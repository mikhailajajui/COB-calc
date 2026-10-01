// Heading slugs and number aliases (B29-R3). Pure functions.

const NUMBER = /^(\d+(?:\.\d+)*)\.?\s+/;
const MAX = 48;

/** The heading text without its leading number ("4.2 Pending" -> "Pending"). */
export function stripNumber(text) {
  return text.replace(NUMBER, '');
}

/** "4.2 Pending" -> "4-2"; null when the heading is not numbered. */
export function aliasOf(text) {
  const m = NUMBER.exec(text);
  return m ? m[1].replace(/\./g, '-') : null;
}

/** At most 48 characters, cut at a hyphen boundary; a hard cut only when the first word is longer. */
export function cut(slug) {
  if (slug.length <= MAX) return slug;
  if (slug[MAX] === '-') return slug.slice(0, MAX);
  const i = slug.slice(0, MAX).lastIndexOf('-');
  return i > 0 ? slug.slice(0, i) : slug.slice(0, MAX);
}

export function slugify(text) {
  const s = stripNumber(text)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cut(s) || 'section';
}
