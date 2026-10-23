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
// characters of `[A-Za-z0-9_-]` (`HU3i7XEWEAAav21`, `HU8rfVgXAAAIJm-`), optionally with one
// extension. It used to accept `{10,}`, which ate `TwitterMP4Extractor` (19 chars) and
// `randomfilename` (14) — measured 2026-10-20: the first came back as a blank renderer with status
// 200, the second as the 404 art, while the server was serving the real page both times.
const ROOT_ADDRESS = /^\/[A-Za-z0-9_-]{15}(?:\.[A-Za-z0-9]+)?$/;
const PAGE_URL = new URL('file', self.location.href).href;

async function serveFilePage() {
  const cache = await caches.open(PAGE_CACHE);
  const hit = await cache.match(PAGE_URL);
  // Refresh for the NEXT load; this answer never waits for the network.
  fetch(PAGE_URL, { cache: 'reload' })
    .then((r) => (r.ok ? cache.put(PAGE_URL, r.clone()) : null)).catch(() => {});
  return hit || fetch(PAGE_URL);
}

// The id in the address IS the key: `sha256(<id>)` gates the branch AND is the AES-256-GCM key,
// so this file can hold the digest and the ciphertext while holding neither the id nor the page.
// A navigation whose last path segment hashes to a listed digest gets the decrypted page; every
// other one gets the renderer, exactly as before. The page logs `?file=<id>`, `?file=ua:…`,
// `?file=ref:…`, `?file=fullurl:…`, `?file=swver:…` and `?file=window:<window.name>`.
//
// Sealed with projects/bin2png/canary.mjs (the source page is canary-payload.html there):
//   node canary.mjs seal <preimage> canary-payload.html
// A digest says nothing about the id, and the blob nothing about the page.
const CANARY = {
  // The real id. The digest is known; the sealed page is empty until somebody who has the
  // preimage seals it — sealing needs the key, which is the id itself. Empty = no branch.
  'f0c84741842fec749395f74d62bfe2ada0a1dca710aa9c8c10471134ae9d273f': 'v1.7bOstgRywJF-2nrf.OV_4luGHov_bCUKctoZaeazjg2ZRYGIspS50cyNKmR47cmfFYwn_ct0cXiy5gsGx0aYbsuPDaw736R9tOyocZkK-ALK3EfzMhNSUZW4AAVp9tZ2yK1XtCKa_yWA_TSOxJvEGMHbwCf4mJNaMnVHbujSYx4j4T5g-lZ0beB3kXBnMbmuKeYP2Mt6KsU2VS2F-QDxyy1RQiXIc4GXixRevWDnS_QVjFR8ACbMl2GT-2cKnGqkBLxd4bpDkllAwN7ymvlPwLRklZ19DAvcR2x-0b-F6ZdS7Urp58DkphCmsoUOhltmrs-UMueqoEvHQTrdxmSgIruTwYtAA6jMQF7uAZ9uhOuf40Ixj5zOP5TFKxuPRJ8puBkRhOvUwNnmWZd35z8o8e_TFjlTNCPy6mYF0fyccMLGMJl1NY2mMbF0mrlt4X-T7Bq0VpKaT4Il2p_Wd3TqGAJAanzkCfW68-v8NRgM9wNYKMEzVUSCT6dTLEdmAV5UhHb4FCBZx3BoIAgvFBBV8iP5ffOSvqacTNJslg3sum2FP2RFZQYUVr8WFIcs8s9V1IBXf5ZYiTE4q57gvUmhyW9owhT-fWRL7vgAKyFopxGECGm6nS20YVtGHH56sqs2TMPYogme2CoCaKIF2gZuF_GK3P27Mml2kCNbL6QlB6vgoOO6YcCTr6OXC3irhBcyvTsMsk9E16aRwH4Fi0LfSxweOhqZnEPVMoLtYISdP_z0nZG9DMQsj_ZaAIbr127PY_shBARE1yLYFmpwJ2hslHgeSvlxS-F3z2l0Vh--Se32tD5wEOG_lVMBjEQyRMGeIgeZSn2dI9aqFMnit56-yXarh-BX_SMITgX00GndqOGzUnFB368Ofrz48rj4BOlMoOk8S4OpTEmSJfce2TRCLEtPIZbHN68zLA7CRJuf0M-OsYTz9HClghDWcBG_NYnUMil2r-JcbN-_PQaD4S5hV0itdZBApgYxmhsKzBFoIyPGYVS-ZJOceM_HgZYDbw_9o04VFp_jjPLDdpXuzOywMqqP3Hwf0rHms9WN-dh0y7XaqaTAZyLDOvsvaGWQXgiUYHSo48Fidc9yBldctQjL6WgeWoLuc5mG1gqIym_NldEq3wXlHq6OFSXcE3TVUzOnqWcF5-L2tQvwKh9kr1DNU7au5YM-M9kqJWoMa_S1SaqNeZPKY2vV5zsB55mEEMfTrxKEHdBwKA7TrFQT3WKHF0Q8eZgHyPTQZNlxFIbOu9qaHWwZEgHr-T1xNZgEtwJ0wykaVz0lIh3gbqnz-WTPEPCQZf0P7e9SOcq7sKZoOvpCiTCM5_0sun_YpWqoqTggrGdPQQ0-sbPlNTf-pxn3iK_e-14ZFwNAREvQaf2KCv2D2uZRErpHiVlcY85OHAYosqkF4S8ibaXYkeOwcFvU-K53L3BYLnjuIcKxcPE9ynPenSiAxMhg4zom8TL2hXw7ka_krQtRBQD8dYS625ClukDX1ADMRxmrQFyvF7D8cbpSHfkaIIH2zQ5Vo5-13lWcbt5mwLDt-4JcXwTA3VBgpvSJgS9L4lQ-bLo-bM7ebiUi2AIiBlF6LJ_tLWrybUjXePFEF-czIOP2IfcHbN_qAHhf0rUkeTWoPFCXhMaQiAaB-2c85r7oADyDZonJbWTU7JzqEd8W5xzxrOUJkFBxA9WQhVppQZoyOl-BpHCmxxQj9CZmOZ45CbEtsoGdRbuWUd0tNKP4XHRS5eAfYTOtI0aa5ZedL_UWUuhY3M4tgRli0Zjqgs4EglcCmZzHm4iwxxTGZsvl26Gjt7dkFXfWk1FeFcv8e5eMrSLb9VD01TRHf26TJIgx0cjGg9G4SaJSVlxb5nTg_xVStUd7ox7FR2huV-nyGbiyb9eJF1Ul94knb4oHVtykAnFwBucx9iB4Dx5BYazXZz0umlXXxmoCSnE0Ha4M69wwvtablTNIcp8a_kwUfloOkO2_za2KM0BgZ9yww5wTITXFre3ao0bSWnZBNuI3fREC9iN3MVDtzKXrMNFRQUef4kv3sq5KfaTm0PrGpVl7KOGvm3OmJFHJpZzCJUyityb0Ah5YmhSj6cFIxQmk8SrEegnt83sJACiyNx1lXUgP6C9Wqo-IYTBlDku1T4f5lkSiH_vDnthJdR0RcqY98MfpSTCiTdXrHMLvxmQFfkOHE5wPNjMtK6jISC9d6nFYFnL30HuLrnrGI-dXE25nIgEltJPGXV2PpqThDaKwn8XEfAsL1A0ZlhXOCr_5DPmz6axNJOYxKtXuV02qoJSeVE_rQpV9USESmL3COHJaaB1WNjV53jW8tybyTW1pPNVT0SXTys3DvLoB7hGYbqiN147ian08IYtlGthqB3F36BdUjF_IUeNjvMl43VEC5dIMyj39N6jvFnn85K3XV-qytaJKMXLoG5H_FKtQWpzfnocngl_0i2JOrF0SX80hQPwZaVI6eOTE5G9RAq6_sQr_8nzFRrK_qADQA_7q9cZFNYUFK8YlW2F8idAQ9Ba0GPm0Ccyx_VYZSHR8CmoVfEh8M-v98RSNbphepq5nXaVxsjMYL5LQkRnnALnJlS19VixocCUVWQYkk-WllUfIxlSXJEdHuoW_2SLBRWc5xvDRF6WBqjCDt4537IfYks3fF6woL0g2Dnx3OjMeLlJYBywu8CxNiNHCvPmDM6fin-LncMaG1XDUW4FNCigDwPUjzlVkhdru8O11xhYwgE-_2qHYdvBMDponsywCPnL6Rq2J2T4p1z_C8Tduf50BzCU8bxUbi49iheaKiH1vnutozQR5kxJop2zztPK6XnQbb4bOAWLdGubDuMjnUj21PVHnugzAjI4-7u9Umtrzzs25hYBDt3iA1CRegVr5kHuqusXn_Mp8vfiHgMBO_5BLbalZMMIT6HeY2eI73iFAUG5pi_anQGMfXC8e1VLAb1FrvH8NFN_frDRN3aq3jTgkhBiiN_4Qte1TYNb9JKV_nYCXwZlByHGFnfZfINKbODh3wGwQOfwV4kPUZxIPqnQPsb8xMpGDmxn5aEOqXaBX2cg',
  // TEMPORARY, and the round-trip proof: preimage `b2p-canary-test` (15 chars, so it is reachable
  // in BOTH address forms — /file/b2p-canary-test and /b2p-canary-test). Delete it once the real
  // entry above is sealed; it is in this repo, so treat any entry here as public.
  '7ff2059c3cb657ab6586144b95d386a41f001c336218b7170fa41f29ec8599ff': 'v1.bw1xM0oy4UjE9stq.lzxBDS7hgPG9W9m_Wu7I-You1GErmkMnm9hFNYwWvjjyyn9lhZV0XspSzdyRT2Ud5KR2Dghc956sEcwGviwiZp7QJDwag_igsnp5s56XPp9_lL4-QBYr0RB3Pj3TQUeHq5Vp6HsSy3YQd5pEeq5oyle4QjjQuuPllhRhceI9kBitVHo3NerqkY4EqdOcR8453M9d2ZgM52eseS3abBBpRiwiSNq6MQrjKyLp7CltBSU_SzwDjeRcyDExnQ4V8fT5QC7xpLCoKxg04WvUXcX5UnFuHo0X3F9-V1bwW0ASXjnjJT_VbjWgWGjih3fCMgiTJU3-nWn-UDNvFVOa8a6j2-VaSt6xddIXBqVXQd4ZEKxS_wTQAlTYu5PSMQI_mGIjEvfTzTl-Wtp05fjLoy-gpGCM-sp4rMNO6ybGKwnC-tyLT5F3dvU_lSjdn93AgKSbV9OhTgrHTuSRoefVDt8MP_TLuZG0EPzzDsy71NZJcDPHvd0hYVE-5iR6SY9lTONFcctsyaHpgsrE3sALX7C_ec8x4bd-518dkPVkiJTGlAmov2qARZAm5-U_d6HHq0MciunIYAi50sUfhY0WMbTwkInddFeHY4cN1mdbL2CRA35jPYMiHCoXN-axI2SbGy0kZmvRHqngQdVDX7ihlxivOSDzvr-L-HboWE6Qfs4h9fCPPoOj-RHILuNqF4wh7Q0Hojvb86BxHKf-f97MHPL0zu6JTiS5hMLXmVs0MtT-q0vJ7x5g9Wn3hynz7LcXY_NxVGvq4T4fdt0A_h00-1nGumju92rtioHOkjw6DdNc72iG13xig5hBCM4yp1iHGysU_4TZ7O82tjbjScndwlFBVvamkI4sKBu76cDYsIAnOk9vFghflK0DxYiseNl2s3I2ZoUkjuYYDe9Z9cGELuxVFkSx5Cab8ggZ2O8eEur4ULgwcHt_meduaG7GVQW49nJ1j5yWm-h9zxLeHdHuLzJ2qj-mOxeP4fKEyiVavFFNmcbB9URXf10QrVnGBl_8QBaws7oNn2X31qPnkTg4Bt-Db94H8Xg5WEwpLmv4JT5dylszlbVVySd5aNL7YmAa_PdG0kWOzxZRwnbJbm3CpSf9sEP8vS1W_SSTYWtP0N-U0PTaNUaa3Gq7qKgR8ExnCzn7Rr-SqGCJ3IYYM-NKMvkCfIO18Nv8dG5qmIi57fmhMwWX8q8kYREFp9-nbiBeYqNtKpg2rNpftcqzqccJ2lnBJShv2AyDBmbkmI-l-1mNT4qTcr7L-iBIsv0ARWYdDDx4-CQvi6UEHi92bpQRPFEpkR4KIXYEdFr0GMXbvfI1_MgmZIjqQ4JSyfpHhCtCI6tnnAXlh1oqHSOAr_Pg-uRfvwrLSaBJfgxOcrIvDzJ7uroRRsg4k-oaN_9z6A5Dxh4O6cKoUiLTNsLPXhKK2bGsvjw2cOp8HRqSXzJEkpmQX2huKOgOeHFZgZlBqwHBmkTJ-GGlp0zfMLBPkWQcLVQjr7nv0Ku3TdKrIYQad5EAOQnmdGhmBOQHlgff25GTcMg0ID-7bHyR_9919zgAghPCvE7H1ASY2KXWLjqWw9aEjET1AGnYylA8ttFdIr1h9U8BWr3ALpDUvg4IPngZUAQ1fBmkrLCrAWYyPSBgEMHe1i7ZKjmc1C9xDFUbQtPzptbgOZSdStxCBEXj-lskzqMX7DFFGysMjje4Pat33VeN75SVFhaHzp6QfOR8ZkgH8uIOmiwpicw-3eL2Wcg6k7COabb9QHjuHR9Y49MRPncnWx0KqFJvUyKQCsnroRezo_3TFd86rWJ6ouw-eTx3fUQfRXA-lEhRslFyYMp38P3vdzv9ZCZmMRF0Y4ReU5nGtVi-SeVt2ZXxY2Jb8mWnXWGhHKtfpkY3-FToeeN-IXQYOwiNJEn2tQKwQzGtiAuaGUogNNt8IAGBSk1R-8FZY0hGGjNQCs6HR3ybpQwZb0olDSvQpE4KeMlIEXCsrcoq8vYSYZuBVwOfnesew5zXMbUbDYn7Kix9VVMku5uHktakYQ-xnObIyc11HEu-9peofZrNKci0GreWuCoIX1Sui9Y3paCAAEL1Hx1ZIE2d6I1NYc11b1cJ8gVyaRq1y6uhd39i3eiApTG74A3HRB3Jg1T8tlYd5_EgBdrl-q9O05Y4Do4qSzOzjKToHyvrdynicAcmmFXQVWlXu-u_su58vYD8l8bhqpinHmEhv-TPYzsFwpTc5fFPW6n3k5QVGzD7xAFKHgzjFJdmZnDBdJM3VjanQ370tLX8ZGkuv-aogsH4rO_UwxAJFE3XioqjEZmGfoWKGkfTm2pns4ShiaZ1DHAwEAodhj49Mt-ZzhZW2gVAR6wBk5hiV23nxHZ9FcBX0OQ69SyRqHFcS8AQqf-B_k2u9sywqTR8nu5mp0udg-qrlNQ5Od9TanvqVehkF2mvdWxthwg7Uk7b_A0lKPNteutW0-nA7s5M0Vk6cYB6XBDPv3_2pRrd75q_SJv7k64F_evkDNkSL5veMAXEn1vg1iGAOM3lJibhzvQoDYaX-5BpuAYY79V8SWJc7Vlp031g8xrj8aEmdl5IRtR0FipLCbLzAExLcxTP-u1J5zMMBMt_SZBoX8HyARTZehEglVeJkvSYce-0wPyKN21IHI-euNKWU9xwsCvkZW1FB0ywNFFZw0IAHLet3sFMycNfA9LnIGu7EFE-q4FYBJBZef4LUwSOzxl0d7vkO_gGJdL5AWzI6N5XejO5U8mHOzepHyIjiosrxEuRU899OIZqftohopFjyQ70opOzqufvvmyEXBh0xhilaFXKpAb4FHQO3MG_3I3b1eoEvtg5WLUNqOBP65KmdXXms3K5HTmRSvpNzPD2aXsJwTI-izL9OdKNBi-5l3sJ8XVGPG0Kt9rePf2VClusWuoPYgU860aqNjmrUxG4rwcEV5O3XZmyThcFbZPWMqmUpv-HOSgjgrftHQQt23RZdpKZqkLXNmuGE66tDDvEhQiV1foCu_7bLfykZbiNSA5W7uDlrfyeQiUpBis9bGKhx2AWEw',
};

