# share: the single-file COB.html

`COB-ts/COB.html` is one generated file that holds the whole calculator (page, styles, engine and UI code, logo). Double-click it or e-mail it: it runs offline from `file://`, with no server and no network request. It is a build output, not a second implementation: it is the sources in `ui/` and `dist/` plus a short closed list of changes.

## Build

From `COB-ts/`:

```bash
npm run build                      # the normal TypeScript build (dist/)
node share/build-share.mjs         # writes COB-ts/COB.html
# or both steps at once:
npm run build --prefix share
```

Options: `--out <path>`, `--date YYYY-MM-DD` (else the environment variable `COB_BUILD_DATE`, else today in UTC), `--root <dir>` (read `ui/`, `dist/`, `package.json` from another folder), `--check` (exit 1 with a warning when the output is older than a source). There is no root `package.json` script on purpose.

The file is a snapshot of the sources at build time: rebuild before sharing, after any change to `ui/`, `dist/` or the version.

## What differs from the served page

- No Help link (the optional add-on blocks are removed).
- No web fonts: the system font stack is used. No external link and no network request of any kind.
- The logo is embedded as a data URI (from `share/assets/alterna-savings.svg`) and is not a link.
- The engine version line is baked in from `package.json` instead of being fetched.
- A footer (screen only) shows the version and build date.
- A Content-Security-Policy meta tag allows only the one inline script (by its sha256), inline styles and data images.

## Coupling

One-way: `share/` reads `ui/`, `dist/` and `package.json` read-only; nothing in the calculator, its engine, tests or build refers to `share/`. The only other mention is the optional `COB_PAGE_URL` override in the Chrome scripts.

## Removal

1. Delete the `share/` folder.
2. Delete `COB-ts/COB.html`.
3. Delete the `COB_PAGE_URL` lines in the Chrome scripts only if wanted (they are harmless).

Nothing else changes.
