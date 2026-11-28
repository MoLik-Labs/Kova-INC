# Try the Cloudflare interface

::: danger Test data only
This interface connects to an independent Cloudflare backend **under development**, not a complete Kova replacement. Uploads, sharing, complete permissions, many drivers and production protections are not ready. Google, Dropbox and real Cloudflare resources have not been verified. Do not use sensitive accounts or files.
:::

## 1. Preview locally

Install Node.js and run from the repository root:

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix deploy/cloudflare-worker
deploy/cloudflare-worker/node_modules/.bin/wrangler dev --config deploy/cloudflare-native/wrangler.local.toml --local --ip 127.0.0.1 --port 8787 --var KOVA_NATIVE_TOKEN:local-test-secret-at-least-32-characters
```

Open `http://127.0.0.1:8787/` on **the machine running Wrangler**. This is a local configuration with an emulated R2 bucket and a public example token. Stop it with Ctrl+C. Never deploy this local config or use the example token on the Internet. This mode previews the interface only: it has no D1, Google OAuth or user sessions, so sign-in will not work. Run `npm run test:cf-ui` for DOM-emulated interaction and asset tests; emulation is not a real browser test.

## 2. Using the experiment

When a separately configured test backend and pre-provisioned account are available, the Google sign-in button starts an experimental flow. Enable `KOVA_EXPERIMENTAL_BROWSER_AUTH=enabled` alongside the experimental login flags: after the callback, the browser returns to the interface with an HttpOnly secure session cookie. A manually entered bearer token remains available for testing; without the browser-auth flag the callback returns a bearer token as JSON. **Never send tokens in chat, URLs, logs or screenshots.** This experimental login is not suitable for real users.

After sign-in, select a connection to browse folders and use **Load more** for the next page. You can test adding Dropbox using a short-lived token from a test account. The Google Drive and Dropbox connection buttons open separate windows when their respective OAuth flags are configured; after a callback completes, return and **Refresh**. Only start one connection flow per provider at a time in the same browser. Removing a connection only removes it from Kova, not from Google or Dropbox; revoke provider access separately. UI downloads are limited to 8 MiB; Google Workspace files request PDF export, which Google may not support for every document type.

## 3. Backend setup and safety

Multi-user experiments require a separate Worker, separate D1 with migrations, separate vault key, configured OAuth and pre-provisioned identities. See the `deploy/cloudflare-native/README.md` in your repository and branch for bindings, variables, limitations and risks. Never attach experimental configuration to a production Worker or data. Enable experimental flags only in isolation; v1 uses a shared token with access to the whole provider account and is not a multi-user boundary.

Before real use the project still needs a security-reviewed login, abuse protection, key recovery, permissions/sharing, additional drivers, real browser and cloud-resource tests. If CSS or JS does not load, check `GET /`, `/app.css`, `/app.js`, the `ASSETS` binding, build configuration and CSP; do not publish the entire repository.

To test D1 and deploy a **separate** experimental Worker after the code reaches your fork, see the [isolated step-by-step guide](./cloudflare-isolated). Do not use the local config on an existing Worker.

## Read-only WebDAV experiment

The isolated Worker includes an **opt-in, experimental R2-only WebDAV subset**;
it is not full WebDAV or a Kova replacement. It requires a separate test R2
bucket, a nonempty restricted prefix, and dedicated Basic credentials. Leave
`KOVA_NATIVE_TOKEN` unset for a DAV-only test: the separate legacy `/v1` API
can expose the whole bucket and is not confined by the DAV prefix. It can
only read: do not use it for NodeWarden backups or connect sensitive data. R2
account setup can require payment verification; do not add a card if you do not
want to. See the repository's `deploy/cloudflare-native/README.md` for exact
settings, protocol limits and local test guidance. Do not overwrite `kova-inc`.

After merging, test only on a **new, separate** Worker and R2 bucket:

1. Create a test bucket and bind it as `R2`; do not attach real data.
2. Set `KOVA_EXPERIMENTAL_R2_DAV=enabled` and `KOVA_DAV_PREFIX=test-root/`
   on the test Worker. The prefix must be nonempty, end in `/`, and have no
   `.` or `..` components.
3. Set a dedicated `KOVA_DAV_USERNAME` (ASCII letters/digits, `_`, `-`, `.`)
   and random `KOVA_DAV_PASSWORD` (32–128 printable ASCII characters without
   spaces) using Worker secrets. Never commit or send secrets in chat. Anyone
   with the credentials can read the whole prefix; there is no RBAC, 2FA or
   rate limiting.
4. Over HTTPS, try PROPFIND Depth 0/1 and GET on dummy files with a WebDAV
   client. Leave the legacy `/v1` bearer API disabled for a DAV-only test.
   Remove the test Worker and secrets when no longer needed.

Only OPTIONS, GET, HEAD and PROPFIND are supported; no writes, deletion, locks,
Range, full WebDAV Class 1/2, or per-account permissions. PROPFIND ignores
requested property selection and returns a fixed set; bodies are limited to
16 KiB. A directory exceeding a single R2 listing page returns 507 instead of
partial results. Mock and workerd/R2 emulator tests passed; actual WebDAV
clients and real R2 have not been tested.
