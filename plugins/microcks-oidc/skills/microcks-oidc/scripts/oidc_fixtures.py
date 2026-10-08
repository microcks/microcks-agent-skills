#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "cryptography>=42.0,<47",
#     "PyYAML>=6.0,<7",
# ]
# ///
"""Build a Microcks-served OpenID Connect provider mock from a declaration file.

The declaration (``oidc-fixtures.json``) is the single source of truth for what varies:
clients, user profiles, failure paths. This tool is a pure function over it, and owns every
byte of RSA key material, every signed JWT, and the dispatch artefact Microcks serves.
Never hand-edit the emitted YAML.

The OpenAPI contract does not vary in shape: OpenID Connect endpoints and their discovery
document are fixed by the protocol. It therefore ships as a bundled asset that ``init``
installs, and no command ever rewrites it wholesale - it is hand-owned and may be extended.
What the discovery document *advertises* does vary, though, so every build additively syncs
the supported scopes, claims and auth methods into it from the declaration. The merge only
appends: an entry added by hand is never dropped. The contract is also where the provider
identity lives - API name, version and issuer are read from it, so the ``iss`` claim in the
tokens cannot drift from the issuer the discovery document advertises.

Subcommands
    init           create the declaration, key material, and a first build
    show           print the current declaration summary (JSON on stdout)
    add-client     add a client; --grant/--auth cover the client, m2m, jwk and secret cases
    add-profile    add a user profile
    update-profile edit an existing profile in place
    set-claim      set or override a claim on a profile
    remove         drop a client or a profile
    build          regenerate keys, tokens, and the examples artefact
    verify         deterministic self-check of the emitted artefacts

Usage:
    uv run oidc_fixtures.py init --dir ./oidc
    uv run oidc_fixtures.py add-client --dir ./oidc --id svc-test --grant client_credentials
    uv run oidc_fixtures.py build --dir ./oidc
    uv run oidc_fixtures.py verify --dir ./oidc
"""

from __future__ import annotations

import argparse
import base64
import json
import logging
import re
import shutil
import sys
from pathlib import Path
from typing import Any

import yaml
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

EXIT_SUCCESS = 0
EXIT_FAILURE = 1
EXIT_ERROR = 2
EXIT_INTERRUPTED = 130

logger = logging.getLogger(__name__)

CONFIG_NAME = "oidc-fixtures.json"
KEYS_DIRNAME = "keys"
DECLARATION_VERSION = 1

# The OpenID Connect endpoints are fixed by the protocol, so the contract ships with the skill
# instead of being generated. Its discovery example is what makes the mock self-describing, and
# the parts of it that do vary - supported scopes, claims and auth methods - are kept in step with
# the declaration by an additive sync rather than by hand.
BUNDLED_CONTRACT = Path(__file__).resolve().parent.parent / "assets" / "oidc-1.0-openapi.yaml"

GRANT_AUTHORIZATION_CODE = "authorization_code"
GRANT_CLIENT_CREDENTIALS = "client_credentials"
GRANTS = (GRANT_AUTHORIZATION_CODE, GRANT_CLIENT_CREDENTIALS)

AUTH_PRIVATE_KEY_JWT = "private_key_jwt"
AUTH_CLIENT_SECRET = "client_secret"
AUTH_METHODS = (AUTH_PRIVATE_KEY_JWT, AUTH_CLIENT_SECRET)

# Frozen clock: fixtures must be byte-identical from one run to the next.
DEFAULT_ISSUED_AT = 1732031605
DEFAULT_EXPIRES_AT = 2047568005

DEFAULT_SCOPES_USER = ["openid", "profile", "email"]
DEFAULT_SCOPES_M2M = ["api.invoke"]


class FixtureError(Exception):
    """Raised when the declaration or the emitted artefacts are inconsistent."""


class LiteralStr(str):
    """A string rendered as a YAML literal block scalar."""


class FixtureDumper(yaml.SafeDumper):
    """YAML dumper that never emits anchors.

    Repeated example payloads are legitimately identical across operations. Left alone,
    PyYAML collapses them into anchors and aliases, which makes the artefact hard to diff
    and relies on the importer resolving aliases. Fixtures are generated, so duplication
    costs nothing and self-contained examples are the safer contract.
    """

    def ignore_aliases(self, data: Any) -> bool:
        """Always inline repeated nodes."""
        return True


def _literal_representer(dumper: yaml.SafeDumper, data: LiteralStr) -> yaml.ScalarNode:
    return dumper.represent_scalar("tag:yaml.org,2002:str", str(data), style="|")


FixtureDumper.add_representer(LiteralStr, _literal_representer)


# --------------------------------------------------------------------------- paths


def config_path(directory: Path) -> Path:
    """Return the declaration path for a fixtures directory."""
    return directory / CONFIG_NAME


def keys_dir(directory: Path) -> Path:
    """Return the key material directory."""
    return directory / KEYS_DIRNAME


def artefact_slug(config: dict[str, Any]) -> str:
    """Return the file stem shared by the contract and the examples artefact."""
    api = config["api"]
    return f"{slugify(api['name'])}-{api['version']}-openapi"


def contract_path(directory: Path, config: dict[str, Any]) -> Path:
    """Return the hand-owned OpenAPI contract path."""
    return directory / f"{artefact_slug(config)}.yaml"


def metadata_path(directory: Path, config: dict[str, Any]) -> Path:
    """Return the generated examples and dispatch artefact path."""
    return directory / f"{artefact_slug(config)}-metadata.yaml"


def slugify(value: str) -> str:
    """Lowercase a value and keep only characters safe in a file name."""
    return re.sub(r"[^a-z0-9.]+", "-", value.lower()).strip("-")


def case_id(value: str) -> str:
    """Build a Microcks dispatch case identifier from a free-form key."""
    return "case_" + re.sub(r"[^a-zA-Z0-9]+", "_", value).strip("_").lower()


# --------------------------------------------------------------------------- crypto


