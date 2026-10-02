/**
 * B30-INV-SAMECODE (QA red test, 2026-10-01): the output holds each module's source lines verbatim except the
 * import lines, the leading `export ` words, the `export { ... } from` lines, the sourcemap comment and the one
 * replaced engine-version statement. The expected lines are derived here by an independent line walk (not the
 * builder's parser). Also: dependency order, one wrapper per module, the generated destructures and return objects.
 */
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { COB, FIXED_DATE, buildReal, tmp, independentModuleOrder, inlineScripts, read } from './support/common.mjs';

const IDS = independentModuleOrder();

/** Line walk of one source: { kept: lines expected in the output, imports: [{names, spec}], exports: [names] }. */
function walkSource(id) {
  const lines = read(join(COB, id)).split('\n');
  const kept = [];
  const imports = [];
  const exportsOut = [];
  let skipFetch = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipFetch) { if (/^\s*\.catch\(\(\) => \{\}\);\s*$/.test(line)) skipFetch = false; continue; }
    if (id === 'ui/ca.js' && line.startsWith("fetch('/package.json')")) { skipFetch = true; continue; }
    if (/^\/\/# sourceMappingURL=/.test(line)) continue;
    if (/^import\s/.test(line) || /^export\s*\{/.test(line)) {
      let j = i; let stmt = line;
      while (!/\bfrom\s*'[^']+'\s*;/.test(lines[j])) { j++; stmt += '\n' + lines[j]; }
      const names = stmt.match(/\{([^}]*)\}/)[1].split(',').map((x) => x.trim().replace(/\s+as\s+/, ':')).filter(Boolean);
      const spec = stmt.match(/\bfrom\s*'([^']+)'/)[1];
      const target = spec.startsWith('/') ? spec.slice(1) : join(id.replace(/[^/]*$/, ''), spec);
      if (/^import/.test(line)) imports.push({ names, target });
      else exportsOut.push(...names);
      i = j;
      continue;
    }
    const m = line.match(/^export (function|const) ([A-Za-z_$][\w$]*)/);
    if (m) { exportsOut.push(m[2]); kept.push(line.replace(/^export /, '')); continue; }
    kept.push(line);
  }
  return { kept, imports, exports: exportsOut };
}

let html;
let lines;
beforeAll(() => {
  html = buildReal(FIXED_DATE).html;
  lines = (inlineScripts(html)[0]?.text ?? '').split('\n');
});

const openAt = (id) => lines.findIndex((l) => l.includes(`__cobModules["${id}"]`) && /=/.test(l) && !/\bconst\b/.test(l));
const GEN = /__cobModules|^\s*return\s*\{|^\s*\}\)\(\);?\s*$|^\s*$|^\s*const\s*\{|^\s*[\w$]+(?:\s*:[^,]+)?,?\s*$|^\s*\}\s*=\s*__cobModules|^\s*\};?\s*$/;

