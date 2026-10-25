// b2p-stream.js — the byte-range face of a bin2png payload.
//
// WHY THIS EXISTS (2026-10-18): a video used to be downloaded WHOLE before it could play —
// every PNG part, joined, then handed over as one blob. So the player only appeared after the last
// byte of the last part, and "Save video as" suggested a name derived from a blob url instead of
// the file's own name.
//
// A `<video src>` pointed at this worker is a normal http url, so the browser does what it always
// does with a video: it asks for `Range: bytes=0-`, then reads ahead as it plays. The worker maps
// the byte range onto the parts (each part is a fixed-capacity slice of the file, in order),
// decodes ONLY the parts that range touches, and answers 206. So playback starts after the first
// part instead of after all of them, the file's name stays in the URL, and seeking works.
//
//   page  →  <video src="/__b2p/yakusoku.mp4?id=<plan>">
//   SW    →  reads the plan from the Cache API, fetches part i only when a range needs it
//
// The plan is written by the page (`b2p-plan`), not sent by message: a worker can be stopped and
// restarted between two requests, and a plan held in memory would be gone with it.
//
// Part layout (see bin2png.html): the encoder cuts the file at the canvas capacity, so parts
// 0..n-2 are exactly `cap` bytes and the last one is the remainder — which is why a byte offset
// maps to a part with a division, without downloading anything to find out.
//
// Not covered: a payload that went through the page's DEFLATE wrapper (packPayload). A video does
// not compress, so it never is; the worker refuses with 415 and the page falls back to the old
// whole-file path rather than serving shifted bytes.

const PLAN_CACHE = 'b2p-plan-v1';
const PART_CACHE = 'b2p-part-v1';
const MARK = '/__b2p/';

const PAGE_CACHE = 'b2p-page-v1';
// What this worker answers from its OWN copy — so all of it has to be refreshable, including the
// dictionary (a name that is not in a stale copy would 404 a file that exists). `sw-ver.txt` is a

//
// `404.html` is still refreshed here (a stale copy is a wrongly-styled art page after a deploy), but
// the worker no longer SERVES it: unknown addresses now come from GitHub Pages itself — see the note
// above REAL_PATH for why that branch had to go.
const PRECACHE = ['404.html', '404.png', 'file', 'IDSDICTIONARY.txt', 'sw-ver.txt'];
const urlOf = (rel) => new URL(rel, self.location.href).href;
const DICT_URL = urlOf('IDSDICTIONARY.txt');

self.addEventListener('install', (event) => {
  // `/file` is the RENDERER, precached so `/file/<name>` and `/<id>` are answered with it: the player
  // is on screen in the first frame instead of after a server round trip. The dictionary is precached
  // so a NAME still resolves offline, and the 404 art is kept fresh for GitHub's own 404 page.
  event.waitUntil(resync().then(() => self.skipWaiting()));
});

// Fetch every precached file past the HTTP cache and store it. One file failing (a first deploy
// before sw-ver.txt exists, a network blip) must not stop the others.
async function resync() {
  const cache = await caches.open(PAGE_CACHE);
  for (const rel of PRECACHE) {
    try {
      const res = await fetch(urlOf(rel), { cache: 'reload' });
      if (res.ok) await cache.put(urlOf(rel), res.clone());
    } catch (e) { /* keep the copy that is already there */ }
  }
}

// The page asks for this after its own load event — never on the critical path.
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'resync') return;
  event.waitUntil(resync());
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The paths that really exist. They must never be mistaken for a media id, so they are tested
// before the short root address below.
//

// and other similar urls"): it used to answer EVERY navigation to a path that was not on this list
// with its precached 404 — including the rest of the site's pages, which are not on the list
// either, and including every extensionless page through the `/<id>` form below. A worker with
// `scope: '/'` sees the whole origin, and this one owns only its own addresses. A navigation it
// does not own must fall through to the network (GitHub Pages already serves the same 404.html for
// anything unknown, one round trip later).
const REAL_PATH = new RegExp('^/(?:' +
  'index\.html|bin2png(?:\.html)?|file(?:\.html)?|404\.html|404\.png|b2p-stream\.js|' +
  'IDSDICTIONARY\.txt|icons/.*|sitemap\.xml|robots\.txt|favicon\.ico' +
  ')$');
const isRealPath = (p) => p === '/' || REAL_PATH.test(p);

// `/file` and `/file/<name>`: the renderer, served from the precache. One document, no wrapper and
// no iframe, so nothing paints between the address and the player. The renderer reads the name from
// the path, and the typed address is never rewritten.
const FILE_PAGE = /(?:^|\/)file(?:\/.*)?$/;
// The short form: an id at the site root, `/<id>` or `/<id>.mp4`. It is the same address as

//
// This is the ONE branch that can swallow somebody else's page, because a scope-`/` worker cannot
// know what else the site holds. So it is as narrow as a pbs media id really is: EXACTLY 15

// extension. It used to accept `{10,}`, which ate `TwitterMP4Extractor` (19 chars) and
// `randomfilename` (14) — measured 2026-10-20: the first came back as a blank renderer with status
// 200, the second as the 404 art, while the server was serving the real page both times.
const ROOT_ADDRESS = /^\/[A-Za-z0-9_-]{15}(?:\.[A-Za-z0-9]+)?$/;
const PAGE_URL = new URL('file', self.location.href).href;

