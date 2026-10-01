// Status chips (B29-R6): the words of a Status cell that map to one of six display states.

// [words, state]. "Not covered" is resolved per cell. Longest words first, so a longer entry is never shadowed.
const TABLE = [
  ['In code, QA-verified', 'covered'],
  ['Partly covered', 'partial'],
  ['Not covered', '*'],
  ['Not verified', 'open'],
  ['Open decision', 'open'],
  ['On hold', 'open'],
  ['change planned', 'planned'],
  ['Parked', 'open'],
  ['Covered', 'covered'],
  ['Delivered', 'covered'],
  ['Decided', 'planned'],
  ['Planned', 'planned'],
  ['Today', 'covered'],
].sort((a, b) => b[0].length - a[0].length);

export const STATES = ['covered', 'partial', 'planned', 'wrong', 'open', 'out'];

/** { words, state } for the source text of a Status cell, or null when it matches nothing. Case-sensitive, word boundary. */
export function matchStatus(cellSource) {
  const text = cellSource.replace(/\*\*/g, '').trim();
  for (const [words, state] of TABLE) {
    if (!text.startsWith(words)) continue;
    const next = text[words.length];
    if (next !== undefined && /[\p{L}\p{N}]/u.test(next)) continue;
    if (state !== '*') return { words, state };
    return { words, state: text.includes('out of scope') ? 'out' : text.includes('planned') ? 'planned' : 'wrong' };
  }
  return null;
}
