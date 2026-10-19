// Invoice labels. Bilingual invoices ("de-en", "pt-en") print "Rechnung / Invoice".
const T = {
  invoice:      { de: 'Rechnung', en: 'Invoice', pt: 'Fatura' },
  proforma:     { de: 'Proforma-Rechnung', en: 'Pro-forma invoice', pt: 'Fatura pró-forma' },
  quote:        { de: 'Angebot', en: 'Quotation', pt: 'Orçamento' },
  credit_note:  { de: 'Rechnungskorrektur', en: 'Credit note', pt: 'Nota de crédito' },
  self_billing: { de: 'Gutschrift', en: 'Self-billing invoice', pt: 'Autofaturação' },
  number:       { de: 'Rechnungsnummer', en: 'Invoice no.', pt: 'Número' },
  quoteNumber:  { de: 'Angebotsnummer', en: 'Quotation no.', pt: 'Número' },
  date:         { de: 'Rechnungsdatum', en: 'Invoice date', pt: 'Data' },
  quoteDate:    { de: 'Datum', en: 'Date', pt: 'Data' },
  validUntil:   { de: 'Gültig bis', en: 'Valid until', pt: 'Válido até' },
  serviceDate:  { de: 'Leistungsdatum', en: 'Date of supply', pt: 'Data da prestação' },
  servicePeriod:{ de: 'Leistungszeitraum', en: 'Service period', pt: 'Período' },
  dueDate:      { de: 'Fällig am', en: 'Due date', pt: 'Vencimento' },
  customerNo:   { de: 'Kundennummer', en: 'Customer no.', pt: 'N.º cliente' },
  yourRef:      { de: 'Ihre Referenz', en: 'Your reference', pt: 'Sua referência' },
  refInvoice:   { de: 'Bezug auf Rechnung', en: 'Refers to invoice', pt: 'Refere-se à fatura' },
  billTo:       { de: 'Rechnungsempfänger', en: 'Bill to', pt: 'Cliente' },
  supplier:     { de: 'Leistender', en: 'Supplier', pt: 'Fornecedor' },
  issuedBy:     { de: 'Ausgestellt vom Leistungsempfänger', en: 'Issued by the customer', pt: 'Emitida pelo adquirente' },
  pos:          { de: 'Pos.', en: 'No.', pt: 'N.º' },
  description:  { de: 'Beschreibung', en: 'Description', pt: 'Descrição' },
  qty:          { de: 'Menge', en: 'Qty', pt: 'Qtd.' },
  unitPrice:    { de: 'Einzelpreis', en: 'Unit price', pt: 'Preço unit.' },
  discount:     { de: 'Rabatt', en: 'Disc.', pt: 'Desc.' },
  vat:          { de: 'USt.', en: 'VAT', pt: 'IVA' },
  amount:       { de: 'Betrag netto', en: 'Net amount', pt: 'Valor s/ IVA' },
  amountGross:  { de: 'Betrag', en: 'Amount', pt: 'Valor' },
  subtotal:     { de: 'Summe netto', en: 'Net total', pt: 'Total ilíquido' },
  vatOn:        { de: 'USt. {r} % auf', en: 'VAT {r}% on', pt: 'IVA {r}% sobre' },
  total:        { de: 'Gesamtbetrag', en: 'Total', pt: 'Total a pagar' },
  totalCredit:  { de: 'Gutschriftsbetrag', en: 'Total credited', pt: 'Total a creditar' },
  vatEur:       { de: 'USt. in EUR', en: 'VAT in EUR', pt: 'IVA em EUR' },
  payment:      { de: 'Zahlung', en: 'Payment', pt: 'Pagamento' },
  bankTransfer: { de: 'Bitte überweisen Sie den Betrag auf folgendes Konto:', en: 'Please transfer the amount to:', pt: 'Pagamento por transferência bancária para:' },
  payToSupplier:{ de: 'Wir überweisen den Betrag auf Ihr Konto:', en: 'We will transfer the amount to your account:', pt: 'Transferiremos o montante para a sua conta:' },
  accountHolder:{ de: 'Kontoinhaber', en: 'Account holder', pt: 'Titular' },
  bank:         { de: 'Bank', en: 'Bank', pt: 'Banco' },
  iban:         { de: 'IBAN', en: 'IBAN', pt: 'IBAN' },
  bic:          { de: 'BIC', en: 'BIC / SWIFT', pt: 'BIC / SWIFT' },
  purpose:      { de: 'Verwendungszweck', en: 'Payment reference', pt: 'Referência' },
  dueBy:        { de: 'Zahlbar ohne Abzug bis zum {d}.', en: 'Payable without deduction by {d}.', pt: 'Pagamento até {d}.' },
  dueNow:       { de: 'Zahlbar sofort ohne Abzug.', en: 'Payable immediately without deduction.', pt: 'Pagamento a pronto.' },
  taxNo:        { de: 'Steuernummer', en: 'Tax no.', pt: 'NIF' },
  vatId:        { de: 'USt-IdNr.', en: 'VAT ID', pt: 'NIF / VAT' },
  register:     { de: 'Registergericht', en: 'Commercial register', pt: 'Registo' },
  director:     { de: 'Geschäftsführer', en: 'Managing director', pt: 'Gerente' },
  seat:         { de: 'Sitz der Gesellschaft', en: 'Registered office', pt: 'Sede' },
  registry:     { de: 'Handelsregister', en: 'Commercial registry', pt: 'Cons. Reg. Comercial' },
  capital:      { de: 'Stammkapital', en: 'Share capital', pt: 'Capital social' },
  regNo:        { de: 'Registernummer', en: 'Registration no.', pt: 'N.º de registo' },
  phone:        { de: 'Tel.', en: 'Phone', pt: 'Tlf.' },
  email:        { de: 'E-Mail', en: 'Email', pt: 'Email' },
  web:          { de: 'Web', en: 'Web', pt: 'Web' },
  page:         { de: 'Seite', en: 'Page', pt: 'Página' },
  greeting:     { de: 'Vielen Dank für Ihren Auftrag.', en: 'Thank you for your business.', pt: 'Obrigado pela preferência.' },
  proformaNote: { de: 'Dies ist keine Rechnung im Sinne des UStG. Die Rechnung folgt nach Leistungserbringung bzw. Zahlung.', en: 'This is not a tax invoice. The invoice will follow after delivery or payment.', pt: 'Este documento não serve de fatura.' },
  quoteNote:    { de: 'Angebot freibleibend. Alle Preise netto zzgl. ggf. gesetzlicher Umsatzsteuer.', en: 'Prices are net, plus VAT where applicable.', pt: 'Preços sem IVA, acrescidos de IVA à taxa legal quando aplicável.' },
  selfBillNote: { de: 'Gutschrift im Sinne des § 14 Abs. 2 Satz 2 UStG – ausgestellt vom Leistungsempfänger.', en: 'Self-billing: invoice issued by the customer on behalf of the supplier (Article 224 and 226(10a) Council Directive 2006/112/EC).', pt: 'Autofaturação – fatura emitida pelo adquirente em nome do fornecedor (Art.º 36.º n.º 11 do CIVA).' },
  creditNoteRef:{ de: 'Diese Rechnungskorrektur bezieht sich auf Rechnung {n} vom {d}.', en: 'This credit note refers to invoice {n} dated {d}.', pt: 'Esta nota de crédito refere-se à fatura {n} de {d}.' },
  availableNote:{ de: '', en: '', pt: 'Os bens/serviços faturados foram colocados à disposição do adquirente na data do documento (Art.º 36.º n.º 5 f) CIVA).' },
  dob:          { de: 'Geburtsdatum', en: 'Date of birth', pt: 'Data de nascimento' },
  smallSender:  { de: 'Kleinunternehmer', en: 'Small business', pt: 'Pequena empresa' },
  madeWith:     { de: 'Erstellt mit HMSK Invoice, kostenlos auf hmsk.life', en: 'Created with HMSK Invoice, free at hmsk.life', pt: 'Criado com HMSK Invoice, grátis em hmsk.life' },
  notes:        { de: 'Hinweise', en: 'Notes', pt: 'Observações' },
};