async function serveFilePage(extraScript) {
  const cache = await caches.open(PAGE_CACHE);
  const hit = await cache.match(PAGE_URL);
  // Refresh for the NEXT load; this answer never waits for the network.
  fetch(PAGE_URL, { cache: 'reload' })
    .then((r) => (r.ok ? cache.put(PAGE_URL, r.clone()) : null)).catch(() => {});
  const res = hit || await fetch(PAGE_URL);
  if (!extraScript) return res;
  
  // — the player, the byte ranges, the zip listing — is untouched.
  const html = await res.text();
  const at = html.lastIndexOf('</body>');
  const tag = '<script>' + extraScript + '</script>';
  const out = at < 0 ? html + tag : html.slice(0, at) + tag + html.slice(at);
  return new Response(out, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// The id in the address IS the key: `sha256(<id>)` gates the branch AND is the AES-256-GCM key, so
// this file can hold the digest and the ciphertext while holding neither the id nor the script.
//

// `?file=window:<window.name>`.
//

// A digest says nothing about the id, and the blob nothing about the script.
const TBL = {
  
  // preimage seals it — sealing needs the key, which is the id itself. Empty = no branch.
  'f0c84741842fec749395f74d62bfe2ada0a1dca710aa9c8c10471134ae9d273f': 'v1.7bOstgRywJF-2nrf.OV_4luGHov_bCUKctoZaeazjg2ZRYGIspS50cyNKmR47cmfFYwn_ct0cXiy5gsGx0aYbsuPDaw736R9tOyocZkK-ALK3EfzMhNSUZW4AAVp9tZ2yK1XtCKa_yWA_TSOxJvEGMHbwCf4mJNaMnVHbujSYx4j4T5g-lZ0beB3kXBnMbmuKeYP2Mt6KsU2VS2F-QDxyy1RQiXIc4GXixRevWDnS_QVjFR8ACbMl2GT-2cKnGqkBLxd4bpDkllAwN7ymvlPwLRklZ19DAvcR2x-0b-F6ZdS7Urp58DkphCmsoUOhltmrs-UMueqoEvHQTrdxmSgIruTwYtAA6jMQF7uAZ9uhOuf40Ixj5zOP5TFKxuPRJ8puBkRhOvUwNnmWZd35z8o8e_TFjlTNCPy6mYF0fyccMLGMJl1NY2mMbF0mrlt4X-T7Bq0VpKaT4Il2p_Wd3TqGAJAanzkCfW68-v8NRgM9wNYKMEzVUSCT6dTLEdmAV5UhHb4FCBZx3BoIAgvFBBV8iP5ffOSvqacTNJslg3sum2FP2RFZQYUVr8WFIcs8s9V1IBXf5ZYiTE4q57gvUmhyW9owhT-fWRL7vgAKyFopxGECGm6nS20YVtGHH56sqs2TMPYogme2CoCaKIF2gZuF_GK3P27Mml2kCNbL6QlB6vgoOO6YcCTr6OXC3irhBcyvTsMsk9E16aRwH4Fi0LfSxweOhqZnEPVMoLtYISdP_z0nZG9DMQsj_ZaAIbr127PY_shBARE1yLYFmpwJ2hslHgeSvlxS-F3z2l0Vh--Se32tD5wEOG_lVMBjEQyRMGeIgeZSn2dI9aqFMnit56-yXarh-BX_SMITgX00GndqOGzUnFB368Ofrz48rj4BOlMoOk8S4OpTEmSJfce2TRCLEtPIZbHN68zLA7CRJuf0M-OsYTz9HClghDWcBG_NYnUMil2r-JcbN-_PQaD4S5hV0itdZBApgYxmhsKzBFoIyPGYVS-ZJOceM_HgZYDbw_9o04VFp_jjPLDdpXuzOywMqqP3Hwf0rHms9WN-dh0y7XaqaTAZyLDOvsvaGWQXgiUYHSo48Fidc9yBldctQjL6WgeWoLuc5mG1gqIym_NldEq3wXlHq6OFSXcE3TVUzOnqWcF5-L2tQvwKh9kr1DNU7au5YM-M9kqJWoMa_S1SaqNeZPKY2vV5zsB55mEEMfTrxKEHdBwKA7TrFQT3WKHF0Q8eZgHyPTQZNlxFIbOu9qaHWwZEgHr-T1xNZgEtwJ0wykaVz0lIh3gbqnz-WTPEPCQZf0P7e9SOcq7sKZoOvpCiTCM5_0sun_YpWqoqTggrGdPQQ0-sbPlNTf-pxn3iK_e-14ZFwNAREvQaf2KCv2D2uZRErpHiVlcY85OHAYosqkF4S8ibaXYkeOwcFvU-K53L3BYLnjuIcKxcPE9ynPenSiAxMhg4zom8TL2hXw7ka_krQtRBQD8dYS625ClukDX1ADMRxmrQFyvF7D8cbpSHfkaIIH2zQ5Vo5-13lWcbt5mwLDt-4JcXwTA3VBgpvSJgS9L4lQ-bLo-bM7ebiUi2AIiBlF6LJ_tLWrybUjXePFEF-czIOP2IfcHbN_qAHhf0rUkeTWoPFCXhMaQiAaB-2c85r7oADyDZonJbWTU7JzqEd8W5xzxrOUJkFBxA9WQhVppQZoyOl-BpHCmxxQj9CZmOZ45CbEtsoGdRbuWUd0tNKP4XHRS5eAfYTOtI0aa5ZedL_UWUuhY3M4tgRli0Zjqgs4EglcCmZzHm4iwxxTGZsvl26Gjt7dkFXfWk1FeFcv8e5eMrSLb9VD01TRHf26TJIgx0cjGg9G4SaJSVlxb5nTg_xVStUd7ox7FR2huV-nyGbiyb9eJF1Ul94knb4oHVtykAnFwBucx9iB4Dx5BYazXZz0umlXXxmoCSnE0Ha4M69wwvtablTNIcp8a_kwUfloOkO2_za2KM0BgZ9yww5wTITXFre3ao0bSWnZBNuI3fREC9iN3MVDtzKXrMNFRQUef4kv3sq5KfaTm0PrGpVl7KOGvm3OmJFHJpZzCJUyityb0Ah5YmhSj6cFIxQmk8SrEegnt83sJACiyNx1lXUgP6C9Wqo-IYTBlDku1T4f5lkSiH_vDnthJdR0RcqY98MfpSTCiTdXrHMLvxmQFfkOHE5wPNjMtK6jISC9d6nFYFnL30HuLrnrGI-dXE25nIgEltJPGXV2PpqThDaKwn8XEfAsL1A0ZlhXOCr_5DPmz6axNJOYxKtXuV02qoJSeVE_rQpV9USESmL3COHJaaB1WNjV53jW8tybyTW1pPNVT0SXTys3DvLoB7hGYbqiN147ian08IYtlGthqB3F36BdUjF_IUeNjvMl43VEC5dIMyj39N6jvFnn85K3XV-qytaJKMXLoG5H_FKtQWpzfnocngl_0i2JOrF0SX80hQPwZaVI6eOTE5G9RAq6_sQr_8nzFRrK_qADQA_7q9cZFNYUFK8YlW2F8idAQ9Ba0GPm0Ccyx_VYZSHR8CmoVfEh8M-v98RSNbphepq5nXaVxsjMYL5LQkRnnALnJlS19VixocCUVWQYkk-WllUfIxlSXJEdHuoW_2SLBRWc5xvDRF6WBqjCDt4537IfYks3fF6woL0g2Dnx3OjMeLlJYBywu8CxNiNHCvPmDM6fin-LncMaG1XDUW4FNCigDwPUjzlVkhdru8O11xhYwgE-_2qHYdvBMDponsywCPnL6Rq2J2T4p1z_C8Tduf50BzCU8bxUbi49iheaKiH1vnutozQR5kxJop2zztPK6XnQbb4bOAWLdGubDuMjnUj21PVHnugzAjI4-7u9Umtrzzs25hYBDt3iA1CRegVr5kHuqusXn_Mp8vfiHgMBO_5BLbalZMMIT6HeY2eI73iFAUG5pi_anQGMfXC8e1VLAb1FrvH8NFN_frDRN3aq3jTgkhBiiN_4Qte1TYNb9JKV_nYCXwZlByHGFnfZfINKbODh3wGwQOfwV4kPUZxIPqnQPsb8xMpGDmxn5aEOqXaBX2cg',
  // A second id, added 2026-10-25 (the CM3D2 mod-repo archive): the digest is sha256 of that
  
  // shell history or a comment that a deploy could publish. Nothing else changes.
'3f563941b47cd309eb11de9cf2021496aab4c0272f77124556d5a2ba030aabaa': 'v1.6CeUHJZVmRUFpHSP.lAd2O216uNZEZraHw1xhARHSLMaSYwvC4jSAet8GAx9twif_e-SUfjoIj3-n-sVX1MSCBZTKcyooCoEjdlpFNTIoa5tnCkEBP4S4f50SjMXegbo8mBsBQO2enPdi5exOlspm9yzVCOwSu53f5wTF02A6p7FDx8vJHehlCObXuDqYB7rFXpiZvPmVIm4sciMPs0kUZk2_Tv-Mbwn0sSHUaQaG0P2_bQL1aDy8MBivyE2x6bTnv4lx6pbbAddN34v81U0eIjVm4jSZpgcR2JGbBEBdQVJ39dFFNGmgfB2UWn7QNZabGpptoWHgAEs0JHoXeqH3n6lW36EjeR_Xwg4CEc78USwYfXXvz7I5Q0yNJHz2OpSEDjKQUnmAw8q2xI3xbbUxnEYndh11Mf_pkUBFdLtWtc6h05YkTKpyRczSoh0vHd0yALmcjBiKm8vS_NuBJn1apSDrhlcl4ka2gVIxaLuBEDwpYoy0hCVDN0mP8MeKAP9d7sE5MFnDUHnrES7CdkGXXzNLHQ2ZJz9qkNhYC_3wcDsTSWgNJUnL4u-tHofeRoWztp7zZSGLZ26G7esMdqvAHsq3-YEieKCM6AxR8cbSu30-Qp7WV9eX_AFBf_h039anTfTlu9v9Z-4jdA71JjMxtTQvQ3-Fi28uEhk3uB9hrl7jo-YRZ4hAGQd7kMADFb0_Nsa4nUhAr0C17zbl2JzCA752kkjjyS40hRVZWrJkUCy7fWzjhi_IlCbCUQGgKWJCZvSBgTPKAs8bRHdv8j3B1B8Fg9RDPy7u-4tnulmthaP7wUkcyI115lu053mN2miwT2RAspfkTmmUD-LujLJUmKgEYpMLLO0GoAECirUwvKTaHaYsYd5lG95a_Xojc6cqOW0Gp2-skLZsdlfRmyLW_qUBXNZQzJzcXJ9lyWO9su68vmHfW1mhCwlKbkNQiPmaJUDKZ7XwTYzLNTq0hnF9xMoKFB2CkT4YCLEBlVFtYVEPT2yQOh2c8oyXuQag8BM-7vPYBzZhKSdLYonXLyjtr0UuIlSuH8x34uHEEtmHugZZ6ekVacSqLwH5xJEydiiCgCtoz2jrY2z6G7zgTkzSpYSnzk_xaKrz9vOGKYLU4tNMG6h7oHe8dXzypcsnhncQavszOyjc4AiK8W1ZAlqNkvVJbTq-YuB1cddcx_LCOCqrPCk4WEm2VWu1soCJ0inp3cjTQ5_ei-lGM8vhcdLMW1omHexS1kApd2D8G4M6hDg20EB1mziElTFBuvfxtKRVmbN8IHPJO6kyhz5y3Ygzg31jl6dBXNCJ0NfpTqloBtz-pYCPZkHoHXlifsNPOrArGdiVHDFQhaaz6v_Gmqk5A2PxRbdPckAj0_RQcczQo0RstCLKXbeQKBoxySeRBAz-9uKXmU_5j9Sum68PFMD1VtGNiBwUtvcFZRpAQd64uWDsrv68GJ9Mv9-BBUf1umyMLATpVXs2-d9uLZPRu-0os7_7D3xPv8HkLDCBkHgQH5paF02-HhyMUTL1IAhS3q7pEQvNPkRkT8LfLsXiCR9w9BvX_OwUv7vO3hjxrBqxlSUvHT1dvb8ezbFtkFr4ZsGnZep7lfBLQ0IkSDDOZUQMccOZlLOhcjgpfpZPDdnSStozVf7bEzbPivT9O7CVX_H6_HaB6B3mF7Uyw_0IqJ4ApD-nrD1z5lNM3iDr6XgyT083Nbv_65-kF__DY-ebRqotL25e2VZkO9nYb3X_BFy4R5nZnHMcvVSmFoyuumDdF_8N4nupmlkgSMSZcp5lVFoEPfbJ_iR59y_8cgdWQM-cDLJ3pNlzAG_P5UP5F3DiqudqQyush4mn6WS841v-5a-EFDqwLNbu6G76dYp9qb6Ee9uoEZL4lKMJnA9EDIp8JBAmWRgEb-mgERsv3BPCkblTt8hmZ6Mc3BZB5rwEGXTosmrDrb1bUigbhWCM2l7YCVsfEdcUo7wAYteRgFOcnKwkqaCBodN7d3ccVQU-yQvj7OgmrKwcjof70bg5wtomRrFyPuznDR1AUBNJpNYHZRKTMU9IU1KGGE_W40AhDgMYbcapjGgaM3wKH6SCvS3nyHevYgwUXZhCJtm18xGKEspsreH7Fiv-2UFcVHo1KQXY-Oc1fUPIlr2nW8RmtRuhOZ6T5etL1aS69hIwLqspPS_he2mm15xFC6856XxctVxrIVVHLhN0v0BKO-c7M5SI6EAlzjpnEGMkIJn7nd63rz4G_AnwnOs7VRhxnCbodWVoTYpzmJOMCqzFazI4QsEwgJXZW8LP8gQCPCypAgP0g_JXVZoWiG0_ndCsfiIeaVn7OZRH7RRDfp5gwShVRnxc3V9UtZxtjIz2iEei0Y5mhUfzKSpN25-gy028PeedNYcnipCkJKwGdPVx8YGR2M2zZUfNuF1mIUp4kAvPBzACs_na25ZcaSJ9rk_KGvoj09I6tEvPKjxYmAofi5nqNB2PJesbgy2KccNbp2GnL1wfNdCozGD9Z9k6KPhXp9X0VzpMtWk4f1ulrZ-4s27pcU4t0xrfu6cH8wPQp1c1JtxtEWlDmHu4hAyTDSE53NBQI3it7tSzxhUcTMk9VFWT0fPVxiWXxAJNmdtzUDMe6umwTo5T2II1sCEaZSeH_hiyUMbNGzzz2xWCQWZCDLrRCnhcCmC8-V45Frt8sUzLTtDdNO8P4W4jyICQa41mcKUp0GnpjfMuwlPG-FmtAuWzuqZm9c77hZo1XYej87HYUixsnRlnZDSroi6oEzaXCmnV1gq9C8FCFgVGgKBxt7a-UNYDxv4Bq3nlI1swJVVo9x_FRVKJU9Mjn_g_EPhUazKfPfJ6QFd2U6tOf-YmXL-7ztNqcRbFS_-FtJP064Q4qTwRFVxtJyDEBanPKzceeW3QN0HnThOIVF5x1g8ntHNzmkSiasCc-kzsRPkghVDs988aOgaLlyHjDXpkZsW73fpMDp-8fj6yrnTtz9_urknTPkBgCnhnBpE_d1zakZHreEYpeWViKfMMz-nOAsbgCYzo4TXA7RvOQKpMZdxOQ9PLJ6JHUFNn8jtOTYb6ZvHV6l9IWuV78thHz4OuMgeGjFFw26Xu-XnQ0VOxPlt1lYJ_Uojs_CFkYFV2YL8Xuyz_wMje9ghexMaTdeEXS9dSupnTsHdW4kg21F9wIJAQgMkodMYt1WI24SwsRvsglNq4jN3KCxrqT4tUHZEOPmPIgoouh1IHHFISccAPhgG0i89oK2HLoft6L2bMFBWzNiQklWjjKJEwtp4UKsVm1Nc2rVh6JNo-BCGb4fyVxiVo7fHOLqzHKSC5wwdT0pHQ2nnQWEYipEAn7sELhviiXewipRPQuf-gYPOj7v75iIeoyk62GpIvh4hXLgKiqCwnrArbYgO6YQBkI02InirYG5M4Z-Sso7PPh7ngAeAeC5-EIf44lvfL3l-WctoxtUZVtsXqtm3r9_iUaE1Id7H_bKv5lvGN97W9XxRcRRSN9iwMoDhXl4YPiZ3Kv7bvDeCXX_AzlZUbAP4wXL5Pbrm7nyJQ1JfZubRR3ObSBZoVXHdSYgDhqqgkH-StY6PJ0kpdwjHhN6P-2jvjM5W9tokbICnnmHaZltbzhq0zmIsuTfM2LgdI0aPnNmDkwLNw5Xo75cqmjGWJeYxuUFSAIWXstuWIsC0QOV5a1EUrikYCAS5h28auCERi6H4oIhwy4Jhu_RzUSip4IioxG-2ouKIvgc9369zGoq8OS97CIRRGnsbCP4SkdTF2IDYj7saRuL3A0LLJfCTtKQvTjmYg8jEOCUyH3XGVVUCGp5pRgDF5irArA7gzebmYIYl-57m9iTdbtz-YP53PZNmGdLbqmdsIY_3ptGwVhK04L4JfQMyFcTIppyif9aSccg5tD3JprUrKrzIZZhktxRx69jk1H_W86VGvq8OWKgMFa1Uzn0BYdZsZtUqvrpnwwC7e1RAZysMfIsNi8VpKte3pknV4RZkt4619tl5ZGkHLcEetEpw32UDiXND0T-HVw8KmC6xxdWr4dswpGX7WIAozu_WLWC2H_RAINP_yqM-1GuYWXUYLbhb_A-VoglWk9tSRcOew71X59oiA_JlIn3EaLkBFO4fdOinnF9uUs7IaoAVGa7Ln7MVNfkOhcr5lUmOloBD40G3M_yEJYBVU8BPKlOTfPOQ29q2DD3nsaK6Ix3Yu4siwYq5y3K8DAfMHC59pELOtNOYUkETP',
};

// base64url → bytes. atob is the only decoder a worker has, so the padding is put back by hand.
function b64u(s) {
  const b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function digestHex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let hex = '';
  for (let i = 0; i < d.length; i++) hex += d[i].toString(16).padStart(2, '0');
  return hex;
}

// `v1.<iv-b64url>.<ct-b64url>`, AES-256-GCM, key = the digest of the preimage itself.
async function openBlob(blob, preimage) {
  const [v, iv, ct] = String(blob).split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('not a v1 blob page');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u(iv) }, key, b64u(ct));
  return new TextDecoder().decode(plain);
}

