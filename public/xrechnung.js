// XRechnung 3.0 export: builds a UN/CEFACT Cross Industry Invoice (CII, D16B) XML document
// following EN 16931 and the German CIUS "XRechnung 3.0" (specification identifier
// urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0).
// Business terms (BT-xx) and rules (BR-xx / BR-DE-xx) are referenced in the comments.
(function () {
  const { TREATMENTS, isEU, cleanVat } = Rules;
  const { compute } = Render;

  const SPEC_ID = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
  const PROCESS_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

  // invoice type code (BT-3), restricted by BR-DE-17
  const TYPE_CODE = { invoice: '380', credit_note: '381', self_billing: '389' };

  // UN/ECE Recommendation 20 unit codes (BT-130)
  const UNIT_CODE = { pc: 'H87', h: 'HUR', day: 'DAY', month: 'MON', flat: 'LS', km: 'KMT', word: 'D68', page: 'ZP' };

  // VAT category (BT-151 / BT-118) + exemption reason code (BT-121) per tax treatment
  function category(treatment, rate) {
    switch (treatment) {
      case 'domestic': return +rate > 0 ? { code: 'S' } : { code: 'Z' };
      case 'small': return { code: 'E' };                                   // § 19 UStG – reason text required (BR-E-10)
      case 'rc_eu_services': return { code: 'AE', reasonCode: 'VATEX-EU-AE', reason: 'Reverse charge' };
      case 'ic_goods': return { code: 'K', reasonCode: 'VATEX-EU-IC', reason: 'Intra-community supply' };
      case 'export_goods': return { code: 'G', reasonCode: 'VATEX-EU-G', reason: 'Export outside the EU' };
      case 'export_services':
      case 'non_eu_sender':
      case 'not_registered':
      default: return { code: 'O', reasonCode: 'VATEX-EU-O', reason: 'Not subject to VAT' };
    }
  }

  const x = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const amt = n => (Math.round((+n + Number.EPSILON) * 100) / 100).toFixed(2);
  const dec = (n, max = 4) => { const s = (+n).toFixed(max).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };
  const d102 = iso => String(iso || '').replace(/-/g, '');
  const dt = (tag, iso, ns = 'udt') => `<ram:${tag}><${ns}:DateTimeString format="102">${d102(iso)}</${ns}:DateTimeString></ram:${tag}>`;
  const iban = s => String(s || '').replace(/\s+/g, '').toUpperCase();
  const addDays = Render.addDays;

  function monthRange(ym) { return Render.monthRange(ym); }

  // BT-73/74 invoicing period, or BT-72 actual delivery date
  function deliveryInfo(inv) {
    switch (inv.serviceMode) {
      case 'period': return { period: [inv.periodFrom, inv.periodTo] };
      case 'month': return inv.month ? { period: monthRange(inv.month) } : { date: inv.date };
      case 'date': return { date: inv.serviceDate || inv.date };
      default: return { date: inv.date };
    }
  }

  function noteText(inv, s, r) {
    const t = TREATMENTS[inv.treatment];
    const n = t && t.note(s, r);
    if (!n) return '';
    const lang = (inv.lang || 'en').split('-')[0];
    return n[lang] || n.en || n.de || '';
  }

  // What is missing for a valid XRechnung. Returns a list of { level, msg } like Rules.checkInvoice.
  function check(inv, s, r) {
    const out = [];
    const add = (level, msg) => out.push({ level, msg });
    if (!TYPE_CODE[inv.docType]) { add('error', 'XRechnung is only available for invoices, credit notes and self-billing invoices (not for pro-formas or quotations).'); return out; }
    if (!s || !r) { add('error', 'Choose sender and client.'); return out; }
    if ((inv.currency || 'EUR') !== 'EUR') add('error', 'XRechnung export supports EUR invoices only.');
    if (!inv.number) add('error', 'Invoice number missing.');
    if (!s.name || !s.street || !s.zip || !s.city) add('error', 'Sender: name, street, postcode and city are required (BR-DE-3, BR-DE-4).');
    if (!r.name || !r.zip || !r.city) add('error', 'Client: name, postcode and city are required (BR-DE-8, BR-DE-9).');
    if (!s.email) add('error', 'Sender email is required (seller contact email BT-43 and electronic address BT-34, BR-DE-7).');
    if (!s.phone || (String(s.phone).match(/\d/g) || []).length < 3) add('error', 'Sender phone number is required (seller contact telephone BT-42, BR-DE-6).');
    if (s.country === 'OTHER' || r.country === 'OTHER') add('error', 'Sender and client need a specific country (ISO code) for XRechnung.');
    if (!r.email) add('error', 'Client email is required (buyer electronic address BT-49, mandatory since XRechnung 3.0).');
    if (!iban(s.iban)) add('error', 'Sender IBAN is required (payment instructions BG-16, BR-DE-1).');
    const cat = category(inv.treatment, 0).code;
    const sVat = cleanVat(s.vatId), sTax = (s.taxNo || '').trim();
    if (['AE', 'K', 'G'].includes(cat) && !sVat) add('error', `Sender VAT ID is required for VAT category ${cat} (BR-${cat === 'K' ? 'IC' : cat}-02).`);
    if (cat === 'AE' && !cleanVat(r.vatId)) add('error', 'Client VAT ID is required for reverse charge (BR-AE-02).');
    if (cat === 'K' && !cleanVat(r.vatId)) add('error', 'Client VAT ID is required for an intra-community supply (BR-IC-02).');
    if (!sVat && !sTax) add('error', 'Sender needs a VAT ID or tax number (BR-DE-16).');
    if (inv.docType === 'credit_note' && !inv.refNumber) add('error', 'Credit note: original invoice number is required.');
    if (!inv.lines.some(l => l.desc)) add('error', 'At least one line with a description is required.');
    if (inv.lines.some(l => (+l.price || 0) < 0)) add('error', 'Negative unit prices are not allowed in XRechnung (BR-27). Use a credit note instead.');
    if (!r.leitwegId && r.kind === 'company' && /stadt|gemeinde|kreis|amt|behörde|ministerium|land |bund/i.test(r.name || ''))
      add('warn', 'Public-sector client? Add their Leitweg-ID in the client record (used as BuyerReference BT-10).');
    return out;
  }

  function party(p, role, opts) {
    const vat = cleanVat(p.vatId);
    const tax = (p.taxNo || '').trim();
    const L = [];
    L.push(`<ram:${role}>`);
    // BT-29 seller identifier: only used as fallback so that BR-CO-26 (BT-29, BT-30 or BT-31) holds
    if (role === 'SellerTradeParty' && opts.sellerId) L.push(`<ram:ID>${x(opts.sellerId)}</ram:ID>`);
    L.push(`<ram:Name>${x(p.name)}</ram:Name>`);
    if (role === 'SellerTradeParty' && p.registerNo) {
      L.push(`<ram:SpecifiedLegalOrganization><ram:ID>${x([p.registerCourt, p.registerNo].filter(Boolean).join(' '))}</ram:ID>` +
        (p.short && p.short !== p.name ? `<ram:TradingBusinessName>${x(p.short)}</ram:TradingBusinessName>` : '') + `</ram:SpecifiedLegalOrganization>`);
    }
    if (role === 'SellerTradeParty') {
      // BG-6 seller contact (BR-DE-2, BR-DE-5/6/7)
      L.push(`<ram:DefinedTradeContact><ram:PersonName>${x(p.contact || p.name)}</ram:PersonName>` +
        `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${x(p.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` +
        `<ram:EmailURIUniversalCommunication><ram:URIID>${x(p.email)}</ram:URIID></ram:EmailURIUniversalCommunication></ram:DefinedTradeContact>`);
    } else if (p.contact) {
      L.push(`<ram:DefinedTradeContact><ram:PersonName>${x(p.contact)}</ram:PersonName></ram:DefinedTradeContact>`);
    }
    const country = p.country && p.country !== 'OTHER' ? p.country : '';
    L.push(`<ram:PostalTradeAddress>` +
      (p.zip ? `<ram:PostcodeCode>${x(p.zip)}</ram:PostcodeCode>` : '') +
      (p.street ? `<ram:LineOne>${x(p.street)}</ram:LineOne>` : '') +
      (p.street2 ? `<ram:LineTwo>${x(p.street2)}</ram:LineTwo>` : '') +
      `<ram:CityName>${x(p.city)}</ram:CityName><ram:CountryID>${x(country || 'DE')}</ram:CountryID></ram:PostalTradeAddress>`);
    if (p.email) L.push(`<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(p.email)}</ram:URIID></ram:URIUniversalCommunication>`);
    if (vat && !opts.noVat) L.push(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(vat)}</ram:ID></ram:SpecifiedTaxRegistration>`);
    if (role === 'SellerTradeParty' && tax && tax !== vat) L.push(`<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(tax)}</ram:ID></ram:SpecifiedTaxRegistration>`);
    L.push(`</ram:${role}>`);
    return L.join('');
  }

  // Build the XML. inv = the invoice record, s = supplier (seller), r = client (buyer).
  // For self-billing (389) the seller is still the supplier; the buyer issued the document.
  function build(inv, s, r) {
    const type = TYPE_CODE[inv.docType];
    const c = compute(inv);
    const sign = c.sign; // credit notes are computed negative; CII 381 carries positive amounts
    const cur = inv.currency || 'EUR';
    const reasonText = noteText(inv, s, r);

    // lines + VAT breakdown per category/rate
    const groups = {};
    const lineXml = c.lines.map((l, i) => {
      const qty = +l.qty || 0, price = +l.price || 0, disc = +l.disc || 0;
      const gross = Math.round(qty * price * 100) / 100;
      const net = sign * l.net;
      const allowance = Math.round((gross - net) * 100) / 100;
      const cat = category(inv.treatment, l.rate);
      const key = cat.code + '|' + l.rate;
      groups[key] = groups[key] || { cat, rate: l.rate, base: 0 };
      groups[key].base = Math.round((groups[key].base + net) * 100) / 100;
      return `<ram:IncludedSupplyChainTradeLineItem>` +
        `<ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>` +
        `<ram:SpecifiedTradeProduct>${l.code ? `<ram:SellerAssignedID>${x(l.code)}</ram:SellerAssignedID>` : ''}<ram:Name>${x(l.desc)}</ram:Name>${l.details ? `<ram:Description>${x(l.details)}</ram:Description>` : ''}</ram:SpecifiedTradeProduct>` +
        `<ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${dec(price)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>` +
        `<ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${UNIT_CODE[l.unit] || 'C62'}">${dec(qty)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>` +
        `<ram:SpecifiedLineTradeSettlement>` +
          `<ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat.code}</ram:CategoryCode>${cat.code === 'O' ? '' /* BR-O-05 */ : `<ram:RateApplicablePercent>${dec(l.rate, 2)}</ram:RateApplicablePercent>`}</ram:ApplicableTradeTax>` +
          (disc && allowance ? `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:CalculationPercent>${dec(disc, 2)}</ram:CalculationPercent><ram:BasisAmount>${amt(gross)}</ram:BasisAmount><ram:ActualAmount>${amt(allowance)}</ram:ActualAmount><ram:ReasonCode>95</ram:ReasonCode><ram:Reason>Discount</ram:Reason></ram:SpecifiedTradeAllowanceCharge>` : '') +
          `<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(net)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>` +
        `</ram:SpecifiedLineTradeSettlement>` +
        `</ram:IncludedSupplyChainTradeLineItem>`;
    }).join('');

    let lineTotal = 0, taxTotal = 0;
    const taxXml = Object.values(groups).sort((a, b) => b.rate - a.rate).map(g => {
      const v = Math.round((g.base * g.rate / 100 + Number.EPSILON) * 100) / 100;   // BR-CO-17
      lineTotal = Math.round((lineTotal + g.base) * 100) / 100;
      taxTotal = Math.round((taxTotal + v) * 100) / 100;
      const reason = g.cat.code === 'E' ? (reasonText || 'Steuerbefreit') : g.cat.reason;
      const withReason = !['S', 'Z'].includes(g.cat.code);
      return `<ram:ApplicableTradeTax>` +
        `<ram:CalculatedAmount>${amt(v)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>` +
        (withReason && reason ? `<ram:ExemptionReason>${x(reason)}</ram:ExemptionReason>` : '') +
        `<ram:BasisAmount>${amt(g.base)}</ram:BasisAmount><ram:CategoryCode>${g.cat.code}</ram:CategoryCode>` +
        (withReason && g.cat.reasonCode ? `<ram:ExemptionReasonCode>${g.cat.reasonCode}</ram:ExemptionReasonCode>` : '') +
        `<ram:RateApplicablePercent>${dec(g.rate, 2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`;   // BR-DE-14 (also for O)
    }).join('');
    const grand = Math.round((lineTotal + taxTotal) * 100) / 100;

    // seller identification: BR-CO-26 needs BT-29, BT-30 or BT-31. Category O must not carry VAT IDs (BR-O-02).
    const catCodes = new Set(Object.values(groups).map(g => g.cat.code));
    const noVat = catCodes.has('O');
    const sVat = cleanVat(s.vatId);
    const sellerId = (noVat || !sVat) && !s.registerNo ? (noVat ? (sVat || s.taxNo || '') : (s.taxNo || '')) : '';

    const notes = [];
    if (reasonText) notes.push(reasonText);
    if (inv.docType === 'self_billing') notes.push('Gutschrift / self-billing invoice issued by the buyer (§ 14 Abs. 2 Satz 2 UStG, Art. 224 Directive 2006/112/EC).');
    if (inv.intro) notes.push(inv.intro);
    if (inv.notes) notes.push(inv.notes);
    const reg = [s.registerCourt && s.registerNo ? `${s.registerCourt} ${s.registerNo}` : '', s.director ? `Geschäftsführer: ${s.director}` : ''].filter(Boolean).join(', ');
    const notesXml = notes.map(n => `<ram:IncludedNote><ram:Content>${x(n)}</ram:Content></ram:IncludedNote>`).join('') +
      (reg ? `<ram:IncludedNote><ram:Content>${x(reg)}</ram:Content><ram:SubjectCode>REG</ram:SubjectCode></ram:IncludedNote>` : '');

    const del = deliveryInfo(inv);
    const due = +inv.dueDays > 0 ? addDays(inv.date, inv.dueDays) : '';
    const terms = due ? `Payable without deduction by ${due}.` : 'Payable immediately without deduction.';
    const shipTo = catCodes.has('K')   // BR-IC-12: deliver-to country required for intra-community supplies
      ? `<ram:ShipToTradeParty><ram:Name>${x(r.name)}</ram:Name><ram:PostalTradeAddress>${r.zip ? `<ram:PostcodeCode>${x(r.zip)}</ram:PostcodeCode>` : ''}${r.street ? `<ram:LineOne>${x(r.street)}</ram:LineOne>` : ''}<ram:CityName>${x(r.city)}</ram:CityName><ram:CountryID>${x(r.country)}</ram:CountryID></ram:PostalTradeAddress></ram:ShipToTradeParty>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext>
<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${PROCESS_ID}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${SPEC_ID}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
</rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>
<ram:ID>${x(inv.number)}</ram:ID>
<ram:TypeCode>${type}</ram:TypeCode>
${dt('IssueDateTime', inv.date)}
${notesXml}
</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>
${lineXml}
<ram:ApplicableHeaderTradeAgreement>
<ram:BuyerReference>${x((r.leitwegId || '').trim() || 'n/a')}</ram:BuyerReference>
${party(s, 'SellerTradeParty', { sellerId, noVat })}
${party(r, 'BuyerTradeParty', { noVat })}
${inv.clientRef ? `<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>${x(inv.clientRef)}</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>` : ''}
</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>
${shipTo}${del.date ? `<ram:ActualDeliverySupplyChainEvent>${dt('OccurrenceDateTime', del.date)}</ram:ActualDeliverySupplyChainEvent>` : ''}
</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement>
<ram:PaymentReference>${x(inv.number)}</ram:PaymentReference>
<ram:InvoiceCurrencyCode>${x(cur)}</ram:InvoiceCurrencyCode>
<ram:SpecifiedTradeSettlementPaymentMeans>
<ram:TypeCode>58</ram:TypeCode>
<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(iban(s.iban))}</ram:IBANID><ram:AccountName>${x(s.accountHolder || s.name)}</ram:AccountName></ram:PayeePartyCreditorFinancialAccount>
${s.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${x(String(s.bic).replace(/\s+/g, ''))}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
</ram:SpecifiedTradeSettlementPaymentMeans>
${taxXml}
${del.period ? `<ram:BillingSpecifiedPeriod>${dt('StartDateTime', del.period[0])}${dt('EndDateTime', del.period[1])}</ram:BillingSpecifiedPeriod>` : ''}
<ram:SpecifiedTradePaymentTerms><ram:Description>${x(terms)}</ram:Description>${due ? dt('DueDateDateTime', due) : ''}</ram:SpecifiedTradePaymentTerms>
<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
<ram:LineTotalAmount>${amt(lineTotal)}</ram:LineTotalAmount>
<ram:TaxBasisTotalAmount>${amt(lineTotal)}</ram:TaxBasisTotalAmount>
<ram:TaxTotalAmount currencyID="${x(cur)}">${amt(taxTotal)}</ram:TaxTotalAmount>
<ram:GrandTotalAmount>${amt(grand)}</ram:GrandTotalAmount>
<ram:DuePayableAmount>${amt(grand)}</ram:DuePayableAmount>
</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
${inv.docType === 'credit_note' && inv.refNumber ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${x(inv.refNumber)}</ram:IssuerAssignedID>${inv.refDate ? dt('FormattedIssueDateTime', inv.refDate, 'qdt') : ''}</ram:InvoiceReferencedDocument>` : ''}
</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`.replace(/^\s*\n/gm, '');
  }

  const fileName = inv => `${String(inv.number || 'invoice').replace(/[\/\\:*?"<>|\s]+/g, '_')}_xrechnung.xml`;

  window.XRechnung = { build, check, fileName, category, SPEC_ID };
})();
