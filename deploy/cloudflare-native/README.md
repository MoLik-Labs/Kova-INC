# Experimental Cloudflare-native backend

This is an isolated proof of concept, **not a Kova replacement** and not
production-ready. It runs in Workers without a separate Kova origin and reads an
R2 bucket through a binding. It has a liveness endpoint (`GET /ping`), bearer
protected `GET /v1/objects` (100 objects per page, optional `prefix` and opaque
`cursor`) and streaming `GET /v1/object?key=...`. An optional create-only `PUT /v1/object?key=...` accepts a declared length up to 8 MiB and is disabled by default. It is not connected to the UI.

To experiment, create a separate Worker project and isolated R2 bucket; bind the
bucket as `R2` and set `KOVA_NATIVE_TOKEN` to a unique random secret of at least
32 characters through Cloudflare's runtime secret settings. Use HTTPS. Do not
bind production data. There is deliberately no one-click button: the prototype
has no user registration or production-ready login, Kova-compatible D1 metadata, large/multipart uploads, deletion, permission scopes, rate
limiting, session revocation, full WebDAV, legacy API compatibility, backup workflow,
or real-provider/browser testing. Possession of the single token grants read
access to the **entire bucket**, including create access if writes are enabled. Do not expose this on a public service or use
it to store sensitive data. Hash comparison and error redaction are not a
substitute for a security review. Cloudflare platform and R2 limits apply.

To test writes locally only, add `--var KOVA_NATIVE_WRITES:enabled` to the
Wrangler command below and run `TEST_LOCAL_WRITES=1 node
tests/cloudflare_native_runtime_smoke.mjs`. The test leaves a random test object
in the emulated bucket. Writes require `Content-Length`, are buffered in memory,
are limited to 8 MiB and use an R2 conditional request to avoid overwriting an
existing key. That behavior was tested locally, not with real R2. Do not enable
writes or use production data until there is a security review and real-cloud
verification.

## Experimental Cloudflare interface

A separate interface lives in `ui/` and is served only when an `ASSETS` binding
is present. It is not the native Kova frontend and is not a complete Kova
replacement. It can use experimental session, Google Drive and Dropbox v2 APIs,
with optional browser sign-in via `KOVA_EXPERIMENTAL_BROWSER_AUTH=enabled`.
This returns an HttpOnly, Secure, SameSite=Lax session cookie and redirects to
the UI after login; the cookie is not accessible to JavaScript. Mutating
cookie-authenticated requests require a same-origin Origin. Without that flag,
the legacy experimental callback returns a bearer token for manual testing;
manual tokens stay in tab memory, not URLs or local storage. UI downloads are limited to 8 MiB. The local Wrangler config
binds assets for visual preview but has no D1 or login configuration; sign-in
will not work there. The [English](../../docs/guide/cloudflare-preview.md) and
[Tiếng Việt](../../docs/guide/vi/cloudflare-preview.md) tutorials cover its
limitations and safe local preview. This UI and backend are not ready for
production, real accounts, or sensitive data.

## Local runtime test (no Cloudflare account)

Install the pinned Wrangler dependencies with `npm ci --ignore-scripts` in
`deploy/cloudflare-worker`. Then from the repository root run:

```sh
deploy/cloudflare-worker/node_modules/.bin/wrangler dev \
  --config deploy/cloudflare-native/wrangler.local.toml --local \
  --ip 127.0.0.1 --port 8787 \
  --var KOVA_NATIVE_TOKEN:local-test-secret-at-least-32-characters
```

In another terminal, run `node tests/cloudflare_native_runtime_smoke.mjs`
or check `curl http://127.0.0.1:8787/ping`, then:

```sh
curl -H 'Authorization: Bearer local-test-secret-at-least-32-characters' \
  'http://127.0.0.1:8787/v1/objects'
```

This is an emulated, empty R2 bucket and a public example token for local use
only. Do not deploy this configuration, use this token remotely, or replace
it with a real secret on a command line. Emulation does not verify Cloudflare
account bindings, resource limits or real R2 behavior. Stop the server when done.

## Experimental Google Drive connector

