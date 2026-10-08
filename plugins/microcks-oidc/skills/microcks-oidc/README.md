---
title: microcks-oidc
description: Maintainer guide for the skill that generates a mock OpenID Connect provider served by Microcks
---

## What this is

A skill that turns a declaration file into everything a Microcks instance needs to serve a
working OpenID Connect provider: RSA key material, a JWKS, signed `id_token` and
`access_token` examples, and the dispatch rules that pick which of them to return.

Two audiences, two documents:

| File | Read by | Purpose |
|---|---|---|
| `SKILL.md` | the agent | How to translate a request into a command. Loaded into context. |
| `README.md` | you | Why it is built this way, and how to change it. Never loaded. |

If you only want to use the skill, `SKILL.md` is enough. Read on to modify it.

## How it works

The pivot is a separation between what varies and what does not.

```
declaration (data)  ->  generator (pure function)  ->  artefacts
oidc-fixtures.json      scripts/oidc_fixtures.py      keys + metadata YAML
```

The agent never writes a token, a key, or a line of YAML. It reads the current state with
`show`, translates intent into a subcommand, and reads the result back. Everything a client
will actually verify is computed on a CPU.

This is not stylistic. An RS256 signature cannot be produced by inference, so a
model-authored token is a token no OIDC client will accept. Two further consequences follow:

- The `add-*` subcommands mutate the declaration, rather than the agent editing the JSON as
  text. A text edit reorders keys, drops fields, and invents grant types, and each of those
  drifts surfaces much later as a broken login. The commands enforce the invariants instead:
  unique ids, an auth method consistent with its key material, a default profile that exists.
- The generated artefact never enters the model's output. A provider with two clients and two
  profiles produces roughly 340 lines of YAML full of JWTs. Emitting that through a model
  costs output tokens and is high variance; emitting it from the CPU costs nothing and is
  byte-reproducible.

## Layout

| Path | Role |
|---|---|
| `SKILL.md` | Agent-facing body. Budget: 500 lines, 5000 tokens. |
| `scripts/oidc_fixtures.py` | The generator. Single-file, PEP 723, pinned dependencies. |
| `assets/oidc-1.0-openapi.yaml` | The OpenID Connect contract, installed by `init` and then hand-owned. |
| `assets/fixtures.schema.json` | JSON Schema of the declaration. Documents every field. |
| `references/microcks-dispatch.md` | Loaded on demand: how the dispatch rules are shaped. |
| `references/troubleshooting.md` | Loaded on demand: symptom to cause, for failing logins. |

The two `references/` files stay out of the agent's context until a specific condition is
met. `SKILL.md` states that condition at each link; keep it that way when adding one.

## Commands

Every subcommand takes `--dir <fixtures-dir>`, is non-interactive, prints JSON on stdout and
diagnostics on stderr, and rebuilds all artefacts on success.

```bash
uv run scripts/oidc_fixtures.py <command> --help
```

| Command | Effect |
|---|---|
| `init` | Install the contract, derive the declaration from it, generate keys, build. |
| `show` | Print current clients, profiles, error cases and artefact paths. |
| `add-client` | `--id`, `--grant`, `--auth`, `--audience`, `--scopes`, `--secret`. |
| `add-profile` | `--key`, `--sub`, `--name`, `--email`, `--login-hint`, `--code`, `--claim`, `--claim-list`. |
| `update-profile` | `--key` plus any of `--sub`, `--name`, `--email`, `--login-hint`, `--code`. Edits in place. |
| `set-claim` | `--profile` plus `--value name=v` or `--value-list name=v1,v2`. |
| `add-error-case` | `--key`, `--error`, `--description` for a rejected-login path. |
| `remove` | `remove client <id>` or `remove profile <key>`. |
| `build` | Regenerate keys, tokens, metadata. `--force-new-keys` rotates. |
| `verify` | Deterministic self-check. Exit 1 on any failure. |

Five operator nouns collapse onto two verbs, which is why there is no `add-m2m` or `add-jwk`:
a machine-to-machine client is `add-client --grant client_credentials`, and JWK versus secret
is `--auth`.

## Generated versus shipped

