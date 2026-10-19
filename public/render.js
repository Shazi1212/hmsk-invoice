// Turns an invoice + its parties into the printable A4 sheet (HTML string).
(function () {
  const { makeL } = I18N;
  const { TREATMENTS, COUNTRIES, COUNTRY_NAMES, senderLegalLines, isBusiness } = Rules;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = s => esc(s).replace(/\n/g, '<br>');
  const round2 = n => (Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100) || 0; // half away from zero, so credit notes mirror invoices
  const LOCALE = { de: 'de-DE', pt: 'pt-PT', en: 'en-IE' };

  function money(n, cur, lang, maxDigits = 2) {
    return new Intl.NumberFormat(LOCALE[lang] || 'de-DE', { style: 'currency', currency: cur || 'EUR', minimumFractionDigits: 2, maximumFractionDigits: maxDigits }).format(n);
  }
  function num(n, lang, max = 2) {
    return new Intl.NumberFormat(LOCALE[lang] || 'de-DE', { maximumFractionDigits: max }).format(n);
  }
  function fmtDate(iso, lang) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return lang === 'de' ? `${d}.${m}.${y}` : `${d}/${m}/${y}`;
  }
  function addDays(iso, days) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + (+days || 0));
    return d.toISOString().slice(0, 10);
  }
  function monthRange(ym) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`];
  }

  // Totals per VAT rate. Line net = qty * price * (1 - disc%). VAT is computed per rate group (EU practice).
  function compute(inv) {
    const sign = inv.docType === 'credit_note' ? -1 : 1;
    const groups = {};
    const lines = inv.lines.map(l => {
      const qty = +l.qty || 0, price = +l.price || 0, disc = +l.disc || 0;
      const net = round2(sign * qty * price * (1 - disc / 100));
      const rate = +l.vat || 0;
      groups[rate] = groups[rate] || { base: 0, vat: 0 };
      groups[rate].base = round2(groups[rate].base + net);
      return { ...l, net, rate };
    });
    let net = 0, vat = 0;
    for (const [rate, g] of Object.entries(groups)) {
      g.vat = round2(g.base * (+rate) / 100);
      net = round2(net + g.base);
      vat = round2(vat + g.vat);
    }
    return { lines, groups, net, vat, total: round2(net + vat), sign };
  }

  function serviceText(inv, L, lang) {
    switch (inv.serviceMode) {
      case 'date': return [L('serviceDate'), fmtDate(inv.serviceDate, lang)];
      case 'period': return [L('servicePeriod'), `${fmtDate(inv.periodFrom, lang)} – ${fmtDate(inv.periodTo, lang)}`];
      case 'month': {
        if (!inv.month) return [L('servicePeriod'), ''];
        const [a, b] = monthRange(inv.month);
        return [L('servicePeriod'), `${fmtDate(a, lang)} – ${fmtDate(b, lang)}`];
      }
      default: return [L('serviceDate'), fmtDate(inv.date, lang)];
    }
  }

  function countryName(c, lang) {
    return (COUNTRY_NAMES[lang] || {})[c] || COUNTRIES[c] || c;
  }

  function addressLines(p, lang, showCountry) {
    if (!p) return [];
    const out = [];
    out.push(`<strong>${esc(p.name)}</strong>`);
    if (p.contact) out.push(esc(p.contact));
    if (p.street) out.push(esc(p.street));
    if (p.street2) out.push(esc(p.street2));
    if (p.zip || p.city) out.push(esc([p.zip, p.city].filter(Boolean).join(' ')));
    if (showCountry && p.country && p.country !== 'OTHER') out.push(esc(countryName(p.country, lang)));
    return out;
  }

  function idLines(p, L) {
    const out = [];
    if (!p) return out;
    if (p.vatId) out.push(`${L('vatId')}: ${esc(p.vatId)}`);
    if (p.taxNo && p.taxNo !== p.vatId) out.push(`${L('taxNo')}: ${esc(p.taxNo)}`);
    return out;
  }

  // opts.madeWith = { url } adds one small "Created with HMSK Invoice" line in the bottom margin
  // (hosted copy only, opt-out in the app). It is positioned absolutely, so it never moves the layout.
  function render(inv, s, r, opts = {}) {
    const lang = inv.lang || 'en';
    const L = makeL(lang);
    const pl = L.primary;
    const cur = inv.currency || 'EUR';
    const c = compute(inv);
    const selfBill = inv.docType === 'self_billing';
    const issuer = selfBill ? r : s;          // whose letterhead
    const addressee = selfBill ? s : r;       // who receives the document
    const accent = (issuer && issuer.accent) || '#111111';
    if (!s || !r) return `<div class="empty-sheet">Choose a sender and a client to see the invoice.</div>`;

    const titleKey = { invoice: 'invoice', proforma: 'proforma', quote: 'quote', credit_note: 'credit_note', self_billing: 'self_billing' }[inv.docType] || 'invoice';
    const isQuote = inv.docType === 'quote';
    const showDisc = inv.showDiscount || inv.lines.some(l => +l.disc);
    const multiRate = Object.keys(c.groups).length > 1 || Object.keys(c.groups).some(r => +r > 0);

    // header
    const logo = inv.showLogo !== false && issuer.logo
      ? `<img class="iv-logo" src="${issuer.logo}" alt="">`
      : `<div class="iv-logotext">${esc(issuer.short || issuer.name)}</div>`;
    const returnLine = [issuer.name, issuer.street, [issuer.zip, issuer.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');

    // meta
    const meta = [];
    meta.push([isQuote ? L('quoteNumber') : L('number'), `<strong>${esc(inv.number || '—')}</strong>`]);
    meta.push([isQuote ? L('quoteDate') : L('date'), fmtDate(inv.date, pl)]);
    if (!isQuote) { const [k, v] = serviceText(inv, L, pl); meta.push([k, v]); }
    if (inv.docType === 'credit_note' && inv.refNumber) meta.push([L('refInvoice'), `${esc(inv.refNumber)}${inv.refDate ? ' · ' + fmtDate(inv.refDate, pl) : ''}`]);
    if (isQuote) meta.push([L('validUntil'), fmtDate(addDays(inv.date, inv.dueDays || 30), pl)]);
    else if (inv.docType !== 'credit_note' && +inv.dueDays > 0) meta.push([L('dueDate'), fmtDate(addDays(inv.date, inv.dueDays), pl)]);
    if (r.customerNo) meta.push([L('customerNo'), esc(r.customerNo)]);
    if (inv.clientRef) meta.push([L('yourRef'), esc(inv.clientRef)]);

    // addressee ids (customer VAT ID is mandatory for reverse charge, useful always for B2B)
    const addrIds = isBusiness(addressee) ? idLines(addressee, L) : [];
    if (addressee.kind === 'freelancer' && addressee.showDob && addressee.dob) addrIds.push(`${L('dob')}: ${esc(addressee.dob)}`);
    const showCountry = addressee.country !== issuer.country;

    // self-billing: show the other party block too
    let partyBlock = '';
    if (selfBill) {
      partyBlock = `<div class="iv-sb">
        <div><div class="iv-lbl">${L('supplier')}</div>${addressLines(s, pl, true).join('<br>')}<br>${idLines(s, L).join('<br>')}</div>
        <div><div class="iv-lbl">${L('issuedBy')}</div>${addressLines(r, pl, true).join('<br>')}<br>${idLines(r, L).join('<br>')}</div>
      </div>`;
    }

    // lines
    const head = `<tr>
      <th class="c-pos">${L('pos', {}, true)}</th>
      <th class="c-desc">${L('description')}</th>
      <th class="c-num">${L('qty')}</th>
      <th class="c-num">${L('unitPrice')}</th>
      ${showDisc ? `<th class="c-num">${L('discount')}</th>` : ''}
      ${multiRate ? `<th class="c-num">${L('vat')}</th>` : ''}
      <th class="c-num">${multiRate ? L('amount') : L('amountGross')}</th>
    </tr>`;
    const rows = c.lines.map((l, i) => `<tr>
      <td class="c-pos">${i + 1}</td>
      <td class="c-desc">${l.code ? `<span class="iv-code">${esc(l.code)}</span> ` : ''}${esc(l.desc)}${l.details ? `<div class="iv-details">${nl2br(l.details)}</div>` : ''}</td>
      <td class="c-num">${num(+l.qty || 0, pl, 3)} ${esc(L.unit(l.unit, true))}</td>
      <td class="c-num">${money(+l.price || 0, cur, pl, 4)}</td>
      ${showDisc ? `<td class="c-num">${+l.disc ? num(+l.disc, pl) + ' %' : ''}</td>` : ''}
      ${multiRate ? `<td class="c-num">${num(l.rate, pl)} %</td>` : ''}
      <td class="c-num">${money(l.net, cur, pl)}</td>
    </tr>`).join('');

    // totals
    const tot = [];
    tot.push(`<tr><td>${L('subtotal')}</td><td>${money(c.net, cur, pl)}</td></tr>`);
    for (const [rate, g] of Object.entries(c.groups).sort((a, b) => b[0] - a[0])) {
      tot.push(`<tr><td>${L('vatOn', { r: num(+rate, pl) }, true)} ${money(g.base, cur, pl)}</td><td>${money(g.vat, cur, pl)}</td></tr>`);
    }
    tot.push(`<tr class="iv-grand"><td>${inv.docType === 'credit_note' ? L('totalCredit') : L('total')}</td><td>${money(c.total, cur, pl)}</td></tr>`);
    if (cur !== 'EUR' && c.vat && inv.fxRate) tot.push(`<tr><td>${L('vatEur')} (1 EUR = ${esc(inv.fxRate)} ${cur})</td><td>${money(c.vat / +inv.fxRate, 'EUR', pl)}</td></tr>`);

    // legal notes
    const notes = [];
    const tnote = TREATMENTS[inv.treatment]?.note(s, r);
    const pickLangs = obj => [...new Set(L.parts.map(p => obj[p] || obj.en))].filter(Boolean);
    if (tnote) notes.push(...pickLangs(tnote).map(t => `<strong>${esc(t)}</strong>`));
    if (selfBill) notes.push(`<strong>${esc(L('selfBillNote'))}</strong>`);
    if (inv.docType === 'proforma') notes.push(`<strong>${esc(L('proformaNote'))}</strong>`);
    if (isQuote) notes.push(esc(L('quoteNote')));
    if (inv.docType === 'credit_note' && inv.refNumber) notes.push(esc(L('creditNoteRef', { n: inv.refNumber, d: fmtDate(inv.refDate, pl) })));
    if (s.country === 'PT' && L.parts.includes('pt') && inv.serviceMode === 'same' && !isQuote) notes.push(esc(T_pt('availableNote')));
    if (inv.notes) notes.push(nl2br(inv.notes));

    // payment
    let pay = '';
    if (!isQuote && inv.docType !== 'credit_note' && s.iban) {
      const due = +inv.dueDays > 0 ? L('dueBy', { d: fmtDate(addDays(inv.date, inv.dueDays), pl) }) : L('dueNow');
      pay = `<div class="iv-pay">
        <div class="iv-lbl">${L('payment')}</div>
        <div>${esc(selfBill ? L('payToSupplier') : L('bankTransfer'))}</div>
        <table>
          <tr><td>${L('accountHolder')}</td><td>${esc(s.accountHolder || s.name)}</td></tr>
          ${s.bank ? `<tr><td>${L('bank')}</td><td>${esc(s.bank)}${s.bankAddress ? ', ' + esc(s.bankAddress) : ''}</td></tr>` : ''}
          <tr><td>${L('iban')}</td><td><strong>${esc(s.iban)}</strong></td></tr>
          ${s.bic ? `<tr><td>${L('bic')}</td><td>${esc(s.bic)}</td></tr>` : ''}
          <tr><td>${L('purpose')}</td><td>${esc(inv.number)}</td></tr>
        </table>
        <div class="iv-due">${esc(due)}</div>
      </div>`;
    }

    // footer (issuer)
    const legal = senderLegalLines(issuer, L);
    const fcol1 = [`<strong>${esc(issuer.name)}</strong>`, esc(issuer.street), esc([issuer.zip, issuer.city].filter(Boolean).join(' ')), esc(countryName(issuer.country, pl))];
    const fcol2 = [issuer.phone && `${L('phone', {}, true)} ${esc(issuer.phone)}`, issuer.email && esc(issuer.email), issuer.website && esc(issuer.website)];
    const fcol3 = [...idLines(issuer, L), ...legal.map(esc)];
    const fcol4 = selfBill ? [] : [issuer.bank && esc(issuer.bank), issuer.iban && `IBAN ${esc(issuer.iban)}`, issuer.bic && `BIC ${esc(issuer.bic)}`];
    const fcol = a => `<div>${a.filter(Boolean).join('<br>')}</div>`;

    const watermark = inv.docType === 'proforma' ? `<div class="iv-watermark">PRO-FORMA</div>` : (inv.status === 'draft' || !inv.status) && inv.showDraftMark ? `<div class="iv-watermark">DRAFT</div>` : '';

    return `
    <div class="iv" style="--accent:${esc(accent)}">
      ${watermark}
      <div class="iv-head">
        <div class="iv-brand">${logo}</div>
        <div class="iv-title">
          <h1 class="${L(titleKey).length > 22 ? 'long' : ''}">${esc(L(titleKey))}</h1>
          <div class="iv-titleno">${esc(inv.number || '')}</div>
        </div>
      </div>
      <div class="iv-bar"></div>
      <div class="iv-top">
        <div class="iv-addr">
          <div class="iv-return">${esc(returnLine)}</div>
          ${addressLines(addressee, pl, showCountry).join('<br>')}
          ${addrIds.length ? `<div class="iv-ids">${addrIds.join('<br>')}</div>` : ''}
          ${addressee.email ? `<div class="iv-ids">${esc(addressee.email)}</div>` : ''}
        </div>
        <table class="iv-meta">${meta.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      </div>
      ${partyBlock}
      ${inv.intro ? `<div class="iv-intro">${nl2br(inv.intro)}</div>` : ''}
      <table class="iv-lines"><thead>${head}</thead><tbody>${rows || `<tr><td colspan="7" class="iv-none">—</td></tr>`}</tbody></table>
      <div class="iv-sum">
        <div class="iv-notes">${notes.map(n => `<p>${n}</p>`).join('')}</div>
        <table class="iv-totals">${tot.join('')}</table>
      </div>
      ${pay}
      ${selfBill ? '' : `<div class="iv-closing">${nl2br(issuer.closing || L('greeting'))}</div>`}
      <div class="iv-spacer"></div>
      <div class="iv-foot">${fcol(fcol1)}${fcol(fcol2)}${fcol(fcol3)}${fcol(fcol4)}</div>
      ${madeWithLine(opts.madeWith, pl)}
    </div>`;
  }

  function madeWithLine(mw, lang) {
    const url = mw && String(mw.url || '');
    if (!url || !/^https?:\/\//i.test(url)) return '';
    return `<div class="iv-made"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(makeL(lang)('madeWith'))}</a></div>`;
  }

  function T_pt(key) { return I18N.T[key].pt; }

  window.Render = { render, compute, fmtDate, addDays, monthRange, money, esc };
})();
