// Bundles the ES modules reachable from one entry file into registry wrappers, one function per module, in
// dependency order. Accepts only the import/export forms the sources use today and fails loudly on any other.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export class BuildError extends Error {}

const fail = (id, line, message) => {
  throw new BuildError(line ? `${id}:${line}: ${message}` : `${id}: ${message}`);
};

const IDENT = '[A-Za-z_$][\\w$]*';
const NAME = new RegExp(`^(${IDENT})(?:\\s+as\\s+(${IDENT}))?$`);
const STATEMENT = /^(import|export)\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;\s*$/;
const FROM_END = /\bfrom\s*'[^']*'\s*;/;
const EXPORT_DECL = new RegExp(`^export (?:function|const) (${IDENT})`);
const SOURCEMAP = '/' + '/# sourceMappingURL=';
const ANCHOR = ['fe', "tch('/package.json')"].join('');
const ANCHOR_END = /\.catch\(\(\) => \{\}\);/;

function replaceVersionLookup(id, text, version) {
  const count = text.split(ANCHOR).length - 1;
  if (count !== 1) fail(id, 0, `the engine-version lookup must occur exactly once (found ${count})`);
  const start = text.indexOf(ANCHOR);
  const tail = text.slice(start).match(ANCHOR_END);
  if (!tail) fail(id, 0, 'the engine-version lookup has no closing catch statement');
  const end = start + tail.index + tail[0].length;
  return `${text.slice(0, start)}printEngineEl.textContent = ${JSON.stringify(` · Engine ${version}`)};${text.slice(end)}`;
}

export function bundle(root, entry, { version }) {
  const realRoot = realpathSync(root);
  const wrappers = new Map();
  const exportsOf = new Map();
  const order = [];

  const resolveSpec = (fromId, line, spec) => {
    let rel;
    if (spec.startsWith('/')) rel = relative(root, resolve(root, '.' + spec));
    else if (spec.startsWith('./') || spec.startsWith('../')) rel = relative(root, resolve(root, dirname(fromId), spec));
    else return fail(fromId, line, `unsupported specifier '${spec}' (only ./, ../ and / paths)`);
    const id = rel.split(sep).join('/');
    if (!(id.startsWith('ui/') || id.startsWith('dist/'))) fail(fromId, line, `specifier '${spec}' resolves outside ui/ and dist/`);
    const abs = join(root, id);
    if (!existsSync(abs)) fail(fromId, line, `specifier '${spec}': file ${id} does not exist`);
    const real = realpathSync(abs);
    if (!(real.startsWith(join(realRoot, 'ui') + sep) || real.startsWith(join(realRoot, 'dist') + sep))) {
      fail(fromId, line, `specifier '${spec}' resolves outside ui/ and dist/ (symbolic link)`);
    }
    return id;
  };

  const load = (id, stack) => {
    if (wrappers.has(id)) return;
    if (stack.includes(id)) fail(id, 0, `dependency cycle: ${[...stack.slice(stack.indexOf(id)), id].join(' -> ')}`);
    stack.push(id);
    let text = readFileSync(join(root, id), 'utf8').replace(/\r\n/g, '\n');
    if (id === entry) text = replaceVersionLookup(id, text, version);
    if (/<\/script/i.test(text)) fail(id, 0, 'contains a closing script tag, which cannot be inlined');
    if (text.includes('<!--')) fail(id, 0, 'contains an HTML comment opener, which cannot be inlined');
    const lines = text.split('\n');
    const body = [];
    const returns = [];
    const own = new Set();
    let reCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const at = i + 1;
      if (line.startsWith(SOURCEMAP)) continue;
      const decl = line.match(EXPORT_DECL);
      if (decl) {
        body.push(line.replace(/^export /, ''));
        returns.push(decl[1]);
        own.add(decl[1]);
        continue;
      }
      if (!/^(?:import|export)\b/.test(line)) {
        body.push(line);
        continue;
      }
      if (!/^(?:import|export)\s*\{/.test(line)) fail(id, at, `unsupported module syntax: ${line.trim()}`);
      let j = i;
      while (!FROM_END.test(lines[j])) {
        j++;
        if (j >= lines.length) fail(id, at, 'unterminated import/export statement');
      }
      const m = lines.slice(i, j + 1).join('\n').match(STATEMENT);
      if (!m) fail(id, at, `unsupported module syntax: ${line.trim()}`);
      const [, kind, list, spec] = m;
      const names = list.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
        const n = x.match(NAME);
        if (!n) fail(id, at, `unsupported name '${x}'`);
        if (kind === 'export' && n[2]) fail(id, at, `export alias '${x}' is not supported`);
        return { orig: n[1], local: n[2] ?? n[1] };
      });
      const dep = resolveSpec(id, at, spec);
      load(dep, stack);
      for (const n of names) {
        if (!exportsOf.get(dep).includes(n.orig)) fail(id, at, `${dep} does not export '${n.orig}'`);
      }
      if (kind.startsWith('i')) {
        const list2 = names.map((n) => (n.orig === n.local ? n.orig : `${n.orig}: ${n.local}`)).join(', ');
        body.push(`const { ${list2} } = __cobModules[${JSON.stringify(dep)}];`);
      } else {
        const tmp = `__re${reCount++}`;
        body.push(`const ${tmp} = __cobModules[${JSON.stringify(dep)}];`);
        for (const n of names) returns.push(`${n.local}: ${tmp}.${n.orig}`);
        for (const n of names) own.add(n.local);
      }
      i = j;
    }
    wrappers.set(id, `__cobModules[${JSON.stringify(id)}] = (() => {\n${body.join('\n')}\nreturn { ${returns.join(', ')} };\n})();`);
    exportsOf.set(id, [...own]);
    order.push(id);
    stack.pop();
  };

  load(entry, []);
  return { order, script: `\nconst __cobModules = {};\n${order.map((id) => wrappers.get(id)).join('\n')}\n` };
}
