# Help page add-on

The calculator's Help page (`ui/help.html`) is generated from the three documents in `COB-ts/docs/` (user manual,
coverage report, domain overview). Everything Help is in this folder, with its own `package.json`, lock and
`node_modules`; the calculator, the engine and the root `package.json` know nothing of it. The only other Help files
are the generated page `ui/help.html` and two marked blocks in `ui/ca.html` (the "Help" link in the header).

## Build and check

Run from `COB-ts/`:

```bash
npm install --prefix help        # once per clone: markdown-it 15.0.2 and mermaid 11.17.2 (exact pins)
node help/build-help.mjs         # builds ui/help.html (needs Chrome and the global @playwright/mcp for the diagrams)
node help/build-help.mjs --check # no Chrome, no packages: "Help is up to date." or a stale WARNING; exit 0
```

`--check --strict` exits 1 when the page is stale, `--check --json` prints one JSON line, and `--check` also exits 1
when a document contains a string that the baseline scans of the UI folder forbid (it names `docs/<file>:<line>`).
The build refuses such a string too, and any document that breaks the Markdown subset (no raw HTML, no heading
deeper than H3, no relative links, no ragged table rows, and so on); it writes nothing and leaves the previous page
untouched. Tests (`help/tests/`) run with the whole suite (`npx vitest run`); the Chrome checks are
`node help/tests/check_help_page.mjs` and `node help/tests/check_help_removal.mjs`.

Run the build after every change to the documents or to anything in this folder; the suite goes red (F13) until you do.

## How to remove Help

Nothing here can be undone (the project has no git), so read all three steps first. Run from `COB-ts/`:

1. Delete the generated page: `rm ui/help.html`.
2. Edit `ui/ca.html`: delete every line from `/* HELP:BEGIN */` to `/* HELP:END */` and every line from
   `<!-- HELP:BEGIN -->` to `<!-- HELP:END -->`, inclusive (exactly one block of each kind). The file is then
   byte-identical to the page before Help was added.
3. Delete this folder: `rm -r help`.

The three documents stay in `COB-ts/docs/` as plain Markdown; the procedure never touches them. Nothing else
changes: no `package.json` key, no lock, no script, no `serve.mjs`, no test of the calculator. Removing Help leaves
the calculator building and its whole suite green in the repository layout (`COB-ts/` beside `COB-user-stories.md`,
which fitness check F7 reads). A copy of `COB-ts/` alone fails F7 with or without Help, and that is unrelated to Help.

The mechanical part of the procedure, which the removal test performs on a scratch copy:

```removal-steps
delete ui/help.html
strip ui/ca.html /* HELP:BEGIN */ /* HELP:END */
strip ui/ca.html <!-- HELP:BEGIN --> <!-- HELP:END -->
delete help
```

After removing, follow the prose follow-ups in `COB-architecture.md` (B29-X4 step 4): the `R-HELP` lines in
`CLAUDE.md` and the agent files, the "Getting help" section of the user manual and the coverage line about the
Help page, and a line in `CHANGES.md`.

## Files

| Path | Role |
|---|---|
| `build-help.mjs` | the command line |
| `lib/` | registry, Markdown rules, IDs, status chips, tables, diagrams, page template, fingerprint, check, UI-scan guard, Chrome renderer |
| `assets/help.css`, `assets/help.client.js` | inlined into the page (the script is at most 8 KB, no libraries) |
| `tests/` | the Help tests (vitest `.test.mjs` files and two Chrome scripts) |
