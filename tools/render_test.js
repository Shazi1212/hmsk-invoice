// Renders sample invoices (fictional demo data) to standalone HTML + PDF via headless Chrome (if installed).
//   node tools/render_test.js  -> test-out/*.pdf, and prints the compliance check for each
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test-out');
fs.mkdirSync(OUT, { recursive: true });
const ctx = { Intl, console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['i18n', 'rules', 'render', 'demo']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', f + '.js'), 'utf8'), ctx);
const { Render, Rules } = ctx;

const { DEMO } = ctx;
const P = id => DEMO.parties.find(p => p.id === 'demo-' + id);
const base = { status: 'issued', date: '2026-10-14', dueDays: 14, serviceMode: 'same', currency: 'EUR', supply: 'services', showLogo: true, lines: [] };

// fictional reference cases (see public/demo.js)
const cases = {
  'de-company-domestic': { ...base, senderId: 'muster', recipientId: 'beispiel', docType: 'invoice', lang: 'de', number: 'RE-2026-001', serviceMode: 'month', month: '2026-09', clientRef: 'PO-4711',
    lines: [{ desc: 'Webdesign', details: 'Landingpage', qty: 12.5, unit: 'h', price: 85, vat: 19 }, { desc: 'Hosting & Wartung', qty: 1, unit: 'month', price: 49, vat: 19, disc: 10 }] },
  'de-company-to-it': { ...base, senderId: 'muster', recipientId: 'esempio', docType: 'invoice', lang: 'de-en', number: 'RE-2026-002',
    lines: [{ desc: 'Consulting', details: 'Monthly retainer', qty: 1, unit: 'month', price: 499, vat: 0 }] },
  'freelancer-small-business': { ...base, senderId: 'jane', recipientId: 'beispiel', docType: 'invoice', lang: 'de', number: 'JD-2026-01', serviceMode: 'period', periodFrom: '2026-09-01', periodTo: '2026-09-30',
    lines: [{ desc: 'Logo-Design', qty: 1, unit: 'flat', price: 900, vat: 0 }] },
  'export-services-us': { ...base, senderId: 'muster', recipientId: 'example', docType: 'invoice', lang: 'en', number: 'RE-2026-003',
    lines: [{ desc: 'Consulting', qty: 10, unit: 'h', price: 120, vat: 0 }] },
  'self-billing': { ...base, senderId: 'jane', recipientId: 'beispiel', docType: 'self_billing', lang: 'de', number: 'GS-2026-001', serviceMode: 'period', periodFrom: '2026-09-01', periodTo: '2026-09-30',
    lines: [{ desc: 'Illustrationen', details: 'Projekt Beispiel', qty: 6, unit: 'pc', price: 150, vat: 0 }] },
};

const css = fs.readFileSync(path.join(ROOT, 'public/app.css'), 'utf8');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
for (const [name, inv] of Object.entries(cases)) {
  const s = P(inv.senderId), r = P(inv.recipientId);
  inv.treatment = Rules.recommendTreatment(s, r, inv.supply);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css} body{background:#fff}</style></head><body><div id="app"><main id="view-editor" class="view editor"><section class="preview-wrap"><div class="preview-scroll"><div id="sheetScale"><div class="sheet">${Render.render(inv, s, r)}</div></div></div></section></main></div></body></html>`;
  const file = path.join(OUT, name + '.html');
  fs.writeFileSync(file, html);
  const checks = Rules.checkInvoice({ ...inv, total: Render.compute(inv).total }, s, r);
  console.log(`\n== ${name}: ${inv.treatment}`);
  checks.forEach(c => console.log(`  [${c.level}] ${c.msg}`));
  if (fs.existsSync(chrome)) {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=4000', `--print-to-pdf=${path.join(OUT, name + '.pdf')}`, 'file://' + file], { stdio: 'ignore' });
  }
}
