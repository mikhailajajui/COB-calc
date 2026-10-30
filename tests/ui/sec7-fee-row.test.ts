/**
 * SEC-7 (checklist §4a; security review 2026-10-28 finding #6; COB-architecture.md §5 security table row SEC-7, which
 * leaves the test design to QA). QA red tests, 2026-10-29. The developer must not edit this file.
 *
 * `addFeeRow` in ui/ca.js writes `values.name` (and `formatAmount(String(values.amount))`, which returns a malformed
 * amount as typed) into `tr.innerHTML` unescaped. Not reachable today (B23-T7a pins the only call as `addFeeRow()`),
 * but it is XSS as soon as fees are prefilled.
 *
 * The project has no DOM (no jsdom, and none may be added). So these tests run the real addFeeRow source, cut out of
 * ca.js, against a minimal fake DOM defined below: elements with attributes, children, the reflected properties the
 * row uses, a `value`/`checked` live state, and an innerHTML setter that tokenises HTML the way a browser does for
 * this subset (quoted and unquoted attributes, void elements, entity decoding, first duplicate attribute wins).
 * Any unsupported property assignment throws (elements are non-extensible, code runs in strict mode), so a
 * fix that uses DOM API this fake does not model fails loudly instead of passing silently.
 *
 * Contract (minimal scope, no SEC-7 brief in §5):
 *  S7-1  Effective row for the only real caller, `addFeeRow()`, is exactly as today, with Financed on and off:
 *        the same elements, attributes, initial values, aria-labels, listeners, data-id sequence and placement.
 *  S7-2  Any fee name and amount reach the inputs as data: the name input's value is the name exactly, the amount
 *        input's value is `formatAmount(String(amount))` exactly, and no extra element or attribute appears.
 *        Hostile cases: attribute break-out, entities, quotes, `<`, `&`, NBSP.
 *  S7-3  Static: no template-literal interpolation inside addFeeRow mentions `values.name` or `values.amount`
 *        (unless it is a call to the escaping `html(` helper of ui/ca-view.js).
 *  S7-4  Structural pin: ca.js outside addFeeRow is unchanged (tests/ca/support/caJsFeeRow.ts, sha256 ff8d8ef5…);
 *        ui/ca-view.js and ui/ca-view.d.ts stay pinned by S6-R2.5.
 *
 * Fix routes: the expected one is to keep the template without the two value interpolations and assign
 * `nameEl.value` / `amountEl.value` after querySelector (QA checked it on a scratch copy: all green). Building the
 * inputs with createElement also passes, but A10-P2 (A10-R5, tests/ca/a10-ca-view.test.ts) forbids
 * `createElement('td')` / `el('td')` in ca.js. `html(h(...))` needs `h`, which ca.js does not import, and S7-4 forbids
 * changing anything outside addFeeRow, the import line included. Only the names ca.js imports from ca-view.js are in
 * scope here, as in the browser. ca-view.js and its .d.ts stay pinned by S6-R2.5.
 * "Rendered markup identical" is read as the effective row (attributes other than value/checked, plus the live
 * value/checked state): the value attribute (defaultValue) is not compared, because ca.js never reads it or resets
 * the form, and the `.value` route necessarily drops it.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as view from '../../ui/ca-view.js';
import { addFeeRowSource, neutraliseCaJs, NEUTRALISED_CA_JS_SHA, readCaJs } from '../ca/support/caJsFeeRow.js';

// --------------------------------------------------------------------------------------------------------------------
// Minimal fake DOM
// --------------------------------------------------------------------------------------------------------------------

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'track']);
const REFLECT: Record<string, string> = {
  type: 'type', placeholder: 'placeholder', inputMode: 'inputmode', autocomplete: 'autocomplete', className: 'class',
  id: 'id', title: 'title', ariaLabel: 'aria-label', name: 'name',
};
const kebab = (k: string): string => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (k: string): string => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

class FakeText {
  parent: FakeEl | null = null;
  constructor(public text: string) {
    Object.preventExtensions(this);
  }
}

type Listener = [string, (...a: unknown[]) => unknown];

class FakeEl {
  readonly tag: string;
  readonly attrs = new Map<string, string>();
  children: (FakeEl | FakeText)[] = [];
  parent: FakeEl | null = null;
  readonly listeners: Listener[] = [];
  removed = false;
  liveValue: string | undefined = undefined;
  liveChecked: boolean | undefined = undefined;
  readonly dataset: Record<string, string>;

  constructor(tag: string) {
    this.tag = tag.toLowerCase();
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_t, k) => (typeof k === 'string' ? this.attrs.get(`data-${kebab(k)}`) : undefined),
      set: (_t, k, v) => {
        this.attrs.set(`data-${kebab(String(k))}`, String(v));
        return true;
      },
      has: (_t, k) => typeof k === 'string' && this.attrs.has(`data-${kebab(k)}`),
      deleteProperty: (_t, k) => this.attrs.delete(`data-${kebab(String(k))}`),
      ownKeys: () => [...this.attrs.keys()].filter((a) => a.startsWith('data-')).map((a) => camel(a.slice(5))),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
    Object.preventExtensions(this);
  }

  get tagName(): string {
    return this.tag.toUpperCase();
  }
  get value(): string {
    return this.liveValue ?? this.attrs.get('value') ?? '';
  }
  set value(v: string) {
    this.liveValue = String(v);
  }
  get checked(): boolean {
    return this.liveChecked ?? this.attrs.has('checked');
  }
  set checked(v: boolean) {
    this.liveChecked = Boolean(v);
  }
  get defaultValue(): string {
    return this.attrs.get('value') ?? '';
  }
  set defaultValue(v: string) {
    this.attrs.set('value', String(v));
  }
  get defaultChecked(): boolean {
    return this.attrs.has('checked');
  }
  set defaultChecked(v: boolean) {
    if (v) this.attrs.set('checked', '');
    else this.attrs.delete('checked');
  }

  setAttribute(n: string, v: unknown): void {
    this.attrs.set(n.toLowerCase(), String(v));
  }
  getAttribute(n: string): string | null {
    return this.attrs.get(n.toLowerCase()) ?? null;
  }
  hasAttribute(n: string): boolean {
    return this.attrs.has(n.toLowerCase());
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n.toLowerCase());
  }
  toggleAttribute(n: string, force?: boolean): boolean {
    const on = force ?? !this.attrs.has(n.toLowerCase());
    if (on) this.attrs.set(n.toLowerCase(), '');
    else this.attrs.delete(n.toLowerCase());
    return on;
  }

  private adopt(c: FakeEl | FakeText | string): FakeEl | FakeText {
    const node = typeof c === 'string' ? new FakeText(c) : c;
    if (node.parent) node.parent.children = node.parent.children.filter((x) => x !== node);
    node.parent = this;
    return node;
  }
  appendChild<T extends FakeEl | FakeText>(c: T): T {
    this.children.push(this.adopt(c));
    return c;
  }
  append(...cs: (FakeEl | FakeText | string)[]): void {
    for (const c of cs) this.children.push(this.adopt(c));
  }
  replaceChildren(...cs: (FakeEl | FakeText | string)[]): void {
    this.children = [];
    this.append(...cs);
  }
  remove(): void {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
    this.parent = null;
  }
  addEventListener(type: string, fn: (...a: unknown[]) => unknown): void {
    this.listeners.push([type, fn]);
  }

  get textContent(): string {
    return this.children.map((c) => (c instanceof FakeText ? c.text : c.textContent)).join('');
  }
  set textContent(t: string) {
    this.children = [];
    if (t !== '') this.append(String(t));
  }
  set innerHTML(s: string) {
    this.children = [];
    parseInto(this, String(s));
  }
  get innerHTML(): string {
    throw new Error('fake DOM: innerHTML getter not modelled');
  }

  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel: string): FakeEl[] {
    const m = /^([a-z]*)\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel.trim());
    if (!m) throw new Error(`fake DOM: selector not modelled: ${sel}`);
    const [, tag, attr, val] = m;
    const out: FakeEl[] = [];
    const walk = (el: FakeEl): void => {
      for (const c of el.children) {
        if (!(c instanceof FakeEl)) continue;
        if ((!tag || c.tag === tag) && c.attrs.has(attr!) && (val === undefined || c.attrs.get(attr!) === val)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}
for (const [prop, attr] of Object.entries(REFLECT)) {
  Object.defineProperty(FakeEl.prototype, prop, {
    get(this: FakeEl) {
      return this.attrs.get(attr) ?? '';
    },
    set(this: FakeEl, v: unknown) {
      this.attrs.set(attr, String(v));
    },
  });
}

/** Browser-like tokeniser for the subset a fee row can contain. */
function parseInto(root: FakeEl, s: string): void {
  let cur = root;
  let i = 0;
  let text = '';
  const flush = (): void => {
    if (text) cur.appendChild(new FakeText(decode(text)));
    text = '';
  };
  while (i < s.length) {
    if (s[i] === '<' && s[i + 1] === '/' && /[a-z]/i.test(s[i + 2] ?? '')) {
      flush();
      const end = s.indexOf('>', i);
      const name = s.slice(i + 2, end < 0 ? s.length : end).trim().toLowerCase();
      i = end < 0 ? s.length : end + 1;
      if (VOID.has(name)) continue;
      for (let n: FakeEl | null = cur; n && n !== root; n = n.parent) {
        if (n.tag === name) {
          cur = n.parent ?? root;
          break;
        }
      }
      continue;
    }
    if (s[i] === '<' && /[a-z]/i.test(s[i + 1] ?? '')) {
      flush();
      i += 1;
      let name = '';
      while (i < s.length && !/[\s/>]/.test(s[i]!)) name += s[i++];
      const el = new FakeEl(name);
      for (;;) {
        while (i < s.length && /[\s/]/.test(s[i]!)) i += 1;
        if (i >= s.length || s[i] === '>') {
          i += 1;
          break;
        }
        let an = '';
        while (i < s.length && !/[\s/>=]/.test(s[i]!)) an += s[i++];
        while (i < s.length && /\s/.test(s[i]!)) i += 1;
        let av = '';
        if (s[i] === '=') {
          i += 1;
          while (i < s.length && /\s/.test(s[i]!)) i += 1;
          const q = s[i];
          if (q === '"' || q === "'") {
            const end = s.indexOf(q, i + 1);
            av = s.slice(i + 1, end < 0 ? s.length : end);
            i = end < 0 ? s.length : end + 1;
          } else {
            while (i < s.length && !/[\s>]/.test(s[i]!)) av += s[i++];
          }
        }
        const key = an.toLowerCase();
        if (key && !el.attrs.has(key)) el.attrs.set(key, decode(av));
      }
      cur.appendChild(el);
      if (!VOID.has(el.tag)) cur = el;
      continue;
    }
    text += s[i++];
  }
  flush();
}

