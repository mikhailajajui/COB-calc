/**
 * B35 static page (user decision DEC-B35-HINT, 2026-10-06): the sentence "It isn't calculated here." is deleted from the
 * Payment amount hint. The hint #paymentAmount-hint in ui/ca.html reads exactly "The scheduled payment." Nothing else
 * changes: the label, the input and its aria-describedby link stay as they are. QA red step, 2026-10-06.
 *
 *   T1 B35-INV-HINT     the hint span exists once and its text is exactly "The scheduled payment."
 *   T2 B35-INV-LINK     the Payment amount input still points at the hint (aria-describedby) and keeps its label.
 *   T3 B35-INV-GONE     the deleted sentence appears in none of the calculator files in ui/ (any apostrophe form).
 *
 * Expected strings are literals typed from the decision. Not time-zone sensitive (no test:tz entry). sr-dev must not edit
 * these assertions.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../architecture/support.js';

const WANT_HINT = 'The scheduled payment.';
const html = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');

const hintSpans = (s: string): RegExpMatchArray[] => [...s.matchAll(/<([a-z]+)\b[^>]*\bid="paymentAmount-hint"[^>]*>([\s\S]*?)<\/\1>/g)];

describe('B35 DEC-B35-HINT: Payment amount hint', () => {
  it('T1 B35-INV-HINT: #paymentAmount-hint occurs once and reads exactly "The scheduled payment."', () => {
    expect((html.match(/id="paymentAmount-hint"/g) ?? []).length).toBe(1);
    const m = hintSpans(html);
    expect(m.length).toBe(1);
    expect(m[0]![0]).toMatch(/^<span class="hint" id="paymentAmount-hint">/);
    expect(m[0]![2]).toBe(WANT_HINT);
  });

  it('T2 B35-INV-LINK: the input keeps aria-describedby="paymentAmount-hint" and the label is unchanged', () => {
    expect(html).toContain(
      '<input type="text" inputmode="decimal" autocomplete="off" data-money id="paymentAmount" value="465.46" aria-describedby="paymentAmount-hint" />',
    );
    expect(html).toContain('<label for="paymentAmount">Payment amount ($)</label>');
  });

  // Named calculator files only, not the folder: other pages under ui/ are generated from the documents, which may
  // quote the deleted sentence when they describe this change.
  it.each(['ca.html', 'ca.js', 'ca-view.js', 'ca-view.d.ts'])('T3 B35-INV-GONE: "It isn\'t calculated here." appears nowhere in ui/%s', (f) => {
    const gone = /isn(?:'|\u2019|&#39;|&rsquo;|&apos;)t\s+calculated\s+here/i;
    expect(readFileSync(`${ROOT}/ui/${f}`, 'utf8')).not.toMatch(gone);
  });
});
