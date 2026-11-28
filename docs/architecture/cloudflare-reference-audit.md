# Cloudflare references: scope and integration boundaries

These repositories were cloned for local inspection, not deployed or vendored.
The commit and license below describe the inspected snapshots, not an assertion
that every dependency has the same license or that any service is secure.

| Repository | Inspected commit | Repository license | Useful starting point |
| --- | --- | --- | --- |
| [Cloudflare-Clist](https://github.com/ooyyh/Cloudflare-Clist) | `1d21eb0e9ac5298b1b2b58876e8b051683bfc7e2` | MIT, copyright ooyyh | Worker/D1 storage aggregation and provider architecture; verify authorization and provider behavior independently. |
| [r2-webdav](https://github.com/abersheeran/r2-webdav) | `6ce5bfecdafad83834a1773c3655a495aff1362b` | Apache-2.0, copyright abersheeran | R2 listing and WebDAV protocol examples; its advertised write/lock support is not a Kova feature. |
| [Davflare](https://github.com/fanchenggang/Davflare) | `79d16fdba6e904f50c63828de60fb9d4dd8b391b` | MIT, copyright Siyu Long | Pages Functions-based R2 explorer, WebDAV and MCP; it is a separate architecture and account model. |
| [R2-Explorer](https://github.com/G4brym/R2-Explorer) | `2c09ecbea00be66992ddb8c63946aed1a9be59e6` | MIT, copyright Gabriel Massadas | R2 browser and deployment patterns; not a multi-provider Kova-compatible backend. |

No source code from these projects was copied in the initial read-only R2 DAV
experiment. If code is copied later, include all applicable notices and review
licenses of transitive dependencies before distribution. A project's README or
its passing tests do not verify Kova's permission, race, privacy or provider
behavior.

## Why this is not full parity

Kova's native server, its experimental Worker, and these references have
different storage models, permission systems and deployment assumptions. Simply
merging their code could expose files or invalidate existing credentials. The
new opt-in WebDAV subset is confined to one R2 prefix and one dedicated Basic
credential, without multi-user authorization. It supports no writes or locks,
and does not implement the full protocol. The existing Worker still lacks full
Kova APIs, all upstream drivers, a production-grade account lifecycle,
NodeWarden-compatible writes, tested real-provider behavior, backups, and a
safe migration path. Do not connect real data to it.

Further work requires a versioned account and storage model, per-user and
per-path authorization, credential rotation/revocation, concurrency-safe writes,
quota and abuse controls, contract tests, emulated and real provider tests, plus
independently tested migration and rollback. R2 availability and payment/card
requirements depend on Cloudflare account and current policy; no card or paid
resource should be assumed.
