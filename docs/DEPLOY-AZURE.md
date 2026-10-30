# Deploying the COB Calculator to Azure App Service

This note is for the Azure and security teams. It describes how the Cost of Borrowing calculator runs on Azure App Service, as delivered by SEC-6 (self-hosted font and logo, `CHANGES.md` §87) SEC-5 (`ui/serve.mjs` for local use and Azure, `CHANGES.md` §88) SEC-5b (server hardening before the handover, `CHANGES.md` §90) SEC-5c (closing the connection after an error reply, and the security headers on the `Expect` replies, `CHANGES.md` §91) and SEC-NODE26 (Node 26 LTS for development and CI, `CHANGES.md` §92). All five were QA-verified (PASS WITH NOTES) on 2026-10-29. The design is in `COB-architecture.md` §5, "SEC-5 and SEC-6 brief" (revision 62), "SEC-5b brief" (revision 63), "SEC-5c brief" (revision 64) and "SEC-NODE26 brief" (revision 65). The production runtime follows the user's decision Q-NODE26-1 (2026-10-29), revised the same day: production runs Node 24 LTS (`NODE|24-lts`) instead of Node 22 (`CHANGES.md` §93). The remaining known gaps are listed under "Known gaps" at the end. Items marked *confirmed on the test app* were checked on 2026-10-29 against a test App Service (see "Test deployment, 2026-10-29"). Anything marked *to confirm* has not been checked against this Azure tenant.

## What the application is

- A static web page plus a small, zero-dependency Node.js file server (`ui/serve.mjs`).
- All calculation runs **in the browser**. The server only answers `GET`/`HEAD` requests for static files. It receives no form data, sets no cookies, stores nothing and has no database. Member data never reaches the server.
- The page loads nothing from other origins. The Inter font and the Alterna logo are served from the app itself (`ui/assets/`).

## Two modes

`ui/serve.mjs` reads only three environment variables: `PORT`, `WEBSITE_HOSTNAME` and `COB_ALLOWED_HOSTS`. Which mode it runs in depends on `WEBSITE_HOSTNAME`.

| | Local mode (default) | Hosted mode |
|---|---|---|
| When | `WEBSITE_HOSTNAME` is unset, empty or only spaces | `WEBSITE_HOSTNAME` is non-empty after trimming (App Service sets it) |
| Listens on | `127.0.0.1` only | `0.0.0.0` |
| Default port (when `PORT` is unset or empty) | `5173` | `8080` |
| Accepted `Host` header | `localhost`, `127.0.0.1`, `localhost:<port>`, `127.0.0.1:<port>` | `WEBSITE_HOSTNAME` plus each `COB_ALLOWED_HOSTS` entry |
| `COB_ALLOWED_HOSTS` | Must be unset or blank; otherwise the server refuses to start | Read |
| `Strict-Transport-Security` | Not sent (plain HTTP on localhost) | Sent |
| Start-up line on stdout | `cob-calculator test UI (Canada): http://localhost:<port> (listening on 127.0.0.1:<port> only)` | `cob-calculator (Canada): hosted mode, listening on 0.0.0.0:<port>; allowed hosts: <list>` |

To run it locally (from `COB-ts/`): `npm run ui`. This builds the engine and starts `node ui/serve.mjs`; then open `http://localhost:5173`.

## Platform