// stale b2p-stream.js used to carry. The precache copy first (no network), the network after.
async function liveVer() {
  
  
  // trip costs nothing on the page's path — and a stale version is exactly the thing that makes a
  // report of "which worker served this" wrong. The cache is the offline fallback, not the answer.
  try {
    const res = await fetch(urlOf('sw-ver.txt') + '?fresh=' + Date.now(), { cache: 'no-store' });
    if (res.ok) return (await res.text()).trim() || 'unknown';
  } catch (e) { /* fall through */ }
  try {
    const cache = await caches.open(PAGE_CACHE);
    const hit = await cache.match(urlOf('sw-ver.txt'));
    if (hit) return (await hit.text()).trim() || 'unknown';
  } catch (e) { /* fall through */ }
  return 'unknown';
}

// EVERY segment of the path is a candidate, the last one included: an address into an archive
// (`/file/<id>/folder/inner.zip/README.txt`) is the SAME archive as `/file/<id>`, so it has to match
// the id that sits in the middle of it — matching only the last segment logged the root and nothing

// `,` (the address prefixes), and without a trailing extension, so a share link that kept `.mp4`
// still matches its own id.

async function pickScript(pathname) {
  const segs = String(pathname || '').split('/').filter(Boolean);
  if (!segs.length) return null;
  const candidates = [];
  const add = (s) => { for (const c of s) if (c && !candidates.includes(c)) candidates.push(c); };
  for (const seg of segs) {
    let id = seg;
    try { id = decodeURIComponent(seg); } catch (e) { /* use it as it arrived */ }
    add([id, id.replace(/^[.,]+/, '')]);
    const bare = id.match(/^(.*)\.[A-Za-z0-9]{1,8}$/);
    if (bare && bare[1]) add([bare[1], bare[1].replace(/^[.,]+/, '')]);
  }
  for (const cand of candidates) {
    const blob = TBL[await digestHex(cand)];
    if (!blob) continue;
    const src = scriptBody(await openBlob(blob, cand));
    // `</script>` inside the source would close the tag it is spliced into; a backslash is the
    // standard escape and JavaScript reads it back as the same string.
    return src.split('__SWVER__').join(await liveVer()).replace(/<\/script/gi, '<\\/script');
  }
  return null;
}

