// Builds XRechnung (CII) files for the reference cases with the fictional demo data.
//   node tools/xrechnung_test.js            -> test-out/xrechnung/*.xml
//   tools/validate-xrechnung.sh             -> validates them (XSD + EN 16931 + XRechnung schematron)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'test-out', 'xrechnung');
fs.mkdirSync(OUT, { recursive: true });
const ctx = { Intl, console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['i18n', 'rules', 'render', 'xrechnung', 'demo']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', f + '.js'), 'utf8'), ctx);
const { Rules, XRechnung, DEMO } = ctx;

const P = id => DEMO.parties.find(p => p.id === 'demo-' + id);
const base = { status: 'issued', date: '2026-10-14', dueDays: 14, serviceMode: 'same', currency: 'EUR', supply: 'services', lang: 'de', lines: [] };

const cases = {
  'domestic-19-7': { ...base, senderId: 'muster', recipientId: 'beispiel', docType: 'invoice', number: 'RE-2026-001', clientRef: 'PO-4711', serviceMode: 'month', month: '2026-09',
    lines: [{ desc: 'Web design', details: 'Landing page', qty: 12.5, unit: 'h', price: 85, vat: 19 },
            { desc: 'Hosting & maintenance', qty: 1, unit: 'month', price: 49, vat: 19, disc: 10 },
            { desc: 'Fachbuch', qty: 2, unit: 'pc', price: 39.9, vat: 7 }] },
  'domestic-with-zero-rated': { ...base, senderId: 'muster', recipientId: 'beispiel', docType: 'invoice', number: 'RE-2026-007', serviceMode: 'date', serviceDate: '2026-10-01',
    lines: [{ desc: 'Consulting', qty: 3, unit: 'h', price: 120, vat: 19 }, { desc: 'Solar module (0 % § 12 Abs. 3 UStG)', qty: 4, unit: 'pc', price: 180.5, vat: 0 }] },
  'small-business-19': { ...base, senderId: 'jane', recipientId: 'beispiel', docType: 'invoice', number: 'JD-2026-01', serviceMode: 'period', periodFrom: '2026-09-01', periodTo: '2026-09-30',
    lines: [{ desc: 'Logo design', qty: 1, unit: 'flat', price: 900, vat: 0 }] },
  'eu-reverse-charge': { ...base, senderId: 'muster', recipientId: 'esempio', docType: 'invoice', lang: 'de-en', number: 'RE-2026-002',
    lines: [{ desc: 'Consulting', qty: 8, unit: 'h', price: 120, vat: 0 }] },
  'eu-goods': { ...base, senderId: 'muster', recipientId: 'esempio', docType: 'invoice', supply: 'goods', lang: 'en', number: 'RE-2026-003', serviceMode: 'date', serviceDate: '2026-10-10',
    lines: [{ desc: 'Server hardware', qty: 2, unit: 'pc', price: 1450, vat: 0 }] },
  'export-services': { ...base, senderId: 'muster', recipientId: 'example', docType: 'invoice', lang: 'en', number: 'RE-2026-004',
    lines: [{ desc: 'Consulting', qty: 10, unit: 'h', price: 120, vat: 0 }] },
  'export-goods': { ...base, senderId: 'muster', recipientId: 'example', docType: 'invoice', supply: 'goods', lang: 'en', number: 'RE-2026-005',
    lines: [{ desc: 'Printed brochures', qty: 500, unit: 'pc', price: 1.2, vat: 0 }] },
  'credit-note': { ...base, senderId: 'muster', recipientId: 'beispiel', docType: 'credit_note', number: 'RK-2026-001', refNumber: 'RE-2026-001', refDate: '2026-10-14', dueDays: 0,
    lines: [{ desc: 'Web design', details: 'Credit for 2.5 h', qty: 2.5, unit: 'h', price: 85, vat: 19 }] },
  'public-sector-leitweg': { ...base, senderId: 'muster', recipientId: 'stadt', docType: 'invoice', number: 'RE-2026-006', dueDays: 30,
    lines: [{ desc: 'Website relaunch', qty: 1, unit: 'flat', price: 4800, vat: 19 }] },
  'self-billing': { ...base, senderId: 'jane', recipientId: 'beispiel', docType: 'self_billing', number: 'GS-2026-001', serviceMode: 'month', month: '2026-09',
    lines: [{ desc: 'Illustrations', qty: 6, unit: 'pc', price: 150, vat: 0 }] },
};

let bad = 0;
for (const [name, inv] of Object.entries(cases)) {
  const s = P(inv.senderId), r = P(inv.recipientId);
  inv.treatment = Rules.recommendTreatment(s, r, inv.supply);
  const issues = XRechnung.check(inv, s, r).filter(c => c.level === 'error');
  if (issues.length) { bad++; console.log(`!! ${name}: ${issues.map(i => i.msg).join(' | ')}`); continue; }
  fs.writeFileSync(path.join(OUT, name + '.xml'), XRechnung.build(inv, s, r));
  console.log(`ok ${name} (${inv.treatment} -> ${XRechnung.category(inv.treatment, inv.lines[0].vat).code})`);
}
process.exitCode = bad ? 1 : 0;
