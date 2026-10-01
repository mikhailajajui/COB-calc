// Token stream -> HTML for one document (B29-R3 to R7). Headings, tables, code and figures are written here; the
// remaining blocks and all inline text use markdown-it's own renderer with the rules overridden below.
import { findIds, leadingIds } from './ids.mjs';
import { plainText } from './markdown.mjs';
import { matchStatus } from './status.mjs';

const FIRST_COLUMN_MAX = 40;

/** One-time setup of the inline rules on a parser instance; the page-wide state travels in `env`. */
export function installRules(md) {
  const esc = md.utils.escapeHtml;
  const rules = md.renderer.rules;
  rules.text = (tokens, idx, _o, env) => {
    const content = tokens[idx].content;
    if (env.noChips > 0) return esc(content);
    let out = '';
    let last = 0;
    for (const { id, index } of findIds(content)) {
      out += esc(content.slice(last, index));
      env.used.add(id);
      out += env.defined.has(id) ? `<a class="id" href="#${id}">${id}</a>` : `<span class="id" data-id="${id}">${id}</span>`;
      last = index + id.length;
    }
    return out + esc(content.slice(last));
  };
  rules.link_open = (tokens, idx, _o, env) => {
    const href = tokens[idx].attrGet('href') ?? '';
    const external = /^https?:\/\//.test(href);
    env.noChips++;
    env.external.push(external);
    return external ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">` : `<a href="${esc(href)}">`;
  };
  rules.link_close = (_t, _i, _o, env) => {
    env.noChips--;
    return env.external.pop() ? '<span class="visually-hidden"> (opens in a new tab)</span></a>' : '</a>';
  };
  const code = (content) => `<pre class="code" tabindex="0" role="region" aria-label="Code"><code>${esc(content)}</code></pre>\n`;
  rules.fence = (tokens, idx) => code(tokens[idx].content);
  rules.code_block = (tokens, idx) => code(tokens[idx].content);
}

export const newEnv = (defined) => ({ defined, used: new Set(), noChips: 0, external: [], unmatched: new Set(), status: 0 });

const chipHtml = (words, state) =>
  `<span class="status" data-state="${state}"><span class="glyph" aria-hidden="true"><svg viewBox="0 0 12 12" focusable="false"><use href="#g-${state}"/></svg></span>${words}</span>`;

/** The inline children of a Status cell with the leading words replaced by a chip (the rest of the text follows). */
function withStatusChip(md, children, hit) {
  const out = [];
  let left = hit.words;
  for (const c of children) {
    if (left && c.type === 'text' && c.content) {
      const take = Math.min(left.length, c.content.length);
      if (c.content.slice(0, take) === left.slice(0, take)) {
        if (left === hit.words) {
          out.push({ type: 'html_inline', content: chipHtml(md.utils.escapeHtml(hit.words), hit.state) });
        }
        left = left.slice(take);
        if (take < c.content.length) {
          out.push({ type: 'text', content: c.content.slice(take) });
        }
        continue;
      }
    }
    out.push(c);
  }
  return left ? children : out;
}

function parseTable(slice) {
  const header = [];
  const body = [];
  let inHead = false;
  let row = null;
  let cell = null;
  for (const t of slice) {
    if (t.type === 'thead_open') inHead = true;
    else if (t.type === 'thead_close') inHead = false;
    else if (t.type === 'tr_open') row = { line: t.map[0] + 1, cells: [] };
    else if (t.type === 'th_open' || t.type === 'td_open') cell = { tag: t.tag, style: t.attrGet('style'), inline: null };
    else if (t.type === 'inline') cell.inline = t;
    else if (t.type === 'th_close' || t.type === 'td_close') row.cells.push(cell);
    else if (t.type === 'tr_close') (inHead ? header : body).push(row);
  }
  return { header, body };
}

/**
 * HTML of one document: { html, headings }.
 * ctx: { md, tokens, key, title, headings (analysis headings with .id/.alias), figures: Map(blockIndex -> html), env }
 */
export function renderBody({ md, tokens, key, headings, figures, env }) {
  const esc = md.utils.escapeHtml;
  const byIndex = new Map(headings.map((h) => [h.index, h]));
  const inline = (tok, noChips = false) => {
    if (noChips) env.noChips++;
    const html = md.renderer.renderInline(tok.children ?? [], md.options, env);
    if (noChips) env.noChips--;
    return html;
  };
  let heading = headings.find((h) => h.level === 1);
  let block = 0;
  let out = '';

  const renderTable = (slice) => {
    const { header, body } = parseTable(slice);
    const cols = header[0].cells.length;
    const statusCol = header[0].cells.findIndex((c) => plainText(c.inline.children).trim().toLowerCase() === 'status');
    const longest = Math.max(0, ...body.map((r) => plainText(r.cells[0].inline.children).length));
    const rowHeader = longest <= FIRST_COLUMN_MAX;
    const attr = (c) => (c.style ? ` style="${esc(c.style)}"` : '');
    let html =
      `<div class="table-wrap" role="region" tabindex="0" aria-labelledby="${heading.id}">\n` +
      `<table${cols >= 6 ? ' class="wide"' : ''}>\n<caption class="visually-hidden">${esc(heading.text)}</caption>\n<thead><tr>` +
      header[0].cells.map((c) => `<th scope="col"${attr(c)}>${inline(c.inline)}</th>`).join('') +
      '</tr></thead>\n<tbody>\n';
    for (const row of body) {
      const ids = leadingIds(row.cells[0].inline.content);
      const spans = ids.slice(1).map((id) => `<span id="${id}"></span>`).join('');
      html += `<tr${ids.length ? ` id="${ids[0]}"` : ''}>`;
      row.cells.forEach((c, i) => {
        let content;
        if (i === statusCol) {
          const hit = matchStatus(c.inline.content);
          if (hit) {
            env.status++;
            const kids = withStatusChip(md, c.inline.children, hit);
            content = md.renderer.renderInline(kids, md.options, env);
          } else {
            env.unmatched.add(c.inline.content.replace(/\*\*/g, '').trim());
            content = inline(c.inline);
          }
        } else content = inline(c.inline);
        if (i === 0) {
          const copy = ids.length ? ` <a class="anchor" href="#${ids[0]}" aria-label="Link to ${ids[0]}">#</a>` : '';
          content = `${spans}${content}${copy}`;
          html += rowHeader ? `<th scope="row"${attr(c)}>${content}</th>` : `<td${attr(c)}>${content}</td>`;
        } else html += `<td${attr(c)}>${content}</td>`;
      });
      html += '</tr>\n';
    }
    return html + '</tbody>\n</table>\n</div>\n<p class="table-hint">Scroll sideways to see all columns.</p>\n';
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') {
      const h = byIndex.get(i);
      const inner = inline(tokens[i + 1], true);
      if (h.level === 1) out += `<h1 id="${h.id}">${inner}</h1>\n`;
      else {
        heading = h;
        out +=
          (h.alias ? `<span id="${h.alias}"></span>` : '') +
          `<${t.tag} id="${h.id}" tabindex="-1">${inner} <a class="anchor" href="#${h.id}" aria-label="Link to section: ${esc(h.text)}">#</a></${t.tag}>\n`;
      }
      i += 2;
    } else if (t.type === 'table_open') {
      let j = i;
      while (tokens[j].type !== 'table_close') j++;
      out += renderTable(tokens.slice(i, j + 1));
      i = j;
    } else if (t.type === 'fence' && (t.info || '').trim().split(/\s+/)[0] === 'mermaid') {
      out += figures.get(block++);
    } else {
      out += md.renderer.render([t], md.options, env);
    }
  }
  return out;
}
