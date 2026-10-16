// Tax treatment + mandatory-field rules for DE, PT, other EU and non-EU parties.
// Legal sources are cited in the notes printed on the invoice and in the checks shown in the editor.
// This is guidance built into the tool, not tax advice: unusual cases (construction § 13b, OSS,
// margin schemes, Kleinunternehmer turnover limits) still need the tax adviser.

const EU = ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'];
const VAT_PREFIX = { GR: 'EL' }; // Greece uses EL in VAT numbers

const COUNTRIES = {
  DE: 'Germany', PT: 'Portugal', AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus',
  CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France', GR: 'Greece', HU: 'Hungary',
  IE: 'Ireland', IT: 'Italy', LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands',
  PL: 'Poland', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia', ES: 'Spain', SE: 'Sweden',
  CH: 'Switzerland', GB: 'United Kingdom', NO: 'Norway', US: 'United States', CA: 'Canada', AE: 'United Arab Emirates',
  PK: 'Pakistan', IN: 'India', TR: 'Türkiye', AU: 'Australia', SA: 'Saudi Arabia', QA: 'Qatar', CN: 'China', OTHER: 'Other country',
};
const COUNTRY_NAMES = {
  de: { DE: 'Deutschland', PT: 'Portugal', IT: 'Italien', BG: 'Bulgarien', AT: 'Österreich', FR: 'Frankreich', ES: 'Spanien', NL: 'Niederlande', BE: 'Belgien', PL: 'Polen', CH: 'Schweiz', GB: 'Vereinigtes Königreich', US: 'USA', LT: 'Litauen', PK: 'Pakistan', AE: 'Vereinigte Arabische Emirate', TR: 'Türkei', DK: 'Dänemark', SE: 'Schweden', GR: 'Griechenland', IE: 'Irland', RO: 'Rumänien', CZ: 'Tschechien', HU: 'Ungarn', LU: 'Luxemburg' },
  pt: { DE: 'Alemanha', PT: 'Portugal', IT: 'Itália', BG: 'Bulgária', AT: 'Áustria', FR: 'França', ES: 'Espanha', NL: 'Países Baixos', BE: 'Bélgica', PL: 'Polónia', CH: 'Suíça', GB: 'Reino Unido', US: 'EUA', LT: 'Lituânia', PK: 'Paquistão' },
};

// VAT rates offered in the line-item dropdown, by the country whose VAT applies.
const VAT_RATES = {
  DE: [19, 7, 0], PT: [23, 13, 6, 0], 'PT-MA': [22, 12, 4, 0], 'PT-AC': [16, 9, 4, 0],
  AT: [20, 13, 10, 0], BE: [21, 12, 6, 0], BG: [20, 9, 0], HR: [25, 13, 5, 0], CY: [19, 9, 5, 0], CZ: [21, 12, 0],
  DK: [25, 0], EE: [24, 13, 9, 0], FI: [25.5, 14, 10, 0], FR: [20, 10, 5.5, 2.1, 0], GR: [24, 13, 6, 0],
  HU: [27, 18, 5, 0], IE: [23, 13.5, 9, 0], IT: [22, 10, 5, 4, 0], LV: [21, 12, 5, 0], LT: [21, 9, 5, 0],
  LU: [17, 14, 8, 3, 0], MT: [18, 7, 5, 0], NL: [21, 9, 0], PL: [23, 8, 5, 0], RO: [21, 11, 0], SK: [23, 19, 5, 0],
  SI: [22, 9.5, 5, 0], ES: [21, 10, 4, 0], SE: [25, 12, 6, 0],
};

const isEU = c => EU.includes(c);
const isBusiness = p => p && (p.kind === 'company' || p.kind === 'freelancer');