def base64url(data: bytes) -> str:
    """Encode bytes as unpadded base64url, per RFC 7515."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def base64url_decode(value: str) -> bytes:
    """Decode unpadded base64url back to bytes."""
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def base64url_uint(value: int) -> str:
    """Encode a positive integer the way RSA JWK members are encoded."""
    length = (value.bit_length() + 7) // 8
    return base64url(value.to_bytes(length, "big"))


def load_or_create_key(directory: Path, name: str, *, force_new: bool) -> rsa.RSAPrivateKey:
    """Load a test RSA key, generating it when absent or when rotation was requested.

    These keys protect nothing: they exist so example tokens stay verifiable without
    regeneration, which is why they are committed alongside the fixtures.
    """
    private_path = keys_dir(directory) / f"{name}.private.pem"
    public_path = keys_dir(directory) / f"{name}.public.pem"

    if private_path.exists() and not force_new:
        private_key = serialization.load_pem_private_key(private_path.read_bytes(), password=None)
        if not isinstance(private_key, rsa.RSAPrivateKey):
            raise FixtureError(f"{private_path} does not hold an RSA key")
        logger.debug("key reused: %s", private_path.name)
        return private_key

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    keys_dir(directory).mkdir(parents=True, exist_ok=True)
    private_path.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    public_path.write_bytes(
        private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )
    logger.info("key generated: %s", private_path.name)
    return private_key


def public_jwk(private_key: rsa.RSAPrivateKey, key_id: str) -> dict[str, str]:
    """Build the provider public JWK exposed through the JWKS endpoint."""
    numbers = private_key.public_key().public_numbers()
    return {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": key_id,
        "n": base64url_uint(numbers.n),
        "e": base64url_uint(numbers.e),
    }


def private_jwk(private_key: rsa.RSAPrivateKey, key_id: str) -> dict[str, str]:
    """Build a client private JWK, used by the client to sign its private_key_jwt assertion."""
    numbers = private_key.private_numbers()
    public = numbers.public_numbers
    return {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": key_id,
        "n": base64url_uint(public.n),
        "e": base64url_uint(public.e),
        "d": base64url_uint(numbers.d),
        "p": base64url_uint(numbers.p),
        "q": base64url_uint(numbers.q),
        "dp": base64url_uint(numbers.dmp1),
        "dq": base64url_uint(numbers.dmq1),
        "qi": base64url_uint(numbers.iqmp),
    }


def sign_jwt(claims: dict[str, Any], private_key: rsa.RSAPrivateKey, key_id: str) -> str:
    """Sign a compact RS256 JWT with the provider signing key."""
    header = {"alg": "RS256", "typ": "JWT", "kid": key_id}
    segments = [
        base64url(json.dumps(header, separators=(",", ":"), sort_keys=True).encode()),
        base64url(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()),
    ]
    signing_input = ".".join(segments).encode("ascii")
    signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
    segments.append(base64url(signature))
    return ".".join(segments)


def verify_jwt(token: str, jwks: dict[str, Any]) -> dict[str, Any]:
    """Verify a compact JWT against a JWKS and return its claims.

    Raises FixtureError when the token is malformed, references an unknown key, or carries
    a signature the advertised public key does not validate.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise FixtureError("token is not a compact JWT")
    header = json.loads(base64url_decode(parts[0]))
    matching = [key for key in jwks["keys"] if key["kid"] == header.get("kid")]
    if not matching:
        raise FixtureError(f"no JWKS entry for kid {header.get('kid')!r}")
    key = matching[0]
    public_key = rsa.RSAPublicNumbers(
        e=int.from_bytes(base64url_decode(key["e"]), "big"),
        n=int.from_bytes(base64url_decode(key["n"]), "big"),
    ).public_key()
    try:
        public_key.verify(
            base64url_decode(parts[2]),
            f"{parts[0]}.{parts[1]}".encode("ascii"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
    except InvalidSignature as error:
        raise FixtureError("token signature does not validate against the emitted JWKS") from error
    return json.loads(base64url_decode(parts[1]))


# --------------------------------------------------------------------- declaration


def default_config(identity: dict[str, str]) -> dict[str, Any]:
    """Build an empty declaration around the identity the contract advertises."""
    return {
        "declarationVersion": DECLARATION_VERSION,
        "issuer": identity["issuer"],
        "api": {"name": identity["name"], "version": identity["version"]},
        "signingKeyId": f"{slugify(identity['name'])}-signing-key",
        "clock": {"issuedAt": DEFAULT_ISSUED_AT, "expiresAt": DEFAULT_EXPIRES_AT},
        "defaultProfile": None,
        "clients": [],
        "profiles": [],
        "errorCases": [],
    }


def load_config(directory: Path) -> dict[str, Any]:
    """Read the declaration, failing clearly when it is absent."""
    path = config_path(directory)
    if not path.exists():
        raise FixtureError(f"no declaration at {path}; run 'init' first")
    config: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    validate_config(config)
    return config


def save_config(directory: Path, config: dict[str, Any]) -> None:
    """Validate then persist the declaration."""
    validate_config(config)
    directory.mkdir(parents=True, exist_ok=True)
    config_path(directory).write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def validate_config(config: dict[str, Any]) -> None:
    """Enforce the declaration invariants that the emitted artefacts depend on."""
    if config.get("declarationVersion") != DECLARATION_VERSION:
        raise FixtureError(f"unsupported declarationVersion: {config.get('declarationVersion')}")

    client_ids = [client["id"] for client in config["clients"]]
    if len(client_ids) != len(set(client_ids)):
        raise FixtureError("duplicate client id in declaration")
    profile_keys = [profile["key"] for profile in config["profiles"]]
    if len(profile_keys) != len(set(profile_keys)):
        raise FixtureError("duplicate profile key in declaration")

    for client in config["clients"]:
        if client["grant"] not in GRANTS:
            raise FixtureError(f"client {client['id']}: unknown grant {client['grant']!r}")
        if client["auth"] not in AUTH_METHODS:
            raise FixtureError(f"client {client['id']}: unknown auth method {client['auth']!r}")
        if client["auth"] == AUTH_CLIENT_SECRET and not client.get("secret"):
            raise FixtureError(f"client {client['id']}: client_secret auth requires a secret")

    default_profile = config.get("defaultProfile")
    if default_profile is not None and default_profile not in profile_keys:
        raise FixtureError(f"defaultProfile {default_profile!r} is not a declared profile")
    if config["profiles"] and default_profile is None:
        raise FixtureError("profiles are declared but defaultProfile is unset")


def user_clients(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Return clients driving the authorization-code flow."""
    return [c for c in config["clients"] if c["grant"] == GRANT_AUTHORIZATION_CODE]


def m2m_clients(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Return machine-to-machine clients."""
    return [c for c in config["clients"] if c["grant"] == GRANT_CLIENT_CREDENTIALS]


def primary_user_client(config: dict[str, Any]) -> dict[str, Any]:
    """Return the client whose tokens the user profiles are minted for."""
    clients = user_clients(config)
    if not clients:
        raise FixtureError("no authorization_code client declared; add one with 'add-client'")
    return clients[0]


# ------------------------------------------------------------------------- tokens


def profile_claims(profile: dict[str, Any]) -> dict[str, Any]:
    """Build the identity claims shared by the id_token and the userinfo response."""
    claims: dict[str, Any] = {
        "sub": profile["sub"],
        "name": profile["name"],
        "preferred_username": profile["sub"],
    }
    if profile.get("email"):
        claims["email"] = profile["email"]
    claims.update(profile.get("claims", {}))
    return claims


def build_tokens(config: dict[str, Any], signing_key: rsa.RSAPrivateKey) -> dict[str, Any]:
    """Mint every example token the declaration implies."""
    key_id = config["signingKeyId"]
    issued_at = config["clock"]["issuedAt"]
    expires_at = config["clock"]["expiresAt"]
    tokens: dict[str, Any] = {"profiles": {}, "m2m": {}}

    if config["profiles"]:
        client = primary_user_client(config)
        scopes = " ".join(client["scopes"])
        for profile in config["profiles"]:
            claims = profile_claims(profile)
            access_token = sign_jwt(
                {
                    "iss": config["issuer"],
                    "aud": client["audience"],
                    "azp": client["id"],
                    "client_id": client["id"],
                    "scope": scopes,
                    "sub": claims["sub"],
                    "preferred_username": claims["preferred_username"],
                    "iat": issued_at,
                    "exp": expires_at,
                    "jti": f"access-{profile['key']}",
                },
                signing_key,
                key_id,
            )
            id_token = sign_jwt(
                {
                    "iss": config["issuer"],
                    "aud": client["id"],
                    "auth_time": issued_at,
                    "iat": issued_at,
                    "exp": expires_at,
                    "jti": f"id-{profile['key']}",
                    **claims,
                },
                signing_key,
                key_id,
            )
            tokens["profiles"][profile["key"]] = {
                "code": profile["code"],
                "access_token": access_token,
                "id_token": id_token,
                "refresh_token": f"refresh-token-{profile['key']}",
                "claims": claims,
                "client_id": client["id"],
                "scopes": scopes,
            }

    for client in m2m_clients(config):
        scopes = " ".join(client["scopes"])
        tokens["m2m"][client["id"]] = {
            "access_token": sign_jwt(
                {
                    "iss": config["issuer"],
                    "aud": client["audience"],
                    "azp": client["id"],
                    "client_id": client["id"],
                    "scope": scopes,
                    "sub": client["id"],
                    "iat": issued_at,
                    "exp": expires_at,
                    "jti": f"access-{slugify(client['id'])}",
                },
                signing_key,
                key_id,
            ),
            "scopes": scopes,
        }
    return tokens


# ---------------------------------------------------------------------- rendering


def json_example(payload: Any) -> LiteralStr:
    """Render a JSON example as a YAML literal block."""
    return LiteralStr(json.dumps(payload, indent=2, ensure_ascii=False))


def read_contract(path: Path) -> dict[str, Any]:
    """Load an OpenAPI contract from disk."""
    if not path.exists():
        raise FixtureError(f"no contract at {path}; run 'init' to install the bundled one")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def contract_identity(contract: dict[str, Any]) -> dict[str, str]:
    """Read the provider identity the contract advertises.

    The provider identity is stated once, in the contract, rather than being restated in the
    declaration. That removes any way for the iss claim in the emitted tokens to disagree
    with the issuer the discovery document advertises.
    """
    try:
        response = contract["paths"]["/.well-known/openid-configuration"]["get"]["responses"]
        example = response["200"]["content"]["application/json"]["examples"]["success"]["value"]
        issuer = json.loads(example)["issuer"]
    except (KeyError, TypeError, ValueError) as error:
        raise FixtureError(
            "the contract has no discovery example under /.well-known/openid-configuration, "
            "so it advertises no issuer"
        ) from error
    return {
        "name": str(contract["info"]["title"]),
        "version": str(contract["info"]["version"]),
        "issuer": str(issuer),
    }


def declared_discovery(config: dict[str, Any]) -> dict[str, list[str]]:
    """Return the discovery entries the declaration implies.

    Only what is actually declared is reported: the scopes granted to some client, the claim
    names some profile carries, and the authentication methods some client uses. Nothing is
    invented, so a caller can treat the result as the minimum the provider must advertise.
    """
    scopes: list[str] = []
    auth_methods: list[str] = []
    for client in config["clients"]:
        scopes.extend(client["scopes"])
        auth_methods.append(client["auth"])

    claims: list[str] = []
    for profile in config["profiles"]:
        claims.extend(profile_claims(profile))

    return {
        "scopes_supported": ordered_unique(scopes),
        "claims_supported": ordered_unique(claims),
        "token_endpoint_auth_methods_supported": ordered_unique(auth_methods),
    }


def ordered_unique(values: list[str]) -> list[str]:
    """Deduplicate while preserving first-seen order."""
    return list(dict.fromkeys(values))


def sync_contract_discovery(path: Path, config: dict[str, Any]) -> list[str]:
    """Additively align the contract's discovery example with the declaration.

    The contract is hand-owned: it carries comments and project-specific entries that a YAML
    round-trip would silently destroy, so only the discovery example's JSON block is rewritten
    and the rest of the file is preserved byte for byte.

    The merge only ever appends. An entry already advertised stays, in place, even when no
    client or profile declares it any more - dropping it is how a scope somebody added by
    hand gets lost, and the whole point of this function is that it cannot happen.

    Returns the entries that were added, as ``field: value`` strings.
    """
    original = path.read_text(encoding="utf-8")
    contract = yaml.safe_load(original)
    try:
        response = contract["paths"]["/.well-known/openid-configuration"]["get"]["responses"]
        example = response["200"]["content"]["application/json"]["examples"]["success"]["value"]
        discovery = json.loads(example)
    except (KeyError, TypeError, ValueError) as error:
        raise FixtureError(
            f"{path} has no readable discovery example under "
            "/.well-known/openid-configuration; the declared scopes and claims cannot be "
            "advertised"
        ) from error

    added: list[str] = []
    for field, required in declared_discovery(config).items():
        advertised = discovery.get(field)
        if advertised is not None and not isinstance(advertised, list):
            raise FixtureError(f"{path}: discovery field {field!r} is not a JSON array")
        current = list(advertised or [])
        missing = [value for value in required if value not in current]
        if not missing:
            continue
        discovery[field] = current + missing
        added.extend(f"{field}: {value}" for value in missing)

    if not added:
        return []

    path.write_text(replace_discovery_block(original, discovery, path), encoding="utf-8")
    logger.info("discovery extended in %s: %s", path.name, ", ".join(added))
    return added


def replace_discovery_block(original: str, discovery: dict[str, Any], path: Path) -> str:
    """Swap the discovery JSON literal block, leaving every other byte of the file alone.

    The block is located structurally - the discovery path, then the ``value: |-`` that opens
    its example - rather than by matching the JSON itself, whose formatting is not guaranteed.
    """
    lines = original.splitlines(keepends=True)

    anchor = next(
        (i for i, line in enumerate(lines) if "/.well-known/openid-configuration:" in line),
        None,
    )
    if anchor is None:
        raise FixtureError(f"{path}: no /.well-known/openid-configuration path to update")

    opener = next(
        (i for i in range(anchor, len(lines)) if lines[i].rstrip().endswith("value: |-")),
        None,
    )
    if opener is None:
        raise FixtureError(
            f"{path}: the discovery example is not a 'value: |-' literal block, so it cannot "
            "be updated safely; add the missing entries by hand"
        )

    body_start = opener + 1
    if body_start >= len(lines) or not lines[body_start].strip():
        raise FixtureError(f"{path}: the discovery example block is empty")
    indent = len(lines[body_start]) - len(lines[body_start].lstrip())

    body_end = body_start
    while body_end < len(lines):
        line = lines[body_end]
        if line.strip() and (len(line) - len(line.lstrip())) < indent:
            break
        body_end += 1

    rendered = json.dumps(discovery, indent=2, ensure_ascii=False)
    block = "".join(f"{' ' * indent}{line}\n" for line in rendered.splitlines())
    return "".join(lines[:body_start]) + block + "".join(lines[body_end:])


def authorize_operation(config: dict[str, Any]) -> dict[str, Any]:
    """Render /authorize: the provider hands back an authorization code per profile."""
    default_case = case_id(config["defaultProfile"])
    hints: dict[str, Any] = {}
    locations: dict[str, Any] = {}
    bodies: dict[str, Any] = {}

    entries = [(p["key"], p["loginHint"], p["code"]) for p in config["profiles"]]
    entries += [(e["key"], e["loginHint"], e["code"]) for e in config["errorCases"]]
    for key, hint, code in entries:
        name = case_id(key)
        hints[name] = {"value": hint}
        locations[name] = {
            "value": "{{ request.params[redirect_uri] }}"
            "?state={{ request.params[state] }}"
            f"&code={code}"
        }
        bodies[name] = {"value": "OK"}

    return {
        "x-microcks-operation": {
            "dispatcher": "FALLBACK",
            "dispatcherRules": json_example(
                {
                    "dispatcher": "URI_PARAMS",
                    "dispatcherRules": "login_hint",
                    "fallback": default_case,
                }
            ),
        },
        "parameters": [
            {
                "name": "login_hint",
                "in": "query",
                "required": False,
                "schema": {"type": "string"},
                "examples": hints,
            }
        ],
        "responses": {
            "302": {
                "headers": {"Location": {"examples": locations}},
                "content": {"application/text": {"examples": bodies}},
            }
        },
    }


def token_operation(config: dict[str, Any], tokens: dict[str, Any]) -> dict[str, Any]:
    """Render /token: authorization-code exchange plus machine-to-machine issuance."""
    rules = ["const body = mockRequest.requestContent();"]
    m2m = m2m_clients(config)
    if m2m:
        rules.append('if (body.includes("grant_type=client_credentials")) {')
        for client in m2m[:-1]:
            rules.append(f'  if (body.includes("client_id={client["id"]}")) {{')
            rules.append(f'    return "{case_id(client["id"])}";')
            rules.append("  }")
        rules.append(f'  return "{case_id(m2m[-1]["id"])}";')
        rules.append("}")
    for error in config["errorCases"]:
        rules.append(f'if (body.includes("code={error["code"]}")) {{')
        rules.append(f'  return "{case_id(error["key"])}";')
        rules.append("}")
    for profile in config["profiles"][1:]:
        rules.append(f'if (body.includes("code={profile["code"]}")) {{')
        rules.append(f'  return "{case_id(profile["key"])}";')
        rules.append("}")
    # A machine-to-machine only provider has no profile to fall back on.
    fallback = config["defaultProfile"] or m2m[-1]["id"]
    rules.append(f'return "{case_id(fallback)}";')

    success: dict[str, Any] = {}
    for key, entry in tokens["profiles"].items():
        success[case_id(key)] = {
            "value": json_example(
                {
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": entry["scopes"],
                    "access_token": entry["access_token"],
                    "refresh_token": entry["refresh_token"],
                    "id_token": entry["id_token"],
                }
            )
        }
    for client_id, entry in tokens["m2m"].items():
        success[case_id(client_id)] = {
            "value": json_example(
                {
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "scope": entry["scopes"],
                    "access_token": entry["access_token"],
                }
            )
        }

    responses: dict[str, Any] = {"200": {"content": {"application/json": {"examples": success}}}}
    if config["errorCases"]:
        failures = {
            case_id(error["key"]): {
                "value": json_example(
                    {"error": error["error"], "error_description": error["description"]}
                )
            }
            for error in config["errorCases"]
        }
        responses["400"] = {"content": {"application/json": {"examples": failures}}}

    return {
        "x-microcks-operation": {
            "dispatcher": "JS",
            "dispatcherRules": LiteralStr("\n".join(rules)),
        },
        "responses": responses,
    }


def userinfo_operations(config: dict[str, Any], tokens: dict[str, Any]) -> dict[str, Any]:
    """Render /userinfo for both the Authorization header and the form-body variants."""
    claims = {
        case_id(key): {"value": json_example(entry["claims"])}
        for key, entry in tokens["profiles"].items()
    }
    default_case = case_id(config["defaultProfile"])

    header_rules = [
        'const values = mockRequest.getRequestHeader("Authorization")'
        ' || mockRequest.getRequestHeader("authorization");',
        'const authorization = (values && values.length > 0) ? values[0] : "";',
    ]
    body_rules = ["const body = mockRequest.requestContent();"]
    for key, entry in tokens["profiles"].items():
        header_rules.append(f'if (authorization.includes("{entry["access_token"]}")) {{')
        header_rules.append(f'  return "{case_id(key)}";')
        header_rules.append("}")
        body_rules.append(f'if (body.includes("{entry["access_token"]}")) {{')
        body_rules.append(f'  return "{case_id(key)}";')
        body_rules.append("}")
    header_rules.append(f'return "{default_case}";')
    body_rules.append('return "case_invalid_token";')

    return {
        "get": {
            "x-microcks-operation": {
                "dispatcher": "JS",
                "dispatcherRules": LiteralStr("\n".join(header_rules)),
            },
            "responses": {"200": {"content": {"application/json": {"examples": claims}}}},
        },
        "post": {
            "x-microcks-operation": {
                "dispatcher": "JS",
                "dispatcherRules": LiteralStr("\n".join(body_rules)),
            },
            "responses": {
                "200": {"content": {"application/json": {"examples": claims}}},
                "400": {
                    "content": {
                        "application/json": {
                            "examples": {
                                "case_invalid_token": {
                                    "value": json_example({"error": "invalid_token"})
                                }
                            }
                        }
                    }
                },
            },
        },
    }


def tokeninfo_operation(config: dict[str, Any], tokens: dict[str, Any]) -> dict[str, Any]:
    """Render /tokeninfo: introspection of every issued example token."""
    rules = ["const body = mockRequest.requestContent();"]
    examples: dict[str, Any] = {}

    for client_id, entry in tokens["m2m"].items():
        rules.append(f'if (body.includes("{entry["access_token"]}")) {{')
        rules.append(f'  return "{case_id(client_id)}";')
        rules.append("}")
        examples[case_id(client_id)] = {
            "value": json_example(
                {
                    "active": True,
                    "scope": entry["scopes"],
                    "client_id": client_id,
                    "exp": config["clock"]["expiresAt"],
                }
            )
        }
    for key, entry in tokens["profiles"].items():
        rules.append(f'if (body.includes("{entry["access_token"]}")) {{')
        rules.append(f'  return "{case_id(key)}";')
        rules.append("}")
        examples[case_id(key)] = {
            "value": json_example(
                {
                    "active": True,
                    "scope": entry["scopes"],
                    "client_id": entry["client_id"],
                    "exp": config["clock"]["expiresAt"],
                    "username": entry["claims"]["sub"],
                }
            )
        }
    rules.append('return "case_inactive";')

    return {
        "x-microcks-operation": {
            "dispatcher": "JS",
            "dispatcherRules": LiteralStr("\n".join(rules)),
        },
        "responses": {
            "200": {"content": {"application/json": {"examples": examples}}},
            "400": {
                "content": {
                    "application/json": {
                        "examples": {"case_inactive": {"value": json_example({"active": False})}}
                    }
                }
            },
        },
    }


def render_metadata(config: dict[str, Any], jwks: dict[str, Any], tokens: dict[str, Any]) -> str:
    """Render the secondary Microcks artefact: examples and dispatch rules only.

    The discovery endpoint is absent on purpose: it is served from the contract, which is
    hand-owned and kept in step with the declaration by ``sync_contract_discovery``. Only what
    depends on the declared keys, clients and profiles is emitted here.
    """
    paths: dict[str, Any] = {
        "/.well-known/jwks.json": {
            "get": {
                "responses": {
                    "200": {
                        "content": {
                            "application/json": {
                                "examples": {"success": {"value": json_example(jwks)}}
                            }
                        }
                    }
                }
            }
        },
    }
    if config["profiles"]:
        paths["/authorize"] = {"get": authorize_operation(config)}
        paths["/userinfo"] = userinfo_operations(config, tokens)
    if config["profiles"] or tokens["m2m"]:
        paths["/token"] = {"post": token_operation(config, tokens)}
        paths["/tokeninfo"] = {"post": tokeninfo_operation(config, tokens)}

    document = {
        "openapi": "3.0.1",
        "info": {"title": config["api"]["name"], "version": config["api"]["version"]},
        "paths": paths,
    }
    header = (
        "# Secondary Microcks artefact: examples and dispatch rules ONLY.\n"
        f"# The contract lives in {artefact_slug(config)}.yaml, and serves the discovery\n"
        "# document itself: that response never varies, so it is not generated here.\n"
        "#\n"
        "# GENERATED by oidc_fixtures.py -- do not edit by hand.\n"
        "# Rebuild: uv run oidc_fixtures.py build\n"
    )
    body = yaml.dump(
        document, Dumper=FixtureDumper, sort_keys=False, allow_unicode=True, width=10_000
    )
    return header + body


# ----------------------------------------------------------------------- commands


def emit(payload: dict[str, Any]) -> int:
    """Write a structured result to stdout."""
    json.dump(payload, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return EXIT_SUCCESS


def apply_change(directory: Path, config: dict[str, Any], command: str) -> int:
    """Persist a declaration change and rebuild, rolling back if the rebuild fails.

    Without the rollback a rejected build would leave the declaration ahead of the emitted
    artefacts, and the next reader could not tell which of the two was authoritative.
    """
    path = config_path(directory)
    previous = path.read_text(encoding="utf-8") if path.exists() else None
    save_config(directory, config)
    try:
        result = do_build(directory, force_new_keys=False)
    except Exception:
        if previous is None:
            path.unlink(missing_ok=True)
        else:
            path.write_text(previous, encoding="utf-8")
        logger.error("rebuild failed; declaration rolled back")
        raise
    result["command"] = command
    return emit(result)


def do_build(directory: Path, *, force_new_keys: bool) -> dict[str, Any]:
    """Regenerate key material, tokens, and the examples artefact from the declaration."""
    config = load_config(directory)
    signing_key = load_or_create_key(directory, config["signingKeyId"], force_new=force_new_keys)
    jwks = {"keys": [public_jwk(signing_key, config["signingKeyId"])]}

    written: list[str] = []
    for client in config["clients"]:
        if client["auth"] != AUTH_PRIVATE_KEY_JWT:
            continue
        client_key = load_or_create_key(directory, client["id"], force_new=force_new_keys)
        jwk_path = keys_dir(directory) / f"{client['id']}.jwk.json"
        jwk_path.write_text(
            json.dumps(private_jwk(client_key, f"{client['id']}-key"), indent=2) + "\n",
            encoding="utf-8",
        )
        written.append(str(jwk_path))

    # The contract advertises what the provider supports, so a scope or claim that reached the
    # declaration but not the discovery document would be invisible to every relying party.
    contract = contract_path(directory, config)
    discovery_added = sync_contract_discovery(contract, config) if contract.exists() else []

    tokens = build_tokens(config, signing_key)
    target = metadata_path(directory, config)
    target.write_text(render_metadata(config, jwks, tokens), encoding="utf-8")
    written.append(str(target))
    return {
        "command": "build",
        "metadata": str(target),
        "contract": str(contract),
        "written": written,
        "clients": [c["id"] for c in config["clients"]],
        "profiles": [p["key"] for p in config["profiles"]],
        "discoveryAdded": discovery_added,
        "keysRotated": force_new_keys,
    }


def cmd_init(args: argparse.Namespace) -> int:
    """Install the bundled contract and derive a declaration from it."""
    directory: Path = args.dir
    if config_path(directory).exists() and not args.force:
        raise FixtureError(f"{config_path(directory)} already exists; pass --force to overwrite")

    identity = contract_identity(read_contract(BUNDLED_CONTRACT))
    target = contract_path(directory, default_config(identity))
    installed = not target.exists()
    if installed:
        directory.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BUNDLED_CONTRACT, target)
        logger.info("contract installed: %s", target.name)
    else:
        # A contract already on disk wins: it is hand-owned and may have been extended.
        identity = contract_identity(read_contract(target))
        logger.info("contract reused: %s", target.name)

    config = default_config(identity)
    save_config(directory, config)
    logger.info("declaration created: %s", config_path(directory))

    result = do_build(directory, force_new_keys=False)
    result["command"] = "init"
    result["contractInstalled"] = installed
    result["issuer"] = identity["issuer"]
    return emit(result)


def cmd_show(args: argparse.Namespace) -> int:
    """Print the current declaration summary."""
    directory: Path = args.dir
    config = load_config(directory)
    return emit(
        {
            "command": "show",
            "declaration": str(config_path(directory)),
            "issuer": config["issuer"],
            "api": config["api"],
            "defaultProfile": config["defaultProfile"],
            "clients": [
                {
                    "id": c["id"],
                    "grant": c["grant"],
                    "auth": c["auth"],
                    "audience": c["audience"],
                    "scopes": c["scopes"],
                }
                for c in config["clients"]
            ],
            "profiles": [
                {"key": p["key"], "sub": p["sub"], "claims": sorted(p.get("claims", {}))}
                for p in config["profiles"]
            ],
            "errorCases": [e["key"] for e in config["errorCases"]],
            "contract": str(contract_path(directory, config)),
            "metadata": str(metadata_path(directory, config)),
        }
    )


def cmd_add_client(args: argparse.Namespace) -> int:
    """Add a client. --grant and --auth cover the client, m2m, jwk and secret cases."""
    directory: Path = args.dir
    config = load_config(directory)
    if any(c["id"] == args.id for c in config["clients"]):
        raise FixtureError(f"client {args.id!r} already declared")
    scopes = args.scopes or (
        DEFAULT_SCOPES_M2M if args.grant == GRANT_CLIENT_CREDENTIALS else DEFAULT_SCOPES_USER
    )
    config["clients"].append(
        {
            "id": args.id,
            "grant": args.grant,
            "auth": args.auth,
            "audience": args.audience or f"{args.id}-api",
            "scopes": scopes,
            "secret": args.secret,
        }
    )
    logger.info("client added: %s", args.id)
    return apply_change(directory, config, "add-client")


def cmd_add_profile(args: argparse.Namespace) -> int:
    """Add a user profile and the authorization code it is reached by."""
    directory: Path = args.dir
    config = load_config(directory)
    if any(p["key"] == args.key for p in config["profiles"]):
        raise FixtureError(f"profile {args.key!r} already declared")
    claims = dict(parse_claim(item) for item in args.claim or [])
    claims.update(dict(parse_claim_list(item) for item in args.claim_list or []))
    config["profiles"].append(
        {
            "key": args.key,
            "sub": args.sub or args.key,
            "name": args.name or args.key,
            "email": args.email,
            "loginHint": args.login_hint or (args.sub or args.key),
            "code": args.code or f"code-{slugify(args.key)}",
            "claims": claims,
        }
    )
    if config["defaultProfile"] is None:
        config["defaultProfile"] = args.key
    logger.info("profile added: %s", args.key)
    return apply_change(directory, config, "add-profile")


def cmd_update_profile(args: argparse.Namespace) -> int:
    """Change an existing profile in place, leaving its claims and its position alone.

    Removing and re-adding would work, but it moves the profile to the end of the list, and
    the first profile is the one /authorize falls back to - so a rename would silently
    repoint the default identity.
    """
    directory: Path = args.dir
    config = load_config(directory)
    matching = [p for p in config["profiles"] if p["key"] == args.key]
    if not matching:
        raise FixtureError(f"unknown profile {args.key!r}")
    profile = matching[0]

    updates = {
        "sub": args.sub,
        "name": args.name,
        "email": args.email,
        "loginHint": args.login_hint,
        "code": args.code,
    }
    changed = {field: value for field, value in updates.items() if value is not None}
    if not changed:
        raise FixtureError(
            f"nothing to update on profile {args.key!r}; "
            "pass at least one of --sub, --name, --email, --login-hint, --code"
        )
    profile.update(changed)
    logger.info("profile updated: %s (%s)", args.key, ", ".join(sorted(changed)))
    return apply_change(directory, config, "update-profile")


def cmd_set_claim(args: argparse.Namespace) -> int:
    """Set or override one claim on an existing profile."""
    directory: Path = args.dir
    config = load_config(directory)
    matching = [p for p in config["profiles"] if p["key"] == args.profile]
    if not matching:
        raise FixtureError(f"unknown profile {args.profile!r}")
    name, value = parse_claim_list(args.value_list) if args.value_list else parse_claim(args.value)
    matching[0].setdefault("claims", {})[name] = value
    logger.info("claim set on %s: %s", args.profile, name)
    return apply_change(directory, config, "set-claim")


def cmd_add_error_case(args: argparse.Namespace) -> int:
    """Add a rejected-login path, reached through its own login_hint."""
    directory: Path = args.dir
    config = load_config(directory)
    if any(e["key"] == args.key for e in config["errorCases"]):
        raise FixtureError(f"error case {args.key!r} already declared")
    config["errorCases"].append(
        {
            "key": args.key,
            "loginHint": args.login_hint or args.key,
            "code": args.code or f"code-{slugify(args.key)}",
            "error": args.error,
            "description": args.description or args.error,
        }
    )
    logger.info("error case added: %s", args.key)
    return apply_change(directory, config, "add-error-case")


def cmd_remove(args: argparse.Namespace) -> int:
    """Drop a client or a profile from the declaration."""
    directory: Path = args.dir
    config = load_config(directory)
    if args.kind == "client":
        remaining = [c for c in config["clients"] if c["id"] != args.id]
        if len(remaining) == len(config["clients"]):
            raise FixtureError(f"unknown client {args.id!r}")
        config["clients"] = remaining
    else:
        remaining = [p for p in config["profiles"] if p["key"] != args.id]
        if len(remaining) == len(config["profiles"]):
            raise FixtureError(f"unknown profile {args.id!r}")
        config["profiles"] = remaining
        if config["defaultProfile"] == args.id:
            config["defaultProfile"] = remaining[0]["key"] if remaining else None
    logger.info("%s removed: %s", args.kind, args.id)
    return apply_change(directory, config, "remove")


def cmd_build(args: argparse.Namespace) -> int:
    """Regenerate every emitted artefact."""
    return emit(do_build(args.dir, force_new_keys=args.force_new_keys))


def cmd_verify(args: argparse.Namespace) -> int:
    """Check the emitted artefacts deterministically."""
    directory: Path = args.dir
    config = load_config(directory)
    checks: list[dict[str, Any]] = []
    failures: list[str] = []

    def record(name: str, ok: bool, detail: str = "") -> None:
        checks.append({"check": name, "ok": ok, "detail": detail})
        if not ok:
            failures.append(f"{name}: {detail}")

    target = metadata_path(directory, config)
    if not target.exists():
        record("metadata-present", False, f"{target} is missing; run 'build'")
        emit({"command": "verify", "ok": False, "checks": checks, "failures": failures})
        return EXIT_FAILURE
    document = yaml.safe_load(target.read_text(encoding="utf-8"))
    record("metadata-present", True, str(target))

    jwks_example = document["paths"]["/.well-known/jwks.json"]["get"]["responses"]["200"]
    jwks = json.loads(jwks_example["content"]["application/json"]["examples"]["success"]["value"])

    signing_path = keys_dir(directory) / f"{config['signingKeyId']}.private.pem"
    record("signing-key-present", signing_path.exists(), str(signing_path))

    verified = 0
    bad_tokens: list[str] = []
    for path, operations in document["paths"].items():
        for method, operation in operations.items():
            for response in operation.get("responses", {}).values():
                for media in response.get("content", {}).values():
                    for name, example in media.get("examples", {}).items():
                        payload = example["value"]
                        if not isinstance(payload, str) or not payload.lstrip().startswith("{"):
                            continue
                        for field in ("access_token", "id_token"):
                            token = json.loads(payload).get(field)
                            if not token:
                                continue
                            try:
                                verify_jwt(token, jwks)
                                verified += 1
                            except FixtureError as error:
                                bad_tokens.append(f"{method.upper()} {path} {name} {field}: {error}")
    record(
        "jwt-signatures",
        not bad_tokens,
        "; ".join(bad_tokens)
        or f"{verified} token(s) validated against the emitted JWKS",
    )

    contract = contract_path(directory, config)
    if contract.exists():
        declared_contract = read_contract(contract)
        declared = declared_contract.get("paths", {})
        orphans = [
            f"{method.upper()} {path}"
            for path, operations in document["paths"].items()
            for method in operations
            if method not in declared.get(path, {})
        ]
        record("examples-covered-by-contract", not orphans, ", ".join(orphans) or "all operations declared")

        identity = contract_identity(declared_contract)
        drift = [
            f"{field}: contract={identity[field]!r} declaration={value!r}"
            for field, value in (
                ("name", config["api"]["name"]),
                ("version", config["api"]["version"]),
                ("issuer", config["issuer"]),
            )
            if identity[field] != value
        ]
        record(
            "declaration-matches-contract",
            not drift,
            "; ".join(drift) or "name, version and issuer agree",
        )

        # A scope or claim missing here is invisible to relying parties, however correct the
        # tokens are, so this is the check that proves nothing was dropped on the way in.
        try:
            discovery_response = declared_contract["paths"][
                "/.well-known/openid-configuration"
            ]["get"]["responses"]
            advertised = json.loads(
                discovery_response["200"]["content"]["application/json"]["examples"][
                    "success"
                ]["value"]
            )
        except (KeyError, TypeError, ValueError):
            record(
                "discovery-covers-declaration",
                False,
                "the contract has no readable discovery example",
            )
        else:
            uncovered = [
                f"{field}: {value}"
                for field, required in declared_discovery(config).items()
                for value in required
                if value not in (advertised.get(field) or [])
            ]
            record(
                "discovery-covers-declaration",
                not uncovered,
                "; ".join(uncovered)
                or "every declared scope, claim and auth method is advertised",
            )
    else:
        record("contract-present", False, f"{contract} is missing")

    for client in config["clients"]:
        if client["auth"] != AUTH_PRIVATE_KEY_JWT:
            continue
        jwk_path = keys_dir(directory) / f"{client['id']}.jwk.json"
        record(f"client-key {client['id']}", jwk_path.exists(), str(jwk_path))

    ok = not failures
    emit({"command": "verify", "ok": ok, "checks": checks, "failures": failures})
    return EXIT_SUCCESS if ok else EXIT_FAILURE


def parse_claim(item: str) -> tuple[str, Any]:
    """Parse a ``name=value`` claim argument."""
    if "=" not in item:
        raise FixtureError(f"claim {item!r} must use name=value")
    name, value = item.split("=", 1)
    return name, value


def parse_claim_list(item: str) -> tuple[str, list[str]]:
    """Parse a ``name=v1,v2`` multi-valued claim argument."""
    name, value = parse_claim(item)
    return name, [part for part in value.split(",") if part]


# ------------------------------------------------------------------------- parser


def create_parser() -> argparse.ArgumentParser:
    """Create and configure the argument parser."""
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="enable debug traces")
    subparsers = parser.add_subparsers(dest="command", required=True)

    def with_dir(sub: argparse.ArgumentParser) -> argparse.ArgumentParser:
        sub.add_argument(
            "--dir", type=Path, default=Path.cwd(), help="fixtures directory (default: cwd)"
        )
        return sub

    init = with_dir(subparsers.add_parser("init", help="install the contract and declare a mock"))
    init.add_argument("--force", action="store_true", help="overwrite an existing declaration")
    init.set_defaults(func=cmd_init)

    with_dir(subparsers.add_parser("show", help="print the declaration summary")).set_defaults(
        func=cmd_show
    )

    client = with_dir(subparsers.add_parser("add-client", help="add a client"))
    client.add_argument("--id", required=True, help="client_id")
    client.add_argument("--grant", choices=GRANTS, default=GRANT_AUTHORIZATION_CODE)
    client.add_argument("--auth", choices=AUTH_METHODS, default=AUTH_PRIVATE_KEY_JWT)
    client.add_argument("--audience", help="aud claim (default: <id>-api)")
    client.add_argument("--scopes", nargs="*", help="granted scopes")
    client.add_argument("--secret", help="required when --auth client_secret")
    client.set_defaults(func=cmd_add_client)

    profile = with_dir(subparsers.add_parser("add-profile", help="add a user profile"))
    profile.add_argument("--key", required=True, help="profile key, used in dispatch case names")
    profile.add_argument("--sub", help="sub claim (default: --key)")
    profile.add_argument("--name", help="name claim")
    profile.add_argument("--email", help="email claim")
    profile.add_argument("--login-hint", help="login_hint selecting this profile")
    profile.add_argument("--code", help="authorization code (default: code-<key>)")
    profile.add_argument("--claim", action="append", help="extra claim, name=value")
    profile.add_argument("--claim-list", action="append", help="multi-valued claim, name=v1,v2")
    profile.set_defaults(func=cmd_add_profile)

    update = with_dir(subparsers.add_parser("update-profile", help="edit a profile in place"))
    update.add_argument("--key", required=True, help="key of the profile to update")
    update.add_argument("--sub", help="new sub claim")
    update.add_argument("--name", help="new name claim")
    update.add_argument("--email", help="new email claim")
    update.add_argument("--login-hint", help="new login_hint selecting this profile")
    update.add_argument("--code", help="new authorization code")
    update.set_defaults(func=cmd_update_profile)

    claim = with_dir(subparsers.add_parser("set-claim", help="set a claim on a profile"))
    claim.add_argument("--profile", required=True)
    claim.add_argument("--value", help="name=value")
    claim.add_argument("--value-list", help="name=v1,v2")
    claim.set_defaults(func=cmd_set_claim)

    remove = with_dir(subparsers.add_parser("remove", help="drop a client or a profile"))
    remove.add_argument("kind", choices=("client", "profile"))
    remove.add_argument("id")
    remove.set_defaults(func=cmd_remove)
    error = with_dir(subparsers.add_parser("add-error-case", help="add a rejected-login path"))
    error.add_argument("--key", required=True, help="case key, used in dispatch case names")
    error.add_argument("--error", default="invalid_client", help="OAuth 2.0 error code")
    error.add_argument("--description", help="error_description value")
    error.add_argument("--login-hint", help="login_hint selecting this case")
    error.add_argument("--code", help="authorization code (default: code-<key>)")
    error.set_defaults(func=cmd_add_error_case)

    build = with_dir(subparsers.add_parser("build", help="regenerate the emitted artefacts"))
    build.add_argument(
        "--force-new-keys",
        action="store_true",
        help="rotate every RSA key; invalidates all previously issued example tokens",
    )
    build.set_defaults(func=cmd_build)

    with_dir(subparsers.add_parser("verify", help="check the emitted artefacts")).set_defaults(
        func=cmd_verify
    )
    return parser


def configure_logging(verbose: bool) -> None:
    """Send diagnostics to stderr, keeping stdout for structured results."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
        stream=sys.stderr,
    )


def main() -> int:
    """Main entry point for the script."""
    args = create_parser().parse_args()
    configure_logging(args.verbose)
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return EXIT_INTERRUPTED
    except FixtureError as error:
        print(f"error: {error}", file=sys.stderr)
        return EXIT_ERROR
    except Exception as error:  # noqa: BLE001 - CLI boundary: one message, no traceback
        print(f"error: {error}", file=sys.stderr)
        return EXIT_FAILURE


if __name__ == "__main__":
    sys.exit(main())
