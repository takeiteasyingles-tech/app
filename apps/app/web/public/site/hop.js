// Course home (web/home.html, served at / to visitors without a session). Links into the app keep the
// prototype's hash routes (/#/entrar?reset=…, /#/certificado/…, the PWA's /#/inicio), and the hash
// never reaches the server, so the home answers them too: this sends them on to /app, where the app
// shell always answers, before the page renders. A hash typed or followed while the home is already
// open changes nothing on the server either, so hashchange hops too. The home's own anchors (#planos)
// do not start with "#/" and stay. A classic blocking script on purpose: the CSP has no 'unsafe-inline'.
function hopToApp() {
  if (location.hash.startsWith('#/')) location.replace(`/app${location.search}${location.hash}`);
}
hopToApp();
addEventListener('hashchange', hopToApp);
