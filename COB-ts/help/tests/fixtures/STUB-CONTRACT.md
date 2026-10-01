# Stub renderer contract (QA fixture for the Help build tests)

The build accepts `--renderer <module>` (B29 decision 5). The module exports
`renderDiagrams(sources) -> Promise<Array<{ svg: string, model: object }>> | Array<...>`,
one entry per Mermaid block, in the order the blocks were passed.

- `sources` items may be strings or objects with the Mermaid text in `source` (the stubs also accept
  `code`, `text`, `content`). The build may call the renderer once for all blocks or once per
  document; the stubs derive everything from the source text, never from the position.
- `svg` is an `<svg ...>` string. The stub's carries `width="100%"`, `viewBox="0 0 200 100"` and
  `style="max-width: 200px;"` (the build must replace Mermaid's width / max-width style by the natural
  size from the viewBox, B29-R8) and no `role`, `<title>` or `<desc>` (the build adds them).
- `model` mirrors Mermaid's own parsed model (`getDiagramFromText(src).db`):
  - flowchart: `{ type: 'flowchart', nodes: [{ id, text, classes: [string] }],
    edges: [{ start, end, stroke: 'normal' | 'dotted' | 'thick', text }] }`
  - sequence: `{ type: 'sequence', actors: [{ name }], messages: [{ from, to, message }] }`
  - any other `type` (for example `gantt`) must fail the build (B29 decision 5).
- A model is taken from a first-line comment in the block: `%% stub-model: <one-line JSON>`;
  without it the stub returns two nodes (`Alpha` today, `Beta` planned) and one edge.
- `%% stub-mode: nosvg` in a block makes the stub return a non-`<svg` string.
- `stub-renderer-fail.mjs` always throws `Error('Parse error on line 3: stub renderer failure')`.
- `stub-renderer-empty.mjs` returns `svg: ''` for every block.
- If `HELP_STUB_LOG` names a file, each call appends one line `{"n": <number of sources>, "sources": <the argument as received>}` to it (revision 36: `sources` added so the test can pin the `{ key, k, line, source }` items).
- `stub-renderer-short.mjs` (revision 36) returns a result for every source except the last, whose entry is `undefined`.
- Revision 36 (B29-R8a): the build calls the renderer exactly once per run with every Mermaid block of every document (registry order, then document order); each item is `{ key, k, line, source }`.