// --------------------------------------------------------------------------------------------------------------------
// Running the real addFeeRow
// --------------------------------------------------------------------------------------------------------------------

type FeeValues = { name?: unknown; amount?: unknown; financed?: unknown };
type Harness = { add: (v?: FeeValues) => void; body: FakeEl; recomputes: () => number };

function harness(financedOption: boolean): Harness {
  const body = new FakeEl('tbody');
  let recomputes = 0;
  const document = {
    createElement: (t: string) => new FakeEl(t),
    createTextNode: (t: string) => new FakeText(String(t)),
  };
  const ctx = { switches: { ...view.UI_SWITCHES, financedOption } };
  // Only the names ca.js really imports from ./ca-view.js are in scope (a name used but not imported would be a
  // ReferenceError in the browser, which the parse check in ui-scripts-parse cannot see).
  const imported = caViewImports();
  const viewExports = Object.entries(view).filter(([k]) => imported.includes(k));
  const params = ['document', 'feesBodyEl', 'recompute', 'viewCtx', ...viewExports.map(([k]) => k)];
  const factory = new Function(...params, `'use strict';\nlet feeRowId = 0;\n${addFeeRowSource()}\nreturn addFeeRow;`) as (
    ...a: unknown[]
  ) => (v?: FeeValues) => void;
  const add = factory(document, body, () => (recomputes += 1), () => ctx, ...viewExports.map(([, v]) => v));
  return { add, body, recomputes: () => recomputes };
}

