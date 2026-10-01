// Markdown parsing and the document rules of B29-R2. The parser is loaded lazily so that this module (and countCells)
// can be imported without the Help packages installed.
import { leadingIds } from './ids.mjs';

/**
 * Number of cells of a table source line (B29-R2 rule 8): drop one leading `|`; a backslash skips the next character;
 * a run of n backticks opens a code span when none is open and closes it at the next run of exactly n; a `|` outside
 * a code span ends a cell; a last piece that is empty or white space only is dropped (the closing `|`).
 */
export function countCells(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  const cells = [];
  let cur = '';
  let open = 0;
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

/** A markdown-it 15 instance: raw HTML parsed (so that it can be detected and rejected), no linkify, no typographer. */
export async function createParser() {
  const { default: MarkdownIt } = await import('markdown-it');
  return new MarkdownIt({ html: true, linkify: false, typographer: false });
}

/** The plain text of inline children (code spans included, markup dropped). */
export function plainText(children = []) {
  let s = '';
  for (const c of children) {
    if (c.type === 'text' || c.type === 'code_inline') s += c.content;
    else if (c.type === 'softbreak' || c.type === 'hardbreak') s += ' ';
    else if (c.type === 'image') s += c.content;
  }
  return s;
}

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TASK = /^\[( |x|X)\](\s|$)/;
const FOOTNOTE = /\[\^[^\]\n]+\]/;
const CODE_SPAN = /(`+)[^`]*?\1/g;

/**
 * Parse a document and check every rule of B29-R2 on the token stream.
 * Returns { tokens, errors: [{ line, msg }], headings, blocks, links, rows }:
 *   headings [{ level, text, line, index }], blocks [{ line, source, heading }] (Mermaid fences),
 *   links [{ line, id }] (#id targets, checked once the ids of the page are known),
 *   rows [{ line, ids }] (table body rows whose first cell starts with an ID list).
 */
export function analyze(src, md) {
  const tokens = md.parse(src, {});
  const lines = src.split('\n');
  const errors = [];
  const headings = [];
  const blocks = [];
  const links = [];
  const rows = [];
  const add = (line, msg) => errors.push({ line, msg });
  const fenced = [];
  let lastTr = 1;
  let lastHeading = null;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'fence') {
      fenced.push(t.map);
      if ((t.info || '').trim().split(/\s+/)[0] === 'mermaid') {
        blocks.push({ line: t.map[0] + 1, source: t.content.replace(/\n$/, ''), heading: lastHeading });
      }
    } else if (t.type === 'tr_open') {
      lastTr = t.map[0] + 1;
    } else if (t.type === 'html_block') {
      add(t.map[0] + 1, 'raw HTML is not allowed in a document');
    } else if (t.type === 'heading_open') {
      const level = Number(t.tag.slice(1));
      const inline = tokens[i + 1];
      const h = { level, text: plainText(inline.children), line: t.map[0] + 1, index: i };
      if (level > 3) add(h.line, `heading deeper than H3 (${t.tag})`);
      else {
        headings.push(h);
        lastHeading = h;
      }
    } else if (t.type === 'table_open') {
      let cols = 0;
      for (let j = i + 1; tokens[j].type !== 'tr_close'; j++) if (tokens[j].type === 'th_open') cols++;
      if (cols < 2) add(t.map[0] + 1, 'table with fewer than 2 columns');
      const [s, e] = t.map;
      const want = countCells(lines[s]);
      for (let l = s + 2; l < e; l++) {
        const got = countCells(lines[l]);
        if (got !== want) add(l + 1, `table row has ${got} cells, the header has ${want}`);
      }
      let inBody = false;
      for (let j = i + 1; tokens[j].type !== 'table_close'; j++) {
        if (tokens[j].type === 'tbody_open') inBody = true;
        if (inBody && tokens[j].type === 'tr_open') {
          const first = tokens[j + 2];
          const ids = first && first.type === 'inline' ? leadingIds(first.content) : [];
          if (ids.length) rows.push({ line: tokens[j].map[0] + 1, ids });
        }
      }
    } else if (t.type === 'paragraph_open' && t.map && t.map[1] - t.map[0] >= 2) {
      const a = lines[t.map[0]];
      const b = lines[t.map[0] + 1];
      if (a.includes('|') && b.includes('|') && DELIMITER.test(b)) add(t.map[0] + 1, 'table refused by the parser (header and delimiter row differ in width)');
    } else if (t.type === 'inline') {
      const line = t.map ? t.map[0] + 1 : lastTr;
      for (const c of t.children ?? []) {
        if (c.type === 'html_inline') add(line, 'raw HTML is not allowed in a document');
        else if (c.type === 'image') {
          const href = c.attrGet('src') ?? '';
          if (!(c.content ?? '').trim()) add(line, 'image without alt text');
          else if (!href.startsWith('data:')) add(line, 'image source must be a data: URI');
        } else if (c.type === 'link_open') {
          const href = c.attrGet('href') ?? '';
          if (/^https?:\/\//.test(href)) continue;
          if (href.startsWith('#')) links.push({ line, id: href.slice(1) });
          else add(line, `link target not allowed: ${href} (use http(s):// or #id)`);
        }
      }
      const item = tokens[i - 2];
      if (item && item.type === 'list_item_open' && TASK.test(t.content ?? '')) add(line, 'task-list item');
    }
  }

  lines.forEach((text, i) => {
    if (fenced.some(([s, e]) => i >= s && i < e)) return;
    if (FOOTNOTE.test(text.replace(CODE_SPAN, ''))) add(i + 1, 'footnote');
  });

  const h1 = headings.filter((h) => h.level === 1);
  if (h1.length !== 1) add(h1[1]?.line ?? 1, `a document needs exactly one H1 (found ${h1.length})`);

  return { tokens, errors, headings, blocks, links, rows };
}