// Light format checks for the most common VAT/tax numbers.
const VAT_FORMATS = {
  DE: /^DE\d{9}$/, PT: /^PT\d{9}$/, IT: /^IT\d{11}$/, BG: /^BG\d{9,10}$/, AT: /^ATU\d{8}$/, FR: /^FR[0-9A-Z]{2}\d{9}$/,
  ES: /^ES[0-9A-Z]\d{7}[0-9A-Z]$/, NL: /^NL\d{9}B\d{2}$/, BE: /^BE[01]\d{9}$/, PL: /^PL\d{10}$/, LT: /^LT(\d{9}|\d{12})$/,
  EL: /^EL\d{9}$/, RO: /^RO\d{2,10}$/, CZ: /^CZ\d{8,10}$/, IE: /^IE\d{7}[A-W][A-I]?$|^IE\d[A-Z+*]\d{5}[A-W]$/, LU: /^LU\d{8}$/,
  DK: /^DK\d{8}$/, SE: /^SE\d{12}$/, FI: /^FI\d{8}$/, HU: /^HU\d{8}$/, SK: /^SK\d{10}$/, SI: /^SI\d{8}$/, HR: /^HR\d{11}$/,
  CY: /^CY\d{8}[A-Z]$/, MT: /^MT\d{8}$/, EE: /^EE\d{9}$/, LV: /^LV\d{11}$/,
};
const cleanVat = v => (v || '').replace(/[\s.\-]/g, '').toUpperCase();
function vatFormatOk(country, vat) {
  const v = cleanVat(vat);
  if (!v) return false;
  const pre = VAT_PREFIX[country] || country;
  const re = VAT_FORMATS[pre];
  return re ? re.test(v) : true;
}

// Which country's VAT applies to the sender (Madeira / Azores have their own PT rates).
function senderVatZone(s) {
  if (s.country === 'PT' && s.ptRegion === 'MA') return 'PT-MA';
  if (s.country === 'PT' && s.ptRegion === 'AC') return 'PT-AC';
  return s.country;
}

// ---------------------------------------------------------------------------
// Tax treatments. Each one: when it applies, which VAT rates are allowed,
// and the legal note that must appear on the invoice (by language).
// ---------------------------------------------------------------------------
const TREATMENTS = {
  domestic: {
    label: 'Standard VAT (sender country rates)',
    zeroOnly: false,
    note: () => null,
  },
  small: {
    label: 'Small-business exemption (no VAT)',
    zeroOnly: true,
    note: s => s.country === 'DE' ? {
      de: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).',
      en: 'No VAT is charged: small business exemption under § 19 German VAT Act (UStG).',
      pt: 'IVA não liquidado: regime de pequenas empresas, § 19 UStG (Alemanha).',
    } : s.country === 'PT' ? {
      pt: 'IVA – regime de isenção (Art.º 53.º do CIVA).',
      en: 'VAT exempt – small business scheme, Article 53 Portuguese VAT Code (CIVA).',
      de: 'Umsatzsteuerbefreit – Kleinunternehmerregelung, Art. 53 CIVA (Portugal).',
    } : {
      en: 'VAT exempt – small enterprise scheme (Article 284 et seq. Council Directive 2006/112/EC).',
      de: 'Umsatzsteuerbefreit – Kleinunternehmerregelung (Art. 284 ff. MwSt-Systemrichtlinie).',
      pt: 'Isento de IVA – regime das pequenas empresas (Art.º 284.º e ss. Diretiva 2006/112/CE).',
    },
  },
  rc_eu_services: {
    label: 'EU B2B services – reverse charge (0%)',
    zeroOnly: true,
    note: () => ({
      de: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge) – die Leistung ist im Inland nicht steuerbar (§ 3a Abs. 2 UStG, § 13b UStG, Art. 196 MwSt-Systemrichtlinie).',
      en: 'Reverse charge: VAT to be accounted for by the recipient (Article 44 and 196 Council Directive 2006/112/EC).',
      pt: 'IVA – autoliquidação (Art.º 6.º n.º 6 alínea a) do CIVA; Art.º 196.º da Diretiva 2006/112/CE).',
    }),
  },
  ic_goods: {
    label: 'EU B2B goods – intra-community supply (0%)',
    zeroOnly: true,
    note: () => ({
      de: 'Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b i.V.m. § 6a UStG; Art. 138 MwSt-Systemrichtlinie).',
      en: 'VAT-exempt intra-community supply of goods (Article 138 Council Directive 2006/112/EC).',
      pt: 'Isento – transmissão intracomunitária de bens (Art.º 14.º do RITI).',
    }),
  },
  export_services: {
    label: 'Services to non-EU client – not taxable here (0%)',
    zeroOnly: true,
    note: s => ({
      de: 'Nicht im Inland steuerbare Leistung – Leistungsort beim Empfänger im Drittland (§ 3a Abs. 2 UStG).',
      en: 'Not subject to VAT in the supplier\'s country – place of supply is the recipient\'s country (Article 44 Council Directive 2006/112/EC).',
      pt: 'IVA – não sujeito; prestação de serviços localizada fora de Portugal (Art.º 6.º n.º 6 alínea a) do CIVA).',
    }),
  },
  export_goods: {
    label: 'Goods export outside the EU (0%)',
    zeroOnly: true,
    note: () => ({
      de: 'Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a i.V.m. § 6 UStG).',
      en: 'VAT-exempt export of goods (Article 146 Council Directive 2006/112/EC).',
      pt: 'Isento – exportação de bens (Art.º 14.º n.º 1 alínea a) do CIVA).',
    }),
  },
  non_eu_sender: {
    label: 'Supplier outside the EU – no EU VAT charged',
    zeroOnly: true,
    note: (s, r) => isEU(r.country) && isBusiness(r) ? {
      en: 'No VAT charged by the supplier. Reverse charge: VAT, if any, is to be accounted for by the recipient (Article 196 Council Directive 2006/112/EC).',
      de: 'Keine Umsatzsteuer ausgewiesen. Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG / Art. 196 MwSt-Systemrichtlinie).',
      pt: 'Sem IVA. Autoliquidação pelo adquirente (Art.º 196.º da Diretiva 2006/112/CE).',
    } : { en: 'No VAT charged – supplier is not established in the EU.', de: 'Keine Umsatzsteuer – Leistender ist nicht in der EU ansässig.', pt: 'Sem IVA – fornecedor não estabelecido na UE.' },
  },
  not_registered: {
    label: 'Supplier not VAT registered (no VAT)',
    zeroOnly: true,
    note: () => ({
      en: 'No VAT charged – the supplier is not registered for VAT.',
      de: 'Keine Umsatzsteuer – der Leistende ist nicht umsatzsteuerlich registriert.',
      pt: 'Sem IVA – o fornecedor não está registado para efeitos de IVA.',
    }),
  },
};