/** The names in ca.js's named import of the view module (no aliases are used there). */
function caViewImports(): string[] {
  const m = /import\s*\{([^}]*)\}\s*from\s*'\.\/ca-view\.js'/.exec(readCaJs());
  if (!m) throw new Error('ui/ca.js: no named import of the view module');
  return m[1]!.split(',').map((x) => x.trim()).filter(Boolean);
}

type ViewNode = { tag: string; attrs: [string, string][]; value?: string; checked?: boolean; children: (ViewNode | string)[] };

/** The effective element tree: attributes other than value/checked (sorted), live value/checked, non-blank text. */
function effective(el: FakeEl): ViewNode {
  const node: ViewNode = {
    tag: el.tag,
    attrs: [...el.attrs.entries()].filter(([k]) => k !== 'value' && k !== 'checked').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    children: el.children.flatMap((c): (ViewNode | string)[] => (c instanceof FakeText ? (c.text.trim() === '' ? [] : [c.text]) : [effective(c)])),
  };
  if (el.tag === 'input') {
    if (el.attrs.get('type') === 'checkbox') node.checked = el.checked;
    else node.value = el.value;
  }
  return node;
}

function allElements(el: FakeEl): FakeEl[] {
  return [el, ...el.children.flatMap((c) => (c instanceof FakeEl ? allElements(c) : []))];
}

