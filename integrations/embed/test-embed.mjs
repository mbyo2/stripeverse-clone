/**
 * Tests for the universal pay-button embed, run in Node with a
 * minimal DOM stub implementing exactly the surface the script uses.
 *
 * Run: node integrations/embed/test-embed.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('./bmaglass-pay-button.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

function makeDom(placeholders) {
  const created = [];
  const warnings = [];
  const errors = [];
  const document = {
    readyState: 'complete',
    querySelectorAll: (sel) => (sel === '.bmaglass-pay-button' ? placeholders : []),
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(), style: {}, attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
      };
      created.push(el);
      return el;
    },
    addEventListener: () => {},
  };
  for (const ph of placeholders) {
    ph.parentNode = {
      children: [],
      replaceChild(newEl, oldEl) { this.replaced = { newEl, oldEl }; },
    };
  }
  const window = { console: { warn: (...a) => warnings.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')) } };
  return { document, window, created, warnings, errors };
}

function run(placeholders) {
  const dom = makeDom(placeholders);
  const ctx = vm.createContext({ document: dom.document, window: dom.window, console: dom.window.console });
  vm.runInContext(src, ctx);
  return dom;
}

// 1. Valid full URL renders a button.
let ph = { dataset: { link: 'https://bmaglasspay.online/pay/12db7755bf28243f' } };
let dom = run([ph]);
check('valid link renders one anchor', dom.created.length === 1 && dom.created[0].tagName === 'A');
check('anchor href is the payment link', dom.created[0].href === 'https://bmaglasspay.online/pay/12db7755bf28243f');
check('default label', dom.created[0].textContent === 'Pay with BMaGlass Pay');
check('placeholder replaced', !!ph.parentNode.replaced);

// 2. data-code + label + target.
ph = { dataset: { code: 'ABC123', label: 'Pay K250', target: '_blank' } };
dom = run([ph]);
check('code builds URL', dom.created[0].href === 'https://bmaglasspay.online/pay/ABC123');
check('custom label', dom.created[0].textContent === 'Pay K250');
check('target _blank + noopener', dom.created[0].target === '_blank' && dom.created[0].rel === 'noopener');

// 3. An API key in the config is REFUSED (never rendered).
ph = { dataset: { link: 'bmp_live_supersecret' } };
dom = run([ph]);
check('API key config refused', dom.created.length === 0);
check('refusal is explained in console', dom.errors.some((e) => e.includes('must never be embedded')));

// 4. Foreign/phishing URL is refused.
ph = { dataset: { link: 'https://evil.example/pay/ABC123' } };
dom = run([ph]);
check('foreign host refused', dom.created.length === 0 && dom.warnings.length === 1);

// 5. Non-HTTPS BMaGlass URL refused.
ph = { dataset: { link: 'http://bmaglasspay.online/pay/ABC123' } };
dom = run([ph]);
check('http (not https) refused', dom.created.length === 0);

console.log(failures === 0 ? '\nALL EMBED TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
