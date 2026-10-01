// The removal interpreter (B29-X5). QA-owned test support; there is NO removal script in the product
// (user decision 2026-09-30): the tests perform the documented steps themselves, on a scratch copy.
//
// The single source of the mechanical steps is the fenced block tagged `removal-steps` in
// help/README.md. Two verbs only:
//   delete <path>                          remove a file or folder inside the copy
//   strip <file> <begin-marker> <end-marker>   remove the inclusive line range, exactly one range
// The interpreter FAILS CLOSED: any problem throws before anything is written (plan first, then apply).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

export const ALLOWED_DELETE = new Set(['ui/help.html', 'help']);
export const ALLOWED_STRIP_FILE = 'ui/ca.html';

/** The lines of the one fenced block whose info string is `removal-steps`. */
export function parseRemovalSteps(readme) {
  const re = /^```[ \t]*removal-steps[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
  const blocks = [...readme.matchAll(re)];
  if (blocks.length !== 1) throw new Error(`expected exactly one removal-steps block, found ${blocks.length}`);
  return blocks[0][1].split('\n').map((l) => l.trim()).filter(Boolean);
}

const MARK = /(\/\*.*?\*\/|<!--.*?-->)/;

export function parseStep(line) {
  const sp = line.indexOf(' ');
  const verb = sp < 0 ? line : line.slice(0, sp);
  const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
  if (verb === 'delete') {
    if (!rest || /\s/.test(rest)) throw new Error(`delete needs exactly one path: ${line}`);
    return { verb, path: rest };
  }
  if (verb === 'strip') {
    const m = /^(\S+)\s+(\/\*.*?\*\/|<!--.*?-->)\s+(\/\*.*?\*\/|<!--.*?-->)$/.exec(rest);
    if (!m) throw new Error(`strip needs <file> <begin> <end>: ${line}`);
    return { verb, file: m[1], begin: m[2], end: m[3] };
  }
  throw new Error(`unknown verb "${verb}": ${line}`);
}

function inside(root, rel) {
  if (isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`path outside the copy: ${rel}`);
  const full = resolve(root, normalize(rel));
  if (full !== resolve(root) && !full.startsWith(resolve(root) + sep)) throw new Error(`path outside the copy: ${rel}`);
  return full;
}

/** Allowlist check of a parsed step list (used by the tests and by runSteps). */
export function checkAllowlist(steps) {
  for (const s of steps) {
    if (s.verb === 'delete' && !ALLOWED_DELETE.has(s.path)) throw new Error(`delete path not in the allowlist: ${s.path}`);
    if (s.verb === 'strip' && s.file !== ALLOWED_STRIP_FILE) throw new Error(`strip file not in the allowlist: ${s.file}`);
  }
}

/** Plan and apply the steps inside `root`. Throws, writing nothing, on any problem. */
export function runSteps(root, lines) {
  const steps = lines.map(parseStep);
  checkAllowlist(steps);
  const plan = [];
  const staged = new Map(); // file -> text after earlier strips
  for (const s of steps) {
    if (s.verb === 'delete') {
      const full = inside(root, s.path);
      if (!existsSync(full)) throw new Error(`nothing to delete: ${s.path}`);
      plan.push({ kind: 'delete', full });
    } else {
      const full = inside(root, s.file);
      const text = staged.get(full) ?? readFileSync(full, 'utf8');
      const ls = text.split('\n');
      const b = ls.flatMap((l, i) => (l.includes(s.begin) ? [i] : []));
      const e = ls.flatMap((l, i) => (l.includes(s.end) ? [i] : []));
      if (b.length !== 1 || e.length !== 1) throw new Error(`${s.file}: expected exactly one ${s.begin} and one ${s.end}, found ${b.length} and ${e.length}`);
      if (b[0] > e[0]) throw new Error(`${s.file}: ${s.end} before ${s.begin}`);
      const next = [...ls.slice(0, b[0]), ...ls.slice(e[0] + 1)].join('\n');
      staged.set(full, next);
    }
  }
  for (const [full, text] of staged) writeFileSync(full, text);
  for (const p of plan) rmSync(p.full, { recursive: true, force: false });
  return steps;
}
