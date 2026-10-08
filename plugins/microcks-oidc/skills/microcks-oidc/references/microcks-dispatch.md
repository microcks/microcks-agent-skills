# Microcks dispatch for the OIDC mock

Load this when a mock must answer differently depending on the request: a new case, a
`login_hint` that selects a profile, or a `JS` rule that is not matching.

You do not write these rules by hand. The generator emits them from the declaration. This
file explains what it emits so you can tell whether the declaration is wrong or the request
is.

## The two artefacts

Microcks needs a contract and a set of examples. This mock splits them along what varies:

- `<api>-<version>-openapi.yaml` - the contract. Operations, parameters, schemas, plus the
  discovery response. Ships with the skill, installed by `init`, never rewritten.
- `<api>-<version>-openapi-metadata.yaml` - examples plus `x-microcks-operation` blocks.
  Generated on every build. Import it as a **secondary** artefact, after the contract.

Import order matters: the secondary artefact attaches examples to operations the primary
artefact declared. Import it first and the examples attach to nothing.

### Why discovery sits in the contract

`GET /.well-known/openid-configuration` needs no dispatch: one example answers every caller,
because the endpoint paths are fixed by the protocol and the algorithms and response types
are properties of the mock rather than of its content. It therefore lives in the contract
rather than in the generated artefact.

Parts of it do depend on the declaration, though - `scopes_supported`, `claims_supported`
and `token_endpoint_auth_methods_supported` follow the declared clients and profiles. Each
build syncs those into the contract additively: declared entries are appended if absent, and
nothing is ever removed, so an entry added by hand survives every rebuild. `verify` fails
when a declared scope or claim is not advertised.

Keeping discovery there has a second effect. The document states the `issuer`, and every
`id_token` carries a matching `iss` claim - a relying party rejects the token when the two
disagree. Because the generator reads the issuer out of the contract instead of holding its
own copy, that pair cannot drift. `verify` re-checks the agreement anyway.

The JWKS endpoint stays generated: it exposes the public half of keys the generator creates,
so it varies by construction.

## Dispatcher styles used here

| Endpoint | Dispatcher | Selects on |
|---|---|---|
| `/authorize` | `FALLBACK` wrapping `URI_PARAMS` | the `login_hint` query parameter |
| `/token` | `JS` | the form body: grant type, `client_id`, authorization code |
| `/userinfo` GET | `JS` | the `Authorization` header |
| `/userinfo` POST | `JS` | the access token in the form body |
| `/tokeninfo` | `JS` | the token in the form body |

`FALLBACK` exists because `URI_PARAMS` alone returns nothing when the parameter is absent.
Real clients often omit `login_hint`, so the fallback names the default profile - the first
one declared, or whichever `defaultProfile` points at.

## Case naming

Every case is `case_<key>`, with non-alphanumeric characters folded to `_`. A profile keyed
`profile` produces `case_profile`; a client `application-test` produces
`case_application_test`. Two fixed cases exist for failure paths: `case_invalid_token` on
`/userinfo` POST, and `case_inactive` on `/tokeninfo`.

The same case name must appear on the parameter example, on the response example, and in the
dispatcher rule. That three-way consistency is exactly what the generator guarantees and what
a hand edit breaks.

## How a profile is selected end to end

1. The client redirects to `/authorize`. If it sends `login_hint=<hint>`, the matching
   profile's case is chosen; otherwise the default profile's case is.
2. The mock returns a 302 whose `Location` echoes the caller's `redirect_uri` and `state`
   and appends that profile's authorization code.
3. The client posts the code to `/token`. The `JS` rule matches on `code=<value>` and returns
   that profile's `access_token`, `id_token` and `refresh_token`.
4. The client calls `/userinfo` with the access token. The `JS` rule matches the token string
   and returns that profile's claims.

Consequences worth knowing:

- The authorization code is what carries identity between step 2 and step 3. Two profiles
  must never share a code; the generator derives it from the profile key.
- Steps 3 and 4 match on the **full token string**. Rotating keys changes every token, so
  the dispatch rules change too. That is why `build` rewrites the whole artefact rather than
  patching it.

## Microcks templating

Response values may reference the incoming request:

- `{{ request.params[redirect_uri] }}` - a query parameter.
- `{{ request.headers[host] }}` - a header, used so discovery advertises the host the caller
  actually reached rather than a hard-coded one.

These are Microcks expressions, not YAML. They must survive into the emitted file literally.
The generator builds a Python structure and lets the YAML dumper quote it, so brace escaping
is not a concern - unlike string templating, which is why this generator does not use it.

## Adding a case

Add it to the declaration through a subcommand, then rebuild:

- a new user answer: `add-profile`
- a new failing answer: `add-error-case`
- a new client answer: `add-client`

If you believe a case is needed that none of those produce, the declaration schema is the
thing to extend - `assets/fixtures.schema.json` plus the matching renderer. Do not add the
case by editing the generated YAML; the next `build` erases it.

## Checking a rule without guessing

Ask the running mock rather than reading the rule:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  "<microcks-url>/rest/<api>/<version>/authorize?redirect_uri=<callback>&state=xyz&login_hint=<hint>"
```

A 302 whose `redirect_url` carries the expected code proves the dispatch. Anything else means
the case name, the hint, or the import is wrong - in that order of likelihood.