describe('B30-INV-SAMECODE: 12 modules, dependency order, verbatim bodies', () => {
  it('the independent walk finds exactly the 12 reachable modules (10 under dist/ca, ca-view.js, ca.js)', () => {
    expect(IDS.length).toBe(12);
    expect(IDS.filter((i) => i.startsWith('dist/ca/')).length).toBe(10);
    expect(IDS.slice(-1)).toEqual(['ui/ca.js']);
  });

  it('every module has exactly one registry wrapper, in the dependency order of the independent walk', () => {
    const at = IDS.map(openAt);
    expect(at.every((i) => i >= 0), `wrappers found at ${at}`).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const id of IDS) expect(lines.filter((l) => l.includes(`__cobModules["${id}"] =`) || l.includes(`__cobModules["${id}"]=`)).length, id).toBe(1);
  });

  it.each(IDS)('%s: source lines verbatim in order; every other line is generated wrapper text', (id) => {
    const start = openAt(id);
    expect(start, `no wrapper for ${id}`).toBeGreaterThanOrEqual(0);
    const next = IDS.map(openAt).filter((i) => i > start).sort((a, b) => a - b)[0] ?? lines.length;
    const region = lines.slice(start + 1, next);
    const { kept } = walkSource(id);
    let at = 0;
    const extras = [];
    for (const l of region) {
      if (at < kept.length && l === kept[at]) at++;
      else extras.push(l);
    }
    expect(at, `source line ${at + 1} (${JSON.stringify(kept[at])}) is missing or altered in the output`).toBe(kept.length);
    // R3-e: the one replaced statement (its exact text is sr-dev's; it must only set the baked engine text)
    const allowed = id === 'ui/ca.js' ? (l) => /printEngineEl|Engine 0\.1\.0/.test(l) : () => false;
    const foreign = extras.filter((l) => !GEN.test(l) && !allowed(l));
    expect(foreign, 'foreign lines in the wrapper').toEqual([]);
    if (id === 'ui/ca.js') expect(extras.filter((l) => allowed(l) && !GEN.test(l)).length).toBeLessThanOrEqual(3);
  });

  it.each(IDS)('%s: each import becomes a destructure of the right module; the return object lists exactly the exports', (id) => {
    const start = openAt(id);
    const next = IDS.map(openAt).filter((i) => i > start).sort((a, b) => a - b)[0] ?? lines.length;
    const text = lines.slice(start, next).join('\n');
    const { imports, exports: ex } = walkSource(id);
    const got = [...text.matchAll(/const\s*\{([^}]*)\}\s*=\s*__cobModules\["([^"]+)"\]/g)].map((m) => ({
      names: m[1].split(',').map((x) => x.trim().replace(/\s*:\s*/, ':')).filter(Boolean).sort(), target: m[2],
    }));
    for (const imp of imports) {
      const hit = got.find((g) => g.target === imp.target && JSON.stringify(g.names) === JSON.stringify([...imp.names].sort()));
      expect(hit, `import { ${imp.names} } from ${imp.target}`).toBeDefined();
    }
    if (ex.length) {
      const i = text.lastIndexOf('return');
      const body = text.slice(i).match(/return\s*\{([\s\S]*?)\}\s*;?/);
      expect(body, 'no return object').not.toBeNull();
      const keys = body[1].split(',').map((x) => x.trim().split(/\s*:/)[0]).filter(Boolean).sort();
      expect(keys).toEqual([...ex].sort());
    }
  });

  it('the replaced statement is gone and nothing replaces it with a network call; ca.js still sets printEngineEl', () => {
    const ca = lines.slice(openAt('ui/ca.js')).join('\n');
    expect(ca).toContain('printEngineEl');
    expect(ca).toMatch(/Engine 0\.1\.0/);
  });
});

describe('B30-INV-SAMECODE: the bundled script is valid and the bundled engine computes what dist/ computes', () => {
  it('the inline script parses as a module (no duplicate declarations from a re-export, no leftover syntax)', () => {
    const f = join(tmp(), 'inline.mjs');
    writeFileSync(f, inlineScripts(html)[0].text);
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('the registry, run without a DOM up to ui/ca.js, gives the same result as dist/ca/index.js for a mortgage with a financed and a cash fee', async () => {
    const text = lines.slice(0, openAt('ui/ca.js')).join('\n').replace(/^[\s\S]*?(?=(?:const|var|let)\s+__cobModules)/, '');
    const ctx = vm.createContext({});
    vm.runInContext(text + '\n;globalThis.__m = __cobModules;', ctx);
    const wire = JSON.stringify({
      flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', loanAmount: 227829.65,
      fees: { fees: [{ name: 'Financed fee', amount: 2000, financed: true, includedInCob: true }, { name: 'Cash fee', amount: 400, financed: false, includedInCob: true }] },
      contractRatePercent: 3.74, paymentAmount: 465.46, paymentFrequency: 'weekly',
      disbursalDate: { $d: '2026-03-17' }, firstPaymentDate: { $d: '2026-03-23' }, endDate: { $d: '2029-03-17' }, semiAnnualCompoundingDate: { $d: '2026-03-17' }, termYears: 3, termMonths: 0,
    });
    const revive = (D) => (k, v) => (v && typeof v === 'object' && '$d' in v ? new D(`${v.$d}T00:00:00Z`) : v);
    const bundled = vm.runInContext(`(() => { const rv = (${revive.toString()})(Date); return JSON.stringify(__m['dist/ca/index.js'].calculateCobCanada(JSON.parse(${JSON.stringify(wire)}, rv))); })()`, ctx);
    const real = await import(pathToFileURL(join(COB, 'dist/ca/index.js')).href);
    const expected = JSON.stringify(real.calculateCobCanada(JSON.parse(wire, revive(Date))));
    expect(bundled.length).toBeGreaterThan(1000);
    expect(bundled).toBe(expected);
  });
});
