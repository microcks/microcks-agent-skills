---
name: microcks-oidc
description: >
  Use when building or changing a mock OpenID Connect provider served by Microcks:
  adding a client, a machine-to-machine client, a user profile and its claims, a client
  JWK or a client_secret, or regenerating the signed id_token and access_token examples.
  Use when a task mentions the OIDC mock, a fake identity provider, JWKS, private_key_jwt,
  client_credentials, login_hint dispatch, or the authorize, token, userinfo and tokeninfo
  endpoints.
  Use when a login against the mock fails with invalid_client, invalid_token or a missing
  id_token, or when a test needs a second user with a different role.
  A bundled generator owns every RSA key, signed token and dispatch rule: never hand-edit
  the generated artefact and never hand-write a JWT.
  Produces files only; running a Microcks server, importing into it, and wiring the mock
  into an application or a test suite are out of scope.
---

# Microcks OIDC provider fixtures

Build a mock OpenID Connect provider from a declaration file. A bundled generator owns
every RSA key, every signed JWT, and the whole dispatch artefact Microcks serves.

## What this owns, and what it does not

This skill produces files. Nothing more.

| Owned here | Not owned here |
|---|---|
| The fixtures declaration and the generated examples artefact | Running a Microcks server, and importing artefacts into it |
| The bundled OpenID Connect contract, installed on `init` | Configuring the application that authenticates against the mock |
| RSA key material, JWKS, signed `id_token` / `access_token` | Wiring the mock into a test suite, in any language |
| Microcks dispatch rules for the OIDC endpoints | |

How a project runs Microcks and publishes artefacts into it varies - a compose file, a CLI,
a CI step, a hosted instance. Discover it; never assume one.

## The one rule

**You never write a token, a key, a JWK or a line of the metadata YAML.** They are computed.
An RS256 signature cannot be produced by inference; a hand-written example token is a token
no client will ever accept. Your job is to translate intent into a subcommand and read the
result back.

The declaration `oidc-fixtures.json` is the single source of truth. Do not hand-edit it
either: the `add-*` subcommands enforce invariants (unique ids, an auth method consistent
with its key material, a default profile that exists) that a text edit silently breaks.

## Preflight

The generator is a PEP 723 script; its dependencies are pinned in its own header and
resolved by `uv`. The system Python is frequently too old to run it, so probe first:

```bash
command -v uv
```

- Found: proceed, invoking every command as `uv run <skill>/scripts/oidc_fixtures.py ...`.
- Not found: stop and ask the operator to install `uv`. Do not fall back to `python3` and do
  not pip-install into the system interpreter.

Then read the current state before changing anything:

```bash
uv run scripts/oidc_fixtures.py show --dir <fixtures-dir>
```

`show` is how you learn which clients and profiles exist. Never answer that from memory.

## Which command for which request

The operator's vocabulary maps onto two verbs. There is no separate command per noun.

| Operator asks for | Command |
|---|---|
| a client (browser login) | `add-client --grant authorization_code` |
| an m2m / service / machine-to-machine client | `add-client --grant client_credentials` |
| a client authenticated by JWK | `add-client --auth private_key_jwt` (default) |
| a client authenticated by a secret | `add-client --auth client_secret --secret <value>` |
| a user / profile / role | `add-profile` |
| a change to an existing user's identity | `update-profile` |
| an extra claim on a user | `set-claim` |
| a rejected-login path | `add-error-case` |

Never invent a value the operator did not give. A `sub`, an email or a role you guessed
produces a mock that authenticates the wrong person. When a request leaves any of those
unstated, ask - with the `askQuestions` tool if one is available - and only then run the
command. When every element is already stated, run it without asking.

## Commands

All commands take `--dir <fixtures-dir>`. All are non-interactive, print JSON on stdout and
diagnostics on stderr, and rebuild every artefact on success.

| Command | Effect |
|---|---|
| `init` | Install the bundled OIDC contract, derive the declaration from it, generate keys, build. |
| `show` | Print the current clients, profiles, error cases and artefact paths. |
| `add-client` | Add a client. `--grant`, `--auth`, `--audience`, `--scopes`, `--secret`. |
| `add-profile` | Add a user. `--key`, `--sub`, `--name`, `--email`, `--claim`, `--claim-list`. |
| `update-profile` | Edit a user in place: `--key` plus `--sub`, `--name`, `--email`, `--login-hint`, `--code`. |
| `set-claim` | Set one claim: `--profile <key> --value name=v` or `--value-list name=v1,v2`. |
| `add-error-case` | Add a failing login path: `--key`, `--error`, `--description`. |
| `remove` | `remove client <id>` or `remove profile <key>`. |
| `build` | Regenerate keys, tokens and the metadata artefact. |
| `verify` | Deterministic self-check. Exit code 1 when a check fails. |

