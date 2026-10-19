// Invoice – editor, lists and storage.
// Storage modes: 'browser' (localStorage, no login) or 'server' (api.php with users), see config.js.
(function () {
  const { makeL, LANGS, UNITS } = I18N;
  const { COUNTRIES, TREATMENTS, recommendTreatment, vatRatesFor, checkInvoice, isEU } = Rules;
  const { render, compute, money, esc, addDays } = Render;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const clone = o => JSON.parse(JSON.stringify(o));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const DOC_LABEL = { invoice: 'Invoice', proforma: 'Pro-forma', quote: 'Quotation', credit_note: 'Credit note', self_billing: 'Self-billing' };
  const SERIES_PREFIX = { proforma: 'PF', quote: 'AN', credit_note: 'RK', self_billing: 'GS' };

  // ---------------------------------------------------------------- storage
  const CONFIG = Object.assign({ storage: 'auto', topLinks: [], madeWith: null }, window.INVOICE_CONFIG || {});
  // optional "Created with HMSK Invoice" footer line (config.js: madeWith.enabled); each user can switch it off
  const MADE_WITH = CONFIG.madeWith && CONFIG.madeWith.enabled && /^https?:\/\//i.test(CONFIG.madeWith.url || '') ? { url: CONFIG.madeWith.url } : null;
  const UI_DE = /^de\b/i.test(navigator.language || '');
  const DB_KEY = 'invoice-db';
  let db = { rev: 0, parties: [], items: [], invoices: [], settings: {} };
  let mode = 'api'; // 'api' = server mode, 'local' = browser mode (localStorage)

  async function api(action, body) {
    const res = await fetch(`api.php?a=${action}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', 'X-Invoice-App': '1' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { if (res.ok || res.status === 404) throw Object.assign(new Error('no api'), { noApi: true }); }
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
    return data;
  }

  let me = { user: 'local', role: 'admin' };
  const isAdmin = () => me.role === 'admin';

  function setDb(data) {
    db = data;
    db.parties ||= []; db.items ||= []; db.invoices ||= [];
    if (!db.settings || Array.isArray(db.settings)) db.settings = {};
  }
  async function loadDb() {
    if (mode === 'local') {
      let stored = null;
      try { stored = localStorage.getItem(DB_KEY); } catch {}
      if (stored) { try { setDb(JSON.parse(stored)); } catch {} }
      else {
        // first visit: start with the fictional demo data so the tool can be tried right away
        setDb({ rev: 0, parties: clone(window.DEMO?.parties || []), items: clone(window.DEMO?.items || []), invoices: [], settings: { lastSender: 'demo-muster' } });
        try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch {}
      }
      return;
    }
    setDb(await api('load'));
  }

  // The server merges record by record (newest updatedAt wins) and only accepts
  // changes to records this user may see, so two users can work at the same time.
  const touch = o => { o.updatedAt = new Date().toISOString(); return o; };
  let deleted = { invoices: [], parties: [], items: [] };
  const markDeleted = (kind, id) => deleted[kind].push(id);
  let localVer = 0, replaceNext = false;
  let saving = Promise.resolve();
  const persistNow = () => { localVer++; saving = saving.then(doPersist); return saving; };
  const persistLater = debounce(() => { saving = saving.then(doPersist); }, 400);
  const persist = () => { localVer++; persistLater(); };
  async function doPersist() {
    setSync('Saving…');
    if (mode === 'local') {
      try { localStorage.setItem(DB_KEY, JSON.stringify(db)); setSync('Saved in this browser'); } catch (e) { setSync('Not saved'); toast('Could not save in this browser: ' + e.message, true); }
      return;
    }
    const ver = localVer, sentDeleted = deleted;
    deleted = { invoices: [], parties: [], items: [] };
    try {
      const r = await api('save', { db, deleted: sentDeleted, replace: replaceNext });
      replaceNext = false;
      if (ver === localVer) setDb(r);   // take the merged copy (includes the other user's changes) unless more edits are queued
      setSync('Saved ✓');
    } catch (e) {
      for (const k in sentDeleted) deleted[k].push(...sentDeleted[k]);
      if (e.status === 401) return showLogin();
      setSync('Not saved');
      toast(e.message, true);
    }
  }
  // pull the other user's changes when nothing of ours is waiting to be saved
  async function refresh() {
    if (mode !== 'api' || $('#app').hidden) return;
    const ver = localVer;
    await saving;
    try { const r = await api('load'); if (ver === localVer) setDb(r); } catch (e) { if (e.status === 401) showLogin(); }
  }
  const draftKey = () => 'invoice-cur-' + me.user;
  // stored as db.settings.showMadeWith; missing (older data and backups) means on
  const showMadeWith = () => !!MADE_WITH && db.settings.showMadeWith !== false;
  function setSync(t) { $('#syncState').textContent = t; }

  // ---------------------------------------------------------------- helpers
  const party = id => db.parties.find(p => p.id === id);
  const partyLabel = p => p.short || p.name;
  function partiesSorted() { return [...db.parties].sort((a, b) => partyLabel(a).localeCompare(partyLabel(b))); }

  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('on');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), err ? 6000 : 2600);
  }

  // Invoice language: the sender's default language if set, otherwise the browser language (DE/EN).
  function defaultLang(s, r) {
    if (!s) return UI_DE ? 'de' : 'en';
    if (s.lang) {
      // a German sender writing to a foreign client gets the bilingual default
      if (r && s.lang === 'de' && r.country !== 'DE') return 'de-en';
      if (r && s.lang === 'pt' && r.country !== 'PT') return 'pt-en';
      return s.lang;
    }
    if (s.country === 'PT') return r && r.country !== 'PT' ? 'pt-en' : 'pt';
    if (UI_DE) return r && r.country && r.country !== 'DE' ? 'de-en' : 'de';
    return 'en';
  }

  // numbering: each issuer has one counter per series (invoice, proforma, …)
  function seriesOf(inv) { return inv.docType === 'invoice' ? 'invoice' : inv.docType; }
  function numberingParty(inv) { return party(inv.docType === 'self_billing' ? inv.recipientId : inv.senderId); }
  function formatNumber(fmt, n, date) {
    const [y, m] = (date || today()).split('-');
    return fmt.replace(/\{YYYY\}/g, y).replace(/\{YY\}/g, y.slice(2)).replace(/\{MM\}/g, m)
      .replace(/\{(N+)\}/g, (_, ns) => String(n).padStart(ns.length, '0'));
  }
  // Monthly clients have their own series ("AB 2026/10-03" = code, year, month, running no.);
  // everything else uses the issuer's series ("RE-2026-001").
  const MONTHLY_FORMAT = '{CODE} {YYYY}/{MM}-{NN}';
  function monthlyClient(inv) {
    const r = party(inv.recipientId);
    return seriesOf(inv) === 'invoice' && r && r.billing === 'monthly' && r.clientCode ? r : null;
  }
  // the month the invoice is for: the service month/period, else the invoice date
  function periodDate(inv) {
    if (inv.serviceMode === 'month' && inv.month) return inv.month + '-01';
    if (inv.serviceMode === 'period' && inv.periodFrom) return inv.periodFrom;
    if (inv.serviceMode === 'date' && inv.serviceDate) return inv.serviceDate;
    return inv.date || today();
  }
  function nextNumber(inv) {
    const p = numberingParty(inv);
    if (!p) return '';
    const mc = monthlyClient(inv);
    const series = mc ? 'client' : seriesOf(inv);
    const owner = mc || p;           // whose counter
    const date = mc ? periodDate(inv) : (inv.date || today());
    const year = date.slice(0, 4);
    const fmt = mc ? (mc.clientNumberFormat || MONTHLY_FORMAT).replace(/\{CODE\}/g, mc.clientCode)
      : series === 'invoice' ? (p.numberFormat || 'RE-{YYYY}-{NNN}') : `${SERIES_PREFIX[series]}-{YYYY}-{NNN}`;
    const c = (owner.counters || {})[series] || { next: 1, year };
    let n = (owner.resetYearly !== '0' && c.year && c.year !== year) ? 1 : (+c.next || 1);
    // skip numbers that already exist for this issuer
    const used = new Set(db.invoices.filter(i => i.status !== 'draft' && numberingParty(i)?.id === p.id).map(i => i.number));
    let num = formatNumber(fmt, n, date);
    while (used.has(num) && n < 99999) num = formatNumber(fmt, ++n, date);
    return { num, n, year, series, partyId: p.id, ownerId: owner.id, date };
  }

  // ---------------------------------------------------------------- editor state
  let cur = null;

  function blankInvoice() {
    const s = party(db.settings.lastSender) || db.parties.find(p => p.iban) || null;
    return {
      id: null, status: 'draft', docType: 'invoice',
      senderId: s?.id || '', recipientId: '',
      lang: defaultLang(s, null), langManual: false,
      number: '', numberManual: false,
      date: today(), dueDays: s?.dueDays ?? 14, dueManual: false,
      serviceMode: 'same', serviceDate: today(), periodFrom: '', periodTo: '', month: today().slice(0, 7),
      currency: 'EUR', supply: 'services', clientRef: '', refNumber: '', refDate: '',
      treatment: 'domestic', treatmentManual: false,
      lines: [blankLine()], showDiscount: false, intro: '', notes: '', showLogo: true,
    };
  }
  function blankLine() { return { desc: '', details: '', qty: 1, unit: 'pc', price: 0, vat: null, disc: 0, code: '' }; }

  // re-derive everything that depends on sender/recipient, keeping what the user set by hand
  function applyDefaults() {
    const s = party(cur.senderId), r = party(cur.recipientId);
    if (!cur.langManual) cur.lang = defaultLang(s, r);
    if (!cur.treatmentManual) cur.treatment = recommendTreatment(s, r, cur.supply);
    if (!cur.dueManual && s && s.dueDays != null && s.dueDays !== '') cur.dueDays = +s.dueDays;
    const rates = vatRatesFor(s, cur.treatment);
    cur.lines.forEach(l => { if (l.vat == null || !rates.includes(+l.vat)) l.vat = rates[0]; });
    if (cur.status === 'draft' && !cur.numberManual) cur.number = nextNumber(cur).num || '';
  }

  function renumber() {
    if (cur.status === 'draft' && !cur.numberManual) { cur.number = nextNumber(cur).num || ''; $('#f-number').value = cur.number; }
  }

  // Picking a monthly client: bill the month after their last invoice and reuse its items.
  function applyMonthlyClient() {
    const r = party(cur.recipientId);
    if (!r || r.billing !== 'monthly' || cur.docType !== 'invoice') return;
    const last = db.invoices.filter(i => i.recipientId === r.id && i.status !== 'draft' && i.docType === 'invoice')
      .sort((a, b) => (periodDate(b)).localeCompare(periodDate(a)))[0];
    let ym;
    if (last) {
      const [y, m] = periodDate(last).split('-').map(Number);
      ym = `${m === 12 ? y + 1 : y}-${String(m % 12 + 1).padStart(2, '0')}`;
    } else {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
      ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    cur.serviceMode = 'month';
    cur.month = ym;
    if (last && !cur.lines.some(l => l.desc)) {
      cur.lines = clone(last.lines);
      for (const k of ['currency', 'supply', 'lang', 'langManual', 'dueDays', 'dueManual', 'clientRef', 'intro', 'notes']) if (k in last) cur[k] = clone(last[k]);
    }
  }

  function snapshotParties(inv) {
    return { sender: clone(party(inv.senderId) || {}), recipient: clone(party(inv.recipientId) || {}) };
  }
  function partiesFor(inv) {
    if (inv.status !== 'draft' && inv.snap) return [inv.snap.sender, inv.snap.recipient];
    return [party(inv.senderId), party(inv.recipientId)];
  }

  // ---------------------------------------------------------------- editor UI
  function fillSelect(sel, options, value) {
    sel.innerHTML = options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    sel.value = value ?? '';
  }

  function refreshPartySelects() {
    const opts = [['', '— choose —'], ...partiesSorted().map(p => [p.id, `${partyLabel(p)} · ${p.country}${p.kind === 'freelancer' ? ' · freelancer' : p.kind === 'private' ? ' · private' : ''}${p.billing === 'monthly' && p.clientCode ? ' · monthly ' + p.clientCode : ''}`])];
    fillSelect($('#f-sender'), opts, cur.senderId);
    fillSelect($('#f-recipient'), opts, cur.recipientId);
  }
  function refreshCatalogue() {
    fillSelect($('#f-catalogue'), [['', '＋ Add from catalogue…'], ...db.items.map(i => [i.id, `${i.desc} · ${money(+i.price || 0, cur.currency, 'de')}`])], '');
  }
  function refreshTemplates() {
    const list = [...db.invoices].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const mine = list.filter(i => i.recipientId === cur.recipientId);
    const rest = list.filter(i => i.recipientId !== cur.recipientId).slice(0, 40);
    const lab = i => `${i.number || 'draft'} · ${partyLabel(party(i.recipientId) || i.snap?.recipient || { name: '?' })} · ${money(compute(i).total, i.currency, 'de')}`;
    fillSelect($('#f-template'), [['', '— blank —'], ...[...mine, ...rest].map(i => [i.id, lab(i)])], '');
  }
  function refreshTreatments() {
    const s = party(cur.senderId), r = party(cur.recipientId);
    const rec = recommendTreatment(s, r, cur.supply);
    fillSelect($('#f-treatment'), Object.entries(TREATMENTS).map(([k, t]) => [k, t.label + (k === rec ? '  ✓ recommended' : '')]), cur.treatment);
    $('#treatHint').textContent = s && r ? `${s.country} → ${r.country}, ${Rules.isBusiness(r) ? 'B2B' : 'B2C'}` : '';
  }

  function loadForm() {
    const f = $('#invForm');
    refreshPartySelects();
    fillSelect($('#f-lang'), Object.entries(LANGS), cur.lang);
    $('#f-docType').value = cur.docType;
    $('#f-number').value = cur.number;
    $('#f-date').value = cur.date;
    if (![...$('#f-dueDays').options].some(o => o.value == cur.dueDays)) $('#f-dueDays').insertAdjacentHTML('beforeend', `<option value="${+cur.dueDays}">${+cur.dueDays} days</option>`);
    $('#f-dueDays').value = String(cur.dueDays);
    $('#f-serviceMode').value = cur.serviceMode;
    for (const k of ['serviceDate', 'periodFrom', 'periodTo', 'month', 'currency', 'supply', 'clientRef', 'refNumber', 'refDate', 'intro', 'notes']) $('#f-' + k).value = cur[k] ?? '';
    $('#f-showDiscount').checked = !!cur.showDiscount;
    $('#f-showLogo').checked = cur.showLogo !== false;
    f.dataset.svc = cur.serviceMode;
    f.dataset.doc = cur.docType;
    refreshTreatments();
    refreshCatalogue();
    refreshTemplates();
    renderLines();
    const locked = cur.status !== 'draft';
    $$('input, select, textarea, #addLine, [data-new-party], #regenNo', f).forEach(el => { el.disabled = locked; });
    $('#saveDraft').hidden = locked;
    $('#issueInv').hidden = locked;
    $('#xmlInv').hidden = !XR_TYPES.includes(cur.docType);
    update();
  }

  function renderLines() {
    const s = party(cur.senderId);
    const rates = vatRatesFor(s, cur.treatment);
    const unitOpts = Object.entries(UNITS).map(([k, v]) => `<option value="${k}">${v.en} · ${v.de}</option>`).join('');
    const disc = cur.showDiscount;
    $('#lines').innerHTML = cur.lines.map((l, i) => `
      <div class="line" data-i="${i}">
        <div class="l1">
          <label>Description <input data-k="desc" value="${esc(l.desc)}" placeholder="Service or product"></label>
          <div class="line-tools">
            <button type="button" data-act="up" title="Move up">↑</button>
            <button type="button" data-act="down" title="Move down">↓</button>
            <button type="button" data-act="save" title="Save to catalogue">★</button>
            <button type="button" data-act="del" title="Remove">✕</button>
          </div>
        </div>
        <label>Details <input data-k="details" value="${esc(l.details)}" placeholder="optional 2nd line"></label>
        <div class="l2 ${disc ? 'disc' : ''}">
          <label>Qty <input data-k="qty" type="number" step="any" value="${esc(l.qty)}"></label>
          <label>Unit <select data-k="unit">${unitOpts}</select></label>
          <label>Unit price <input data-k="price" type="number" step="any" value="${esc(l.price)}"></label>
          <label>VAT % <select data-k="vat">${rates.map(r => `<option value="${r}">${r} %</option>`).join('')}</select></label>
          ${disc ? `<label>Disc. % <input data-k="disc" type="number" step="any" min="0" max="100" value="${esc(l.disc)}"></label>` : ''}
        </div>
        <div class="line-sum" data-sum></div>
      </div>`).join('');
    $$('#lines .line').forEach((el, i) => {
      $('[data-k=unit]', el).value = cur.lines[i].unit || 'pc';
      $('[data-k=vat]', el).value = String(cur.lines[i].vat ?? rates[0]);
    });
    if (cur.status !== 'draft') $$('#lines input, #lines select, #lines button').forEach(e => e.disabled = true);
    lineSums();
  }
  function lineSums() {
    const c = compute(cur);
    $$('#lines .line').forEach((el, i) => { $('[data-sum]', el).textContent = c.lines[i] ? '= ' + money(c.lines[i].net, cur.currency, 'de') + ' net' : ''; });
  }

  const update = debounce(() => {
    const [s, r] = partiesFor(cur);
    $('#sheet').innerHTML = render(cur, s, r, { madeWith: showMadeWith() ? MADE_WITH : null });
    fitPreview();
    renderChecks(s, r);
    $('#previewTitle').textContent = `${DOC_LABEL[cur.docType]} ${cur.number || ''} · ${cur.status}`;
    saveDraftLocal();
  }, 60);

  function renderChecks(s, r) {
    const c = compute(cur);
    const list = checkInvoice({ ...cur, total: c.total }, s, r);
    const n = { error: 0, warn: 0, info: 0 };
    list.forEach(x => n[x.level]++);
    const badge = n.error ? `<span class="badge err">${n.error} must fix</span>` : n.warn ? `<span class="badge warn">${n.warn} to review</span>` : `<span class="badge ok">Compliant</span>`;
    const row = x => `<div class="check ${x.level}"><span class="dot"></span><div>${esc(x.msg)}${x.law ? `<span class="law">${esc(x.law)}</span>` : ''}</div></div>`;
    let html = `<h3>Compliance check ${badge}</h3>` + (list.length ? list.map(row).join('') : '<p class="hint">All mandatory details are present.</p>');
    if (XR_TYPES.includes(cur.docType) && s && r) {
      const xr = XRechnung.check(cur, s, r);
      const ready = !xr.some(x => x.level === 'error');
      html += `<h3 class="xr-head">E-invoice (XRechnung) ${ready ? '<span class="badge ok">ready</span>' : '<span class="badge warn">missing data</span>'}</h3>` +
        (xr.length ? xr.map(x => row({ ...x, level: x.level === 'error' ? 'warn' : 'info' })).join('') : '<p class="hint">All data for the XRechnung export is present. Issue the invoice, then use "XRechnung (XML)".</p>');
    }
    $('#checks').innerHTML = html;
    cur._errors = n.error;
  }

  function fitPreview() {
    const box = $('.preview-scroll'), sheet = $('#sheet'), wrap = $('#sheetScale');
    if (!box.clientWidth) return;
    const w = sheet.offsetWidth;
    const k = Math.min(1, (box.clientWidth - 2) / w);
    wrap.style.transform = `scale(${k})`;
    wrap.style.height = sheet.offsetHeight * k + 'px';
    wrap.style.width = w * k + 'px';
  }
  window.addEventListener('resize', debounce(fitPreview, 100));

  // local draft so an unsaved invoice survives a reload
  function saveDraftLocal() { try { if (cur.status === 'draft') localStorage.setItem(draftKey(), JSON.stringify(cur)); } catch {} }

  function bindEditor() {
    const f = $('#invForm');
    f.addEventListener('input', onField);
    f.addEventListener('change', onField);

    $('#lines').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const i = +b.closest('.line').dataset.i;
      const act = b.dataset.act;
      if (act === 'del') { cur.lines.splice(i, 1); if (!cur.lines.length) cur.lines.push(blankLine()); applyDefaults(); }
      if (act === 'up' && i > 0) [cur.lines[i - 1], cur.lines[i]] = [cur.lines[i], cur.lines[i - 1]];
      if (act === 'down' && i < cur.lines.length - 1) [cur.lines[i + 1], cur.lines[i]] = [cur.lines[i], cur.lines[i + 1]];
      if (act === 'save') {
        const l = cur.lines[i];
        if (!l.desc) return toast('Give the line a description first.', true);
        const ex = db.items.find(x => x.desc === l.desc);
        const item = touch({ id: ex?.id || uid(), desc: l.desc, details: l.details, unit: l.unit, price: +l.price || 0, code: l.code || '' });
        if (ex) Object.assign(ex, item); else db.items.push(item);
        persist(); refreshCatalogue(); toast(ex ? 'Catalogue item updated' : 'Saved to catalogue');
        return;
      }
      renderLines(); update();
    });

    $('#addLine').onclick = () => { cur.lines.push(blankLine()); applyDefaults(); renderLines(); update(); $$('#lines .line').at(-1).querySelector('input').focus(); };
    $('#regenNo').onclick = () => { cur.numberManual = false; applyDefaults(); $('#f-number').value = cur.number; update(); };
    $('#newInv').onclick = () => { if (cur.status === 'draft' && isDirty() && !confirm('Discard the current unsaved changes?')) return; cur = blankInvoice(); applyDefaults(); loadForm(); };
    $('#saveDraft').onclick = () => saveInvoice('draft');
    $('#issueInv').onclick = () => issue();
    $('#printInv').onclick = () => printInvoice();
    $('#xmlInv').onclick = () => downloadXml();
  }

  function isDirty() { return cur.lines.some(l => l.desc) || cur.recipientId; }

  function onField(e) {
    const el = e.target;
    if (cur.status !== 'draft') return;
    const line = el.closest('.line');
    if (line) {
      const l = cur.lines[+line.dataset.i];
      const k = el.dataset.k;
      if (!k) return;
      l[k] = ['qty', 'price', 'disc', 'vat'].includes(k) ? (el.value === '' ? '' : +el.value) : el.value;
      lineSums(); update();
      return;
    }
    const id = el.id?.replace(/^f-/, '');
    if (!id || e.type === 'input' && el.tagName === 'SELECT') return;
    switch (id) {
      case 'sender': case 'recipient':
        cur[id + 'Id'] = el.value;
        if (id === 'sender') { db.settings.lastSender = el.value; cur.numberManual = false; persist(); }
        if (id === 'recipient') { cur.numberManual = false; applyMonthlyClient(); }
        applyDefaults(); loadForm(); return;
      case 'docType':
        cur.docType = el.value; cur.numberManual = false; applyDefaults(); loadForm(); return;
      case 'lang': cur.lang = el.value; cur.langManual = true; break;
      case 'number': cur.number = el.value; cur.numberManual = true; break;
      case 'date':
        cur.date = el.value;
        if (!cur.numberManual) { applyDefaults(); $('#f-number').value = cur.number; }
        break;
      case 'dueDays': cur.dueDays = +el.value; cur.dueManual = true; break;
      case 'serviceMode': cur.serviceMode = el.value; $('#invForm').dataset.svc = el.value; renumber(); break;
      case 'month': case 'periodFrom': case 'serviceDate': cur[id] = el.value; renumber(); break;
      case 'treatment': cur.treatment = el.value; cur.treatmentManual = true; applyDefaults(); renderLines(); break;
      case 'supply': cur.supply = el.value; applyDefaults(); refreshTreatments(); renderLines(); break;
      case 'currency': cur.currency = el.value; lineSums(); break;
      case 'showDiscount': cur.showDiscount = el.checked; renderLines(); break;
      case 'showLogo': cur.showLogo = el.checked; break;
      case 'catalogue': {
        const it = db.items.find(x => x.id === el.value);
        if (it) {
          const empty = cur.lines.length === 1 && !cur.lines[0].desc;
          const l = { ...blankLine(), desc: it.desc, details: it.details || '', unit: it.unit || 'pc', price: +it.price || 0, code: it.code || '' };
          if (empty) cur.lines[0] = l; else cur.lines.push(l);
          applyDefaults(); renderLines();
        }
        el.value = '';
        break;
      }
      case 'template': {
        const src = db.invoices.find(x => x.id === el.value);
        if (src) startFrom(src);
        return;
      }
      default:
        if (id in cur) cur[id] = el.value;
    }
    update();
  }

  // copy an earlier invoice into a fresh draft (monthly retainers etc.)
  function startFrom(src, opts = {}) {
    const n = blankInvoice();
    for (const k of ['senderId', 'recipientId', 'docType', 'lang', 'langManual', 'dueDays', 'dueManual', 'serviceMode', 'currency', 'supply', 'clientRef', 'treatment', 'treatmentManual', 'showDiscount', 'intro', 'notes', 'showLogo']) n[k] = clone(src[k]);
    n.lines = clone(src.lines);
    if (src.serviceMode === 'month' && src.month) {
      const [y, m] = src.month.split('-').map(Number);
      const d = new Date(y, m, 1);
      n.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    if (src.serviceMode === 'period' || src.serviceMode === 'date') { n.periodFrom = ''; n.periodTo = ''; n.serviceDate = today(); }
    if (opts.creditNote) {
      n.docType = 'credit_note'; n.refNumber = src.number; n.refDate = src.date;
      n.serviceMode = src.serviceMode; n.serviceDate = src.serviceDate; n.periodFrom = src.periodFrom; n.periodTo = src.periodTo; n.month = src.month;
    }
    if (!party(n.senderId) && src.snap) toast('The original sender no longer exists – choose one.', true);
    cur = n; applyDefaults(); loadForm(); switchView('editor');
    toast(opts.creditNote ? `Credit note for ${src.number} prepared` : 'Copied – check the dates and amounts');
  }

  function saveInvoice(status) {
    if (!cur.senderId || !cur.recipientId) { toast('Choose sender and client first.', true); return false; }
    const rec = clone(cur);
    delete rec._errors;
    rec.status = status;
    rec.updatedAt = new Date().toISOString();
    if (!rec.id) { rec.id = uid(); rec.createdAt = rec.updatedAt; }
    const i = db.invoices.findIndex(x => x.id === rec.id);
    if (i >= 0) db.invoices[i] = rec; else db.invoices.push(rec);
    cur = rec;
    persist();
    if (status === 'draft') { toast('Draft saved'); update(); }
    return true;
  }

  let issuing = false;
  async function issue() {
    if (issuing) return false;
    const [s, r] = partiesFor(cur);
    renderChecks(s, r);
    if (cur._errors) { toast('Fix the red items in the compliance check before issuing.', true); $('#checks').scrollIntoView({ behavior: 'smooth' }); return false; }
    if (!cur.lines.some(l => l.desc && +l.qty && +l.price)) { toast('Add at least one priced line.', true); return false; }
    const nn = nextNumber(cur);
    issuing = true;
    try {
      if (mode === 'api') {
        // the server hands out the number, checking every user's invoices
        await saving;
        const res = await api('number', { partyId: nn.partyId, clientId: cur.recipientId, series: seriesOf(cur), date: cur.date, periodDate: periodDate(cur), invoiceId: cur.id || '', number: cur.numberManual ? cur.number : '' });
        cur.number = res.number;
        if (res.counters) { const p = party(res.ownerId || nn.partyId); if (p) p.counters = res.counters; }
      } else {
        if (!cur.numberManual) cur.number = nn.num;
        const clash = db.invoices.find(i => i.id !== cur.id && i.status !== 'draft' && i.number === cur.number && numberingParty(i)?.id === nn.partyId);
        if (clash) { toast(`Number ${cur.number} is already used. Press ↻ for the next free number.`, true); return false; }
        const p = party(nn.ownerId);
        p.counters = p.counters || {};
        if (!cur.numberManual || cur.number === nn.num) p.counters[nn.series] = { next: nn.n + 1, year: nn.year };
      }
    } catch (e) {
      toast(e.status === 409 ? e.message + ' Press ↻ for the next free number.' : e.message, true);
      return false;
    } finally { issuing = false; }
    cur.snap = snapshotParties(cur);
    cur.issuedAt = new Date().toISOString();
    saveInvoice('issued');
    localStorage.removeItem(draftKey());
    loadForm();
    toast(`${DOC_LABEL[cur.docType]} ${cur.number} issued and saved`);
    return true;
  }

  async function printInvoice() {
    const needsIssue = cur.status === 'draft' && ['invoice', 'credit_note', 'self_billing'].includes(cur.docType);
    if (needsIssue) {
      if (cur._errors) {
        if (!confirm('This invoice still has compliance errors and is not issued. Print it as a draft anyway?')) return;
      } else if (confirm('Issue this invoice now (final number, saved to history) before printing?\n\nCancel = print as draft without saving.')) {
        if (!(await issue())) return;
      }
    } else if (cur.status === 'draft' && cur.senderId && cur.recipientId) {
      saveInvoice('draft');
    }
    const r = partiesFor(cur)[1];
    const old = document.title;
    document.title = `${cur.number || 'draft'} ${r ? partyLabel(r) : ''}`.replace(/[\/\\:*?"<>|]/g, '-');
    setTimeout(() => { window.print(); document.title = old; }, 80);
  }

  // ---------------------------------------------------------------- XRechnung export
  const XR_TYPES = ['invoice', 'credit_note', 'self_billing'];
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportXml(inv) {
    const [s, r] = partiesFor(inv);
    const problems = XRechnung.check(inv, s, r).filter(x => x.level === 'error');
    if (problems.length) { toast('XRechnung not possible yet: ' + problems.map(p => p.msg).join(' '), true); return false; }
    download(XRechnung.fileName(inv), XRechnung.build(inv, s, r), 'application/xml');
    toast(`XRechnung ${inv.number} downloaded`);
    return true;
  }
  async function downloadXml() {
    if (!XR_TYPES.includes(cur.docType)) return toast('XRechnung is only available for invoices, credit notes and self-billing invoices.', true);
    if (cur.status === 'draft') {
      if (cur._errors) { toast('Fix the red items in the compliance check first: an e-invoice must be issued.', true); return; }
      const [s, r] = partiesFor(cur);
      const problems = XRechnung.check(cur, s, r).filter(x => x.level === 'error');
      if (problems.length) { toast('XRechnung not possible yet: ' + problems.map(p => p.msg).join(' '), true); return; }
      if (!confirm('An e-invoice needs a final number. Issue this invoice now (saved to history, then locked)?')) return;
      if (!(await issue())) return;
    }
    exportXml(cur);
  }

  // ---------------------------------------------------------------- history
  function renderHistory() {
    const q = $('#histSearch').value.toLowerCase();
    const st = $('#histFilter').value;
    const by = i => i.createdBy || 'admin';
    const admin = isAdmin() && mode === 'api';
    const users = [...new Set(db.invoices.map(by))].sort();
    const uSel = $('#histUser');
    uSel.hidden = !admin || users.length < 2;
    if (admin && uSel.options.length !== users.length + 1) { const v = uSel.value; uSel.innerHTML = `<option value="">Everyone</option>` + users.map(u => `<option>${esc(u)}</option>`).join(''); uSel.value = v; }
    const uf = admin ? uSel.value : '';
    const rows = [...db.invoices].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || ''))
      .filter(i => (!st || i.status === st) && (!uf || by(i) === uf))
      .map(i => {
        const [s, r] = partiesFor(i);
        const c = compute(i);
        return { i, s, r, c, text: [i.number, s && partyLabel(s), r && partyLabel(r), c.total, DOC_LABEL[i.docType]].join(' ').toLowerCase() };
      }).filter(x => !q || x.text.includes(q));
    const totalOpen = rows.filter(x => x.i.status === 'issued' && x.i.docType === 'invoice').reduce((a, x) => a + x.c.total, 0);
    $('#histTable').innerHTML = `<thead><tr><th>Number</th><th>Date</th><th>Type</th><th>From</th><th>To</th><th class="num">Total</th><th>Status</th>${admin ? '<th>By</th>' : ''}<th></th></tr></thead><tbody>` +
      (rows.map(({ i, s, r, c }) => `<tr data-id="${i.id}">
        <td><strong>${esc(i.number || '—')}</strong></td><td>${Render.fmtDate(i.date, 'de')}</td><td>${DOC_LABEL[i.docType]}</td>
        <td>${esc(s ? partyLabel(s) : '?')}</td><td>${esc(r ? partyLabel(r) : '?')}</td>
        <td class="num">${money(c.total, i.currency, 'de')}</td>
        <td><span class="badge ${i.status}">${i.status}</span></td>
        ${admin ? `<td>${esc(by(i))}</td>` : ''}
        <td>
          <button class="btn sm" data-h="open">Open</button>
          <button class="btn sm" data-h="dup">Copy</button>
          ${i.status !== 'draft' && XR_TYPES.includes(i.docType) ? `<button class="btn sm" data-h="xml" title="Download XRechnung (XML)">XML</button>` : ''}
          ${i.status === 'issued' ? `<button class="btn sm" data-h="paid">Mark paid</button>` : ''}
          ${i.status === 'paid' ? `<button class="btn sm ghost" data-h="unpaid">Unpaid</button>` : ''}
          ${i.status !== 'draft' && i.docType === 'invoice' ? `<button class="btn sm ghost" data-h="cn">Credit note</button>` : ''}
          ${i.status === 'draft' ? `<button class="btn sm ghost danger" data-h="del">Delete</button>` : ''}
        </td></tr>`).join('') || `<tr><td colspan="9" class="hint">No invoices yet.</td></tr>`) +
      `</tbody>` + (totalOpen ? `<tfoot><tr><td colspan="5"><strong>Open (issued, unpaid)</strong></td><td class="num"><strong>${money(totalOpen, 'EUR', 'de')}</strong></td><td colspan="${admin ? 3 : 2}"></td></tr></tfoot>` : '');
  }
  function bindHistory() {
    $('#histSearch').oninput = renderHistory;
    $('#histFilter').onchange = renderHistory;
    $('#histUser').onchange = renderHistory;
    $('#histTable').onclick = e => {
      const b = e.target.closest('button[data-h]');
      if (!b) return;
      const inv = db.invoices.find(x => x.id === b.closest('tr').dataset.id);
      const h = b.dataset.h;
      if (h === 'open') { cur = clone(inv); loadForm(); switchView('editor'); }
      if (h === 'dup') startFrom(inv);
      if (h === 'xml') exportXml(inv);
      if (h === 'cn') startFrom(inv, { creditNote: true });
      if (h === 'paid') { inv.status = 'paid'; inv.paidAt = today(); touch(inv); persist(); renderHistory(); }
      if (h === 'unpaid') { inv.status = 'issued'; delete inv.paidAt; touch(inv); persist(); renderHistory(); }
      if (h === 'del' && confirm(`Delete draft ${inv.number || ''}?`)) { db.invoices = db.invoices.filter(x => x !== inv); markDeleted('invoices', inv.id); persist(); renderHistory(); }
    };
  }

  // ---------------------------------------------------------------- parties
  function renderParties() {
    $('#partyList').innerHTML = partiesSorted().map(p => `
      <div class="pcard" data-id="${p.id}">
        <div class="plogo">${p.logo ? `<img src="${p.logo}" alt="">` : esc((p.short || p.name || '?').slice(0, 2).toUpperCase())}</div>
        <div><h3>${esc(p.name)}</h3>
          <div class="pmeta">${esc([p.kind, COUNTRIES[p.country] || p.country].join(' · '))}</div>
          <div class="pmeta">${esc([p.vatId, p.taxNo].filter(Boolean).join(' · ') || 'no tax ID')}</div>
          <div class="pmeta">${p.iban ? 'Bank ✓ · ' : ''}${p.vatScheme === 'small' ? 'small business · ' : ''}${p.adminOnly ? 'admin only · ' : ''}${p.billing === 'monthly' ? `monthly · ${esc(p.clientCode || '')} · ` : ''}${db.invoices.filter(i => i.senderId === p.id || i.recipientId === p.id).length} invoices</div>
        </div>
      </div>`).join('') || '<p class="hint">No entries yet.</p>';
  }

  let editingParty = null, partyTarget = null, pendingLogo;
  function openParty(p, target) {
    editingParty = p || null;
    partyTarget = target || null;
    pendingLogo = p?.logo || '';
    const f = $('#partyForm');
    f.reset();
    const data = p || { kind: 'company', country: 'DE', vatScheme: 'standard', resetYearly: '1', dueDays: 14, accent: '#111111', numberFormat: 'RE-{YYYY}-{NNN}' };
    for (const el of f.elements) {
      if (!el.name) continue;
      if (el.name === 'nextNumber') el.value = data.counters?.invoice?.next || 1;
      else if (el.name === 'clientNext') el.value = data.counters?.client?.next || 1;
      else if (el.type === 'checkbox') el.checked = !!data[el.name];
      else el.value = data[el.name] ?? (el.tagName === 'SELECT' ? el.options[0]?.value : '');
    }
    $('#partyDlgTitle').textContent = p ? 'Edit ' + partyLabel(p) : 'New sender / client';
    $('#partyDelete').hidden = !p;
    showLogo();
    syncPartyForm();
    $('#partyDlg').showModal();
  }
  function syncPartyForm() {
    const f = $('#partyForm');
    f.dataset.kind = f.kind.value;
    f.dataset.country = f.country.value;
    f.dataset.billing = f.billing.value;
    const code = (f.clientCode.value || 'XX').toUpperCase();
    const fmt = (f.clientNumberFormat.value || '{CODE} {YYYY}/{MM}-{NN}').replace(/\{CODE\}/g, code);
    const d = new Date();
    $('#p-numberPreview').textContent = 'Example: ' + formatNumber(fmt, +f.clientNext.value || 1, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    if (f.country.value !== 'DE' && f.country.value !== 'PT') f.dataset.other = '1'; else delete f.dataset.other;
  }
  function showLogo() {
    $('#logoBox').innerHTML = pendingLogo ? `<img src="${pendingLogo}" alt="">` : 'No logo';
  }
  function bindParties() {
    fillSelect($('#p-country'), Object.entries(COUNTRIES).map(([k, v]) => [k, `${v} (${k})${isEU(k) ? '' : ' · non-EU'}`]), 'DE');
    fillSelect($('#p-lang'), [['', 'Automatic (browser language)'], ...Object.entries(LANGS)], '');
    $('#partyForm').addEventListener('change', e => { if (['kind', 'country', 'billing'].includes(e.target.name)) syncPartyForm(); });
    $('#partyForm').addEventListener('input', e => { if (['clientCode', 'clientNumberFormat', 'clientNext'].includes(e.target.name)) syncPartyForm(); });
    $('#partyList').onclick = e => { const c = e.target.closest('.pcard'); if (c) openParty(party(c.dataset.id)); };
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-new-party]');
      if (b && !b.disabled) openParty(null, b.dataset.newParty);
    });
    $('#partyCancel').onclick = () => $('#partyDlg').close();
    $('#logoClear').onclick = () => { pendingLogo = ''; showLogo(); };
    $('#logoFile').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      pendingLogo = await readLogo(file);
      showLogo();
      e.target.value = '';
    };
    $('#partyDelete').onclick = () => {
      const used = db.invoices.filter(i => i.senderId === editingParty.id || i.recipientId === editingParty.id).length;
      if (!confirm(`Delete ${partyLabel(editingParty)}?${used ? `\n${used} invoices reference it. Issued invoices keep their own copy of the details.` : ''}`)) return;
      db.parties = db.parties.filter(p => p !== editingParty);
      markDeleted('parties', editingParty.id);
      persist(); $('#partyDlg').close(); renderParties(); refreshPartySelects();
    };
    $('#partyForm').onsubmit = e => {
      e.preventDefault();
      const f = e.target;
      const p = editingParty || { id: uid(), createdAt: new Date().toISOString() };
      for (const el of f.elements) {
        if (!el.name) continue;
        if (el.name === 'nextNumber' || el.name === 'clientNext') {
          const key = el.name === 'nextNumber' ? 'invoice' : 'client';
          p.counters = p.counters || {};
          const c = p.counters[key] || { year: today().slice(0, 4) };
          const next = Math.max(1, +el.value || 1);
          if (+c.next !== next) { c.next = next; p.countersSetAt = new Date().toISOString(); }
          p.counters[key] = c;
        } else if (el.type === 'checkbox') p[el.name] = el.checked;
        else p[el.name] = el.value.trim();
      }
      if (p.vatId) p.vatId = Rules.cleanVat(p.vatId);
      p.clientCode = (p.clientCode || '').toUpperCase();
      if (p.billing === 'monthly' && !p.clientCode) { toast('Monthly clients need a short code, e.g. IL.', true); return; }
      if (p.dueDays !== '') p.dueDays = +p.dueDays;
      p.logo = pendingLogo;
      touch(p);
      if (!editingParty) db.parties.push(p);
      persist();
      $('#partyDlg').close();
      renderParties();
      if (partyTarget === 'sender') cur.senderId = p.id;
      if (partyTarget === 'recipient') cur.recipientId = p.id;
      if (cur.status === 'draft') applyDefaults();
      loadForm();
      toast('Saved');
    };
  }

  // logos are stored inline (data URL), downscaled so the database stays small
  function readLogo(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = reject;
      fr.onload = () => {
        if (file.type === 'image/svg+xml') return resolve(fr.result);
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, 900 / img.width, 360 / img.height);
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/png'));
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  // ---------------------------------------------------------------- catalogue
  let editingItem = null;
  function renderItems() {
    $('#itemTable').innerHTML = `<thead><tr><th>Description</th><th>Details</th><th>Unit</th><th class="num">Price</th><th></th></tr></thead><tbody>` +
      (db.items.map(i => `<tr data-id="${i.id}"><td><strong>${esc(i.desc)}</strong></td><td>${esc(i.details || '')}</td><td>${esc(UNITS[i.unit]?.en || i.unit)}</td><td class="num">${money(+i.price || 0, 'EUR', 'de')}</td><td><button class="btn sm" data-edit>Edit</button></td></tr>`).join('')
        || `<tr><td colspan="5" class="hint">Nothing saved yet. Use ★ on an invoice line or "New item".</td></tr>`) + '</tbody>';
  }
  function bindItems() {
    $$('.unit-select').forEach(s => s.innerHTML = Object.entries(UNITS).map(([k, v]) => `<option value="${k}">${v.en} · ${v.de}</option>`).join(''));
    const open = it => {
      editingItem = it;
      const f = $('#itemForm'); f.reset();
      for (const el of f.elements) if (el.name) el.value = it?.[el.name] ?? (el.name === 'unit' ? 'pc' : '');
      $('#itemDelete').hidden = !it;
      $('#itemDlg').showModal();
    };
    $('#newItem').onclick = () => open(null);
    $('#itemTable').onclick = e => { if (e.target.closest('[data-edit]')) open(db.items.find(i => i.id === e.target.closest('tr').dataset.id)); };
    $('#itemCancel').onclick = () => $('#itemDlg').close();
    $('#itemDelete').onclick = () => { db.items = db.items.filter(i => i !== editingItem); markDeleted('items', editingItem.id); persist(); $('#itemDlg').close(); renderItems(); refreshCatalogue(); };
    $('#itemForm').onsubmit = e => {
      e.preventDefault();
      const it = editingItem || { id: uid() };
      for (const el of e.target.elements) if (el.name) it[el.name] = el.name === 'price' ? +el.value || 0 : el.value.trim();
      touch(it);
      if (!editingItem) db.items.push(it);
      persist(); $('#itemDlg').close(); renderItems(); refreshCatalogue();
    };
  }

  // ---------------------------------------------------------------- backup
  function syncMadeWith() {
    $$('.made-only').forEach(el => el.hidden = !MADE_WITH);
    $$('.mw-toggle').forEach(el => el.checked = showMadeWith());
  }
  function bindBackup() {
    $$('.mw-toggle').forEach(el => el.addEventListener('change', () => {
      db.settings.showMadeWith = el.checked;
      persist(); syncMadeWith(); update();
    }));
    $('#exportJson').onclick = () => {
      download(`invoice-backup-${today()}.json`, JSON.stringify({ ...db, exportedAt: new Date().toISOString(), app: 'invoice' }, null, 2), 'application/json');
      try { localStorage.setItem('invoice-last-backup', today()); } catch {}
    };
    $('#demoLoad').onclick = () => {
      const D = window.DEMO || { parties: [], items: [] };
      let n = 0;
      for (const p of D.parties) if (!party(p.id)) { db.parties.push(touch(clone(p))); n++; }
      for (const it of D.items) if (!db.items.some(x => x.id === it.id)) { db.items.push(touch(clone(it))); n++; }
      persist(); refreshPartySelects(); refreshCatalogue();
      toast(n ? `${n} demo entries added` : 'Demo data is already there');
    };
    $('#demoRemove').onclick = () => {
      const ids = new Set(db.parties.filter(p => p.demo).map(p => p.id));
      const items = db.items.filter(i => i.demo);
      const drafts = db.invoices.filter(i => i.status === 'draft' && (ids.has(i.senderId) || ids.has(i.recipientId)));
      if (!ids.size && !items.length) return toast('No demo data left');
      if (!confirm(`Remove ${ids.size} demo senders/clients, ${items.length} catalogue items${drafts.length ? ` and ${drafts.length} drafts that use them` : ''}? Issued invoices keep their own copy of the details.`)) return;
      ids.forEach(id => markDeleted('parties', id));
      items.forEach(i => markDeleted('items', i.id));
      drafts.forEach(i => markDeleted('invoices', i.id));
      db.parties = db.parties.filter(p => !p.demo);
      db.items = db.items.filter(i => !i.demo);
      db.invoices = db.invoices.filter(i => !drafts.includes(i));
      if (ids.has(db.settings.lastSender)) delete db.settings.lastSender;
      persist();
      if (cur.status === 'draft' && (ids.has(cur.senderId) || ids.has(cur.recipientId))) { cur = blankInvoice(); applyDefaults(); }
      loadForm(); toast('Demo data removed');
    };
    $('#wipeLocal').onclick = () => {
      if (mode !== 'local') return;
      if (!confirm('Delete ALL invoices, senders, clients and catalogue items stored in this browser? Download a backup first if you want to keep them.')) return;
      try { for (const k of Object.keys(localStorage)) if (k.startsWith('invoice-')) localStorage.removeItem(k); } catch {}
      localStorage.setItem(DB_KEY, JSON.stringify({ rev: 0, parties: [], items: [], invoices: [], settings: {} }));
      location.reload();
    };
    $('#importJson').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.parties) || !Array.isArray(data.invoices)) throw new Error('Not an invoice backup');
        if (!confirm(`Replace all current data with this backup (${data.parties.length} parties, ${data.invoices.length} invoices)?`)) return;
        setDb({ ...data, rev: db.rev });
        replaceNext = true;
        persist(); toast('Backup restored'); cur = blankInvoice(); applyDefaults(); loadForm(); syncMadeWith();
      } catch (err) { toast(err.message, true); }
      e.target.value = '';
    };
  }

  // ---------------------------------------------------------------- views / boot
  function switchView(v) {
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    $$('.view').forEach(el => el.hidden = el.id !== 'view-' + v);
    const draw = () => {
      if (v === 'history') renderHistory();
      if (v === 'parties') renderParties();
      if (v === 'items') renderItems();
      if (v === 'editor') { refreshPartySelects(); refreshCatalogue(); refreshTemplates(); update(); }
    };
    draw();
    if (v !== 'editor') refresh().then(draw);
  }

  function showLogin(msg) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#loginErr').textContent = msg || '';
    ($('#loginUser').value ? $('#loginPw') : $('#loginUser')).focus();
  }

  async function start() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#whoami').textContent = mode === 'api' ? `${me.user}${isAdmin() ? ' · admin' : ''}` : '';
    document.body.classList.toggle('is-admin', isAdmin());
    document.body.classList.toggle('is-browser', mode === 'local');
    $('#logoutBtn').hidden = mode !== 'api';
    $('#localNote').hidden = mode !== 'local';
    $('#localNoteText').textContent = UI_DE
      ? 'Ihre Daten bleiben in diesem Browser (localStorage). Nichts wird an einen Server gesendet. Exportieren Sie regelmäßig ein Backup.'
      : 'Your data stays in this browser (localStorage). Nothing is sent to a server. Export a backup regularly.';
    $('#backupText').textContent = mode === 'local'
      ? 'Everything is stored only in this browser (localStorage) on this device. Clearing the browser data deletes it, and other browsers or devices do not see it. Download a backup file regularly; you can restore it here or in any other browser.'
      : 'The server keeps the last 50 versions automatically. You can also download everything as one JSON file or restore from one (admin).';
    let restored = null;
    try { restored = JSON.parse(localStorage.getItem(draftKey())); } catch {}
    cur = restored && restored.status === 'draft' ? restored : blankInvoice();
    if (!restored) applyDefaults();
    importLines();
    loadForm(); syncMadeWith();
    setSync(mode === 'local' ? 'Saved in this browser' : 'Synced');
  }

  // Line items handed over by another tool on the same site (e.g. the time tracker):
  // localStorage 'invoice-import' = { source, recipientName?, currency?, lines: [{ desc, details, qty, unit, price }] },
  // read once when the page is opened with ?import.
  function importLines() {
    if (!new URLSearchParams(location.search).has('import')) return;
    history.replaceState(null, '', location.pathname);
    let data = null;
    try { data = JSON.parse(localStorage.getItem('invoice-import')); localStorage.removeItem('invoice-import'); } catch {}
    if (!data || !Array.isArray(data.lines) || !data.lines.length || cur.status !== 'draft') return;
    const lines = data.lines.map(l => ({ ...blankLine(), desc: String(l.desc || ''), details: String(l.details || ''),
      qty: +l.qty || 0, unit: UNITS[l.unit] ? l.unit : 'pc', price: +l.price || 0 }));
    if (cur.lines.some(l => l.desc)) cur.lines.push(...lines); else cur.lines = lines;
    const name = String(data.recipientName || '').trim().toLowerCase();
    const r = name && db.parties.find(p => [p.name, p.short].some(v => (v || '').trim().toLowerCase() === name));
    if (r && !cur.recipientId) cur.recipientId = r.id;
    if ([...$('#f-currency').options].some(o => o.value === data.currency)) cur.currency = data.currency;
    applyDefaults(); saveDraftLocal();
    toast((UI_DE ? `${lines.length} Positionen übernommen` : `${lines.length} lines imported`) + (data.source ? ` (${data.source})` : ''));
  }

  function renderTopLinks() {
    const links = Array.isArray(CONFIG.topLinks) ? CONFIG.topLinks : [];
    const txt = t => typeof t === 'string' ? t : (UI_DE ? t.de : t.en) || t.en || '';
    $('#siteStrip').innerHTML = links.map(l => `<a href="${esc(l.href)}">${esc(txt(l.text))}</a>`).join('');
    $('#siteStrip').hidden = !links.length;
  }

  // auto mode: server mode only if api.php answers and has at least one user
  async function detectMode() {
    if (location.protocol === 'file:') return 'local';
    if (CONFIG.storage === 'browser') return 'local';
    if (CONFIG.storage === 'server') return 'api';
    try {
      const r = await api('status');
      return r && r.app === 'invoice' && r.server ? 'api' : 'local';
    } catch { return 'local'; }
  }

  async function boot() {
    renderTopLinks();
    bindEditor(); bindHistory(); bindParties(); bindItems(); bindBackup();
    $('#tabs').onclick = e => { const b = e.target.closest('button[data-view]'); if (b) switchView(b.dataset.view); };
    document.addEventListener('click', e => { const b = e.target.closest('[data-goto]'); if (b) switchView(b.dataset.goto); });
    $('#logoutBtn').onclick = async () => { if (mode === 'api') await api('logout', {}).catch(() => {}); showLogin(); };
    $('#loginForm').onsubmit = async e => {
      e.preventDefault();
      try {
        me = await api('login', { user: $('#loginUser').value, password: $('#loginPw').value });
        $('#loginPw').value = '';
        try { localStorage.setItem('invoice-lastuser', me.user); } catch {}
        await loadDb();
        start();
      } catch (err) { showLogin(err.message); }
    };
    window.addEventListener('beforeprint', fitPreview);
    window.addEventListener('focus', () => refresh().then(() => { if (!$('#view-history').hidden) renderHistory(); }));
    try { $('#loginUser').value = localStorage.getItem('invoice-lastuser') || ''; } catch {}
    mode = await detectMode();
    if (mode === 'local') { await loadDb(); start(); return; }
    try {
      me = await api('me');
      await loadDb();
      start();
    } catch (e) {
      if (e.noApi || e instanceof TypeError) { mode = 'local'; await loadDb(); start(); }
      else showLogin();
    }
  }

  boot();
})();