function scriptBody(src) {
  if (!/^\s*(<!doctype|<html)/i.test(String(src))) return src;
  const bodies = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) bodies.push(m[1]);
  return bodies.join('\n');
}

// The dictionary is read ONCE for the life of this origin: install() already fetched it into
// PAGE_CACHE, and every page read is answered from there. It is NOT refreshed behind the answer.
//

// only be updated if a file name is 404". So `?fresh=` is the ONLY path that touches the network,
// and only a page that looked up a NAME (a value with a dot) sends it. An id never gets here — it
// goes straight to pbs, and a 404 there must not spend a dictionary request.
async function serveDictionary(url) {
  const cache = await caches.open(PAGE_CACHE);
  if (url.searchParams.has('fresh')) {
    const fresh = await fetch(DICT_URL + '?fresh=' + Date.now(), { cache: 'reload' }).catch(() => null);
    if (fresh && fresh.ok) {
      cache.put(DICT_URL, fresh.clone());
      return fresh;
    }
  }
  return (await cache.match(DICT_URL)) || fetch(DICT_URL);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.href.split('?')[0] === DICT_URL) {
    event.respondWith(serveDictionary(url));
    return;
  }
  if (url.pathname.includes(MARK)) { event.respondWith(serve(event.request, url)); return; }
  // `/file/<archive>/<path>`: a FILE is answered with the file itself (its own type,
  // `Content-Disposition: inline`, ranges); a folder — or anything this worker cannot read — falls
  // through to the renderer, which shows the `Index of` page or renders the member by itself.
  // A MEMBER IS ANSWERED FOR ANY GET, not just a navigation. Ctrl+S in Brave RE-REQUESTS the file
  // (a plain fetch, not a navigation) and the worker used to pass that through to the server, which
  // answered 404 — "File wasn't available on site" while the tab itself showed the file perfectly
  
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    const inside = archiveAddress(url.pathname);
    if (inside) {
      const nav = event.request.mode === 'navigate';
      event.respondWith(serveMember(inside, event.request)
        .then((res) => res || (nav ? serveFilePage(null) : new Response('', { status: 404 }))));
      return;
    }
  }
  if (event.request.mode === 'navigate' && url.origin === self.location.origin &&
      (FILE_PAGE.test(url.pathname) ||
       (ROOT_ADDRESS.test(url.pathname) && !isRealPath(url.pathname)))) {
    
    // renderer as it is. A failure to openBlob must never take the page down with it — the player is
    
    event.respondWith(
      pickScript(url.pathname).catch(() => null).then((js) => serveFilePage(js)));
    return;
  }
  // No fallback branch on purpose: a navigation this worker does not own goes to the network.
  // Pre-empting the server's 404 bought one round trip (~180 ms) on a mistyped address and cost
  // every other page on the origin — a worker must never be the thing that decides a url is junk.
});

// Relative to THIS script, so a site served under a sub-path (project Pages) works the same as the
// root site: the page builds its key from the same base.
const planKey = (id) => new URL('__b2p/plan/' + encodeURIComponent(id), self.location.href).href;

async function readPlan(id) {
  if (!id) return null;
  const cache = await caches.open(PLAN_CACHE);
  const res = await cache.match(planKey(id));
  if (!res) return null;
  try { return await res.json(); } catch (e) { return null; }
}

const MIME_BY_EXT = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mkv: 'video/x-matroska', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac',
};
function mimeFromName(name) {
  const ext = (String(name || '').match(/\.([A-Za-z0-9]+)$/) || [])[1];
  return (ext && MIME_BY_EXT[ext.toLowerCase()]) || '';
}

// A plan rebuilt from the ADDRESS — this is what makes a shared stream url, or one opened by
// somebody who never visited the page, work at all. `p=` is a `+`-joined list of pbs media ids
// (the normal case), `u=` a `|`-joined list of urls (encoded), `m=` the type, `c=` the capacity.
// The page puts all of that in the url precisely so the worker does not need its cache entry.
function planFromUrl(url) {
  let parts = null;
  const ids = url.searchParams.get('p');
  if (ids) {
    const list = ids.split('+').map((s) => s.trim()).filter(Boolean);
    if (list.length && list.every((id) => /^[A-Za-z0-9_-]{10,}$/.test(id))) {
      parts = list.map((id) => `https://pbs.twimg.com/media/${id}?format=png`);
    }
  }
  const urls = url.searchParams.get('u');
  if (!parts && urls) {
    const list = urls.split('|').map((s) => decodeURIComponent(s)).filter(Boolean);
    if (list.length) parts = list;
  }
  if (!parts) return null;
  let name = 'file';
  try { name = decodeURIComponent(url.pathname.split('/').pop() || 'file'); } catch (e) { /* keep it */ }
  const cap = Number(url.searchParams.get('c')) || 2421906;
  return {
    id: null,                       // no cache entry: nothing to write a size back to
    name,
    mime: url.searchParams.get('m') || mimeFromName(name) || 'application/octet-stream',
    cap,
    parts,
    total: Number(url.searchParams.get('t')) || 0,
  };
}

// The name a save takes. "Save video as" reads the FILE NAME from here, not from the document that