/** Today's row, by hand from ui/ca.js addFeeRow before SEC-7, for a fee name `name` and a formatted amount. */
function expectedRow(id: number, financedOption: boolean, nameValue: string, amountValue: string, checked: boolean): ViewNode {
  const label = nameValue || 'Fee';
  const td = (child: ViewNode): ViewNode => ({ tag: 'td', attrs: [], children: [child] });
  return {
    tag: 'tr',
    attrs: [['data-id', String(id)]],
    children: [
      td({ tag: 'input', attrs: [['aria-label', 'Fee name'], ['data-field', 'name'], ['placeholder', 'Fee name'], ['type', 'text']], value: nameValue, children: [] }),
      td({
        tag: 'input',
        attrs: [['aria-label', `Amount: ${label}`], ['autocomplete', 'off'], ['data-field', 'amount'], ['data-money', ''], ['inputmode', 'decimal'], ['type', 'text']],
        value: amountValue,
        children: [],
      }),
      ...(financedOption
        ? [td({ tag: 'input', attrs: [['aria-label', `Financed: ${label}`], ['data-field', 'financed'], ['type', 'checkbox']], checked, children: [] })]
        : []),
      td({ tag: 'button', attrs: [['aria-label', `Remove fee: ${label}`], ['class', 'remove-fee'], ['data-remove', ''], ['type', 'button']], children: ['Remove'] }),
    ],
  };
}

const ON_OFF = [true, false] as const;

// --------------------------------------------------------------------------------------------------------------------