| Setting | Value |
|---|---|
| Service | Azure App Service, **Linux**, built-in Node stack |
| Runtime | **Built and tested on Node 26.13.0 LTS** ("Lithium", end of life 2029-04-30); that is the version in `.nvmrc` and the floor in `package.json`. Development and CI stay on it. **Production runs `NODE|24-lts` (Node 24 LTS), at least 24.22.2,** until `NODE|26` is generally available on App Service for Linux (decision Q-NODE26-1, 2026-10-29, revised the same day from `NODE|22-lts` to `NODE|24-lts`; `CHANGES.md` §93). Node 24 LTS has been generally available on App Service for Linux since 2025-10-29 ([announcement](https://azure.github.io/AppService/2025/10/29/node24-available.html)); its end of life is 2028-04-30. Node 22 is not used: Microsoft ends App Service support for Node 22 on 2027-04-30 and recommends Node 24 ([notice](https://www.microsoft.com/releasecommunications/api/v2/azure/567334)). `NODE|26` has been in preview since 2026-09-11; no GA date was known on 2026-10-29 (*to confirm* with Microsoft). The Node 24 runtime is verified: `ui/serve.mjs` needs no packages, and on Node 24.22.2 (2026-10-29) the four server test files (`a13-serve`, `sec5-serve-azure`, `sec5b-serve-hardening`, `sec5c-serve-close`) pass 416/416. The full suite on Node 24.22.2 gives 4377 passed and 5 expected failures, with one failure: the deliberate F23 live check, which fails on purpose on any Node below 26.13.0 (`CHANGES.md` §93). Earlier, the same four files also passed 416/416 on Node 22.23.4 (`CHANGES.md` §92, QA addendum); that result is kept as history. **Switch to `NODE|26` once it is generally available, and before 2028-04-30**, when Node 24 reaches end of life. Make sure the 24.x patch App Service runs is 24.22.2 or later (*to confirm*). How to set it: in the portal, Configuration > General settings > Stack settings > Node 24 LTS; or `az webapp config set -g <rg> -n <app> --linux-fx-version "NODE|24-lts"` (the string documented in Microsoft's Node.js configuration guide). After the switch, the string is `"NODE|26"` (*to confirm* once it is generally available). |
| Startup command | `node ui/serve.mjs` |
| Instances | Stateless, so any number works. ARR affinity (session cookies) can be **off**. |
| Connection timeouts (set in `ui/serve.mjs`) | Keep-alive idle timeout **120 s**; time limit for the request headers **125 s**; time limit for the whole request **125 s**. The app's keep-alive idle timeout must be longer than the idle timeout of the Azure front end towards the app; otherwise the front end can reuse a connection the app has just closed and return `502`. *To confirm with the Azure team:* the front end's idle timeout. If it is 120 s or more, the three values need raising in a later task. |

## What to deploy

Build in CI, then deploy the built files only.

The build agent must use **Node 26.13.0**: for example the Azure Pipelines task `UseNode@1` with version `26.13.0`, or a step that reads `.nvmrc` (*to confirm* for your pipeline). `npm ci` on an older Node fails by design: `.npmrc` sets `engine-strict=true`, so npm stops with `EBADENGINE` because `package.json` requires `"node": ">=26.13.0"` (`CHANGES.md` §92, checked on Node 22.23.4; Node 24 is also below that floor).

These two settings act **only when npm installs** (CI and development machines). App Service never runs npm here, because the platform build is off (`SCM_DO_BUILD_DURING_DEPLOYMENT=false`, below). So they don't stop `node ui/serve.mjs` from starting on the `NODE|24-lts` runtime.

```bash
npm ci
npm run build        # compiles src/ to dist/
npx vitest run       # optional gate: the full test suite
```

Deploy these, keeping their relative paths:

| Path | Why |
|---|---|
| `ui/` | The page (`ca.html`, `ca.css`, `ca.js`, `ca-view.js`), the server (`serve.mjs`) and `assets/` (fonts with their licence, logo) |
| `dist/` | The compiled calculation engine that the page imports |
| `package.json` | The server reads the version number from it |

Don't deploy `node_modules/` (the server needs no packages at runtime), `src/`, `tests/`, `share/`, `docs/` or `COB.html`. Turn off the platform build so App Service doesn't run `npm install` on the deployed files: app setting `SCM_DO_BUILD_DURING_DEPLOYMENT=false` (*to confirm* for your deployment method, e.g. zip deploy or a pipeline task).

## App settings (environment variables)

The server reads only these three:

| Name | Who sets it | Meaning |
|---|---|---|
| `WEBSITE_HOSTNAME` | **App Service**, automatically (e.g. `cob-calc.azurewebsites.net`) | When it is present, the server runs in **hosted mode**: it listens on `0.0.0.0` and accepts only the allowed host names. Don't set or override it. |
| `COB_ALLOWED_HOSTS` | You, when a custom domain is used | Extra host names the app answers to, comma-separated, e.g. `cob.intranet.alterna.example`. Entries are trimmed and lower-cased; empty entries and duplicates are dropped. You can add a port (`name:8443`, 1 to 65535) if users reach the app on a non-default port. Wildcards, schemes, paths and other characters are refused at start-up. The `WEBSITE_HOSTNAME` name is always allowed and is checked the same way. Setting this variable when `WEBSITE_HOSTNAME` is not set stops the app at start-up. |
| `PORT` | App Service, normally (*to confirm*) | The port to listen on. If it is unset, hosted mode uses `8080`. It must be a whole number from 1 to 65535; anything else stops the app at start-up with a clear message. |

The `Host` header must match an allowed entry exactly (case does not matter), including any port. Requests with any other `Host` header get `403 Forbidden` (except `/healthz`, see below). A request with **no** `Host` header (HTTP/1.1) or with **more than one** `Host` header gets `400 Bad Request`, on every path including `/healthz`. An HTTP/1.0 request with no `Host` header is treated as having an empty one: `/healthz` answers, everything else gets `403`. If an Application Gateway or Front Door sits in front, it must keep the original `Host` header, or its host name must be added to `COB_ALLOWED_HOSTS`. On the test app, a request with a host name not bound to the site was rejected by Azure's own front end (`404`) before it reached the app (*confirmed on the test app*, 2026-10-29), so the app's own `403` applies only to host names that Azure routes to the site.

A start-up error writes one line to stderr and the process exits with code 1, without listening. The lines are:

| Cause | Message |
|---|---|
| `PORT` is not a whole number from 1 to 65535 (for example `0`, `0x50`, `080`, `70000`) | `serve.mjs: PORT must be a whole number from 1 to 65535 (got "<value>")` |
| `COB_ALLOWED_HOSTS` set in local mode | `serve.mjs: COB_ALLOWED_HOSTS is only read on Azure App Service (WEBSITE_HOSTNAME is not set)` |
| An invalid name in `WEBSITE_HOSTNAME` or `COB_ALLOWED_HOSTS` (for example `*.x.com`) | `serve.mjs: invalid host name in WEBSITE_HOSTNAME or COB_ALLOWED_HOSTS: "<value>"` |
| The port is in use or cannot be opened | `serve.mjs: cannot listen on <address>:<port>: <code>` (for example `EADDRINUSE`) |

## Security settings on App Service

| Setting | Value |
|---|---|
| HTTPS Only | **On**. TLS ends at the App Service front end, and the app receives plain HTTP. With it on, plain HTTP requests get `301` to HTTPS from Azure (*confirmed on the test app*, 2026-10-29). |
| Minimum inbound TLS version | **1.2** (or 1.3 if your policy requires it). TLS 1.0 and 1.1 were refused (*confirmed on the test app*, 2026-10-29). |
| FTP / FTPS | **Disabled** |
| SCM and FTP basic-auth publishing credentials | **Off**. Deploy with Entra ID / a service connection. |
| Remote debugging | Off |
| Internal access only | **Access restrictions** that allow only the corporate network ranges (deny all others), **or** a **private endpoint** with public network access disabled. Apply the same restriction to the SCM (Kudu) site. This is Azure configuration; the app itself does not check client IP addresses. With access restrictions, a request from an address that is not allowed gets Azure's own `403 Ip Forbidden` (header `x-ms-forbidden-ip`) before it reaches the app (*confirmed on the test app*, 2026-10-29). |
| Health check path | **`/healthz`**, exactly. It returns `200` with the body `ok` whatever the `Host` header (as long as there is exactly one), and reveals nothing. A query string is ignored (`/healthz?x` also answers `ok`). Other spellings are not the health check: `/healthz/` and `/%68ealthz` get `404` (or `403` if the `Host` is not allowed). |
| Always On | Optional. Its pings are ordinary `GET` requests. |

*To confirm with the Azure team:* the `Host` header of the platform's warm-up and Always On requests. If they don't use the site's own host name, they get `403` (which still counts as an HTTP response) on paths other than `/healthz`.

## Security headers

The app itself sets these headers on every response it writes: pages, scripts, fonts, `/healthz`, `/version.json`, and its own `400`/`403`/`404`/`405`/`417` errors. They are also on the replies to requests that Node.js cannot parse (a malformed request line or header, headers that are too large, a request that is too slow): those get `400`, `431`, `413` or `408`, with the headers below, `Content-Type: text/plain; charset=utf-8`, a fixed short body and `Connection: close`. The connection closes as soon as the reply has been handed to the operating system, even if the client keeps its side open. If the client has reset the connection, or the app has already started a reply on it, the app closes the connection without writing anything. The `417` reply to an `Expect:` header (step 0b below) carries the same headers. A request with `Expect: 100-continue` gets no interim `100 Continue` line: it gets its final reply at once (with these headers), and the connection then closes. Azure doesn't need to add any headers. A proxy in front must not remove or override them.

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cache-Control` | `no-store` |
| `Strict-Transport-Security` | `max-age=31536000` (hosted mode only. It reaches the browser through the App Service front end unchanged (*confirmed on the test app*, 2026-10-29). `includeSubDomains` and `preload` are deliberately left out; *to confirm* against your domain policy.) |

The CSP contains no `unsafe-inline`, `unsafe-eval`, hashes, nonces, `data:`, `blob:` or other origins.

Check after a deployment:

```bash
curl -sI https://<host>/            # 200 and the headers above
curl -s  https://<host>/healthz     # ok
curl -s  https://<host>/version.json   # {"version":"<version>"}
curl -sI https://<host>/package.json   # 404 (not published)
```

## Test deployment, 2026-10-29

A test app was checked from an allowed IP address on 2026-10-29: `cob-calc-majaj`, plan F1 (free), Canada Central, then running `NODE|22-lts` (before the switch to `NODE|24-lts`). Results:

- `/`, `/ui/ca.js`, the `dist/` engine, `/healthz` and `/version.json` answered `200`.
- `/package.json`, `/ui/serve.mjs` and `src/` paths answered `404`.
- Every response carried the full header set above, including `Content-Security-Policy` and `Strict-Transport-Security: max-age=31536000`.
- Plain HTTP got `301` to HTTPS (HTTPS Only). TLS 1.0 and 1.1 were refused.
- An address that is not allowed got Azure's `403 Ip Forbidden` (header `x-ms-forbidden-ip`), and a wrong host name got `404` from Azure's front end. Neither request reached the app.

**Known quirk, F1 plan.** The first ZipDeploy from Cloud Shell reported `UnknownDeploymentError` after about 258 seconds of "Starting the site", yet the app then served correctly. This looks like a cold-start or deployment-tracking quirk of the free F1 plan, not an app fault (*to confirm* on a paid plan).

Still to check on the target tenant: the same results under `NODE|24-lts` and on the production plan.

## What the server publishes

- `/`, which serves `ui/ca.html`
- files under `/ui/` and `/dist/` with the extensions `.html`, `.js`, `.css`, `.svg`, `.woff2` and `.txt` only (lower case; the `.txt` is the font licence, sent as `text/plain; charset=utf-8`)
- `/version.json`, which returns `{"version":"<version>"}` (the version printed on the calculator's printout). The version is read from `package.json` once, at start-up. If `package.json` is missing or unreadable, or has no text `version`, `/version.json` is `404` and the printout simply leaves the version out.
- `/healthz`

Everything else is `404`, including source code, tests, `package.json`, `package-lock.json`, `.mjs` files (so `serve.mjs` itself), `.json` files, TypeScript declaration files and source maps. Symbolic links that lead outside `ui/` or `dist/` are not followed. Paths that contain `//`, that end with `/` (other than `/` itself, so `/ui/ca.html/` too), or that contain an encoded `/` or `\` (`%2f`, `%5c`, any case) are `404`. Only `GET` and `HEAD` are accepted; other methods get `405` with `Allow: GET, HEAD`. `HEAD` gets the same status and headers as `GET`, with no body. The app's own error replies are short plain-text bodies: `Bad request` (`400`, with `Connection: close`), `Forbidden` (`403`), `Not found` (`404`), `Method not allowed` (`405`), `Expectation failed` (`417`, with `Connection: close`). Node's parse-error replies use `Bad request` (`400`), `Request header fields too large` (`431`), `Content too large` (`413`) and `Request timeout` (`408`).

The two fixed routes, `/healthz` and `/version.json`, match the path exactly as sent, before any decoding, and the query string is ignored. So `/healthz?x` is the health check, while `/%68ealthz` and `/version%2Ejson` are not (they end at `404`). File paths are still decoded: `/ui/ca%2Ejs` serves `ui/ca.js`.

Each request is checked in this order:

| Step | Check | Answer |
|---|---|---|
| 0 | No `Host` header on an HTTP/1.1 request, or more than one `Host` header | `400 Bad request`, `Connection: close` |
| 0b | An HTTP/1.1 request with an `Expect` header whose value is not `100-continue` (an empty `Expect:` included). HTTP/1.0 requests are not affected: their `Expect` header is ignored | `417 Expectation failed`, `Connection: close` (no body for `HEAD`) |
| 1 | Method is not `GET` or `HEAD` | `405`, `Allow: GET, HEAD` |
| 1a | The request target does not start with `/` (for example the absolute form `http://other.host/ui/ca.js`) | `400 Bad request`, `Connection: close` |
| 2 | Path (up to `?`) is exactly `/healthz` | `200 ok`, whatever the `Host` |
| 3 | `Host` is not allowed | `403 Forbidden` |
| 4 | Path is exactly `/version.json` | `200` with the version, or `404` if there is none |
| 4a | Path contains `//`, ends with `/` (not `/` itself), or contains `%2f` or `%5c`; or it can't be decoded | `404 Not found` |
| 5–8 | `/` becomes `ui/ca.html`; the file must be under `ui/` or `dist/`, have an allowed extension, and its real path (after symbolic links) must stay inside `ui/` or `dist/` | `200` with the file, otherwise `404` |

A request with `Expect: 100-continue` goes through the same steps and gets its final reply at once, with no interim `100 Continue`; the connection then closes. Because step 0 comes before step 0b, a request with two `Host` headers and an `Expect` header gets `400`, not `417`.

Because the `Host` check (step 3) comes first, a path refused at step 4a or 5–8 gets `403`, not `404`, when the `Host` is not allowed.

## Logging

- The app writes one start-up line to stdout (see "Two modes" for the exact text) and start-up errors to stderr. Enable **App Service logs, application logging (filesystem or Log Analytics)** to keep them.
- The app doesn't log requests. Use the platform's **HTTP logs** / `AppServiceHTTPLogs` in Log Analytics for access records.
- The URL paths and headers in those logs carry no member data, because inputs never leave the browser.

## Third-party content

- **Inter font** 4.1 (`ui/assets/fonts/`), SIL Open Font License 1.1. The licence text is shipped as `ui/assets/fonts/LICENSE.txt` and served next to the fonts.
- **Alterna Savings logo** (`ui/assets/alterna-savings.svg`). This is Alterna's own mark.
- No npm packages are used at runtime. The `devDependencies` are only for building and testing.

## Known gaps

The SEC-5b items listed here before (Node's `400` replies without headers, a duplicate `Host` header, `/ui/ca.html/` served, encoded or query forms of the fixed routes, `//` and encoded separators, the short keep-alive timeout, no `engines` field) are fixed (`CHANGES.md` §90). The SEC-5c follow-ups F-1 (a connection left half-open for about 150 seconds after a malformed request) and F-2 (Node's own `417` and `100 Continue` replies without the security headers) are fixed (`CHANGES.md` §91). None of the gaps below serves a file outside `ui/` or `dist/`.

**Accepted deviations from the HTTP standard (RFC 9112)**, decided in the SEC-5b brief; no business impact:

1. **N-SEC5B-1.** A single `Host` header with an invalid value (for example `Host: a b`) gets `403 Forbidden`, not the `400` the standard asks for. The outcome is the same: the request is refused and nothing is served.
2. **N-SEC5B-2.** A request target in absolute form (`GET http://host/ui/ca.js`) gets `400`, although the standard says a server must accept it. Browsers and the App Service front end send only the normal form (`GET /ui/ca.js`), and accepting the absolute form would take the host from the target instead of the checked `Host` header.

**Accepted behaviour** (user decision 2026-10-29, SEC-5c):

3. **N-SEC5C-1.** If a valid request and malformed bytes arrive in the same read, the client gets only the `400` reply, and the valid request gets no answer. Node's default handler behaves the same way. This is not a deviation from the HTTP standard.

**Limit of the SEC-5c fix, to confirm in an Azure test:**

4. **R5c-1 limit.** The app closes a connection only after its reply has been handed to the operating system. If the client is still sending when the connection closes, TCP may answer with a reset, and the client's operating system may then drop the reply before the client reads it. In the measured runs this never happened, but they were on macOS loopback only, not on Linux or behind the App Service front end. It is no worse than Node's default behaviour.

**To confirm with the Azure team:** the front end's idle timeout towards the app (see "Platform").

Also not yet checked: nobody has recorded opening the page in a browser **under the SEC-5 headers** (the CSP console check, the `/version.json` fetch on the printout, and the CSV download), or after the SEC-5b and SEC-5c changes (`CHANGES.md` §90 and §91 "Still to do"). The browser check recorded on 2026-10-29 is for SEC-6 (checklist: no console errors).
