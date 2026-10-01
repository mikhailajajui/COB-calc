// ID chips, defining rows and the ID index (B29-R5). Pure functions.

const PREFIXED = '(?:US|UC|BR|IN|FB|DEV|OQ|Q)-[A-Z0-9]+(?:-[A-Z0-9]+)*';
const ID_SCAN = new RegExp(`\\b${PREFIXED}\\b|\\bB\\d{1,3}\\b|\\bF\\d{1,3}\\b|\\bA\\d{1,3}\\b`, 'g');
const ID_WHOLE = new RegExp(`^(?:${PREFIXED}|B\\d{1,3}|F\\d{1,3}|A\\d{1,3})$`);
const ID_LEAD = new RegExp(`^(${PREFIXED}|B\\d{1,3}|F\\d{1,3}|A\\d{1,3})(?:-[a-z][a-z0-9-]*)?(?![A-Za-z0-9_])`);

export const isId = (s) => ID_WHOLE.test(s);

/** Every ID match in a text: [{ id, index }]. */
export function findIds(text) {
  return [...text.matchAll(ID_SCAN)].map((m) => ({ id: m[0], index: m.index }));
}

/**
 * The leading ID list of a first table cell (source text): IDs separated by `,` `/` or white space, from the start of
 * the cell; an ID may be followed directly by a lowercase suffix that belongs to it (DEV-W-interim is the ID DEV-W).
 * An ID repeated in the list is one definition.
 */
export function leadingIds(cellSource) {
  let rest = cellSource.replace(/\*\*/g, '').replace(/`/g, '').trim();
  const ids = [];
  for (;;) {
    const m = ID_LEAD.exec(rest);
    if (!m) break;
    if (!ids.includes(m[1])) ids.push(m[1]);
    rest = rest.slice(m[0].length).replace(/^\s*[,/]\s*|^\s+/, '');
    if (!ID_LEAD.test(rest)) break;
  }
  return ids;
}
