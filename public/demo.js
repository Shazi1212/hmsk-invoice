// Fictional demo data. Every name, address, tax ID and bank account here is made up;
// DE02120300000000202051 is a widely published test IBAN, *.example domains are reserved (RFC 2606).
window.DEMO = {
  parties: [
    {
      id: 'demo-muster', demo: true, kind: 'company', country: 'DE',
      name: 'Muster GmbH', short: 'Muster GmbH', legalForm: 'GmbH', contact: 'Max Mustermann',
      street: 'Musterstraße 1', zip: '10115', city: 'Berlin',
      email: 'rechnung@muster-gmbh.example', phone: '+49 30 1234567', website: 'www.muster-gmbh.example',
      vatId: 'DE123456789', taxNo: '12/345/67890', vatScheme: 'standard',
      registerCourt: 'Amtsgericht Berlin-Charlottenburg', registerNo: 'HRB 123456', director: 'Max Mustermann', seat: 'Berlin',
      bank: 'Musterbank', iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001',
      numberFormat: 'RE-{YYYY}-{NNN}', resetYearly: '1', counters: {}, dueDays: 14, accent: '#2563eb',
      closing: '', billing: 'once',
    },
    {
      id: 'demo-jane', demo: true, kind: 'freelancer', country: 'DE',
      name: 'Jane Doe Design', short: 'Jane Doe Design', contact: 'Jane Doe',
      street: 'Beispielweg 5', zip: '20095', city: 'Hamburg',
      email: 'hello@janedoe.example', phone: '+49 40 7654321', website: 'janedoe.example',
      vatId: '', taxNo: '22/815/08150', vatScheme: 'small',
      bank: 'Musterbank', iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001', accountHolder: 'Jane Doe',
      numberFormat: 'JD-{YYYY}-{NN}', resetYearly: '1', counters: {}, dueDays: 14, accent: '#db2777',
      closing: '', billing: 'once',
    },
    {
      id: 'demo-beispiel', demo: true, kind: 'company', country: 'DE',
      name: 'Beispiel AG', short: 'Beispiel AG', contact: 'Buchhaltung',
      street: 'Beispielallee 10', zip: '80331', city: 'München',
      email: 'eingangsrechnungen@beispiel-ag.example', vatId: 'DE987654321', vatScheme: 'standard', billing: 'once', customerNo: 'K-1001',
    },
    {
      id: 'demo-stadt', demo: true, kind: 'company', country: 'DE',
      name: 'Stadtverwaltung Musterstadt', short: 'Stadt Musterstadt', contact: 'Amt für Digitales',
      street: 'Rathausplatz 1', zip: '12345', city: 'Musterstadt',
      email: 'e-rechnung@musterstadt.example', vatScheme: 'none', billing: 'once', leitwegId: '04011000-1234512345-06',
    },
    {
      id: 'demo-esempio', demo: true, kind: 'company', country: 'IT',
      name: 'Esempio S.r.l.', short: 'Esempio S.r.l.',
      street: 'Via Esempio 1', zip: '20121', city: 'Milano',
      email: 'fatture@esempio.example', vatId: 'IT12345678901', vatScheme: 'standard', billing: 'once',
    },
    {
      id: 'demo-example', demo: true, kind: 'company', country: 'US',
      name: 'Example Inc.', short: 'Example Inc.',
      street: '1 Example Street', zip: '10001', city: 'New York, NY',
      email: 'ap@example.com', vatScheme: 'none', billing: 'once',
    },
  ],
  items: [
    { id: 'demo-item-web', demo: true, desc: 'Web design', details: 'Design and implementation', unit: 'h', price: 85, code: '' },
    { id: 'demo-item-consult', demo: true, desc: 'Consulting', details: '', unit: 'h', price: 120, code: '' },
    { id: 'demo-item-hosting', demo: true, desc: 'Hosting & maintenance', details: 'Monthly flat fee', unit: 'month', price: 49, code: '' },
  ],
};
