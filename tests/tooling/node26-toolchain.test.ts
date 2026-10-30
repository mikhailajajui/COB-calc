/**
 * SEC-NODE26 (user decision 2026-10-29: move COB-ts to Node 26 LTS; COB-architecture.md §5 "SEC-NODE26 brief",
 * revision 65, R-N26-1..R-N26-9, tests N26-INV-*; fitness check F23). QA red tests, 2026-10-29. The developer must
 * not edit this file.
 *
 * F23: the toolchain versions agree and the suite runs on the tested Node.
 * - N26-INV-FLOOR        engines.node is a full `>=X.Y.Z` floor and equals `>=26.13.0` (R-N26-1).
 * - N26-INV-TYPES-MAJOR  @types/node is `~X.Y.Z` with X = the floor's major; the locked version has the range's
 *                        major and minor and a patch >= the range's (R-N26-5; replaces A18-R1's minor rule).
 * - N26-INV-NVMRC        .nvmrc is exactly `<floor>\n` (R-N26-3).
 * - N26-INV-NPMRC        .npmrc is exactly `engine-strict=true\n` (R-N26-2).
 * - N26-INV-ALLOWSCRIPTS allowScripts deep-equals { fsevents: false } and is the last key of package.json (R-N26-4).
 * - N26-INV-RUNTIME      process.versions.node >= the floor, compared numerically part by part. The suite therefore
 *                        fails on purpose on a Node older than 26.13.0 (mutation M1).
 * - N26-INV-README       (QA addition for R-N26-9 coverage; wording is sr-dev's) README.md names 26.13.0, .nvmrc,
 *                        engine-strict and the fsevents allowScripts entry.
 * Each invariant has a pure helper with the brief's vectors, plus the live check against ROOT.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../architecture/support.js';

type Triple = [number, number, number];
const FLOOR = '>=26.13.0';

function parseFloor(s: unknown): Triple | null {
  const m = typeof s === 'string' ? /^>=(\d+)\.(\d+)\.(\d+)$/.exec(s) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function parseVersion(s: string): Triple | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when version `v` (X.Y.Z) is >= `floor` (X.Y.Z), comparing the three parts as numbers. */
function atLeast(v: string, floor: string): boolean {
  const a = parseVersion(v);
  const b = parseVersion(floor);
  if (!a || !b) throw new Error(`not X.Y.Z: ${v} / ${floor}`);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
}

function floorProblems(engineNode: unknown): string[] {
  if (parseFloor(engineNode) === null) return [`engines.node ${JSON.stringify(engineNode)} is not a full >=X.Y.Z floor`];
  if (engineNode !== FLOOR) return [`engines.node is ${String(engineNode)}, expected ${FLOOR}`];
  return [];
}

function typesProblems(range: unknown, floor: unknown, locked: unknown): string[] {
  const out: string[] = [];
  const m = typeof range === 'string' ? /^~(\d+)\.(\d+)\.(\d+)$/.exec(range) : null;
  const f = parseFloor(floor);
  if (!m) return [`@types/node range ${JSON.stringify(range)} is not ~X.Y.Z`];
  if (!f) return [`floor ${JSON.stringify(floor)} is not >=X.Y.Z`];
  const r: Triple = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (r[0] !== f[0]) out.push(`@types/node major ${r[0]} differs from the engines floor major ${f[0]}`);
  const l = typeof locked === 'string' ? parseVersion(locked) : null;
  if (!l) out.push(`locked @types/node ${JSON.stringify(locked)} is not X.Y.Z`);
  else if (l[0] !== r[0] || l[1] !== r[1] || l[2] < r[2]) out.push(`locked @types/node ${String(locked)} does not satisfy ${String(range)}`);
  return out;
}

function nvmrcProblems(text: string | null, floor: string): string[] {
  if (text === null) return ['.nvmrc does not exist'];
  const want = `${floor.replace(/^>=/, '')}\n`;
  return text === want ? [] : [`.nvmrc is ${JSON.stringify(text)}, expected ${JSON.stringify(want)}`];
}

function npmrcProblems(text: string | null): string[] {
  if (text === null) return ['.npmrc does not exist'];
  return text === 'engine-strict=true\n' ? [] : [`.npmrc is ${JSON.stringify(text)}, expected "engine-strict=true\\n"`];
}

function allowScriptsProblems(pkg: Record<string, unknown>): string[] {
  const out: string[] = [];
  const a = pkg.allowScripts;
  if (JSON.stringify(a) !== JSON.stringify({ fsevents: false })) out.push(`allowScripts is ${JSON.stringify(a)}, expected {"fsevents":false}`);
  const keys = Object.keys(pkg);
  if (keys[keys.length - 1] !== 'allowScripts') out.push(`the last key of package.json is ${keys[keys.length - 1]}, expected allowScripts`);
  return out;
}

const readOrNull = (rel: string) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown> & {
  engines?: { node?: string };
  devDependencies?: Record<string, string>;
};
const LOCK = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string; devDependencies?: Record<string, string>; engines?: unknown }>;
};

describe('SEC-NODE26 N26-INV-FLOOR (R-N26-1)', () => {
  it.each([
    ['>=26.13.0', true],
    ['>=26', false],
    ['>=22', false],
    ['>=26.12.1', false],
    ['^26.13.0', false],
    ['>=26.13.0 <27', false],
  ])('vector %s -> ok %s', (v, ok) => {
    expect(floorProblems(v).length === 0).toBe(ok);
  });

  it('live: package.json engines.node is >=26.13.0', () => {
    expect(floorProblems(PKG.engines?.node)).toEqual([]);
  });
});

