/**
 * F7 (COB-architecture.md §6): open decisions are registered.
 *
 * SEC-11 (revision 60 brief, user decisions Q-SEC11-1 of 2026-10-28): the suite must pass in a copy of
 * COB-ts alone, with ZERO skipped tests. F7 therefore reads only the in-folder registry COB-ts/DECISIONS.md.
 * The agreement of that registry with the business record (COB-user-stories.md, one folder above COB-ts;
 * the brief's F7c) is NOT a vitest test: it is the parent-level script tools/check-decisions-registry.mjs,
 * run in the repository layout (user decision Q-SEC11-1 (iii)).
 *
 *  (a) Every export of src/ca/policies.ts has a JSDoc tag `@decision <ID>`, and that ID is a row of DECISIONS.md.
 *  (b) DECISIONS.md exists, and every `it.fails` / `test.fails` in tests/ca has a preceding comment matching
 *      /(012 D-\d+|OQ-[A-Z]+|known_divergence)/. "Preceding comment" = the contiguous block of
 *      comment lines directly above the call (blank lines skipped). Calls inside comments don't count.
 *  (d) The registry lists exactly the policies.ts @decision IDs: no missing ID, no stale row, no ID in two rows.
 *  (e) Q-SEC11-1 (ii): every registry row holds four non-empty cells, ID | one-line decision | status |
 *      business record, and the business-record cell cites a section (§n).
 *
 * Registry row (SEC-11-R1): a line matching ^|\s*<ID>\s*| where <ID> is the whole first cell and matches the
 * @decision ID pattern below. Header and separator rows don't match.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, SRC_CA, listFiles, read, rel, stripComments } from './support.js';

const POLICIES = join(SRC_CA, 'policies.ts');
const REGISTRY = join(ROOT, 'DECISIONS.md');
const TAG = /(012 D-\d+|OQ-[A-Z]+|known_divergence)/;
// B24 widened OQ- to (OQ|Q)- (Q-SACD); B37 widened it to DEC-... IDs (DEC-B37-LEAP-N).
const ID = String.raw`(?:OQ|Q)-[A-Z]+|DEC-[A-Z0-9]+(?:-[A-Z0-9]+)*`;
const EXPORT_RE = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?export\s+(?:declare\s+)?(?:const|let|var|function|type|interface|enum|class)\s+(\w+)/g;
const DECISION_RE = new RegExp(String.raw`@decision\s+(${ID})\b`);
const ROW_RE = new RegExp(String.raw`^\|\s*(${ID})\s*\|`);

interface PolicyExport {
  name: string;
  id: string | undefined;
}

function policyExports(): PolicyExport[] {
  const src = read(POLICIES);
  return [...src.matchAll(EXPORT_RE)].map((m) => ({ name: m[2]!, id: m[1]?.match(DECISION_RE)?.[1] }));
}

interface RegistryRow {
  line: number;
  id: string;
  cells: string[];
}

/** Rows of DECISIONS.md whose first cell is exactly a decision ID. [] when the file is absent. */
function registryRows(): RegistryRow[] {
  if (!existsSync(REGISTRY)) return [];
  const out: RegistryRow[] = [];
  read(REGISTRY)
    .split('\n')
    .forEach((l, i) => {
      const m = l.match(ROW_RE);
      if (!m) return;
      const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim()); // a literal pipe in a cell is written \|
      out.push({ line: i + 1, id: m[1]!, cells });
    });
  return out;
}

/** Exports of policies.ts lacking a `@decision <ID>` JSDoc whose ID is a DECISIONS.md row. */
function policyViolations(): string[] {
  if (!existsSync(POLICIES)) return ['src/ca/policies.ts does not exist (created by A7)'];
  if (!existsSync(REGISTRY)) return ['DECISIONS.md does not exist (SEC-11-R1)'];
  const registered = new Set(registryRows().map((r) => r.id));
  const out: string[] = [];
  for (const { name, id } of policyExports()) {
    if (!id) out.push(`${name}: no @decision OQ-x JSDoc`);
    else if (!registered.has(id)) out.push(`${name}: ${id} not in DECISIONS.md`);
  }
  if (/export\s*\{/.test(stripComments(read(POLICIES)))) out.push('export { ... } lists are not allowed: tag each export');
  return out;
}

/** it.fails / test.fails calls in tests/ca without a tagged comment block directly above. */
function untaggedFails(): string[] {
  const out: string[] = [];
  for (const f of listFiles(join(ROOT, 'tests', 'ca'), /\.test\.ts$/)) {
    const orig = read(f).split('\n');
    const code = stripComments(read(f)).split('\n');
    code.forEach((line, i) => {
      if (!/\b(it|test)\.fails\s*\(/.test(line)) return;
      let j = i - 1;
      while (j >= 0 && orig[j]!.trim() === '') j -= 1;
      const block: string[] = [];
      while (j >= 0 && /^\s*(\/\/|\/\*|\*)/.test(orig[j]!)) block.unshift(orig[j--]!);
      if (!TAG.test(block.join('\n'))) out.push(`${rel(f)}:${i + 1}`);
    });
  }
  return out;
}

describe('F7 open decisions are registered', () => {
  // F7a -> A7 (policies.ts, one named constant per open decision); source changed to DECISIONS.md by SEC-11.
  it('F7a [A7, SEC-11]: every policies.ts export has @decision <ID>, and the ID is a row of DECISIONS.md', () => {
    expect(policyViolations()).toEqual([]);
  });

  it('F7b: DECISIONS.md exists; every it.fails in tests/ca has a preceding 012 D-n / OQ-x / known_divergence comment', () => {
    expect(existsSync(REGISTRY), 'COB-ts/DECISIONS.md (SEC-11-R1)').toBe(true);
    const calls = listFiles(join(ROOT, 'tests', 'ca'), /\.test\.ts$/).flatMap((f) =>
      stripComments(read(f)).split('\n').filter((l) => /\b(it|test)\.fails\s*\(/.test(l)),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(untaggedFails()).toEqual([]);
  });

  it('F7d [SEC-11]: DECISIONS.md lists exactly the policies.ts @decision IDs, each in one row', () => {
    expect(existsSync(REGISTRY), 'COB-ts/DECISIONS.md (SEC-11-R1)').toBe(true);
    const tagged = [...new Set(policyExports().flatMap((e) => (e.id ? [e.id] : [])))].sort();
    expect(tagged.length).toBeGreaterThan(0);
    const ids = registryRows().map((r) => r.id);
    const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    expect(dupes, 'IDs in more than one row').toEqual([]);
    expect([...new Set(ids)].sort()).toEqual(tagged);
  });

  it('F7e [SEC-11, Q-SEC11-1 (ii)]: every DECISIONS.md row is ID | one-line decision | status | business record (§n)', () => {
    expect(existsSync(REGISTRY), 'COB-ts/DECISIONS.md (SEC-11-R1)').toBe(true);
    const rows = registryRows();
    expect(rows.length).toBeGreaterThan(0);
    const bad = rows.flatMap((r) => {
      if (r.cells.length !== 4) return [`DECISIONS.md:${r.line} ${r.id}: ${r.cells.length} cells, want 4`];
      if (r.cells.some((c) => c === '')) return [`DECISIONS.md:${r.line} ${r.id}: empty cell`];
      if (!/§\s*\d/.test(r.cells[3]!)) return [`DECISIONS.md:${r.line} ${r.id}: business record cites no §section`];
      return [];
    });
    expect(bad).toEqual([]);
  });
});