Run `uv run scripts/oidc_fixtures.py <command> --help` for the full flag list rather than
guessing a flag name.

A rejected change is rolled back: if the rebuild fails, the declaration returns to its
previous content. A non-zero exit therefore means nothing changed.

## Emitted layout

```
<fixtures-dir>/
  oidc-fixtures.json                     declaration - what varies: clients, profiles
  <api>-<version>-openapi.yaml           contract - installed from the bundle, never rewritten
  <api>-<version>-openapi-metadata.yaml  GENERATED - examples and dispatch rules
  keys/
    <signing-key>.private.pem            provider signing key
    <signing-key>.public.pem
    <client-id>.private.pem              per-client key material
    <client-id>.jwk.json                 private JWK the client signs its assertion with
```

The contract is not generated. OpenID Connect endpoints and their discovery document are
fixed by the protocol, so the contract ships with this skill and `init` copies it in. A
contract already present in the directory is kept as is - it is hand-owned and may have been
extended.

What that document *advertises* is not fixed, though: `scopes_supported`, `claims_supported`
and `token_endpoint_auth_methods_supported` follow the declared clients and profiles. Every
build syncs them into the contract **additively** - a declared entry missing from discovery
is appended, and nothing already advertised is ever removed, so a scope somebody added by
hand survives every rebuild. Only that one JSON block is rewritten; comments and every other
line of the contract are preserved. `build` reports what it added under `discoveryAdded`.

The contract also states the provider identity: API name, version, and the `issuer` that the
discovery document advertises. The generator reads those from it rather than keeping its own
copy, so the `iss` claim in every token matches what the provider announces. `verify` checks
the agreement, checks that every declared scope and claim is advertised, and checks that
every generated example targets an operation the contract actually declares.

## Workflows

**Bootstrap a provider.** `init` installs the contract and writes an empty declaration. Then
one `add-client` per client, one `add-profile` per user, then `verify`. The first profile
added becomes the default the dispatcher falls back to when no `login_hint` matches.

**Add a user to an existing provider.** `show` to see the existing profile keys, then
`add-profile`, then `verify`. Claims beyond `sub` / `name` / `email` / `preferred_username`
are explicit: pass `--claim name=value`, or `--claim-list name=v1,v2` for a list-valued
claim. To change a user already declared, use `update-profile` rather than `remove` plus
`add-profile`: removing moves the profile to the end of the list, and the first profile is
the one `/authorize` falls back to.

**Add a machine-to-machine client.** `add-client --grant client_credentials`. It gets an
`access_token` and an introspection example, and no `id_token` - correct, since
`client_credentials` authenticates no user.

**After any change, publish the artefacts.** The generator writes files; it does not publish
them, so nothing you changed is live yet. Importing is the project's job and differs per
setup - look for an import script, a compose service, or a CI step rather than inventing a
command. Import the contract first and the metadata artefact second, then confirm the API is
actually being served instead of assuming it:

```bash
curl -s <microcks-url>/api/services
```

## Rotating keys - stop and ask first

`build --force-new-keys` regenerates every RSA key. It invalidates every previously issued
example token and breaks any consumer that pinned a JWK or a public PEM - an application
still holding the old client JWK starts failing with `invalid_client`.

Before running it, state the blast radius and get an explicit confirmation. Never pass this
flag as part of a routine rebuild; an ordinary `build` reuses existing keys on purpose.

## Verifying

`verify` is the deterministic gate; do not substitute your own reading of the YAML for it.
It checks that every emitted `access_token` and `id_token` validates against the emitted
JWKS, that the signing key and each client's key material exist, that every declared scope,
claim and auth method is advertised by the discovery document, and that no generated example
targets an operation absent from the contract.

Read its `checks` array. A failing check names the artefact at fault.

## Before you report back

- Did every value come from a command, or did any come from recall?
- Did `verify` exit zero, or did you infer success from `build` alone?
- Did you tell the operator the artefacts still need importing into Microcks?
- If keys were rotated, did the operator explicitly approve it?

## Deeper references

- Read `references/microcks-dispatch.md` when a request needs a mock to answer differently
  depending on the request - a new dispatch case, a `login_hint` that selects a profile, or
  a `JS` dispatcher rule that is not matching.
- Read `references/troubleshooting.md` when a login or token exchange fails against the
  mock - `invalid_client`, `invalid_token`, a missing `id_token`, a nonce or signature
  rejection, or an import that reports no service.
