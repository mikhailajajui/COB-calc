// The default renderer (B29-R8a): Chrome through the globally installed Playwright runs Mermaid and returns, per
// block, the SVG and a normalised model of the diagram. This is the only module that names the browser tooling.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function loadBrowserTool() {
  let root;
  try {
    root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  } catch (e) {
    throw new Error(`cannot find the global npm folder (${e.message.split('\n')[0]})`);
  }
  try {
    return createRequire(join(root, '@playwright', 'mcp') + '/')('playwright-core');
  } catch {
    throw new Error(`the global package @playwright/mcp (with playwright-core) is not installed under ${root}; Mermaid needs Chrome through it`);
  }
}

/** Runs inside the page: one entry per source, { svg, model } or { error }. */
async function inPage({ sources, font }) {
  /* global mermaid */
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: { fontFamily: font },
    flowchart: { htmlLabels: true },
  });
  const out = [];
  for (const item of sources) {
    try {
      const parsed = await mermaid.mermaidAPI.getDiagramFromText(item.source);
      const db = parsed.db;
      let model;
      if (String(parsed.type).startsWith('flowchart')) {
        model = {
          type: 'flowchart',
          nodes: [...db.getVertices().values()].map((v) => ({ id: v.id, text: v.text ?? '', classes: [...(v.classes ?? [])] })),
          edges: db.getEdges().map((e) => ({ start: e.start, end: e.end, stroke: e.stroke ?? 'normal', text: e.text ?? '' })),
        };
      } else if (String(parsed.type).startsWith('sequence')) {
        model = {
          type: 'sequence',
          actors: [...db.getActors().keys()].map((name) => ({ name })),
          messages: db.getMessages().filter((m) => m.from && m.to && typeof m.message === 'string').map((m) => ({ from: m.from, to: m.to, message: m.message })),
        };
      } else {
        model = { type: String(parsed.type) };
      }
      const { svg } = await mermaid.render(`mm-${item.key}-${item.k}`, item.source);
      out.push({ svg, model });
    } catch (e) {
      out.push({ error: String((e && e.message) || e) });
    }
  }
  return out;
}

/** sources: [{ key, k, line, source }] -> [{ svg, model }] in the same order. */
export async function renderDiagrams(sources) {
  const { chromium } = loadBrowserTool();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    throw new Error(`Chrome could not be started (${e.message.split('\n')[0]})`);
  }
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: readFileSync(join(HELP_DIR, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'), 'utf8') });
    const results = await page.evaluate(inPage, { sources, font: FONT });
    return results.map((r, i) => {
      if (r.error) {
        const s = sources[i];
        throw new Error(`mermaid ${s.key} block ${s.k} (line ${s.line}): ${r.error}`);
      }
      return r;
    });
  } finally {
    await browser.close();
  }
}