// Pick the legally expected treatment for sender -> recipient.
function recommendTreatment(s, r, supply /* 'services' | 'goods' */) {
  if (!s) return 'domestic';
  if (!r) return !isEU(s.country) ? 'non_eu_sender' : s.vatScheme === 'small' ? 'small' : s.vatScheme === 'none' ? 'not_registered' : 'domestic';
  if (!isEU(s.country)) return 'non_eu_sender';
  if (s.vatScheme === 'none') return 'not_registered';
  const cross = s.country !== r.country;
  const b2b = isBusiness(r);
  if (cross && isEU(r.country) && b2b) return supply === 'goods' ? (s.vatScheme === 'small' ? 'small' : 'ic_goods') : 'rc_eu_services';
  if (cross && !isEU(r.country)) return supply === 'goods' ? 'export_goods' : (b2b ? 'export_services' : (s.vatScheme === 'small' ? 'small' : 'domestic'));
  if (s.vatScheme === 'small') return 'small';
  return 'domestic';
}

function vatRatesFor(s, treatment) {
  if (!s) return [0];
  if (TREATMENTS[treatment]?.zeroOnly) return [0];
  return VAT_RATES[senderVatZone(s)] || [0];
}

// ---------------------------------------------------------------------------
// Checks: what the law requires on this invoice that is missing or wrong.
// level 'error' = invoice is not legally valid, 'warn' = should fix, 'info' = hint.
// ---------------------------------------------------------------------------
function checkInvoice(inv, s, r) {
  const out = [];
  const add = (level, msg, law) => out.push({ level, msg, law });
  if (!s) { add('error', 'Choose a sender (supplier).'); return out; }
  if (!r) { add('error', 'Choose a recipient (client).'); return out; }
  const t = inv.treatment;
  const de = s.country === 'DE', pt = s.country === 'PT';

  // Everyone: § 14 Abs. 4 UStG / Art. 226 VAT Directive / Art.º 36.º n.º 5 CIVA
  const addrOk = p => p.street && p.zip && p.city && p.country;
  if (!s.name || !addrOk(s)) add('error', 'Sender needs full name and address.', '§ 14 Abs. 4 Nr. 1 UStG / Art. 226(5) VAT Directive');
  if (!r.name || !addrOk(r)) add('error', 'Recipient needs full name and address.', '§ 14 Abs. 4 Nr. 1 UStG / Art. 226(5) VAT Directive');
  if (!inv.number) add('error', 'Invoice number missing (must be unique and sequential).', '§ 14 Abs. 4 Nr. 4 UStG / Art. 226(2)');
  if (!inv.date) add('error', 'Invoice date missing.', '§ 14 Abs. 4 Nr. 3 UStG');
  if (!inv.serviceMode || (inv.serviceMode === 'date' && !inv.serviceDate) || (inv.serviceMode === 'period' && (!inv.periodFrom || !inv.periodTo)))
    add('error', 'Delivery / service date or period is required.', '§ 14 Abs. 4 Nr. 6 UStG / Art. 226(7)');
  if (!inv.lines.length || inv.lines.some(l => !l.desc)) add('error', 'Every line needs a clear description of the goods or services.', '§ 14 Abs. 4 Nr. 5 UStG');

  // Sender tax id
  const sHasVat = !!cleanVat(s.vatId), sHasTax = !!(s.taxNo || '').trim();
  if (isEU(s.country) && !sHasVat && !sHasTax && !(de && s.kind === 'freelancer')) add('error', `Sender needs a tax number${de ? ' (Steuernummer)' : pt ? ' (NIF)' : ''} or VAT ID.`, '§ 14 Abs. 4 Nr. 2 UStG / Art. 226(3)');
  if (s.vatId && isEU(s.country) && !vatFormatOk(s.country, s.vatId)) add('warn', `Sender VAT ID "${s.vatId}" does not match the ${s.country} format.`);

  // Reverse charge / intra-community: both VAT IDs
  if (t === 'rc_eu_services' || t === 'ic_goods') {
    if (!sHasVat) add(t === 'ic_goods' ? 'error' : 'warn', 'Cross-border EU B2B: the sender should show its own VAT ID (USt-IdNr / NIF PT…). Needed for the recapitulative statement (ZM / Declaração Recapitulativa).', '§ 14a Abs. 1 UStG / Art. 226(4)');
    if (!cleanVat(r.vatId)) add(t === 'ic_goods' ? 'error' : 'warn', 'Recipient VAT ID missing. Without it you cannot prove the client is a business, so reverse charge may not apply. Verify it in VIES.', '§ 14a Abs. 1 UStG / Art. 18 Reg. 282/2011');
    else if (!vatFormatOk(r.country, r.vatId)) add('warn', `Recipient VAT ID "${r.vatId}" does not look like a valid ${r.country} VAT number (check the country prefix, verify in VIES).`);
    else add('info', 'Check the recipient VAT ID in VIES (ec.europa.eu/taxation_customs/vies) and keep the confirmation.');
  }
  if (t === 'rc_eu_services' && s.vatScheme === 'small' && de)
    add('info', 'Kleinunternehmer: EU B2B services are reported in the Zusammenfassende Meldung, which needs a USt-IdNr from the BZSt.', '§ 18a UStG');

  // Treatment sanity
  const rec = recommendTreatment(s, r, inv.supply);
  if (t !== rec) add('warn', `For this sender/recipient combination the usual treatment is "${TREATMENTS[rec].label}". You chose "${TREATMENTS[t]?.label}".`);
  if (TREATMENTS[t]?.zeroOnly && inv.lines.some(l => +l.vat > 0)) add('error', 'This tax treatment requires 0% VAT on every line.');
  if (t === 'domestic' && inv.lines.some(l => +l.vat === 0)) add('warn', 'A line has 0% VAT under standard taxation: state the exemption reason in the notes.', '§ 14 Abs. 4 Nr. 8 UStG / Art.º 36.º n.º 5 e) CIVA');

  // Germany
  if (de) {
    if (s.kind === 'company' && /GmbH|UG|AG|KG|e\.K\./i.test((s.legalForm || '') + ' ' + s.name)) {
      if (!s.registerCourt || !s.registerNo) add('warn', 'German companies must show Registergericht + Handelsregisternummer on business letters.', '§ 35a GmbHG / § 37a HGB');
      if (/GmbH|UG/i.test((s.legalForm || '') + s.name) && !s.director) add('warn', 'Name the Geschäftsführer (managing director) on GmbH/UG invoices.', '§ 35a GmbHG');
      if (/\bUG\b/.test(s.name + ' ' + (s.legalForm || '')) && !/haftungsbeschränkt/i.test(s.name + ' ' + (s.legalForm || '')))
        add('warn', 'UG must use the full legal form "UG (haftungsbeschränkt)".', '§ 5a Abs. 1 GmbHG');
    }
    if (inv.currency !== 'EUR' && t === 'domestic') add('warn', 'Invoice in foreign currency with German VAT: the VAT amount must also be shown in EUR.', '§ 16 Abs. 6 UStG');
    if (s.vatScheme === 'small' && t === 'domestic') add('error', 'Sender is a Kleinunternehmer (§ 19 UStG) and must not charge VAT.');
    if (r.country === 'DE' && isBusiness(r) && s.vatScheme === 'standard')
      add('info', 'Domestic B2B: since 2025 German businesses must be able to receive e-invoices; issuing them becomes mandatory from 2027 (turnover > €800k) / 2028 (all). Until then a PDF is fine; "XRechnung (XML)" already creates the e-invoice.', '§ 14 Abs. 1 UStG, § 27 Abs. 38 UStG');
  }

  // Portugal
  if (pt) {
    if (inv.docType === 'invoice' || inv.docType === 'credit_note')
      add('error', 'Portuguese invoices (Fatura, Fatura-Recibo, Nota de Crédito) must be issued with AT-certified software (ATCUD + QR code, SAF-T). Issue the legal Fatura with certified invoicing software or the Portal das Finanças and use this tool for pro-formas and quotations only.', 'DL 28/2019, Portaria 363/2010, Art.º 36.º CIVA');
    if (s.kind === 'company' && (!s.capital || !s.registry)) add('warn', 'Portuguese companies must show the share capital (capital social) and the registry office + registration number (Conservatória / NIPC).', 'Art.º 171.º Código das Sociedades Comerciais');
    if (!(s.taxNo || s.vatId)) add('error', 'NIF of the sender is required.', 'Art.º 36.º n.º 5 a) CIVA');
    if (isBusiness(r) && !(r.vatId || r.taxNo)) add('warn', 'Show the NIF / VAT number of the business client.', 'Art.º 36.º n.º 5 a) CIVA');
  }

  // Freelancer specifics
  if (s.kind === 'freelancer') {
    if (s.showDob) add('warn', 'Date of birth is not required on an invoice and is personal data – leave it off.', 'Art. 5(1)(c) GDPR (data minimisation)');
    if (de && !sHasTax && !sHasVat) add('error', 'Freelancer in Germany: the Steuernummer from the Finanzamt (or USt-IdNr) is mandatory on every invoice.', '§ 14 Abs. 4 Nr. 2 UStG');
  }

  // Self-billing
  if (inv.docType === 'self_billing') {
    if (!isBusiness(r)) add('error', 'Self-billing: the recipient (who issues the Gutschrift) must be a business.');
    add('info', 'Self-billing (Gutschrift) needs a prior agreement with the supplier, and the supplier must not object to it.', '§ 14 Abs. 2 S. 2 UStG / Art. 224 VAT Directive');
  }
  if (inv.docType === 'credit_note' && !inv.refNumber) add('error', 'A credit note / correction must refer to the original invoice number and date.', '§ 31 Abs. 5 UStDV / Art. 219 VAT Directive');

  // Recipient VAT ID format (any case)
  if (r.vatId && isEU(r.country) && !vatFormatOk(r.country, r.vatId) && t !== 'rc_eu_services' && t !== 'ic_goods')
    add('warn', `Recipient VAT ID "${r.vatId}" does not match the ${r.country} format.`);

  // Payment
  if (!s.iban) add('info', 'No bank account on the sender – add IBAN/BIC so the client can pay.');
  if (inv.total > 250 || !inv.total) { /* small-amount invoice rules (§ 33 UStDV) not used: we always print the full set */ }
  return out;
}

// Footer / header legal lines for the sender, by country.
function senderLegalLines(s, L) {
  const lines = [];
  if (!s) return lines;
  if (s.country === 'DE') {
    if (s.registerCourt && s.registerNo) lines.push(`${L('register')}: ${s.registerCourt} ${s.registerNo}`);
    if (s.director) lines.push(`${L('director')}: ${s.director}`);
    if (s.seat) lines.push(`${L('seat')}: ${s.seat}`);
  } else if (s.country === 'PT') {
    if (s.registry) lines.push(`${L('registry')}: ${s.registry}`);
    if (s.capital) lines.push(`${L('capital')}: ${s.capital}`);
    if (s.legalForm) lines.push(s.legalForm);
  } else {
    if (s.registerNo) lines.push(`${L('regNo')}: ${[s.registerCourt, s.registerNo].filter(Boolean).join(' ')}`);
    if (s.director) lines.push(`${L('director')}: ${s.director}`);
  }
  return lines;
}

window.Rules = { EU, COUNTRIES, COUNTRY_NAMES, VAT_RATES, TREATMENTS, isEU, isBusiness, recommendTreatment, vatRatesFor, checkInvoice, senderLegalLines, vatFormatOk, cleanVat };
