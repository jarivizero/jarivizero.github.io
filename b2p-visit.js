

(function () {
  try {
    var SUPA_URL = 'https://ahyjufzfnozcexviegoo.supabase.co';
    var SUPA_KEY = 'sb_publishable_EcCH1iuhCsLBUiCUX0k82g_CyTmP6UR';
    var path = location.pathname + (location.search || '');
    var seen = 'b2p-visit:' + path;
    try {
      if (sessionStorage.getItem(seen)) return;
      sessionStorage.setItem(seen, '1');
    } catch (e) { }
    fetch(SUPA_URL + '/rest/v1/rpc/visit', {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      keepalive: true,           // a click that navigates away still delivers the count
      headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY,
                 Authorization: 'Bearer ' + SUPA_KEY },
      body: JSON.stringify({ p_path: path })
    }).catch(function () {});
  } catch (e) { }
})();