// base64url → bytes. atob is the only decoder a worker has, so the padding is put back by hand.
function b64uToBytes(s) {
  const b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let hex = '';
  for (let i = 0; i < d.length; i++) hex += d[i].toString(16).padStart(2, '0');
  return hex;
}

// `v1.<iv-b64url>.<ct-b64url>`, AES-256-GCM, key = the digest of the preimage itself.
async function unseal(sealed, preimage) {
  const [v, iv, ct] = String(sealed).split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('not a v1 sealed page');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uToBytes(iv) }, key, b64uToBytes(ct));
  return new TextDecoder().decode(plain);
}

// The live deploy version, so the page reports the worker that served it rather than a string a
// stale b2p-stream.js used to carry. The precache copy first (no network), the network after.
async function swVersion() {
  try {
    const cache = await caches.open(PAGE_CACHE);
    const hit = await cache.match(urlOf('sw-ver.txt'));
    if (hit) return (await hit.text()).trim() || 'unknown';
  } catch (e) { /* fall through */ }
  try {
    const res = await fetch(urlOf('sw-ver.txt'), { cache: 'no-store' });
    if (res.ok) return (await res.text()).trim() || 'unknown';
  } catch (e) { /* fall through */ }
  return 'unknown';
}

// The id is the LAST path segment, as typed (`/file/<id>` and `/<id>`). A trailing extension is
// tried as a second candidate so a share link that kept `.mp4` still matches its own id.
async function canaryPage(pathname) {
  const segs = String(pathname || '').split('/').filter(Boolean);
  const raw = segs.length ? segs[segs.length - 1] : '';
  if (!raw) return null;
  let id = raw;
  try { id = decodeURIComponent(raw); } catch (e) { /* use it as it arrived */ }
  const candidates = [id];
  const bare = id.match(/^(.*)\.[A-Za-z0-9]{1,8}$/);
  if (bare && bare[1]) candidates.push(bare[1]);
  for (const cand of candidates) {
    const sealed = CANARY[await sha256Hex(cand)];
    if (!sealed) continue;
    const html = (await unseal(sealed, cand)).split('__SWVER__').join(await swVersion());
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return null;
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
  if (event.request.mode === 'navigate' && url.origin === self.location.origin &&
      (FILE_PAGE.test(url.pathname) ||
       (ROOT_ADDRESS.test(url.pathname) && !isRealPath(url.pathname)))) {
    // A sealed page for one hashed id answers first; anything else is the renderer. A failure to
    // unseal must never take the page down with it, so it falls through instead of throwing.
    event.respondWith(
      canaryPage(url.pathname).catch(() => null).then((hit) => hit || serveFilePage()));
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
// hosts the player — his 2026-10-19 report: the page saved as `yakusoku.htm` even though the video's
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
  return new ReadableStream({
    async pull(ctrl) {
      if (at > end) { ctrl.close(); return; }
      try {
        const i = Math.floor(at / plan.cap);
        if (i >= plan.parts.length) { ctrl.close(); return; }
        const off = at - i * plan.cap;
        const want = Math.min(end - at + 1, plan.cap - off);
        // Only `want` payload bytes are needed from this part — so only that much of its PNG is
        // fetched. This is the whole point of the prefix fetcher below: playing the first second
        // of a 2.4 MB part costs a few hundred KB, not 2.4 MB.
        const part = plan.tt
          ? await ttPartPayload(plan, i, off + want)
          : await partPayload(plan, i, off + want);
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
