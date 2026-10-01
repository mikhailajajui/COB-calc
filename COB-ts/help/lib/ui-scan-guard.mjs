// B29-R13: strings that three baseline tests forbid anywhere in the UI folder. The generated page sits in that folder
// and quotes the documents, so the build refuses a document line, and finally the page, that contains one.
// The list is hard-coded on purpose (Help reads nothing of the calculator side); a QA test cross-checks it against the
// baseline tests, read as text. Origins are named by bare file name.

export const UI_SCAN_PATTERNS = [
  { id: 'UIG-1', pattern: /includedInCob/, origin: 'b10-includedincob-optional.test.ts' },
  { id: 'UIG-2', pattern: /\btotalFees\b/, origin: 'fees.test.ts' },
  { id: 'UIG-3', pattern: /archive\/pre-b27/, origin: 'b27-personal-loan-monthly-only.test.ts' },
];

/** [{ line, id, match }] with 1-based lines, one entry per line and pattern. */
export function findForbidden(text) {
  const hits = [];
  text.split('\n').forEach((lineText, i) => {
    for (const { id, pattern } of UI_SCAN_PATTERNS) {
      const m = pattern.exec(lineText);
      if (m) hits.push({ line: i + 1, id, match: m[0] });
    }
  });
  return hits;
}

export const originOf = (id) => UI_SCAN_PATTERNS.find((p) => p.id === id)?.origin ?? '';