const UNITS = {
  pc:    { de: 'Stk.', en: 'pc', pt: 'un' },
  h:     { de: 'Std.', en: 'h', pt: 'h' },
  day:   { de: 'Tag(e)', en: 'day(s)', pt: 'dia(s)' },
  month: { de: 'Monat', en: 'month', pt: 'mês' },
  flat:  { de: 'pauschal', en: 'flat', pt: 'global' },
  km:    { de: 'km', en: 'km', pt: 'km' },
  word:  { de: 'Wort', en: 'word', pt: 'palavra' },
  page:  { de: 'Seite', en: 'page', pt: 'página' },
};

const LANGS = {
  de: 'Deutsch', en: 'English', pt: 'Português', 'de-en': 'Deutsch / English', 'pt-en': 'Português / English',
};

// makeL('de-en')('invoice') -> 'Rechnung / Invoice'; single = only first language (for amounts, sentences that would get too long)
function makeL(lang) {
  const parts = lang.split('-');
  const L = (key, vars = {}, single = false) => {
    const e = T[key];
    if (!e) return key;
    const fill = s => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
    const vals = (single ? parts.slice(0, 1) : parts).map(p => fill(e[p] ?? e.en)).filter(Boolean);
    return [...new Set(vals)].join(' / ');
  };
  L.unit = (u, single) => {
    const e = UNITS[u];
    if (!e) return u || '';
    return [...new Set((single ? parts.slice(0, 1) : parts).map(p => e[p]))].join(' / ');
  };
  L.primary = parts[0];
  L.parts = parts;
  return L;
}

window.I18N = { T, UNITS, LANGS, makeL };