Only what depends on the declaration is generated.

| Artefact | Origin |
|---|---|
| `<api>-<version>-openapi.yaml` | Shipped in `assets/`, copied by `init`, never rewritten. |
| `<api>-<version>-openapi-metadata.yaml` | Generated on every build. |
| `keys/*.pem`, `keys/*.jwk.json` | Generated once, reused until rotation. |

The contract carries the discovery response. That response does not vary with the declared
clients or profiles, since the endpoint paths are fixed by the protocol, so generating it
would be work without variation.

It also has a load-bearing side effect. Discovery states the `issuer`, and every `id_token`
carries a matching `iss` claim; a relying party rejects the token when the two disagree. The
generator reads the identity (API name, version, issuer) out of the contract instead of
holding its own copy, so the pair cannot drift. `verify` re-checks it anyway.

A static discovery document costs one guarantee, which `verify` buys back. When discovery was
generated, `scopes_supported` and `token_endpoint_auth_methods_supported` were derived from
the declared clients and could not disagree with them. Now they are written by hand, so they
can fall behind: declare a client with a new scope, forget the contract, and the mock still
serves a discovery document that never mentions it. The `discovery-covers-declaration` check
fails in that case, naming each declared scope, claim or auth method the contract does not
advertise.

A contract already present in the target directory is left alone: it is hand-owned and may
have been extended with project-specific scopes or claims.

## Extending it

Adding a field to the declaration touches three places, in this order:

1. `assets/fixtures.schema.json` - declare the field and what it means.
2. `scripts/oidc_fixtures.py` - accept it in the relevant `cmd_*`, validate it in
   `validate_config`, and consume it in the renderer that needs it.
3. `verify` - add a check if the field can be wrong in a way a green build would hide.

Never add a field the CLI cannot set. A declarable-but-unreachable field forces the agent to
hand-edit the JSON, which is the one thing this design exists to prevent.

Adding a dispatch case follows the same rule: it comes from a subcommand, never from editing
the generated YAML, which the next `build` overwrites.

## Validating a change

```bash
D=$(mktemp -d)
uv run scripts/oidc_fixtures.py init        --dir "$D"
uv run scripts/oidc_fixtures.py add-client  --dir "$D" --id app --grant authorization_code
uv run scripts/oidc_fixtures.py add-client  --dir "$D" --id svc --grant client_credentials
uv run scripts/oidc_fixtures.py add-profile --dir "$D" --key u1 --sub user1 --name "User One"
uv run scripts/oidc_fixtures.py verify      --dir "$D"
```

`verify` asserts that every emitted token validates against the emitted JWKS, that key
material exists for each client, that no generated example targets an operation absent from
the contract, that the declaration still agrees with the contract identity, and that the
discovery document advertises every scope, claim and auth method the declaration declares.

Two properties worth re-checking by hand after touching the renderer:

- Rebuilding twice produces byte-identical output. Timestamps are frozen for this reason.
- The emitted YAML contains no anchors or aliases. PyYAML deduplicates identical blocks by
  default; `FixtureDumper` disables it so every example stays self-contained.

## Invariants that already broke once

Each of these was a real defect caught during validation. They are the first things to
re-test after a change.

| Invariant | How it broke |
|---|---|
| A provider with only m2m clients builds | `/token` fell back to `defaultProfile`, null until a profile exists. |
| A rejected change leaves no partial state | The declaration was saved before the rebuild that then failed. |
| Emitted YAML has no aliases | PyYAML collapsed the two identical userinfo blocks into `*id001`. |
| `init` produces an importable directory | No contract was installed, so nothing could be imported. |
| Every declaration field has a subcommand | `errorCases` was declarable with no way to create one. |

## Scope

This skill produces files. Running a Microcks server, importing into it, and wiring the mock
into an application or a test suite are all out of scope, and deliberately so: those differ
per project, and baking one setup into the skill would make it unusable elsewhere.

Key rotation (`build --force-new-keys`) is the only irreversible operation. It invalidates
every previously issued token and breaks any consumer holding a pinned JWK. `SKILL.md`
requires explicit human approval before it runs.
