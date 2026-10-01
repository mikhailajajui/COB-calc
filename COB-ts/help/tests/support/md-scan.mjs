// Independent Markdown scanners for the output tests (B29). Written from the documents' own syntax,
// deliberately NOT sharing any code with the builder (QA's independent count, B29-INV-COUNT).

import { STATUS_TABLE, statusMatch } from './docs-lint.mjs';

/** The 13 status entries of B29-R6 (revision 36): [words, state]; "Not covered" is resolved per cell (`*`). */
export const STATUS_WORDS = STATUS_TABLE;

/** Lines of a document with fenced-code state: [{ text, line (1-based), fenced, lang }]. */
export function lines(md) {
  const out = [];
  let fence = null;
  md.split('\n').forEach((text, i) => {
    const m = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)/.exec(text);
    if (!fence && m) {
      fence = { mark: m[2][0], len: m[2].length, lang: m[3] };
      out.push({ text, line: i + 1, fenced: true, lang: fence.lang, edge: true });
    } else if (fence) {
      const close = new RegExp(`^\\s*\\${fence.mark}{${fence.len},}\\s*$`).test(text);
      out.push({ text, line: i + 1, fenced: true, lang: fence.lang, edge: close });
      if (close) fence = null;
    } else {
      out.push({ text, line: i + 1, fenced: false, lang: '' });
    }
  });
  return out;
}

export function headings(md) {
  const hs = [];
  for (const l of lines(md)) {
    if (l.fenced) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l.text);
    if (m) hs.push({ level: m[1].length, text: m[2], line: l.line });
  }
  return hs;
}

export function mermaidBlocks(md) {
  const blocks = [];
  let cur = null;
  for (const l of lines(md)) {
    if (l.fenced && l.lang === 'mermaid' && l.edge && !cur) {
      cur = { startLine: l.line, src: [] };
    } else if (cur && l.fenced && l.edge) {
      blocks.push({ ...cur, src: cur.src.join('\n') });
      cur = null;
    } else if (cur) {
      cur.src.push(l.text);
    }
  }
  return blocks;
}

/** Split a table row into cells; honours escaped pipes and pipes inside code spans. */
export function splitRow(row) {
  const s = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  let tick = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      tick = tick === 0 ? n : tick === n ? 0 : tick;
      cur += s.slice(i, i + n);
      i += n - 1;
    } else if (c === '|' && tick === 0) {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

/** GFM tables outside fenced code: [{ header: [..], rows: [[..]], line }]. */
export function tables(md) {
  const ls = lines(md);
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    if (ls[i].fenced || !/^\s*\|/.test(ls[i].text)) continue;
    if (i + 1 >= ls.length || !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(ls[i + 1].text)) continue;
    const header = splitRow(ls[i].text);
    const rows = [];
    let j = i + 2;
    while (j < ls.length && !ls[j].fenced && /^\s*\|/.test(ls[j].text)) {
      rows.push({ cells: splitRow(ls[j].text), line: ls[j].line });
      j++;
    }
    out.push({ header, rows, line: ls[i].line });
    i = j - 1;
  }
  return out;
}

/**
 * Status cells of every table with a header cell equal to "Status" (case-insensitive, trimmed), classified by the
 * brief's mapping (docs-lint.statusMatch). counts: by words; states: by data-state; unmatched: full cell texts.
 */
export function statusCounts(md) {
  const counts = Object.fromEntries(STATUS_WORDS.map(([w]) => [w, 0]));
  const states = { covered: 0, partial: 0, wrong: 0, planned: 0, open: 0, out: 0 };
  const unmatched = [];
  for (const t of tables(md)) {
    const col = t.header.findIndex((h) => h.trim().toLowerCase() === 'status');
    if (col < 0) continue;
    for (const r of t.rows) {
      const cell = (r.cells[col] ?? '').replace(/\*\*/g, '').trim();
      const hit = statusMatch(cell);
      if (hit) {
        counts[hit.words]++;
        states[hit.state]++;
      } else unmatched.push({ cell, line: r.line });
    }
  }
  return { counts, states, unmatched };
}

/** The leading ID list of a first cell (B29-R5): IDs separated by `,` `/` or whitespace from the start. */
export function leadingIds(cell) {
  const c = cell.replace(/\*\*/g, '').replace(/`/g, '').trim();
  // an ID may be followed directly by a lowercase suffix that belongs to it (DEV-W-interim -> DEV-W)
  const ID = /^((?:US|UC|BR|IN|FB|DEV|OQ|Q)-[A-Z0-9]+(?:-[A-Z0-9]+)*|B\d{1,3}|F\d{1,3}|A\d{1,3})(?:-[a-z][a-z0-9-]*)?(?![A-Za-z0-9_])/;
  const ids = [];
  let rest = c;
  for (;;) {
    const m = ID.exec(rest);
    if (!m) break;
    ids.push(m[1]);
    rest = rest.slice(m[0].length).replace(/^\s*[,/]\s*|^\s+/, '');
    if (!ID.test(rest)) break;
  }
  return ids;
}
