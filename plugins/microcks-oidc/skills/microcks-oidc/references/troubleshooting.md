# Troubleshooting the OIDC mock

Load this when a login or token exchange fails against the mock. Each entry names the
observable symptom first, because that is what you actually have.

Confirm the symptom with a command before acting on it. Most entries below were originally
diagnosed as the wrong thing.

## The mock serves nothing

**Symptom.** `GET /rest/OIDC/1.0/.well-known/openid-configuration` returns 404, or the
service list is empty.

**Check.** `curl -s <microcks-url>/api/services | grep -o '"name":"[^"]*"'`

Likely causes, in order:

1. The artefacts were generated but never imported. Generation and publication are separate
   steps; `build` only writes files.
2. The import ran but silently did nothing. The Microcks CLI prints
   `Please login to perform operation...` and still exits successfully when it has no
   session. It needs a `login` call before `import`, and a writable `HOME` - it writes to
   `$HOME/.config`, so an unset or unwritable `HOME` breaks it.
3. The secondary artefact was imported before the contract. Examples attach to operations
   that must already exist. Import the contract first.

## The service list returns 401

**Symptom.** `GET /api/services` returns 401 while the mock endpoints themselves work.

**Cause.** The Microcks API is behind Keycloak. The mock endpoints under `/rest/...` stay
public; the management API does not. For a local disposable instance, disabling Keycloak is
the usual choice. `GET /api/health` is unauthenticated either way and is the right target for
a readiness probe.

## invalid_client at the token endpoint

**Symptom.** The token exchange returns 400 with `{"error":"invalid_client"}`.

**Check.** `uv run scripts/oidc_fixtures.py show --dir <fixtures-dir>` and compare the
declared client id and auth method against what the application sends.

Causes:

1. The application's client id is not declared. The dispatcher falls through to whatever
   case it can match, and an undeclared client matches none.
2. The declared auth method disagrees with the application. A client declared
   `private_key_jwt` needs the application to hold the matching private JWK from
   `keys/<client-id>.jwk.json`; a client declared `client_secret` needs the secret.
3. Keys were rotated and the application still holds the old JWK. Rotation changes every key
   and every token; consumers must be updated in the same change.
4. The declaration deliberately contains an error case whose `login_hint` or code is being
   matched. Check `show` for declared error cases before assuming a defect.

## invalid_token at userinfo

**Symptom.** `/userinfo` returns 400 with `{"error":"invalid_token"}`.

**Cause.** The `JS` dispatcher matches the access token as a literal string. The token
presented is not one the current artefact contains, which almost always means the artefact
was rebuilt after the caller obtained its token, or the caller is replaying a token from a
previous key generation. Restart the login flow.

Note the asymmetry: `/userinfo` GET falls back to the default profile when nothing matches,
while POST returns `invalid_token`. A GET that silently returns the wrong user is this
fallback doing its job.

## No id_token in the token response

**Symptom.** The token response carries `access_token` but no `id_token`.

**Cause.** The client is declared with `client_credentials`. That grant authenticates a
service, not a user, so there is no identity to assert and no `id_token` by construction. If
a user identity is wanted, the client needs `authorization_code` - a different client, or a
changed declaration.

## Nonce rejected by the relying party

**Symptom.** The client library rejects the `id_token`, citing a missing or mismatched
`nonce`. Libraries name it differently; `IDX21320` is one such code.

**Cause.** The client sends a fresh random `nonce` per request and requires it echoed back
in the `id_token`. A static fixture cannot echo a value it never saw - the tokens are signed
ahead of time.

**Resolution.** This is a property of static mocking, not a defect to fix in the fixture.
Relax the nonce requirement in the local development configuration only, scoped to a
dedicated environment so that no shared or production path is affected. Never relax it
globally.

## Signature rejected

**Symptom.** The client library reports an invalid signature or an unknown key id.

**Check.** `uv run scripts/oidc_fixtures.py verify --dir <fixtures-dir>`

`verify` validates every emitted token against the emitted JWKS. If it passes, the fixtures
are internally consistent and the fault is downstream: the client is reading a cached JWKS,
or pointing at a different issuer. If it fails, the artefact and the keys have diverged - run
`build` and re-import.

## The session cookie never comes back

**Symptom.** The OIDC round trip completes but the application still sees no session.

**Cause.** Usually not the mock. Cookies marked `Secure` are not returned over plain HTTP, so
a local HTTP setup drops the session, correlation and nonce cookies. This surfaces as a login
that appears to succeed and then immediately does not.

Confirm where the failure is before touching the fixtures: if the token endpoint returned
200, the mock did its job.

## Changes do not take effect

**Symptom.** A profile or client was added, but the mock behaves as before.

**Cause.** The artefact was regenerated but not re-imported. Re-import, then re-check the
service list. A generated file on disk changes nothing that is already running.
