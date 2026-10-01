// Shared logic of the three stub renderers (B29, QA-owned). See STUB-CONTRACT.md.
import { appendFileSync } from 'node:fs';

const DEFAULT_MODEL = {
  type: 'flowchart',
  nodes: [{ id: 'A', text: 'Alpha', classes: ['today'] }, { id: 'B', text: 'Beta', classes: ['planned'] }],
  edges: [{ start: 'A', end: 'B', stroke: 'normal', text: '' }],
};

/** `sources` is an array of strings or of objects carrying the Mermaid text in `source` | `code` | `text`. */
export function sourceOf(item) {
  if (typeof item === 'string') return item;
  return item.source ?? item.code ?? item.text ?? item.content ?? '';
}

export function modelFor(src) {
  const m = /^%%\s*stub-model:\s*(.+)$/m.exec(src);
  return m ? JSON.parse(m[1]) : DEFAULT_MODEL;
}

export function svgFor(i) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" id="stub-${i}" width="100%" viewBox="0 0 200 100" ` +
    `style="max-width: 200px;" aria-roledescription="flowchart-v2"><g><text x="10" y="20">stub ${i}</text></g></svg>`
  );
}

export function log(sources) {
  if (process.env.HELP_STUB_LOG) appendFileSync(process.env.HELP_STUB_LOG, JSON.stringify({ n: sources.length, sources }) + '\n');
}

export function render(sources, mode) {
  log(sources);
  return sources.map((item, i) => {
    const src = sourceOf(item);
    const model = modelFor(src);
    if (mode === 'fail') throw new Error('Parse error on line 3: stub renderer failure');
    if (mode === 'empty') return { svg: '', model };
    if (mode === 'short' && i === sources.length - 1) return undefined; // a missing entry (B29-R8a)
    if (/^%%\s*stub-mode:\s*nosvg/m.test(src)) return { svg: '<div>not an svg</div>', model };
    return { svg: svgFor(i), model };
  });
}
