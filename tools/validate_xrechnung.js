// Validates XRechnung CII files the same way the KoSIT validator scenario for XRechnung 3.0 (CII) does:
//   1. XML Schema  (UN/CEFACT CII D16B, via xmllint)
//   2. EN 16931 CII schematron (compiled XSLT, run with SaxonJS / xslt3)
//   3. XRechnung 3.0 CII schematron (compiled XSLT, run with SaxonJS / xslt3)
// It needs: xmllint, node/npx, and the KoSIT "validator-configuration-xrechnung" release unpacked in tools/.cache/kosit
// (tools/validate-xrechnung.sh downloads it). This is a re-implementation of the validator's pipeline,
// not the official KoSIT validator jar.
//
//   node tools/validate_xrechnung.js [files...]     (default: test-out/xrechnung/*.xml)
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CFG = process.env.KOSIT_CONFIG || path.join(ROOT, 'tools', '.cache', 'kosit');
const XSD = path.join(CFG, 'resources/cii/16b/xsd/CrossIndustryInvoice_100pD16B.xsd');
const SCH = [
  ['EN16931', path.join(CFG, 'resources/cii/16b/xsl/EN16931-CII-validation.xsl')],
  ['XRechnung', path.join(CFG, 'resources/xrechnung/3.0.2/xsl/XRechnung-CII-validation.xsl')],
];
// severity overrides from the KoSIT scenario (scenarios.xml)
const CUSTOM = { 'BR-CL-23': 'warning', 'BR-CL-21': 'warning', 'CII-SR-452': 'error', 'CII-SR-453': 'error', 'CII-SR-454': 'error',
  'CII-SR-465': 'error', 'CII-SR-466': 'error', 'CII-SR-475': 'information', 'CII-SR-476': 'information' };
const XSLT3 = process.env.XSLT3 || 'xslt3';

for (const f of [XSD, ...SCH.map(s => s[1])]) if (!fs.existsSync(f)) { console.error('Missing ' + f + ' – run tools/validate-xrechnung.sh first.'); process.exit(2); }

const dir = path.join(ROOT, 'test-out', 'xrechnung');
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).filter(f => f.endsWith('.xml')).map(f => path.join(dir, f));
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'xr-'));

// compile the stylesheets once to SEF (SaxonJS needs that), cached next to the config
for (const [name, xsl] of SCH) {
  const sef = xsl.replace(/\.xsl$/, '.sef.json');
  if (!fs.existsSync(sef)) execFileSync(XSLT3, [`-xsl:${xsl}`, `-export:${sef}`, '-nogo'], { stdio: 'inherit' });
}

let failed = 0;
for (const file of files) {
  const errors = [], warnings = [];
  const xsd = spawnSync('xmllint', ['--noout', '--schema', XSD, file], { encoding: 'utf8' });
  if (xsd.status !== 0) errors.push('[XSD] ' + xsd.stderr.trim().split('\n').filter(l => !/validates$/.test(l)).join('\n        '));
  for (const [name, xsl] of SCH) {
    const out = path.join(tmp, name + '.svrl');
    const run = spawnSync(XSLT3, [`-xsl:${xsl.replace(/\.xsl$/, '.sef.json')}`, `-s:${file}`, `-o:${out}`], { encoding: 'utf8' });
    if (run.status !== 0) { errors.push(`[${name}] could not process: ${(run.stderr || '').trim().split('\n')[0]}`); continue; }
    const svrl = fs.readFileSync(out, 'utf8');
    const re = /<svrl:(failed-assert|successful-report)\b([^>]*)>([\s\S]*?)<\/svrl:\1>/g;
    let m;
    while ((m = re.exec(svrl))) {
      const attr = k => (m[2].match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1] || '';
      const id = attr('id');
      const flag = CUSTOM[id] || attr('flag') || 'error';
      const text = (m[3].match(/<svrl:text>([\s\S]*?)<\/svrl:text>/) || [])[1] || '';
      const line = `[${name}] ${id} (${flag}) ${text.replace(/\s+/g, ' ').trim()}`;
      (flag === 'warning' || flag === 'information' ? warnings : errors).push(line);
    }
  }
  const ok = !errors.length;
  if (!ok) failed++;
  console.log(`${ok ? 'VALID  ' : 'INVALID'} ${path.basename(file)}${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''})` : ''}`);
  for (const e of errors) console.log('   ✗ ' + e);
  for (const w of warnings) console.log('   ! ' + w);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${files.length - failed}/${files.length} valid`);
process.exitCode = failed ? 1 : 0;
