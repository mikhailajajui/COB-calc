# Deploying the COB Calculator to Azure App Service on Windows

This note is for the Azure and security teams. It covers only what differs from the Linux deployment in `docs/DEPLOY-AZURE.md`, which stays the reference for everything not repeated here: what the application is, the app settings `WEBSITE_HOSTNAME` / `COB_ALLOWED_HOSTS`, the security settings, the security headers and what the server publishes. User decision 2026-10-30: deploy on Azure App Service for Windows, worked on in the `win_deploy` branch.

**Status: not yet deployed.** Nothing here has been checked on a Windows App Service. Items marked *to confirm* must be checked on the first deployment (see "First deployment checklist").

## How it runs

```
browser --HTTPS--> App Service front end --> IIS --(iisnode, named pipe)--> node server.cjs --> ui/serve.mjs
```

- On Windows, App Service runs Node.js inside IIS through **iisnode**. iisnode starts `node` with the entry file named in `web.config` and passes it a **named pipe** (`\\.\pipe\<name>`) in `PORT` instead of a port number.
- `ui/serve.mjs` accepts that pipe **in hosted mode only** (when `WEBSITE_HOSTNAME` is set, which App Service does) and listens on it. A pipe name that isn't exactly `\\.\pipe\<name>` (name of letters, digits, `{ } . _ -`, at most 200 characters) is refused at start-up with the usual `PORT must be a whole number…` message. In local mode `PORT` must still be a number.
- iisnode loads its entry file with `require()`. `ui/serve.mjs` is an ES module with top-level `await`, which `require()` can't load, so the entry file is **`server.cjs`**, which only imports `ui/serve.mjs`.
- `web.config` sends **every** request to `server.cjs`, so IIS never serves a file itself. The allow-list, the `Host` check, `/healthz`, `/version.json` and the security headers are the app's, exactly as on Linux.

## Platform

| Setting | Value |
|---|---|
| Service | Azure App Service, **Windows** |
| Plan | **Basic (B1) or higher.** Node 24 on Windows App Service is 64-bit only, and the Free (F1) and Shared (D1) plans run only 32-bit workers. On a 32-bit worker iisnode can't find Node 24 and the site answers `500`. |
| Platform (bitness) | **64-bit** (`use32BitWorkerProcess=false`; the pipeline sets it) |
| Node version | App setting `WEBSITE_NODE_DEFAULT_VERSION=~24` (the latest Node 24 the platform has). CI builds and tests on Node 26.13.0, as on Linux. *To confirm:* the 24.x patch App Service picks is 24.22.2 or later (`docs/DEPLOY-AZURE.md`, "Platform"). Move to `~26` once Node 26 is available on Windows App Service, and before Node 24's end of life on 2028-04-30. |
| Startup command | None. `web.config` names the entry file (`server.cjs`); the Linux "Startup command" setting doesn't apply. |
| Platform build | Off: `SCM_DO_BUILD_DURING_DEPLOYMENT=false` |
| Deployment method | **Zip deploy**, not run-from-package. iisnode writes its logs to `iisnode\` under the site folder, which run-from-package mounts read-only. |

## What to deploy

The Linux package plus the two Windows files, keeping their relative paths:

| Path | Why |
|---|---|
| `ui/`, `dist/`, `package.json` | As on Linux (`docs/DEPLOY-AZURE.md`, "What to deploy") |
| `server.cjs` | iisnode's entry point; imports `ui/serve.mjs` |
| `web.config` | Hands every request to iisnode, hides the `iisnode` log folder, removes IIS's `Server` and `X-Powered-By` headers, passes the app's error replies through unchanged, turns off iisnode's debugger and developer error pages |

The app does not serve `server.cjs` or `web.config` (both answer `404`), because only files under `ui/` and `dist/` are published.

## Pipeline

`azure-pipelines.yml` on `win_deploy`:

- **Build** job (Linux): Node 26.13.0, `npm ci`, typecheck, build, the full test suite, then the zip (`ui/`, `dist/`, `package.json`, `server.cjs`, `web.config`).
- **WindowsPipe** job (Windows agent): `tests/tooling/win-serve-pipe.test.ts`, which starts `ui/serve.mjs` and `server.cjs` in hosted mode on a real Windows named pipe and checks `/healthz`, the page, the security headers, the `Host` check and that `server.cjs`, `web.config` and `package.json` are `404`.
- **Deploy** stage, off unless the run's "Deploy to Azure App Service" box is ticked: `AzureWebApp@1` with `appType: webApp`, zip deploy, `WEBSITE_NODE_DEFAULT_VERSION=~24`, `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, `use32BitWorkerProcess=false`. Set `azureServiceConnection` and `webAppName` first, and create the `cob-calculator-windows` environment (add an approval check to it for production).

## Security settings

As in `docs/DEPLOY-AZURE.md`, "Security settings on App Service": HTTPS Only on, minimum TLS 1.2, FTP/FTPS disabled, SCM and FTP basic-auth publishing credentials off, remote debugging off, access restrictions or a private endpoint (also on the SCM site), health check path `/healthz`, ARR affinity off. The pipeline does not set these.

## Logging

- iisnode captures the app's stdout and stderr (the start-up line, start-up errors) in `D:\home\site\wwwroot\iisnode\`. Read them through the Kudu console or the Log stream. They aren't reachable from the web: `web.config` hides that folder and the app doesn't publish it.
- Access records: the platform's HTTP logs, as on Linux.

## Differences from Linux to accept or confirm

1. **IIS answers some requests itself, without the app's security headers.** Examples: requests IIS's request filtering refuses (for example a double-encoded URL or an over-long URL), and the `500`/`502`/`503` IIS sends if Node isn't running. On Linux every reply comes from the app. These replies carry no member data, but the CSP and other headers are missing from them (*to confirm* which ones occur and whether the security team accepts them).
2. **The SEC-5b and SEC-5c connection handling sits behind IIS.** IIS parses the client's HTTP request before the app sees it, so the app's replies to malformed requests (`400`/`408`/`413`/`431`/`417`) mostly don't reach clients; IIS replies instead. The app's keep-alive and request timeouts (120 s / 125 s / 125 s) apply on the pipe between IIS and Node, not to client connections.
3. **The `Host` check depends on iisnode passing the original `Host` header.** It should, but *to confirm*: if the app answers `403` to its own host name, it isn't.
4. **`WEBSITE_HOSTNAME` must reach the Node process.** If it doesn't, `serve.mjs` starts in local mode, refuses the pipe and exits; the iisnode log then shows `serve.mjs: PORT must be a whole number from 1 to 65535 (got "\\.\pipe\…")` (*to confirm* it's set).

## First deployment checklist

From an allowed network:

```bash
curl -sI https://<host>/                 # 200, the full header set from docs/DEPLOY-AZURE.md, and no Server / X-Powered-By
curl -s  https://<host>/healthz          # ok
curl -s  https://<host>/version.json     # {"version":"<version>"}
curl -sI https://<host>/package.json     # 404
curl -sI https://<host>/server.cjs       # 404
curl -sI https://<host>/web.config       # 404
curl -sI https://<host>/iisnode/         # 404
```

Then open the page, check the browser console shows no CSP errors, run one calculation and the CSV download. In Kudu, check that the iisnode log shows `cob-calculator (Canada): hosted mode, listening on \\.\pipe\…`, and that the Node version (`node -v` in the Kudu console) is 24.22.2 or later.
