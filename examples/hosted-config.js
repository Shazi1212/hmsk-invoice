// Example config for a static, hosted copy (this is the one used on https://hmsk.life/apps/invoice/).
// Build with:  tools/build-static.sh /path/to/site/apps/invoice examples/hosted-config.js
window.INVOICE_CONFIG = {
  storage: 'browser',
  topLinks: [
    { href: '/tools/invoice/', text: '← hmsk.life' },
    { href: '/impressum/', text: 'Impressum' },
    { href: '/datenschutz/', text: { en: 'Privacy', de: 'Datenschutz' } },
  ],
  // "Created with HMSK Invoice, free at hmsk.life" footer line, on by default, users can switch it off.
  madeWith: { enabled: true, url: 'https://hmsk.life/tools/invoice/?utm_source=invoice&utm_medium=footer&utm_campaign=invoice-made-with' },
};