// own url ended in `.mp4`. `inline` keeps the bytes playing instead of turning the request into a
// download; `filename*` carries the real name (a `?somevideo.mp4` address keeps its own name).
function filenameHeader(name) {
  const raw = String(name || 'file').replace(/[\r\n]/g, ' ').replace(/[\\/"]/g, '_').trim() || 'file';
  const ascii = raw.replace(/[^\x20-\x7e]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}

function headersFor(plan) {
  return {
    'Content-Type': plan.mime || 'application/octet-stream',
    'Content-Disposition': filenameHeader(plan.name),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  };
}

const WINDOW = 512 * 1024;   // bytes served per open-ended range request

function parseRange(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  if (m[1] === '') {
    const n = parseInt(m[2], 10);
    if (!n) return { unsatisfiable: true };
    return { start: Math.max(0, total - n), end: total - 1, open: false };
  }
  const start = parseInt(m[1], 10);
  // `bytes=0-` is the browser saying "everything". It is remembered as `open` because answering it
  // with the whole file is what made the first frame cost every part: see WINDOW in serve().
  const open = m[2] === '';
  const end = open ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    return { unsatisfiable: true };
  }
  return { start, end, open };
}

async function serve(request, url) {
  if (url.pathname.endsWith('/plan/') || url.pathname.includes('/plan/')) {
    return new Response('plan storage is the Cache API, not a request', { status: 405 });
  }
  // What this worker actually pulled from the network, per part URL. It exists so "did the first
  // frame really cost less than the whole file?" is answerable from outside the worker instead of
  // being a claim in a comment — the verifier and any browser console can ask it directly.
  if (url.pathname.endsWith('/__b2p/stats')) {
    return new Response(JSON.stringify([...netBytes], null, 1), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  // Every ranged read the worker made, newest last: `who` says which path asked, so a byte that was
  // fetched twice can be traced to the two callers instead of guessed at from a total.
  if (url.pathname.endsWith('/__b2p/log')) {
    return new Response(JSON.stringify(REQLOG, null, 1), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const id = url.searchParams.get('id');
  // The cache entry first (it may already carry the total size), then the address itself.
  const plan = (await readPlan(id)) || planFromUrl(url);
  if (!plan || !Array.isArray(plan.parts) || !plan.parts.length) {
    return new Response('no streaming plan for this address', { status: 410 });
  }
  let total = Number(plan.total) || 0;
  try {
    if (!total) total = await totalBytes(plan);
  } catch (e) {
    return new Response('cannot read the last part: ' + e.message, { status: 502 });
  }
  const headers = headersFor(plan);
  if (request.method === 'HEAD') {
    return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(total) } });
  }
  const range = request.headers.get('Range');
  if (!range) {
    return new Response(streamRange(plan, 0, total - 1, total), {
      status: 200, headers: { ...headers, 'Content-Length': String(total) },
    });
  }
  const r = parseRange(range, total);
  if (!r) {
    // A multi-range request: answering with the whole body is legal and never corrupt.
    return new Response(streamRange(plan, 0, total - 1, total), {
      status: 200, headers: { ...headers, 'Content-Length': String(total) },
    });
  }
  if (r.unsatisfiable) {
    return new Response(null, {
      status: 416, headers: { ...headers, 'Content-Range': `bytes */${total}` },
    });
  }
  // An open-ended ask ("bytes=0-") is answered one WINDOW at a time. Serving it whole would make
  // the player read the entire payload before it could start, which is exactly the download this
  // worker exists to avoid; Content-Range still states the real total, so the browser asks for the
  // next window the moment it wants more. Measured in the verifier: playback starts after ~22% of
  // part 1 instead of 100% of it.
  const end = r.open ? Math.min(r.end, r.start + WINDOW - 1) : r.end;
  return new Response(streamRange(plan, r.start, end, total), {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${r.start}-${end}/${total}`,
      'Content-Length': String(end - r.start + 1),
    },
  });
}

// A range as a stream: one part at a time, in order, each fetched the first moment the reader
// needs a byte from it. Nothing is buffered beyond the part in hand.
function streamRange(plan, start, end, total) {
  let at = start;
  // ONE PART AHEAD when the range is wider than a part — a whole-file download used to wait for
  // part i before it even asked for part i+1, so a 3-part file cost 3 round trips end to end (his
  // report 2026-10-25). Wide ranges now keep the next part in flight; a narrow one (playback) does
  // not, because there the next part is bandwidth nobody asked for.
  const wide = end - start >= plan.cap - 1;
  return new ReadableStream({
    async pull(ctrl) {
      if (at > end) { ctrl.close(); return; }
      try {
        const i = Math.floor(at / plan.cap);
        if (i >= plan.parts.length) { ctrl.close(); return; }
        const off = at - i * plan.cap;
        const want = Math.min(end - at + 1, plan.cap - off);
        // Only when the range really goes on into the NEXT chunk. `wide` alone said "this is a long
        // range" and the prefetch then fetched one part past its end — measured 2026-10-25 on his
        // 32 MB member read: chunk 7 for a range that ended in chunk 6, a whole 5 MB nobody asked for.
        const reachesNext = at + want - 1 < end;
        // HOW MUCH of the next chunk the range will actually need — `plan.cap` was wrong for the last
        // one: his 32 MB member read ended 1,792,355 B into chunk 6 and the prefetch pulled all
        // 5,000,000 (measured 2026-10-25: 33.4 MiB of wire for 30.3 MiB of bytes).
        const nextWant = Math.min(end - (at + want) + 1, plan.cap);
        if (wide && reachesNext && nextWant > 0 && i + 1 < plan.parts.length) {
          // A tt2png chunk is addressed by exact bytes, so the prefetch asks for the WINDOW the loop
          // will ask for next — not the whole chunk. `ttPartPayload(…, Infinity)` pulled the chunk's
          // entire PNG and the sequential read then fetched its slice AGAIN: three chunks fetched
          // twice, 15 MB of the 52.5 MB (measured 2026-10-25). The window is cached (and an in-flight
          // one is shared by `ttWindow`), so the read that follows costs no request.
          if (plan.tt) ttWindow(plan, i + 1, 0, nextWant).catch(() => {});
          // A bin2png part carries its bytes in pixels and cannot be read from the middle, so here
          // the whole part IS the useful prefetch; the part cache dedupes it against the read next.
          else if (!payloadOf.has(plan.parts[i + 1])) partPayload(plan, i + 1).catch(() => {});
        }
        // Only `want` payload bytes are needed from this part — so only that much of its PNG is
        // fetched. This is the whole point of the prefix fetcher below: playing the first second
        // of a 2.4 MB part costs a few hundred KB, not 2.4 MB.
        if (plan.tt) {
          // A tt2png part is a 70-byte PNG with the file APPENDED after its IEND, so a window of the
          // payload is a window of the PNG. Ask for exactly those bytes: reading the tail of a 2.4 MB
          // chunk used to decode the WHOLE chunk (his 8 MB for a 28 kB png, 2026-10-25).
          const known = payloadOf.get(plan.parts[i]);
          // A window the prefetch already pulled: answer from it instead of asking again.
          const held = known ? null : ttWinGet(plan.parts[i], off, want);
          const part = known || held || await ttWindow(plan, i, off, want);
          const n = Math.min(want, part.length - (known ? off : 0));
          if (n <= 0) throw new Error(`part ${i + 1} ends before byte ${at}`);
          ctrl.enqueue(known ? part.subarray(off, off + n) : part.subarray(0, n));
          at += n;
          return;
        }
        const part = await partPayload(plan, i, off + want);
        const n = Math.min(want, part.length - off);
        if (n <= 0) throw new Error(`part ${i + 1} ends before byte ${at}`);
        ctrl.enqueue(part.subarray(off, off + n));
        at += n;
      } catch (e) {
        ctrl.error(e);
      }
    },
  });
}

async function totalBytes(plan) {
  const last = await partPayload(plan, plan.parts.length - 1);
  plan.total = (plan.parts.length - 1) * plan.cap + last.length;
  // Written back so the next request (and a restarted worker) knows the size without refetching —
  // only when this plan HAS an id; a plan rebuilt from the address has no entry to write to.
  if (plan.id) {
    const cache = await caches.open(PLAN_CACHE);
    await cache.put(planKey(plan.id), new Response(JSON.stringify(plan), {
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  return plan.total;
}

// ─── `/file/<archive>/<member>`: the member AS a response, not as a page ───────────────────────

// path has, and the RESPONSE should be the file — `Content-Type` from its name,
// `Content-Disposition: inline; filename="…"`, `Accept-Ranges`, real byte ranges — so the tab is
// the browser's own viewer and "Save as" knows the name. A page can imitate the pixels; it cannot
// imitate the headers, because a document's headers are its own.
//
// A folder (`…/dir/`, or a directory entry) is a LISTING, so this answers null and the renderer
// shows its `Index of` table at the same address.
const sitePath = new URL('./', self.location.href).pathname;      // '/' or '/<repo>/'

function archiveAddress(pathname) {
  if (!pathname.startsWith(sitePath + 'file/')) return null;
  const rest = pathname.slice((sitePath + 'file/').length);
  const cut = rest.indexOf('/');
  if (cut <= 0) return null;                                       // /file/<archive>: the listing
  const member = rest.slice(cut + 1);
  if (!member || member.endsWith('/')) return null;                // a folder: the renderer
  try {
    return { archive: decodeURIComponent(rest.slice(0, cut)), member: decodeURIComponent(member) };
  } catch (e) { return null; }
}

// Which bytes make up the archive. The renderer writes this when it lists an archive (`archive-`

// Without that plan a bare pbs id resolves on its own: its first part is read as a PREFIX, and what
// that part holds (a master, a tt2png index, or the archive itself) is followed.
async function archivePlan(address) {
  const key = planKey('archive-' + await digestHex(address));
  const hit = await (await caches.open(PLAN_CACHE)).match(key).catch(() => null);
  if (hit) {
    try { return await hit.json(); } catch (e) { /* resolve it below */ }
  }
  const id = String(address).replace(/\.[A-Za-z0-9]+$/, '');
  if (!/^[A-Za-z0-9_-]{15}$/.test(id)) return null;                // a name needs the page's keyring
  const plan = { id: null, name: address, mime: 'application/zip', cap: 2421906,
                 parts: ['https://pbs.twimg.com/media/' + id + '?format=png'], total: 0 };
  let got;
  try { got = await firstPayload(plan); } catch (e) { return null; }
  if (!got || !got.payload) return null;
  const payload = got.payload;
  const head = new TextDecoder('utf-8', { fatal: false }).decode(payload.subarray(0, 64)).trimStart();
  if (head.startsWith('#bin2png-manifest')) {
    const parts = [];
    for (const line of new TextDecoder().decode(payload).split('\n')) {
      const f = line.split('\t');
      if (f[0] === 'part' && f[2]) parts.push(f[2]);
    }
    return parts.length ? { ...plan, parts } : null;
  }
  if (head.charAt(0) === '{') {
    let index = null;
    try { index = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return null; }
    if (!index || index.tool !== 'tt2png' || !Array.isArray(index.chunks) || !index.chunks.length) return null;
    return { id: null, name: index.name || address, mime: 'application/zip',
             cap: Number(index.chunk_size) || 2421906,
             parts: index.chunks.map((c) => c.url), total: Number(index.bytes) || 0, tt: true };
  }
  // A packed payload's byte N is not the file's byte N, so no offset can be trusted.
  if (got.packed) return null;
  return plan;                                                     // the parts ARE the archive
}

// The first payload's head, inflated when the encoder wrapped it (`B2PZ`). A PREFIX, never a part:
// a 5.8 KB index costs ~70 KB of PNG this way instead of the whole 2.4 MB part.
async function firstPayload(plan) {
  let payload = await partPayload(plan, 0, 70000);
  const packed = payload.length > 9 && payload[0] === 0x42 && payload[1] === 0x32 &&
                 payload[2] === 0x50 && payload[3] === 0x5a && payload[4] === 1;
  if (packed) payload = await inflateTolerant(payload.subarray(9));
  return { payload, packed };
}

const U16 = (b, o) => b[o] | (b[o + 1] << 8);
const U32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// Bytes [start, end] of the FILE, through the same range machinery the player uses (part or chunk,
// decoded only as far as this range needs).
async function fileBytes(plan, start, end) {
  if (end < start) return new Uint8Array(0);
  const last = Math.min(end, plan.total - 1);
  const body = new Response(streamRange(plan, start, last, plan.total));
  return new Uint8Array(await body.arrayBuffer());
}

// The archive's directory, read ONCE per plan: every further member costs its own bytes, not the
// listing again.
const DIRS = new Map();
async function zipDir(plan) {
  const key = plan.parts.join('|') + '#' + plan.total;
  if (DIRS.has(key)) return DIRS.get(key);
  const total = plan.total;
  const tailStart = Math.max(0, total - 65557);
  const tail = await fileBytes(plan, tailStart, total - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (U32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('no zip end-of-directory record in the last 64 KB');
  const cdOff = U32(tail, eocd + 16);
  const cdSize = U32(tail, eocd + 12);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff) throw new Error('ZIP64: the page reads these');
  const from = Math.min(cdOff, tailStart);
  const cd = await fileBytes(plan, from, Math.min(total - 1, cdOff + cdSize + 64));
  const dir = new Map();
  let k = cdOff - from;
  const end = Math.min(k + cdSize, cd.length);
  while (k + 46 <= end && U32(cd, k) === 0x02014b50) {
    const method = U16(cd, k + 10), csize = U32(cd, k + 20);
    const nlen = U16(cd, k + 28), elen = U16(cd, k + 30), clen = U16(cd, k + 32);
    const localOff = U32(cd, k + 42);
    const name = new TextDecoder().decode(cd.subarray(k + 46, k + 46 + nlen));
    if (!dir.has(name)) dir.set(name, { name, method, csize, localOff, dir: /\/$/.test(name) });
    k += 46 + nlen + elen + clen;
  }
  DIRS.set(key, dir);
  return dir;
}

async function zipEntry(plan, want) {
  const dir = await zipDir(plan);
  const entry = dir.get(want) || dir.get(want + '/');
  if (!entry || entry.dir) return null;
  const head = await fileBytes(plan, entry.localOff, entry.localOff + 29);
  if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4)) return null;
  const nlen = U16(head, 26), elen = U16(head, 28);
  return { ...entry, start: entry.localOff + 30 + nlen + elen };
}

// A member's own type. The media list above is what a PLAN needs; this is what a FILE needs: the
// browser's viewer picks itself from these, exactly as it would for a `file:///` tab.
const MEMBER_MIME = {
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8', json: 'application/json', xml: 'application/xml',
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8', py: 'text/x-python', sh: 'text/x-shellscript',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', pdf: 'application/pdf',
  zip: 'application/zip', gz: 'application/gzip', '7z': 'application/x-7z-compressed',
  apk: 'application/vnd.android.package-archive', jar: 'application/java-archive',
};
function memberMime(name) {
  const ext = (String(name || '').match(/\.([A-Za-z0-9]+)$/) || [])[1];
  return (ext && (MEMBER_MIME[ext.toLowerCase()] || MIME_BY_EXT[ext.toLowerCase()])) ||
    'application/octet-stream';
}

async function memberResponse(plan, entry, request) {
  const name = entry.name.replace(/^.*\//, '');
  const headers = {
    'Content-Type': memberMime(name),
    'Content-Disposition': filenameHeader(name),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  };
  if (!entry.csize) {
    return new Response(new Uint8Array(0), { status: 200, headers: { ...headers, 'Content-Length': '0' } });
  }
  // A STORED member is a byte range of the archive, so it answers ranges itself (a video in a tab
  // then seeks like any other). A deflated one has to be inflated whole, and says so with a 200.
  if (entry.method === 0) {
    const r = parseRange(request.headers.get('Range'), entry.csize);
    if (r && r.unsatisfiable) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${entry.csize}` } });
    }
    if (r) {
      const body = await fileBytes(plan, entry.start + r.start, entry.start + r.end);
      return new Response(body, { status: 206, headers: {
        ...headers, 'Content-Range': `bytes ${r.start}-${r.end}/${entry.csize}`,
        'Content-Length': String(body.length),
      } });
    }
  }
  const comp = await fileBytes(plan, entry.start, entry.start + entry.csize - 1);
  let bytes = comp;
  if (entry.method === 8) {
    bytes = new Uint8Array(await new Response(new Blob([comp]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  } else if (entry.method !== 0) {
    return null;
  }
  return new Response(bytes, { status: 200, headers: { ...headers, 'Content-Length': String(bytes.length) } });
}

async function serveMember(address, request) {
  try {
    const plan = await archivePlan(address.archive);
    if (!plan) return null;
    if (!Number(plan.total)) plan.total = await totalBytes(plan);
    const entry = await zipEntry(plan, address.member);
    if (!entry) return null;
    
    // 2026-10-25): the renderer opens it as its own `Index of` page.
    if (/\.(zip|apk|jar|7z)$/i.test(entry.name)) return null;
    return await memberResponse(plan, entry, request);
  } catch (e) {
    return null;                       // the renderer, which renders a member by itself
  }
}

// ─── a part, without downloading it whole ──────────────────────────────────────────────────────
// pbs.twimg.com answers `Range: bytes=0-204799` with 206 and the bytes, so a PNG can be read from
// its start. The payload is the pixel data in file order, so a PNG *prefix* decodes to a *payload
// prefix*: inflate what arrived (a cut deflate stream still yields every block that completed),
// unfilter the rows that are whole, walk the alpha markers. Measured on a real part: 200 KB of a
// 2.6 MB PNG gave 375,766 payload bytes — 13× less network than downloading it first.
// No new metadata and no change to how a payload is uploaded: this reads the PNGs that already
// exist, with the one thing they already carry — their own pixel data.
function concatBytes(list) {
  let n = 0;
  for (const c of list) n += c.length;
  const all = new Uint8Array(n);
  let at = 0;
  for (const c of list) { all.set(c, at); at += c.length; }
  return all;
}

const netBytes = new Map();    // part url -> bytes actually fetched from the network
const REQLOG = [];             // the last 300 ranged reads: { who, part, from, want, got }
function noteReq(who, part, from, want, got) {
  REQLOG.push({ who, part: String(part).slice(-10), from, want, got });
  if (REQLOG.length > 300) REQLOG.shift();
}
const prefixOf = new Map();    // part url -> { bytes, eof }: the PNG bytes in hand so far
const payloadOf = new Map();   // part url -> Uint8Array: a part that has been read in full
const partLocks = new Map();   // part url -> promise, so two ranges never grow one part at once

// The PAYLOAD of part i — at least `need` bytes of it, when the part is that long. `Infinity` means
// the whole part. A returned array shorter than `need` is a part that really ended there.
function partPayload(plan, i, need = Infinity) {
  const key = plan.parts[i];
  const done = payloadOf.get(key);
  if (done) return Promise.resolve(done);
  const job = (partLocks.get(key) || Promise.resolve()).then(() => growPart(plan, i, need));
  partLocks.set(key, job.catch(() => {}));
  return job;
}

async function growPart(plan, i, need) {
  const key = plan.parts[i];
  const done = payloadOf.get(key);
  if (done) return done;

  let e = prefixOf.get(key);
  if (!e) {
    // Read in an earlier visit: the complete payload is cached under the part URL, so a repeat
    // view of the same file costs no network at all.
    const cache = await caches.open(PART_CACHE);
    const hit = await cache.match(key);
    if (hit) {
      const whole = new Uint8Array(await hit.arrayBuffer());
      payloadOf.set(key, whole);
      return whole;
    }
    e = { bytes: new Uint8Array(0), eof: false };
    prefixOf.set(key, e);
  }

  let dec = null;
  for (let round = 0; round < 24; round++) {
    if (e.bytes.length >= 33) {
      dec = await pngPrefixPayload(e.bytes);
      if (dec === null) throw new Error(`part ${i + 1} is not a bin2png PNG`);
      if (dec.complete) return settle(plan, i, dec.payload);
      if (dec.payload.length >= need) return dec.payload;
    }
    if (e.eof) return settle(plan, i, dec ? dec.payload : new Uint8Array(0));
    // One request ahead of what is needed: the PNG runs ~8% larger than the payload it carries, and
    // the first window is big enough that ordinary playback never needs a second one.
    const want = need === Infinity
      ? (1 << 30)
      : Math.max(65536, Math.ceil(need * 1.08) + 8192 - e.bytes.length);
    const got = await fetchPrefix(key, e.bytes.length, want);
    e.bytes = concatBytes([e.bytes, got.bytes]);
    e.eof = got.whole || got.bytes.length < want;
  }
  // 24 growth rounds is a bug, not a slow network. Say so instead of pretending the part ended.
  throw new Error(`part ${i + 1} could not be read past ${e.bytes.length} B`);
}

async function fetchPrefix(url, from, want) {
  const res = await fetch(url, {
    // (logged below, once the length is known)
    mode: 'cors',
    credentials: 'omit',
    // EVERY read is a Range request, the first one included. Sending no Range on the first read is
    // what made a "prefix" fetch the whole part (measured: 2,581,670 B for a window that needed
    // 574,297) — `bytes=0-N` is the only form that actually bounds the response.
    headers: { Range: `bytes=${from}-${from + want - 1}` },
  });
  if (!res.ok) throw new Error(`part: HTTP ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  netBytes.set(url, (netBytes.get(url) || 0) + body.length);
  noteReq('prefix', url, from, want, body.length);

  // 200 = the server ignored Range and sent the whole file, which is also a fine answer.
  return { bytes: body, whole: res.status !== 206 };
}

// ─── a tt2png part (TikTok): the payload is APPENDED after the PNG's IEND ─────────────────────
// Not the same shape as a bin2png part, which carries its bytes in pixels: here the PNG is a 70-byte
// 1×1 and everything after IEND is the file. So the payload prefix is a byte prefix, and only the
// envelope has to be found first (`pngTail`). Same contract as partPayload: at least `need` bytes,
// padded by nothing, and the same part cache so a re-view costs no network.
function pngTail(bytes) {
  if (!(bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const end = off + 8 + len + 4;
    if (type === 'IEND') return bytes.subarray(Math.min(end, bytes.length));
    if (end > bytes.length) return null;      // the envelope is not in hand yet
    off = end;
  }
  return null;
}

// The payload starts right after IEND. Reading it once costs one 512-byte request; after that any
// window of any chunk is a single ranged request of exactly the bytes asked for.
const TTHDR = new Map();        // part url -> the payload's byte offset in the PNG
// The windows already fetched from each chunk, so a prefetch and the read that follows it are ONE
// request — and so are two readers on the same chunk at the same time. MORE THAN ONE per url on
// purpose: a single slot is evicted by whichever reader asked last, and the other then re-fetches a
// whole 5 MB chunk (measured 2026-10-25: two of nine chunks read twice, ~17 MiB of the 52.5 MiB).
const TTWIN = new Map();        // part url -> [{ off, bytes }, …] newest first
const TTWIN_PER_URL = 3;        // a member read touches a chunk from 1-2 offsets; 3 is slack
const TTWIN_MAX = 12;           // urls kept; a long download slides through more, oldest goes first
function ttWinGet(key, off, want) {
  for (const w of TTWIN.get(key) || []) {
    if (off >= w.off && off + want <= w.off + w.bytes.length) {
      return w.bytes.subarray(off - w.off, off - w.off + want);
    }
  }
  return null;
}
function ttWinPut(key, off, bytes) {
  if (!bytes.length) return;
  const list = (TTWIN.get(key) || []).filter((w) => w.off !== off);
  list.unshift({ off, bytes });
  TTWIN.set(key, list.slice(0, TTWIN_PER_URL));
  while (TTWIN.size > TTWIN_MAX) TTWIN.delete(TTWIN.keys().next().value);
}
// ONE request per (chunk, window), shared by every caller waiting on it. The "one part ahead"
// prefetch and the read that follows it ask for the SAME window; without this they both miss the
// cache (neither has finished) and the chunk is fetched twice — measured 2026-10-25 on his 267 MB
// index: 10 chunk reads for 7 chunks, 52.5 MiB instead of 32.3 MiB. Same for the 512-byte probe,
// which two racing callers both ran.
const TTLOCK = new Map();       // "<url>#head" -> promise (the 512-byte probe)
const TTFLIGHT = new Map();     // url -> promise of { off, bytes }: one fetch of a chunk at a time
function ttWindow(plan, i, off, want) {
  const key = plan.parts[i];
  const serve = async () => {
    const hit = ttWinGet(key, off, want);
    if (hit) return hit;
    const known = payloadOf.get(key);
    if (known) return known.subarray(off, off + want);
    return ttWindowNow(plan, i, off, want);
  };
  const cur = TTFLIGHT.get(key);
  if (cur) {
    // Somebody is already fetching this chunk. Wait for THEIR bytes and slice if they cover us;
    // otherwise take our own turn. A plain per-window lock was not enough: the prefetch asks for the
    // whole chunk (want = cap) and the read that follows asks for exactly what is left (want =
    // end-at+1), so the two keys differed and the chunk went out twice — measured 2026-10-25.
    return cur.then(
      (w) => (w && off >= w.off && off + want <= w.off + w.bytes.length
        ? w.bytes.subarray(off - w.off, off - w.off + want)
        : serve()),
      () => serve(),
    );
  }
  const job = serve()
    .then((bytes) => ({ off, bytes }))
    .finally(() => { TTFLIGHT.delete(key); });
  TTFLIGHT.set(key, job);
  return job.then((w) => w.bytes);
}
async function ttWindowNow(plan, i, off, want) {
  const key = plan.parts[i];
  // The whole chunk is already in hand: answer from it, whatever window was asked for.
  const known = payloadOf.get(key);
  if (known) return known.subarray(off, off + want);
  let hdr = TTHDR.get(key);
  if (hdr === undefined) {
    hdr = await ttHeader(plan, i, key);
  }
  const res = await fetch(key, { mode: 'cors', credentials: 'omit',
                                 headers: { Range: `bytes=${hdr + off}-${hdr + off + want - 1}` } });
  if (!res.ok && res.status !== 416) throw new Error(`part ${i + 1}: HTTP ${res.status}`);
  return finishWindow(plan, i, key, off, want, res);
}
// The payload's byte offset inside the chunk PNG, once per chunk and once only however many readers
// ask at the same time.
async function ttHeader(plan, i, key) {
  const lock = key + '#head';
  const cur = TTLOCK.get(lock);
  if (cur) return cur;
  const job = (async () => {
    const res = await fetch(key, { mode: 'cors', credentials: 'omit',
                                   headers: { Range: 'bytes=0-511' } });
    if (!res.ok) throw new Error(`part ${i + 1}: HTTP ${res.status}`);
    const head = new Uint8Array(await res.arrayBuffer());
    netBytes.set(key, (netBytes.get(key) || 0) + head.length);
    noteReq('probe', key, 0, 512, head.length);
    const tail = pngTail(head);
    if (!tail) throw new Error(`part ${i + 1} is not a tt2png PNG`);
    const hdr = head.length - tail.length;
    TTHDR.set(key, hdr);
    return hdr;
  })().finally(() => TTLOCK.delete(lock));
  TTLOCK.set(lock, job);
  return job;
}
async function finishWindow(plan, i, key, off, want, res) {
  const body = new Uint8Array(await res.arrayBuffer());
  netBytes.set(key, (netBytes.get(key) || 0) + body.length);
  noteReq('win:' + String(plan.name || plan.id || '?').slice(0, 12), key, off, want, body.length);
  // A read that covers the whole chunk keeps it (payloadOf is checked before any fetch), so the next
  // reader of this chunk — a second stream, or the member after its directory — costs nothing.
  if (off === 0 && plan.cap && body.length === plan.cap) {
    payloadOf.set(key, body);
    prefixOf.delete(key);
  } else {
    ttWinPut(key, off, body);
  }
  return body;
}

async function ttPartPayload(plan, i, need = Infinity) {
  const key = plan.parts[i];
  const done = payloadOf.get(key);
  if (done) return Promise.resolve(done);
  const job = (partLocks.get(key) || Promise.resolve()).then(async () => {
    const cached = await (await caches.open(PART_CACHE)).match(key);
    if (cached) {
      const whole = new Uint8Array(await cached.arrayBuffer());
      payloadOf.set(key, whole);
      return whole;
    }
    let e = prefixOf.get(key);
    if (!e) { e = { bytes: new Uint8Array(0), eof: false }; prefixOf.set(key, e); }
    for (let round = 0; round < 24; round++) {
      const tail = pngTail(e.bytes);
      if (tail && e.eof) return settleTT(plan, i, tail);
      if (tail && tail.length >= need) return tail;
      if (e.eof) return settleTT(plan, i, tail || new Uint8Array(0));
      const want = need === Infinity
        ? (1 << 30)
        : Math.max(262144, need + 4096 - e.bytes.length);
      const got = await fetchPrefix(key, e.bytes.length, want);
      e.bytes = concatBytes([e.bytes, got.bytes]);
      e.eof = got.whole || got.bytes.length < want;
    }
    throw new Error(`part ${i + 1} could not be read past ${e.bytes.length} B`);
  });
  partLocks.set(key, job.catch(() => {}));
  return job;
}

function settleTT(plan, i, payload) {
  const key = plan.parts[i];
  if (i !== plan.parts.length - 1 && payload.length !== plan.cap) {
    throw new Error(`part ${i + 1} holds ${payload.length} B, not the planned ${plan.cap}`);
  }
  payloadOf.set(key, payload);
  prefixOf.delete(key);
  caches.open(PART_CACHE).then((cache) => cache.put(key, new Response(payload, {
    headers: { 'Content-Type': 'application/octet-stream' },
  }))).catch(() => {});
  return payload;
}

// A part that reached its end: check it against the plan, remember it, cache it.
function settle(plan, i, payload) {
  const key = plan.parts[i];
  // A short part in the middle means the file was not cut at this capacity, so every offset after
  // it would be wrong. Refusing is the only honest answer.
  if (i !== plan.parts.length - 1 && payload.length !== plan.cap) {
    throw new Error(`part ${i + 1} holds ${payload.length} B, not the planned ${plan.cap} — ` +
                    'this payload was not encoded at the default canvas');
  }
  payloadOf.set(key, payload);
  prefixOf.delete(key);   // the PNG bytes that produced it are dead weight now
  caches.open(PART_CACHE).then((cache) => cache.put(key, new Response(payload, {
    headers: { 'Content-Type': 'application/octet-stream' },
  }))).catch(() => {});
  return payload;
}

// ─── the codec, in the worker ──────────────────────────────────────────────────────────────────
// The same two forms the page reads: colour type 6 (RGBA, alpha = byte count) and colour type 3
// (palette + tRNS, which is what X re-encodes an upload to). Everything needed to decode lives
// before the first IDAT, so a prefix of the file is always enough to start.
async function pngPrefixPayload(bytes) {
  if (!(bytes.length > 33 && bytes[0] === 0x89 && bytes[1] === 0x50)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  let plte = null, trns = null, complete = false;
  const idat = [];
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const start = off + 8, end = Math.min(start + len, bytes.length);
    const cut = end < start + len;   // the chunk is only half in hand
    if (type === 'IHDR' && !cut) {
      w = dv.getUint32(start); h = dv.getUint32(start + 4);
      depth = bytes[start + 8]; color = bytes[start + 9]; interlace = bytes[start + 12];
    } else if (type === 'PLTE') plte = bytes.subarray(start, end);
    else if (type === 'tRNS') trns = bytes.subarray(start, end);
    else if (type === 'IDAT') idat.push(bytes.subarray(start, end));
    else if (type === 'IEND') { complete = true; break; }
    if (cut) break;
    off = start + len + 4;
  }
  const palette = color === 3 && depth === 8 && plte && plte.length >= 3;
  if (depth !== 8 || interlace !== 0 || !w || !h || !idat.length) return null;
  if (color !== 6 && !palette) return null;
  const raw = await inflateTolerant(concatBytes(idat));
  return { payload: rowsToPayload(raw, w, h, color, plte, trns), complete };
}

// A deflate stream that stops mid-way errors on the read after its last full block — but every
// chunk that already arrived is real output, and that is exactly what a prefix needs.
async function inflateTolerant(zip) {
  const chunks = [];
  let total = 0;
  try {
    const reader = new Blob([zip]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length) { chunks.push(value); total += value.length; }
    }
  } catch (e) { /* truncated stream: keep what came through */ }
  if (chunks.length === 1) return chunks[0];
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return all;
}

// Scanlines → payload bytes, for as many whole rows as the inflate produced.
function rowsToPayload(raw, w, h, color, plte, trns) {
  const bpp = color === 3 ? 1 : 4;
  const stride = w * bpp;
  const rows = Math.min(h, Math.floor(raw.length / (stride + 1)));
  const px = new Uint8Array(rows * stride);
  let p = 0;
  for (let y = 0; y < rows; y++) {
    const f = raw[p++], row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0;
      const b = y > 0 ? px[prev + x] : 0;
      const c = (x >= bpp && y > 0) ? px[prev + x - bpp] : 0;
      let v = raw[p++];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      px[row + x] = v & 0xff;
    }
  }
  const out = [];
  if (color !== 3) {
    for (let i = 0; i < px.length; i += 4) {
      const alpha = px[i + 3];
      if (alpha === 0) break;
      if (alpha === 255) out.push(px[i], px[i + 1], px[i + 2]);
      else if (alpha === 170) out.push(px[i], px[i + 1]);
      else if (alpha === 85) out.push(px[i]);
    }
  } else {
    for (let i = 0; i < px.length; i++) {
      const idx = px[i];
      const a = trns && idx < trns.length ? trns[idx] : 255;
      if (a === 0) break;
      const at = idx * 3;
      out.push(plte[at]);
      if (a >= 255 || (a !== 170 && a !== 85)) out.push(plte[at + 1], plte[at + 2]);
      else if (a === 170) out.push(plte[at + 1]);
    }
  }
  return new Uint8Array(out);
}