describe('SEC-NODE26 N26-INV-TYPES-MAJOR (R-N26-5)', () => {
  it.each([
    ['~26.6.6', '>=26.13.0', '26.6.6', true],
    ['~26.6.6', '>=26.13.0', '26.6.9', true],
    ['~22.12.0', '>=26.13.0', '22.12.0', false],
    ['^26.6.6', '>=26.13.0', '26.6.6', false],
    ['26.6.6', '>=26.13.0', '26.6.6', false],
    ['~26.6.6', '>=26.13.0', '26.7.0', false],
    ['~26.6.6', '>=26.13.0', '26.6.5', false],
  ])('vector (%s, %s, %s) -> ok %s', (range, floor, locked, ok) => {
    expect(typesProblems(range, floor, locked).length === 0).toBe(ok);
  });

  it('live: devDependencies @types/node is ~26.6.6, its major equals the floor major, and the lockfile resolves it', () => {
    const range = PKG.devDependencies?.['@types/node'];
    expect(range).toBe('~26.6.6');
    expect(typesProblems(range, PKG.engines?.node, LOCK.packages['node_modules/@types/node']?.version)).toEqual([]);
    expect(LOCK.packages['']!.devDependencies?.['@types/node']).toBe(range);
  });
});

describe('SEC-NODE26 N26-INV-NVMRC (R-N26-3)', () => {
  it.each([
    ['26.13.0\n', true],
    ['26.12.1\n', false],
    ['v26.13.0\n', false],
    ['26.13.0', false],
    ['26.13.0\r\n', false],
  ])('vector %j -> ok %s', (text, ok) => {
    expect(nvmrcProblems(text, FLOOR).length === 0).toBe(ok);
  });

  it('live: .nvmrc is exactly the engines floor plus LF', () => {
    expect(nvmrcProblems(readOrNull('.nvmrc'), String(PKG.engines?.node))).toEqual([]);
    expect(nvmrcProblems(readOrNull('.nvmrc'), FLOOR)).toEqual([]);
  });
});

describe('SEC-NODE26 N26-INV-NPMRC (R-N26-2)', () => {
  it.each([
    ['engine-strict=true\n', true],
    ['engine-strict=true', false],
    ['engine-strict=false\n', false],
    ['engine-strict=true\nfund=false\n', false],
  ])('vector %j -> ok %s', (text, ok) => {
    expect(npmrcProblems(text).length === 0).toBe(ok);
  });

  it('live: .npmrc is exactly engine-strict=true and LF', () => {
    expect(npmrcProblems(readOrNull('.npmrc'))).toEqual([]);
  });
});

describe('SEC-NODE26 N26-INV-ALLOWSCRIPTS (R-N26-4)', () => {
  it.each([
    [{ name: 'x', allowScripts: { fsevents: false } }, true],
    [{ allowScripts: { fsevents: false }, name: 'x' }, false],
    [{ name: 'x', allowScripts: { fsevents: true } }, false],
    [{ name: 'x', allowScripts: { fsevents: false, esbuild: true } }, false],
    [{ name: 'x' }, false],
  ])('vector %j -> ok %s', (pkg, ok) => {
    expect(allowScriptsProblems(pkg).length === 0).toBe(ok);
  });

  it('live: allowScripts is { fsevents: false }, the last key, in npm\'s 2-space layout', () => {
    expect(allowScriptsProblems(PKG)).toEqual([]);
    const text = readFileSync(join(ROOT, 'package.json'), 'utf8');
    expect(text.endsWith('  },\n  "allowScripts": {\n    "fsevents": false\n  }\n}\n')).toBe(true);
  });
});

describe('SEC-NODE26 N26-INV-RUNTIME (F23)', () => {
  it.each([
    ['26.13.0', '26.13.0', true],
    ['26.12.1', '26.13.0', false],
    ['22.23.4', '26.13.0', false],
    ['27.0.0', '26.13.0', true],
    ['26.13.10', '26.13.9', true],
    ['26.14.0', '26.13.9', true],
    ['9.0.0', '10.0.0', false],
  ])('atLeast(%s, %s) is %s', (v, floor, want) => {
    expect(atLeast(v, floor)).toBe(want);
  });

  it('live: the running Node is at least the engines floor (fails on purpose on Node < 26.13.0)', () => {
    const floor = parseFloor(PKG.engines?.node);
    // Before the task lands the floor is still >=22 (not a full triple); check against the brief's floor too.
    expect(atLeast(process.versions.node, '26.13.0'), `running Node ${process.versions.node}`).toBe(true);
    if (floor) expect(atLeast(process.versions.node, floor.join('.'))).toBe(true);
  });
});

describe('SEC-NODE26 N26-INV-README (R-N26-9, QA addition)', () => {
  it('README.md states the Node requirement, .nvmrc, engine-strict and the fsevents allowScripts entry', () => {
    const r = readFileSync(join(ROOT, 'README.md'), 'utf8');
    expect(r).toContain('26.13.0');
    expect(r).toContain('.nvmrc');
    expect(r).toContain('engine-strict');
    expect(r).toContain('allowScripts');
    expect(r).toContain('fsevents');
  });
});
