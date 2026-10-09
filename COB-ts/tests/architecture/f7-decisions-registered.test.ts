/**
 * F7 (COB-architecture.md §6): open decisions are registered.
 *  (a) Every export of src/ca/policies.ts has a JSDoc tag `@decision OQ-x`, and that ID
 *      appears in COB-user-stories.md (one folder above COB-ts).
 *  (b) Every `it.fails` / `test.fails` in tests/ca has a preceding comment matching
 *      /(012 D-\d+|OQ-[A-Z]+|known_divergence)/. "Preceding comment" = the contiguous block of
 *      comment lines directly above the call (blank lines skipped). Calls inside comments
 *      don't count.
 *
 * (a) is a plain `it` since A7 (2026-09-28) created policies.ts; the check requires the file to exist.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, SRC_CA, listFiles, read, rel, stripComments } from './support.js';

const POLICIES = join(SRC_CA, 'policies.ts');
const USER_STORIES = join(ROOT, '..', 'COB-user-stories.md');
const TAG = /(012 D-\d+|OQ-[A-Z]+|known_divergence)/;

/** Exports of policies.ts lacking a `@decision OQ-x` JSDoc whose ID is in the user stories. */
function policyViolations(): string[] {
  if (!existsSync(POLICIES)) return ['src/ca/policies.ts does not exist (created by A7)'];
  const stories = read(USER_STORIES);
  const src = read(POLICIES);
  const out: string[] = [];
  const re = /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?export\s+(?:declare\s+)?(?:const|let|var|function|type|interface|enum|class)\s+(\w+)/g;
  for (const m of src.matchAll(re)) {
    // B37: widened again to DEC-... IDs (DEC-B37-LEAP-N is the decision ID of LEAP_AWARE_PAYMENTS_PER_YEAR).
    const id = m[1]?.match(/@decision\s+((?:OQ|Q)-[A-Z]+|DEC-[A-Z0-9]+(?:-[A-Z0-9]+)*)\b/)?.[1]; // B24: widened from OQ- (Q-SACD is the decision ID of SEMI_ANNUAL_DATE_REQUIRED)
    if (!id) out.push(`${m[2]}: no @decision OQ-x JSDoc`);
    else if (!new RegExp(`\\b${id}\\b`).test(stories)) out.push(`${m[2]}: ${id} not in COB-user-stories.md`);
  }
  if (/export\s*\{/.test(stripComments(src))) out.push('export { ... } lists are not allowed: tag each export');
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
  // F7a -> A7 (policies.ts, one named constant per open decision).
  it('F7a [A7]: every policies.ts export has @decision OQ-x, and the ID is in COB-user-stories.md', () => {
    expect(policyViolations()).toEqual([]);
  });

  it('F7b: every it.fails in tests/ca has a preceding 012 D-n / OQ-x / known_divergence comment', () => {
    expect(existsSync(USER_STORIES)).toBe(true);
    const calls = listFiles(join(ROOT, 'tests', 'ca'), /\.test\.ts$/).flatMap((f) =>
      stripComments(read(f)).split('\n').filter((l) => /\b(it|test)\.fails\s*\(/.test(l)),
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(untaggedFails()).toEqual([]);
  });
});
