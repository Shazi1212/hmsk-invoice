// Runtime configuration. Edit this file (or replace it in your build) to change how the app stores data.
window.INVOICE_CONFIG = {
  // 'auto'    = use the PHP server (api.php) when it is reachable AND has at least one user,
  //             otherwise keep everything in this browser (localStorage).
  // 'browser' = always keep data in this browser, never contact api.php (static hosting).
  // 'server'  = always use api.php with login (self-hosted, multi-user).
  storage: 'auto',

  // Optional links shown in a slim strip above the app, e.g.
  // [{ href: '/', text: { en: '← Home', de: '← Startseite' } }, { href: '/imprint/', text: 'Imprint' }]
  topLinks: [],
};
