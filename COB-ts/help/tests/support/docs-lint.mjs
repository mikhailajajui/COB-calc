// QA's independent oracle for the document rules of B29-R2 / R5 / R6 (revision 36). It is a transliteration of the
// brief's detection table onto markdown-it's token stream, written separately from the builder (which it must not
// import). Used (a) by the "live documents" tests, so a documentation defect is found without running the builder,
// and (b) in the scratch checks that prove the T2 expectations against the real parser. Needs help/node_modules.
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { HELP } from './common.mjs';

let MD;
export async function markdownIt() {
  if (!MD) {
    const req = createRequire(join(HELP, 'package.json'));
    // markdown-it 15 is ESM-only: resolve the package folder, import its "import" entry.
    const dir = join(req.resolve('markdown-it/package.json'), '..');
    const mod = await import(pathToFileURL(join(dir, 'dist', 'markdown-it.mjs')).href);
    MD = new mod.default({ html: true, linkify: false, typographer: false });
  }
  return MD;
}

/** B29-R2 countCells(line): the brief's algorithm, verbatim. */
export function countCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  const cells = [];
  let cur = '';
  let open = 0; // length of the open code-span run, 0 when none
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      cur += c + (s[i + 1] ?? '');
      i++;
    } else if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      if (open === 0) open = n;
      else if (open === n) open = 0;
      cur += s.slice(i, i + n);
      i += n - 1;
    } else if (c === '|' && open === 0) {
      cells.push(cur);
      cur = '';
    } else cur += c;
  }
  cells.push(cur);
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.length;
}

const REFUSED_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Every B29-R2 failure of a document: [{ line, rule, what }] (1-based lines), sorted by line then rule. */
export async function lintDocument(src) {
  const md = await markdownIt();
  const toks = md.parse(src, {});
  const lines = src.split('\n');
  const out = [];
  const add = (line, rule, what) => out.push({ line, rule, what });
  const fenced = []; // [start, end) 0-based line ranges of fence tokens
  for (const t of toks) if (t.type === 'fence') fenced.push(t.map);
  let lastTr = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'tr_open') lastTr = t.map[0] + 1;
    if (t.type === 'html_block') add(t.map[0] + 1, 1, 'raw html');
    if (t.type === 'heading_open' && /^h[4-6]$/.test(t.tag)) add(t.map[0] + 1, 2, 'heading deeper than H3');
    if (t.type === 'table_open') {
      let ths = 0;
      for (let j = i + 1; toks[j].type !== 'tr_close'; j++) if (toks[j].type === 'th_open') ths++;
      if (ths < 2) add(t.map[0] + 1, 7, 'table with fewer than 2 columns');
      const [s, e] = t.map;
      const want = countCells(lines[s]);
      for (let l = s + 2; l < e; l++) {
        const got = countCells(lines[l]);
        if (got !== want) add(l + 1, 8, `ragged row (${got} cells, header ${want})`);
      }
    }
    if (t.type === 'paragraph_open' && t.map && t.map[1] - t.map[0] >= 2) {
      const a = lines[t.map[0]];
      const b = lines[t.map[0] + 1];
      if (a.includes('|') && b.includes('|') && REFUSED_DELIM.test(b)) add(t.map[0] + 1, 9, 'table refused by the parser');
    }
    if (t.type === 'inline') {
      const line = t.map ? t.map[0] + 1 : lastTr;
      for (const c of t.children ?? []) {
        if (c.type === 'html_inline') add(line, 1, 'raw html (inline)');
        if (c.type === 'image') {
          const src = c.attrGet('src') ?? '';
          if (!(c.content ?? '').trim()) add(line, 3, 'image without alt text');
          else if (!src.startsWith('data:')) add(line, 3, 'image source is not a data: URI');
        }
        if (c.type === 'link_open') {
          const h = c.attrGet('href') ?? '';
          if (!(/^https?:\/\//.test(h) || h.startsWith('#'))) add(line, 6, `link ${h}`);
        }
      }
      const item = toks[i - 2]; // list_item_open, paragraph_open, inline
      if (item && item.type === 'list_item_open' && /^\[( |x|X)\](\s|$)/.test(t.content ?? '')) add(line, 4, 'task-list item');
    }
  }
  // rule 5: source-line scan outside fences, code spans removed
  lines.forEach((text, i) => {
    if (fenced.some(([s, e]) => i >= s && i < e)) return;
    if (/\[\^[^\]\n]+\]/.test(text.replace(/(`+)[^`]*?\1/g, ''))) add(i + 1, 5, 'footnote');
  });
  return out.sort((x, y) => x.line - y.line || x.rule - y.rule);
}

// ------------------------------------------------------------------ B29-R6 status mapping (the 13 rows)
/** [words, state] in the brief's table; "Not covered" is resolved from the cell text (see statusMatch). */
export const STATUS_TABLE = [
  ['In code, QA-verified', 'covered'],
  ['Partly covered', 'partial'],
  ['Not covered', '*'],
  ['Not verified', 'open'],
  ['Open decision', 'open'],
  ['On hold', 'open'],
  ['Parked', 'open'],
  ['Covered', 'covered'],
  ['Delivered', 'covered'],
  ['Today', 'covered'],
  ['Decided', 'planned'],
  ['Planned', 'planned'],
  ['change planned', 'planned'],
];

/** { words, state, text } for a Status cell's source text, or null when it matches nothing (B29-R6). */
export function statusMatch(cellSource) {
  const text = cellSource.trim().replace(/\*\*/g, '').trim();
  const rows = [...STATUS_TABLE].sort((x, y) => y[0].length - x[0].length);
  for (const [words, state] of rows) {
    if (!text.startsWith(words)) continue;
    const next = text[words.length];
    if (next !== undefined && /[\p{L}\p{N}]/u.test(next)) continue;
    const st = state === '*' ? (text.includes('out of scope') ? 'out' : text.includes('planned') ? 'planned' : 'wrong') : state;
    return { words, state: st, text };
  }
  return null;
}
