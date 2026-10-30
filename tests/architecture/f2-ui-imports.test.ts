/**
 * F2 (COB-architecture.md §6): the UI imports only the CA public barrel or its own modules.
 * For ui/ca*.js, every import specifier is '/dist/ca/index.js' or './ca-*.js'.
 * No known debt: ui/ca.js:1 moved from '/dist/index.js' to '/dist/ca/index.js' in A3
 * (2026-09-27).
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, fmt, importsOf, listFiles } from './support.js';

const files = listFiles(join(ROOT, 'ui'), /^ca.*\.js$/);
const allowed = (spec: string) => spec === '/dist/ca/index.js' || /^\.\/ca-[\w-]+\.js$/.test(spec);
const bad = files.flatMap(importsOf).filter((e) => !allowed(e.spec));

describe('F2 UI imports only the CA barrel or ./ca-*.js', () => {
  it('F2: ui/ca.js exists and imports the CA barrel', () => {
    expect(files.map((f) => f.split('/').pop())).toContain('ca.js');
    expect(files.flatMap(importsOf).map((e) => e.spec)).toContain('/dist/ca/index.js');
  });

  // F2 [A3] (CA public barrel), done 2026-09-27.
  it('F2 [A3]: ui/ca*.js import only /dist/ca/index.js or ./ca-*.js', () => {
    expect(fmt(bad)).toEqual([]);
  });
});