The isolated Worker also has a **single-account, read-only prototype**:
`GET /v1/google-drive/files?parent=root` lists a folder (optional opaque
`cursor`; the response has `nextPageToken`). An optional `name` filters by
Google Drive's `name contains` semantics within that folder; it is not a
recursive or full-text search. Use the same filter and parent when paging. The
owner-scoped v2 listing accepts the same filter. Additionally,
`GET /v1/google-drive/file?id=...` streams a binary file. These routes use the
same bearer token as the R2 API and do not require the R2 binding. Anyone with
that token can access **all files authorized to the connected Google account**,
not just one folder. Native Google Workspace documents can be exported with
`GET /v1/google-drive/export?id=...&format=pdf` (also available under `/v2/`
with the owner's `connection` parameter). Allowed formats are `pdf`, `docx`,
`xlsx`, `pptx`, `txt` and `csv`; Google determines which formats apply to each
file. CSV exports only the first sheet. Exports do not support ranges, and
[Google limits `files.export` output to 10 MB](https://developers.google.com/drive/api/reference/rest/v3/files/export).
Exports are served as attachments, and provider errors are not returned verbatim.
Upload, recursive/full-text search, multipart ranges, shortcuts, OAuth consent UI,
per-user credentials, permissions, credential revocation, rate limiting and
multi-drive management are not implemented. The experimental Cloudflare UI is separate from the native Kova UI.

For a future isolated experiment, Google Drive API must be enabled, an OAuth
client and an offline refresh token obtained securely with a suitable read-only
scope, and `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
`GOOGLE_REFRESH_TOKEN` set as Worker runtime secrets, alongside a strong
`KOVA_NATIVE_TOKEN`. **Do not paste credentials in commands, issues or chat.**
Use a disposable Google account and files only. Google OAuth verification,
testing-mode restrictions, token expiry/revocation and quotas apply; a refresh
token is not guaranteed to remain valid. Consult Google's
[web server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server)
and [Drive scope guide](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
This code refreshes on every request; it does not cache tokens or retry quota
errors. Binary downloads support one validated byte range for resuming; Google
may ignore the range and respond with the full file. It fixes upstream hosts and
rejects redirects, strips upstream headers,
limits JSON responses, and never returns credentials in errors. Downloads have a
30-second deadline for response headers, not a fixed deadline for the streamed
body; network failures, platform limits and redirects may still interrupt transfers.
**Mocks only:** this has not been exercised against a real Google account or deployed Worker. Do not use
it for production or sensitive data. Revoke credentials after experimentation.

## Experimental Dropbox connector

The separate **disabled-by-default, single-account** Dropbox experiment offers
`GET /v1/dropbox/files?path=` (root is empty; a returned `nextCursor` can be
passed as `?cursor=...` instead of `path`) and
`GET /v1/dropbox/file?path=/folder/file` for read-only downloads. Paths must be
absolute and must not contain dot segments. Listing is not recursive. Download
Range requests are not supported. Explicitly set `KOVA_EXPERIMENTAL_DROPBOX` to
`enabled` and configure `DROPBOX_ACCESS_TOKEN` and `KOVA_NATIVE_TOKEN` as runtime
secrets on an isolated test Worker. Anyone possessing the shared Kova token can
access **all Dropbox content authorized to that Dropbox token**; this is not a
multi-user security boundary. Never use production credentials or sensitive data.

An additional, separately disabled owner-scoped experiment requires both
`KOVA_EXPERIMENTAL_V2=enabled` and `KOVA_EXPERIMENTAL_DROPBOX_V2=enabled`,
D1 migrations through `0007_dropbox_connections.sql`, a valid vault key, and a
pre-established session. `POST /v2/dropbox/connections` accepts a JSON object
with only `accessToken`, or the C++ driver's equivalent credential fields
`appKey`, `appSecret` and `refreshToken` (all three required, no other fields).
Existing access-token records remain compatible. Refresh credentials are sealed
in D1 and exchanged at Dropbox's fixed OAuth endpoint when needed. This does not
implement the OAuth consent flow: obtaining these credentials remains a manual
test step unless the separately gated OAuth flow below is configured. There is no access-token cache, so each operation incurs a refresh
request and Dropbox's associated latency/quota. `GET` lists the authenticated owner's connections;
`DELETE /v2/dropbox/connections?id=...` deletes the local record. The bearer
session is required for each request. `GET /v2/dropbox/files?connection=...`
and `GET /v2/dropbox/file?connection=...&path=...` use that owner's encrypted
credential only. The cap is 50 connections per owner. Creation and deletion
atomically check the live session. Deletion does not revoke the Dropbox grant
or stop an in-flight request. Never send tokens in URLs, logs, issues or chat.

A further disabled-by-default write experiment requires
`KOVA_EXPERIMENTAL_DROPBOX_WRITES=enabled` in addition to the v2 flags.
`PUT /v2/dropbox/file?connection=...&path=/folder/new-file` sends a raw body
with a valid `Content-Length`, at most 8 MiB. It uses Dropbox `mode=add`,
`autorename=false` and `strict_conflict=true`; a conflict returns 409 rather
than silently replacing a file. The token needs Dropbox's `files.content.write`
scope. The server counts bytes independently, checks the owner's session and
connection again after receiving the body, and streams no client-controlled
host or headers to Dropbox. A provider request already in flight cannot be
rolled back on revocation or disconnect. A timeout or invalid provider response
can occur **after Dropbox created the file**; check the folder before retrying.
The write uses a shared folder's existing Dropbox permissions and does not
implement Kova public/private sharing.

The optional interactive Dropbox connection flow additionally requires
`KOVA_EXPERIMENTAL_DROPBOX_OAUTH=enabled`, the D1 migration
`0008_dropbox_oauth_pending.sql`, `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`,
and `KOVA_DROPBOX_REDIRECT` set to the same-origin HTTPS URL ending in
`/v2/dropbox/oauth/callback`, also registered with Dropbox. Start with
`POST /v2/dropbox/oauth/start` using the owner's session. It requests read scopes
and offline access with PKCE and a single-use state, bound to the initiating
browser and live session. The callback stores encrypted refresh credentials.
To request Dropbox write permission additionally, explicitly enable
`KOVA_EXPERIMENTAL_DROPBOX_OAUTH_WRITE=enabled`; this is distinct from the
server-side upload switch. A popup returns JSON on success; return to the UI and
refresh. Starting a second flow in the same browser invalidates the first browser
binding. The feature has mock and workerd/D1-emulator tests only, no real-provider
validation, production rate limiting, grant revocation or secure provisioning UI.
An exchanged grant can survive if local persistence fails; revoke at Dropbox.
Never publish secrets or callback URLs containing codes.

These endpoints use fixed Dropbox API hosts and never follow redirects. Dropbox
access tokens expire; larger uploads, shares, rate limiting,
UI upload and real-provider testing remain unimplemented. v1 is still a shared-token endpoint
if separately enabled; v2 does not change its security model. Local tests use
mock responses, not Dropbox. Revoke test credentials after use. Dropbox quotas
and permissions apply. The operator controlling the Worker and vault key can
read credentials: encryption is not end-to-end. Do not deploy this experiment
with production or sensitive data.

## Access-control foundation (not integrated)

`migrations/0001_access_foundation.sql` and `src/access.js` are isolated
experimental D1-oriented primitives for private-by-default resources, explicit
role grants and read-only bearer links with expiry and revocation. The schema
and queries are tested against SQLite locally via `npm run test:cf-access` and
against the local workerd/D1 emulator in CI. Real Cloudflare D1 has not been
tested. The prototype's existing
HTTP endpoints **do not call these primitives**: they still use a single shared
bearer token and must not be treated as a multi-user system. Authentication,
role assignment, per-user grants, restricted-recipient links, password links,
provider credential isolation, folder inheritance and all UI integration remain
unimplemented. Links are denied while their creator lacks the share grant, but
restoring that grant can reactivate unexpired links unless explicitly revoked.
The isolated `removeResourceRoleGrant` primitive atomically revokes links created
by members of the affected role when the resource owner removes its share grant;
it conservatively revokes links even if another role grants share permission.
This primitive is not connected to a management endpoint. Direct database edits,
role-membership changes and other grant-change paths do not enforce this rule;
all such paths require equivalent transactional handling before integration. A deployment operator can access plaintext by
changing Worker code or bindings. Do not use this as a security
boundary until integrated and reviewed end to end.

## Session foundation (not login)

`migrations/0002_sessions.sql` and `src/sessions.js` add isolated session
primitives: 256-bit random tokens, token hashes in D1, fixed expiry (at most
24 hours), account-disabled checks and revocation. Tests use SQLite and the
local workerd/D1 emulator; they do not verify production D1. The opt-in `/v2`
experiment validates and revokes sessions; the separately disabled Google
login prototype can issue sessions for pre-provisioned identities. `issueSession`
must only be called after a trusted authentication flow verifies identity. There is no password authentication, production-ready login UI, reset,
2FA, comprehensive CSRF/security review, brute-force protection, multi-user
provider authorization or operational key recovery. Disabling an account must
also permanently revoke its sessions, preferably atomically; otherwise enabling
it again reactivates unexpired sessions. An isolated, unexposed `disableUser`
primitive uses an explicit `manage_users` role permission and a D1 batch to
disable the user and revoke its sessions and links it created. It is tested in
SQLite and a local D1 emulator, not real D1. It has no HTTP route or trusted
authentication, and it does not revoke links created by other users to the
disabled user’s resources. No account-management flow enforces it yet. Do not expose these helpers or connect real accounts until all of
those are designed and reviewed.

Workers Web Crypto has an implementation limit on PBKDF2 iterations; see the
[workerd discussion](https://github.com/cloudflare/workerd/issues/1346). Do not
silently reduce password-hash strength or assume a local test proves production
limits. Choose and test an appropriate authentication design before wiring a
login flow to session issuance.

## Credential-vault foundation (experimental)

The experimental `0004_connections.sql` and `src/credential-vault.js` store a
single owner's Google credentials in D1 using AES-256-GCM. Random 96-bit nonces
and authenticated connection ID, owner and provider bind ciphertext to its
record. Only the enabled owner is authorized by these isolated primitives;
actor identity must come from a trusted authentication layer, not client input.
Tests cover ciphertext tampering, owner changes, disabled users and isolated
workerd/D1 emulation. They do not constitute a security review or test real D1.

An isolated `/v2/google-drive/` experiment uses this vault and session
primitives for owner-only listing and downloads; it is disabled unless
`KOVA_EXPERIMENTAL_V2=enabled`. It has no production-ready login or
connection provisioning and is available through a separate experimental Cloudflare UI. The older `/v1` prototype still uses one
account-level bearer secret and must not be treated as multi-user.
Key provisioning, key versioning/rotation, safe backup/recovery, audit, OAuth
consent/revocation, deletion semantics at Google and grant-based sharing are not
implemented. Losing the separate master key makes encrypted credentials
unrecoverable. A deployment operator able to alter Worker code or access the
key can access credentials; this is not end-to-end encryption. Do not store
production secrets until the complete system is reviewed and tested.


## Owner-scoped connector experiment

The opt-in `/v2/google-drive/files?connection=...` and
`/v2/google-drive/file?connection=...&id=...` routes require a session token,
D1 binding `DB`, and a separate vault key. `/v2/me` and `POST /v2/logout`
validate or revoke the same bearer session. `/v2/connections` lists only the
current user's connection IDs, provider names and creation times, up to 50 per
page with `nextCursor`; encrypted credentials are not returned.
`DELETE /v2/connections?id=...` removes an owner's stored connection locally
with an atomic live-session check; it does not revoke the Google authorization
or cancel an in-flight download. Only the enabled connection owner is allowed; a user ID from the request is never trusted. The route refreshes the
owner's Google token and uses the same limited read-only connector. It is tested
with mock Google responses and local workerd/D1 emulation only.

**Do not enable or deploy for users:** there is no production-ready login,
account provisioning, consent UI, provider-side credential revocation, D1 migration
deployment, durable throttling or production-ready UI, and no real provider test. It does not implement
roles, resource sharing or Kova API compatibility. The test harness seeds users,
sessions and connections directly and is not part of the Worker. The v1 shared
bearer routes remain separate and would bypass these owner checks if enabled.


## OAuth connection experiment (disabled)

An opt-in `/v2/google-drive/oauth/start` and callback prototype requests the
Google Drive read-only scope using PKCE, a random single-use state, an encrypted
short-lived verifier, initiating browser cookie and a live initiating session.
Migration `0009_google_oauth_browser_binding.sql` is required and invalidates
pending attempts created before migration. Starting a second Google connection
flow in the same browser invalidates the first browser binding. It stores the
refresh token in the experimental owner-scoped vault. OAuth requires both experimental flags
and a configured fixed HTTPS callback URI; the separate experimental UI can start this flow but is not production-ready. The separate login prototype is disabled by default. The flow has mock and
local D1/workerd tests only and has not been verified with Google or deployed
Cloudflare resources. **Do not enable it for users or sensitive data.**

The callback URL contains an authorization code and state. Logging, referrer
leaks, provider error handling, consent denial, quotas, cleanup of abandoned
flows, credential recovery and revocation, user-visible confirmations and rate
limits need an end-to-end security design. A failed callback consumes the state;
retry requires a fresh attempt. If a token exchange succeeds but persistence
fails, a provider authorization can remain active; revoke it in Google account
settings. The read-only scope, Google verification rules and account testing
restrictions may require additional approval. No secret should be printed or
shared in chat, logs or Git.


## Google sign-in experiment (disabled)

The disabled-by-default `/v2/auth/google/start` and callback experiment uses
Google OIDC, PKCE, a single-use D1 state, a Secure HttpOnly SameSite=Lax
browser-binding cookie, and RS256 verification using Google's fixed JWKS
endpoint. It validates issuer, audience, nonce and token times. Only Google
subjects pre-provisioned in `external_identities` map to enabled users; email
is not an identifier. By default it returns a one-hour bearer session as JSON.
When `KOVA_EXPERIMENTAL_BROWSER_AUTH=enabled`, it instead sets a one-hour
HttpOnly, Secure, SameSite=Lax host-only session cookie and redirects to `/`;
state-changing requests using this cookie require a matching HTTPS Origin.
Sign-out revokes the session and clears the cookie. This is still experimental.
The workerd test uses synthetic users, generated signing keys and mock Google
responses; no Google account, Cloudflare deployment or browser was tested.

This is not ready for users: no onboarding/provisioning UI, production-ready browser login UI,
durable rate limiting, account recovery, audit, session security policy, consent
handling or real provider validation exists. Anyone can fill the prototype's
global pending-attempt cap, causing denial of service. Removing an identity does
not automatically revoke already-issued sessions. Redirect query logging and
session-token handling require review. Provisioning and privilege assignment
must not be exposed until end-to-end authentication and authorization are
reviewed. Keep all experimental flags disabled; use no sensitive accounts.

## Experimental read-only R2 WebDAV subset

The standalone Worker can optionally expose **read-only** `/dav/` against a
single nonempty R2 prefix. This is a protocol subset, not WebDAV class 1/2 or a
Kova-compatible/multi-user server. It is disabled unless
`KOVA_EXPERIMENTAL_R2_DAV=enabled` is explicitly configured. Configure a
separate test bucket and `KOVA_DAV_PREFIX` such as `test-root/` (must be nonempty,
end in `/`, and contain no `.` or `..` segments). Set a dedicated
`KOVA_DAV_USERNAME` (ASCII letters, digits, `_`, `-`, `.`) and a random
`KOVA_DAV_PASSWORD` (32–128 printable ASCII characters, no spaces) via Worker
secrets; never commit them or share them in chat. Use HTTPS only. A Basic client
with these credentials can read the **entire configured prefix**, without
per-user roles, sessions, 2FA, IP limits or rate limiting. The legacy `/v1`
R2 API is independent: configuring `KOVA_NATIVE_TOKEN` grants its bearer holder
access to the whole bucket, not just this prefix. Leave that token unset when
testing DAV alone, and do not assume DAV restrictions apply to other routes.
Do not use real accounts or data; do not enable on the existing `kova-inc` Worker. R2 may
require Cloudflare account setup or a payment method: do not assume free
provisioning is available to your account.

Supports OPTIONS, GET, HEAD and PROPFIND with Depth 0 or 1, plus a bounded
16 KiB PROPFIND body. Property selection is ignored and a fixed set of
properties returned; it does not advertise WebDAV class compliance. A folder
with a truncated R2 listing fails with 507 rather than returning incomplete
results. No ranges, pagination, locks, writes, deletes, quotas, backup destination,
conditional requests, public sharing or external provider mounts. GETs are
attachment-only and do not preserve provider Content-Type. Do not use as a
NodeWarden backup target. The feature was tested with mocks and workerd's local
R2 emulator, not actual Cloudflare R2 or real WebDAV clients.

For source references, license notices, and remaining compatibility gates see
[`docs/architecture/cloudflare-reference-audit.md`](../../docs/architecture/cloudflare-reference-audit.md).
