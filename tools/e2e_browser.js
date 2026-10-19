// End-to-end test of the browser mode in headless Chrome (no extra npm packages; uses the
// Chrome DevTools Protocol over Node's built-in WebSocket, Node >= 22).
//   node tools/e2e_browser.js http://127.0.0.1:8000/ [--screenshot shot.png] [--pdf out.pdf] [--xml out.xml]
// Flow: fresh profile -> demo data -> pick client -> add catalogue item -> issue -> PDF (print) ->
// XRechnung XML -> credit note -> backup export -> "Created with" footer line opt-out (when config enables it). Fails (exit 1) when a step does not work.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const url = process.argv[2];
if (!url) { console.error('usage: node tools/e2e_browser.js URL [--screenshot f.png] [--pdf f.pdf] [--xml f.xml]'); process.exit(2); }
const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-e2e-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--lang=en-US', 'about:blank'], { stdio: 'ignore' });
  let ws, id = 0;
  const pending = new Map();
  const requests = [];
  const errors = [];
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async expr => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const ok = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ✓ ' + msg); };
  try {
    let targets;
    for (let t = 0; t < 50; t++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(200); } }
    const page = targets.find(t => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
      if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' ' + (m.params.entry.url || ''));
    });
    await send('Network.enable');
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await sleep(1500);

    console.log('E2E ' + url);
    const boot = await evaluate(`return { app: !document.querySelector('#app').hidden, note: document.querySelector('#localNote').hidden ? '' : document.querySelector('#localNoteText').textContent, parties: document.querySelectorAll('#f-sender option').length - 1, strip: [...document.querySelectorAll('#siteStrip a')].map(a => a.getAttribute('href')) }`);
    ok(boot.app, 'app starts without login (browser mode)');
    ok(/localStorage/.test(boot.note), 'privacy note visible: ' + boot.note);
    ok(boot.parties >= 1, `demo data loaded (${boot.parties} parties)`);
    console.log('    strip links: ' + (boot.strip.join(', ') || '(none)'));

    // capture downloads, auto-confirm dialogs, count print calls
    await evaluate(`window.__dl = []; const o = URL.createObjectURL; URL.createObjectURL = b => { b.text().then(t => window.__dl.push(t)); return o(b); };
      HTMLAnchorElement.prototype.click = function () { window.__dl.push('NAME:' + this.download); };
      window.confirm = () => true; window.__printed = 0; window.print = () => { window.__printed++; };`);
    await evaluate(`const set = (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
      set('#f-sender', 'demo-muster'); await new Promise(r => setTimeout(r, 150));
      set('#f-recipient', 'demo-beispiel'); await new Promise(r => setTimeout(r, 150));
      set('#f-catalogue', 'demo-item-web'); await new Promise(r => setTimeout(r, 150));
      const q = document.querySelector('#lines [data-k=qty]'); q.value = '12.5'; q.dispatchEvent(new Event('input', { bubbles: true }));
      set('#f-catalogue', 'demo-item-hosting'); await new Promise(r => setTimeout(r, 300));`);
    const draft = await evaluate(`return { lines: document.querySelectorAll('#lines .line').length, sheet: document.querySelector('#sheet').innerText.includes('Beispiel AG'), xr: document.querySelector('#checks').innerText }`);
    ok(draft.lines === 2 && draft.sheet, 'draft with 2 lines rendered in the A4 preview');
    ok(/XRechnung\)\s*ready/i.test(draft.xr), 'XRechnung readiness shown as ready');
    const mwOn = await evaluate(`return !!(window.INVOICE_CONFIG.madeWith && window.INVOICE_CONFIG.madeWith.enabled)`);
    const mwLine = () => evaluate(`const a = document.querySelector('#sheet .iv-made a'); return a ? { text: a.textContent, href: a.getAttribute('href') } : null`);
    const mw = await mwLine();
    ok(mwOn ? !!mw && /^https?:\/\//.test(mw.href) : !mw, mwOn ? `footer line shown: "${mw?.text}" -> ${mw?.href}` : 'no footer line (madeWith off in config)');
    if (arg('--screenshot')) {
      await evaluate(`window.scrollTo(0, 0); document.querySelector('.preview-scroll').scrollTop = 0;`);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1400, height: 900, scale: 1 } });
      fs.writeFileSync(arg('--screenshot'), Buffer.from(shot.data, 'base64'));
      console.log('    screenshot -> ' + arg('--screenshot'));
    }

    await evaluate(`document.querySelector('#issueInv').click(); await new Promise(r => setTimeout(r, 400));`);
    const issued = await evaluate(`const d = JSON.parse(localStorage.getItem('invoice-db')); return d.invoices.map(i => i.number + ':' + i.status)`);
    ok(issued.length === 1 && /:issued$/.test(issued[0]), 'issued and stored in localStorage: ' + issued[0]);

    await evaluate(`document.querySelector('#printInv').click(); await new Promise(r => setTimeout(r, 300));`);
    ok(await evaluate(`return window.__printed`) === 1, 'PDF / Print opens the print dialog');
    const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
    const pdfBuf = Buffer.from(pdf.data, 'base64');
    const pages = (pdfBuf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    ok(pdfBuf.length > 10000 && pages === 1, `print layout gives a one-page A4 PDF (${Math.round(pdfBuf.length / 1024)} KB, ${pages} page)`);
    if (arg('--pdf')) fs.writeFileSync(arg('--pdf'), pdfBuf);

    await evaluate(`window.__dl = []; document.querySelector('#xmlInv').click(); await new Promise(r => setTimeout(r, 400));`);
    const dl = await evaluate(`return window.__dl`);
    const xml = dl.find(t => t.startsWith('<?xml')) || '';
    ok(dl.some(t => /^NAME:.*_xrechnung\.xml$/.test(t)) && xml.includes('urn:xeinkauf.de:kosit:xrechnung_3.0'), `XRechnung XML downloaded (${xml.length} bytes)`);
    const total = await evaluate(`const d = JSON.parse(localStorage.getItem('invoice-db')); return Render.compute(d.invoices[0]).total.toFixed(2)`);
    ok(xml.includes(`<ram:GrandTotalAmount>${total}</ram:GrandTotalAmount>`), `XML grand total matches the invoice (${total} EUR)`);
    ok(!/HMSK Invoice|hmsk\.life/.test(xml), 'footer line is not in the XRechnung XML');
    if (arg('--xml')) fs.writeFileSync(arg('--xml'), xml);

    await evaluate(`document.querySelector('#tabs [data-view=history]').click(); await new Promise(r => setTimeout(r, 200));
      document.querySelector('#histTable [data-h=cn]').click(); await new Promise(r => setTimeout(r, 300));
      window.__dl = []; document.querySelector('#xmlInv').click(); await new Promise(r => setTimeout(r, 500));`);
    const cn = (await evaluate(`return window.__dl`)).find(t => t.startsWith('<?xml')) || '';
    ok(/<ram:TypeCode>381<\/ram:TypeCode>/.test(cn), 'credit note issued and exported as type 381');

    await evaluate(`window.__dl = []; document.querySelector('#tabs [data-view=settings]').click(); document.querySelector('#exportJson').click(); await new Promise(r => setTimeout(r, 300));`);
    const backup = (await evaluate(`return window.__dl`)).find(t => t.startsWith('{')) || '{}';
    ok(JSON.parse(backup).invoices?.length === 2, 'backup JSON contains both documents');

    if (mwOn) {
      await evaluate(`document.querySelector('#tabs [data-view=settings]').click();
        const c = document.querySelector('#view-settings .mw-toggle'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 600)); document.querySelector('#tabs [data-view=editor]').click(); await new Promise(r => setTimeout(r, 300));`);
      ok(!(await mwLine()), 'unticking "Show Created with HMSK Invoice" removes the line');
      await send('Page.reload'); await sleep(1500);
      await evaluate(`const set = (s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
        set('#f-sender', 'demo-muster'); set('#f-recipient', 'demo-beispiel'); await new Promise(r => setTimeout(r, 300));`);
      const after = await evaluate(`return { saved: JSON.parse(localStorage.getItem('invoice-db')).settings.showMadeWith, box: document.querySelector('#view-settings .mw-toggle').checked, sheet: !!document.querySelector('#sheet .iv'), line: !!document.querySelector('#sheet .iv-made') }`);
      ok(after.saved === false && !after.box && after.sheet && !after.line, 'opt-out is saved and survives a reload');
      await evaluate(`const c = document.querySelector('#view-settings .mw-toggle'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 300));`);
      ok(!!(await mwLine()), 'ticking it again brings the line back');
    }

    ok(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    const origin = new URL(url).origin;
    const foreign = requests.filter(u => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
    ok(!foreign.length, `no third-party requests (${requests.length} requests, all same-origin)` + (foreign.length ? ': ' + foreign.join(', ') : ''));
    console.log('E2E passed');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    try { ws && ws.close(); } catch {}
    chrome.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