describe('SEC-7 fake DOM self-check (the harness models a browser for this subset)', () => {
  it('parses quoted/unquoted attributes, void elements, entities, first duplicate wins, and breaks out of an unescaped value like a browser', () => {
    const el = new FakeEl('tr');
    el.innerHTML = '<td><input type="text" value="a &amp; b &quot;q&quot; &lt;x&gt;" value="dup" /></td><td><input value=""><img src=x onerror=alert(1)>" /></td>';
    const [first, second] = el.querySelectorAll('[value]');
    expect(first!.value).toBe('a & b "q" <x>');
    expect(second!.value).toBe('');
    const img = allElements(el).find((e) => e.tag === 'img');
    expect(img?.attrs.get('onerror')).toBe('alert(1)');
  });

  it('rejects unmodelled property assignment', () => {
    const el = new FakeEl('input');
    expect(() => {
      'use strict';
      (el as unknown as Record<string, unknown>).notAProperty = 1;
    }).toThrow(TypeError);
  });

  it('only the ca-view names ca.js imports are in scope (formatAmount and html are; h is not imported today)', () => {
    const names = caViewImports();
    expect(names).toContain('formatAmount');
    expect(names).toContain('html');
    expect(names).not.toContain('h');
    for (const n of names) expect(Object.keys(view), n).toContain(n);
  });

  it('runs the real addFeeRow source cut from ui/ca.js', () => {
    expect(addFeeRowSource()).toMatch(/^function addFeeRow\(/);
    const h = harness(false);
    h.add();
    expect(h.body.children).toHaveLength(1);
  });
});

describe.each(ON_OFF)('SEC-7 S7-1: addFeeRow() (the only real call) gives today\'s row, financedOption=%s', (financedOption) => {
  it('first and second rows: same elements, attributes, initial values and labels as before SEC-7', () => {
    const h = harness(financedOption);
    h.add();
    h.add({});
    const rows = h.body.children.filter((c): c is FakeEl => c instanceof FakeEl);
    expect(rows.map(effective)).toEqual([expectedRow(0, financedOption, '', '0.00', false), expectedRow(1, financedOption, '', '0.00', false)]);
  });

  it('listeners: name input relabels on input; Remove removes the row and recomputes once; no recompute on add', () => {
    const h = harness(financedOption);
    h.add();
    const tr = h.body.children[0] as FakeEl;
    expect(h.recomputes()).toBe(0);
    const name = tr.querySelector('[data-field="name"]')!;
    const input = name.listeners.filter(([t]) => t === 'input');
    expect(input).toHaveLength(1);
    name.value = 'Legal';
    input[0]![1]({ target: name });
    expect(tr.querySelector('[data-field="amount"]')!.getAttribute('aria-label')).toBe('Amount: Legal');
    expect(tr.querySelector('[data-remove]')!.getAttribute('aria-label')).toBe('Remove fee: Legal');
    if (financedOption) expect(tr.querySelector('[data-field="financed"]')!.getAttribute('aria-label')).toBe('Financed: Legal');
    const click = tr.querySelector('[data-remove]')!.listeners.filter(([t]) => t === 'click');
    expect(click).toHaveLength(1);
    click[0]![1]({ target: tr.querySelector('[data-remove]') });
    expect(tr.removed).toBe(true);
    expect(h.body.children).toHaveLength(0);
    expect(h.recomputes()).toBe(1);
  });
});

const HOSTILE_NAMES = [
  'Appraisal',
  'Legal & admin',
  '"><img src=x onerror=alert(1)>',
  'x" autofocus onfocus="alert(1)',
  "x' onmouseover='alert(1)",
  '<script>alert(1)</script>',
  '&amp;',
  '&lt;b&gt;',
  'a < b > c',
  "O'Brien \"Q\"",
  'two words',
  '  padded  ',
  '</td><td>',
];

describe.each(ON_OFF)('SEC-7 S7-2: a fee name reaches the input as data, financedOption=%s', (financedOption) => {
  it.each(HOSTILE_NAMES)('name %j', (name) => {
    const h = harness(financedOption);
    h.add({ name });
    const tr = h.body.children[0] as FakeEl;
    expect(h.body.children).toHaveLength(1);
    expect(effective(tr)).toEqual(expectedRow(0, financedOption, name, '0.00', false));
    for (const el of allElements(tr)) {
      expect(['tr', 'td', 'input', 'button'], `element <${el.tag}>`).toContain(el.tag);
      for (const a of el.attrs.keys()) expect(a, `attribute ${a} on <${el.tag}>`).not.toMatch(/^on|^autofocus$|^src$/);
    }
  });
});

const AMOUNTS: [unknown, string][] = [
  [1234.5, '1,234.50'],
  ['227829.65', '227,829.65'],
  ['"><img src=x onerror=alert(1)>', view.formatAmount('"><img src=x onerror=alert(1)>')],
  ['1&lt;2', view.formatAmount('1&lt;2')],
  ['', view.formatAmount('')],
];

describe.each(ON_OFF)('SEC-7 S7-2: a fee amount reaches the input as formatAmount(String(amount)), financedOption=%s', (financedOption) => {
  it('oracle sanity: malformed amounts come back as typed (that is why the amount needs the same treatment)', () => {
    expect(view.formatAmount('"><img src=x onerror=alert(1)>')).toBe('"><img src=x onerror=alert(1)>');
  });

  it.each(AMOUNTS)('amount %j -> %j', (amount, shown) => {
    const h = harness(financedOption);
    h.add({ name: 'Fee A', amount, financed: true });
    const tr = h.body.children[0] as FakeEl;
    expect(effective(tr)).toEqual(expectedRow(0, financedOption, 'Fee A', shown, true));
    expect(allElements(tr).map((e) => e.tag).filter((t) => !['tr', 'td', 'input', 'button'].includes(t))).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------------------------------------

/** Every `${…}` expression in `src` (balanced braces). */
function interpolations(src: string): string[] {
  const out: string[] = [];
  for (let i = src.indexOf('${'); i >= 0; i = src.indexOf('${', i + 2)) {
    let depth = 0;
    let j = i + 1;
    for (; j < src.length; j += 1) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}' && --depth === 0) break;
    }
    out.push(src.slice(i + 2, j).trim());
  }
  return out;
}

describe('SEC-7 S7-3: static, no fee value is interpolated into a template inside addFeeRow', () => {
  it('no ${…} in addFeeRow mentions values.name or values.amount unless it is an html( call', () => {
    const bad = interpolations(addFeeRowSource()).filter((e) => /\bvalues\s*\.\s*(name|amount)\b|\bvalues\s*\[/.test(e) && !/^html\(/.test(e));
    expect(bad).toEqual([]);
  });

  it('the interpolation scanner finds today\'s offenders when run on the pre-SEC-7 text (scanner self-check)', () => {
    const pre = '`<input value="${values.name ?? \'\'}" /><input value="${formatAmount(String(values.amount ?? 0))}" />${on ? `<x ${values.financed ? \'checked\' : \'\'}>` : \'\'}`';
    expect(interpolations(pre).filter((e) => /\bvalues\s*\.\s*(name|amount)\b/.test(e))).toEqual([
      "values.name ?? ''",
      'formatAmount(String(values.amount ?? 0))',
    ]);
  });
});

describe('SEC-7 S7-4: structural pin, ui/ca.js outside addFeeRow is unchanged', () => {
  it('ca.js with addFeeRow neutralised and the SEC-5 fetch put back has sha256 ff8d8ef5…', () => {
    expect(createHash('sha256').update(neutraliseCaJs()).digest('hex')).toBe(NEUTRALISED_CA_JS_SHA);
  });

  it('exactly one addFeeRow declaration, and the module-level `let feeRowId = 0;` right before it', () => {
    const src = readCaJs();
    expect(src.split('function addFeeRow(').length - 1).toBe(1);
    expect(src).toMatch(/let feeRowId = 0;\n\nfunction addFeeRow\(/);
  });
});
