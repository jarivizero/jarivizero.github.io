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

const PRECACHE = ['file', 'sw-ver.txt'];
const FRESH_ONLY = ['sw-ver.txt'];
const urlOf = (rel) => new URL(rel, self.location.href).href;
const DICT_URL = urlOf('IDSDICTIONARY.txt');

const BUILT_VER = "390c71818292a311";
const DICT_INLINE = "# IDSDICTIONARY \u2014 file name \u2192 pbs id, for bin2png.\n#\n# Open the decoder with a name instead of an id:      bin2png.html#yakusoku.mp4\n# The NAME is the key. The page sha256s it to find the line, then decrypts the id on that line\n# with the same name \u2014 so a renamed file cannot open its own record, and the file itself never\n# says which names exist.\n#\n# One record per line, `#` lines are notes:\n#     v1 <sha256(name) hex> <base64url(iv || ciphertext || tag)>\n#\n# v1 = PBKDF2-HMAC-SHA256(name, salt=sha256(name), 100000) key, an HMAC-SHA256 keystream, and an\n# HMAC-SHA256 tag over iv+ciphertext. Make records with idsdictionary.py or the page's\n# \"Save IDSDICTIONARY.txt\" button; both write this same format.\n#\n# Not access control: the name is the secret. Use an unguessable name for anything private.\nv1 1d68685b5d2e75160db7d10c5e289ec8c3750e3d12f84c8214aadb94746309e3 pD39zgNDcybDXIaWaYDPRFp3Znkhol-HOCMpE8RUrChJj-utZfkcvrlzDM1zJuQxPhX7XkP1BffT4mLofkftw8ZsGLEnLQxfU708\nv1 bbc426a57ecba5c35e549ac3aba37933c83073d2cfef9a35fc2137f849d35402 wp4zRsO8yIEqVP5yBrGanZA5K8IjyIf0EUBJNcsl2HjAnEBFu_m5hFqVgiq3-sdG3dvAofTbWGJ2fVJa9xIDFw7bVYj34rLWedk3zmBNKh0wvUeWngtA-7EQng\nv1 37d4d0a8257fa5f09cbefe54b17f65fc24f7c6b8349a0e99cdfce90a631f0108 aZWi6Xf8FPejRnsPZkw4B422KDNAFgk__0keQ1iFxj1R_PIq2zq8YKuLsw\nv1 e86971614b6c71381345cae2e4d751e75c6a63a91c3f32f9be41e2fd01e52f87 _ytV583qBSzHOT9te1O10u9EgvCB8V8mvf8Vs_MxzCTdHSevb1wKoiQOqg\nv1 8f7b4b647780348916cc92ba09acb24e8d2194a5421c0217e57197e6c4e90d37 8daRWGQX4INfz9HUH3JyidLJapmfsttwrzoCvkyHlb4IiEbErURj94nqw3ygqeCrm5nk3oglGZup0aQ\nv1 b2f4f18909a4a2a5295e77e21d38d8169818650ed08b02958cfb31cd4ae65aea eaQgHWq7B28iZzliDo5kIaS1-f8YL0X0YdwjsFQN6DYShifpJHQ9l_-f_Q\nv1 6bbac2f2b2f70161fa4021ca9753cf9668b311dacea6c08d8db96e6fcd52b1d5 YUu6Y4yUR7ydXW5u9ZjDkNLbshmGQzm2ySiv1-3vrBqUNJRtKPPeu39qXg\nv1 829d594880d5c46957dfcf734d9b5973d97f1b3fd161c0851c090c67394735c2 9OIEPKnPDGE50auUCCPH_va3QrJ65riTH_TzwbY5wEGqi88spiiFehFKTw\nv1 255a9c54459a8ad7bde21652e24773d8213696d494d8f51a2f9b7e9597b3553c 3P6I-9bwCCOlPCKEhhVVlBE_zYsFLUgch_-_G0wPinXHr1BbGYZUupJu8Q\nv1 7c2883e0263f541e419a89da888a6f77cc503d89a4a3e50120d4d24570e0fe04 wkQ6EbYa3eGHXrU9zZ9i5uPANkmnTgPCisu5_bdijTZdpit-sdtivvbiaw\n";
// A copy the NETWORK gave us is kept for the build that asked for it, never across builds: a worker
// update that carries a newer baked list must not be shadowed by a cache entry an older worker wrote.
const dictKey = DICT_URL + '?cache=' + BUILT_VER;

self.addEventListener('install', (event) => {
  // `/file` is the RENDERER, precached so `/file/<name>` and `/<id>` are answered with it: the player
  // is on screen in the first frame instead of after a server round trip. The 404 art is kept fresh
  // for GitHub's own 404 page.
  event.waitUntil(resync().then(() => self.skipWaiting()));
});

// Fetch every precached file past the HTTP cache and store it. One file failing (a first deploy
// before sw-ver.txt exists, a network blip) must not stop the others.
//
// `dictChanged` is tri-state: true forces the dictionary, false skips it, and undefined means "ask
// sw-ver.txt" — which is fetched here anyway, so the answer is free. That is the whole rule: the
// dictionary goes over the wire only when the deploy has moved past the copy baked into this file.
async function resync(dictChanged) {
  const cache = await caches.open(PAGE_CACHE);
  for (const rel of PRECACHE) {
    try {
      const res = await fetch(urlOf(rel), { cache: FRESH_ONLY.includes(rel) ? 'reload' : 'default' });
      if (!res.ok) continue;
      if (rel === 'sw-ver.txt' && dictChanged === undefined) {
        const live = (await res.clone().text()).trim();
        dictChanged = !BUILT_VER || (!!live && live !== BUILT_VER);
      }
      await cache.put(urlOf(rel), res.clone());
    } catch (e) { /* keep the copy that is already there */ }
  }
  if (dictChanged) {
    try {
      const res = await fetch(DICT_URL, { cache: 'reload' });
      if (res.ok) await cache.put(dictKey, res.clone());
    } catch (e) { /* the baked list is still there */ }
  }
}

// The page asks for this after its own load event — never on the critical path. It only asks when
// IT saw sw-ver.txt move, so the dictionary is part of what it means by "changed".
self.addEventListener('message', (event) => {
  if (!event.data) return;
  // "which client am I?" — a streamed download is started from an IFRAME (Chromium cancels a
  // `download`-attribute request a worker answers, measured 2026-10-25), so `event.clientId` on that
  // request is the frame's, not the page's. The page asks for its own id and puts it in the job, so
  // the "(5/10)" messages reach the link that was clicked.
  if (event.data.type === 'whoami') {
    if (event.source && event.source.postMessage) {
      event.source.postMessage({ type: 'b2p-client', id: event.source.id || '' });
    }
    return;
  }
  if (event.data.type !== 'resync') return;
  event.waitUntil(resync(true));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const REAL_PATH = new RegExp('^/(?:' +
  'index\.html|bin2png(?:\.html)?|file(?:\.html)?|404\.html|404\.png|b2p-stream\.js|' +
  'IDSDICTIONARY\.txt|icons/.*|sitemap\.xml|robots\.txt|favicon\.ico' +
  ')$');
const isRealPath = (p) => p === '/' || REAL_PATH.test(p);

// `/file` and `/file/<name>`: the renderer, served from the precache. One document, no wrapper and
// no iframe, so nothing paints between the address and the player. The renderer reads the name from
// the path, and the typed address is never rewritten.
const FILE_PAGE = /(?:^|\/)file(?:\/.*)?$/;

const ROOT_ADDRESS = /^\/[A-Za-z0-9_-]{15}(?:\.[A-Za-z0-9]+)?$/;
const PAGE_URL = new URL('file', self.location.href).href;

async function serveFilePage(logger) {
  const cache = await caches.open(PAGE_CACHE);
  const hit = await cache.match(PAGE_URL);
  // Refresh for the NEXT load; this answer never waits for the network.
  fetch(PAGE_URL, { cache: 'reload' })
    .then((r) => (r.ok ? cache.put(PAGE_URL, r.clone()) : null)).catch(() => {});
  const res = hit || await fetch(PAGE_URL);
  if (!logger) return res;
  
  const html = await res.text();
  const at = html.lastIndexOf('</body>');
  const out = at < 0 ? html + logger : html.slice(0, at) + logger + html.slice(at);
  return new Response(out, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const HOP_BODY_HEADERS = ['content-length', 'content-encoding', 'transfer-encoding'];

async function loggedPage(request) {
  const res = await fetch(request);
  const type = res.headers.get('content-type') || '';
  if (!/text\/html/i.test(type)) return res;
  const logger = await loggerTags().catch(() => '');
  if (!logger) return res;
  const html = await res.text();
  const at = html.lastIndexOf('</body>');
  const out = at < 0 ? html + logger : html.slice(0, at) + logger + html.slice(at);
  const headers = new Headers(res.headers);
  for (const h of HOP_BODY_HEADERS) headers.delete(h);
  return new Response(out, { status: res.status, statusText: res.statusText, headers });
}

const BLOB = 'v1.TIxATq25ELg2BiCx.FDz_vcb5SW96DaNjzR0WfJZOi3zIfTaU71bggjnnkp16Km9MY-4DGdZo4qlLcXx1O_iGMI8VLsS59N3Ju_uTIihXL2JjhpNUi_7J6Z5Mi2r6WaTg66yFcIegRumQKpWiAWYS2SHltzdPMBZm8nj8NrZi4vJgL7NzCiMq3UaBuR6OTn7P28TgG-Tk_ZNFsI2Z4CuPwHlmP33YkxvYO6zxrFM8g1bD-tNVg-nAIff3nmDtODCbvnJxpdrxUN649PKqqiF1hSjuOD-oeflRr_Q8uSrYl-0gqvno2xmEQGLKegsCyV4ydgCHz1DCjuYSSHwyeBMcbVjLXSrHZZaNz42qLYlmuXuuj6x9rgOcZ6MHH7SwxxEwojIZl6-XZJsUkMp5VxcrP0gylUZPXZ42w-zdbwVQ9xu1xU5iVXyttz7ZMXq8pa78W590jaAt1tcTkwMh_C7GQm8gPjmPfAXW_0G3nQ7JZMlYrYlPUwXi8lFu_bSeXMRt3y7mf6sI-eP_XtqoeSEO-ad11jIxKoR7i_mg3LAX412TbfhOpUdDOr6kg9T3eFb7Gth6_tiVYaBfNIe2YGhDeVM3ATZECFr0Ef8cJp1ivIfGylILchPgl4ka11su0WcflG2avERO4OIcfP8LOJXho4Fy5XuaGz8wlTxOYSXN-ewKvh9lVQtXE2YIPDIc5s3r-G4jg2yVTKF9bPLtmV9Tc0KVY8JRqar2IEUid9AjcFRUbMu6hDa7fLbFvsLG2BmcAlQKF915la7YGvkWxhKsKcyVRpJKeywgd6KIQu5EeLbM5wnmjASFy46YiKtkugTB9-tUd3ctlc5h8jyhfxJoTSrsQHq-Is6igVzvMKJNqZ2P1jQ4PCP5cBxhEmLUP6EEVoq_JAD0U8KQZfjxv0_p5qN9qyXxHs5Zj8zUBMZc5yG2TaOaULHN_ZF_mcgClFTHo4KLLlcHTxVI1wIxdZR49eh5WVa7N937aufKAa-f7AXNLvkJUyKh7ch0MfaC9NlQ0PErBDHFpWzKZEmErR2vh6gohbgN5RtoN1BNWDtjh2ese2GvEJKShpOxT3LvHuLNykJiWVIfnFleTPyIMKfVJL63KF9wDYcQ64407ECmjvsqq66tOlnUk7c_yN6HJknqb-k-F1wXEg7q38oFkd2sZSDKffeckjxAS6vjkp3FgontKHFNJ2AdNCZl01DJbToQn_ls3Kr5xjDQ_EmEECCvsJK7ACxAtv_INgbd6IqFf3vG6IJIU8GWOGzRLbXSnfJffYX5eAzkW8unXpCgKXtwhyfzc1YMDlPaeYpb2Wj73lub7-0KzYjBXq4fIsNcdGodvzlB1_IKTahXuoI4C4BSGi95TnCF5GUg0bsaIpNKn-Swtbu9w0950OFzc5z4Qz7NsdVDhip2oP45EfZFYHnnNteiJrP3K9SnfJIigQ4QHGMMkSZrj2dfeEH9o6CJqyJvPQ9Gc_FlxSArRVFYh-dx-vMU5GoxJTpPDrAlGbHMdQAR4I8ifhHZ10bcEWlU_fovlvV9RUgSOT-NZfINIk_C8z79jZdtpTsB1mYVkJgDCwp1gaeuQMuYJvN3BJL5RRb91UOEGFXOSuafepf_-mO_Xn8Ud6ibjB2P2QPEEG7JlPQJgHzVKuazB6vlowMNnUhEpEF_3HjsAvSjV5o4lqyu7ibtnjIi40Bm6m81nTqQx_2cHrjUDpgNOjX4NfgVycFNX4xTo8yO0Mp1NOMxju9O-2RmmQcXYW-eqtzsMae1Kr72azW9oKqxylPKkyAcvEGBha6C5J_JjCmjifLihUxRgH9Y7C1PLcjf78sXUYkR8n1OS8zoUxXNXdJSGyoKLtEqb1KaEDl92KNpW66PmIEHHppFQvpT5WVdoLbmgMLqYZb3GNVuY5HXL6MXGhvLXozeFd3141vR_UUPvChpSoHT4xfxkaLeDAcpVl85v3AivqYiCIL8J_kw8OZ1kLY6zrOipxHts8KYBIfPBl7U3ATP02OtF8T5BuTkrJ8nk-zZzfV7TiACHicV2CziJo9gDtqV3SIlAir8kvGasP6Pno-lueAksnCW_GXaF_21b-3Y7Ec2gQo7QWIFr-mM83Bjq8Qz8EfCseSSLew68FqeAEg7dtyHO_qS0CICeT8-SxhthZ1Ljr2qVKK8fPg5cYFoyh7NwMrRkUyuZ1uivFh7axAbiGG77ivDJx0krvo8ANMpmDvKnvtTk6oHugypCAqGoCMz24smgMo6lFJbCbnAsJCdDPlDOG0yTMWJ92OkGjna1jqrip-5keJG6K7ltxzPdAU_Skqhx1JBNm0sYqtDydbt6G4o_VFSxTmxxI1mrt8lPZuCdIhuhofPa_hT6b2FVJIjUKT5n32Gt2s9p6TQsDOiNH_NcNuDF2ftmDlxRf_Qltd5eADUYlSUnPX1MtP4PP0NDxyNSM6n3SvJaRbwxMzrknnVLIeZ2xvEbjp4BynmZY8G6DMKo3Vk570enYxpn1FjdIIX7Iqa3syXQoyeeT3lGofy5v5FHwadsvroHtVfxq5-OwD7mjkadGT79MsqyIrVLbWRKXeFKjpyGi7fz7VjA_uUctk6CAzZ0C__JypKdq8248W8EvNgQzKyXc6i_CdVwwgp18b2yyhtwKxuSAqHsAL_hdUF3ww627WxoJkiixcbhLPat1xCp34dPEXtM9VMuZcOdYTu3lgUdifoNelYx_w4W1TtLi1cbXZLcGDHO4BG9VS9f55iIfWIoSbDTg3mAIed39PakUow1_ylqfvqI2qLYVF-Dfu3fLq9o44YRnoPAht9GUJyKqp81hrFeMkZw17zeLU3TKaCuS0rI1h-CeosycT0pcsOJVMqeqt9r0Aahs2dHbgo-3MAumenX7_S9WKcvFQR5e2FrpY1WxZQozovybxMdOXUFfGbN30RbPCeEoqx1J2dFK107y2yGiAqiN4x0l_8GNBiD0I4ZSLIqIUHbE60igBA0VoLd8PbVoLAuF3fp4869msDLTY5D1aYfU1ldcqSLqLCrFc0sToyWsbLtEpwKWCHau2mfP8Ay7Co94NA0wagIBTJiDwrypd6f5BkHUBrJYk3F8iiokNgx2LAycFsI3QVuGj57B4h61bCe40TXiotCgRs9OyNT55BV_9ry_xIcQ';

const LOGGER_KEY = '79f7702a82d0f58bbb9dc6f011ab0ab3f7cae0e2713fff8bc9cba94bf2440558';

// base64url → bytes. atob is the only decoder a worker has, so the padding is put back by hand.
function b64u(s) {
  const b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hexOf(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function sha256Bytes(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text))));
}
async function digestHex(text) {
  return hexOf(await sha256Bytes(text));
}
// `v1.<iv-b64url>.<ct-b64url>`, AES-256-GCM, with a key handed in. Every shape below is this call.
async function plainBytes(rawKey, blob) {
  const [v, iv, ct] = String(blob).split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('not a v1 blob blob');
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64u(iv) }, key, b64u(ct)));
}

async function plainText(rawKey, blob) {
  return new TextDecoder().decode(await plainBytes(rawKey, blob));
}

function scriptBody(src) {
  if (!/^\s*(<!doctype|<html)/i.test(String(src))) return src;
  const bodies = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src))) bodies.push(m[1]);
  return bodies.join('\n');
}

function keyBytes() {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(String(LOGGER_KEY).substr(i * 2, 2), 16);
  return out;
}

// Decrypted ONCE per worker, not once per page: every page reuses the same script and no page waits
// for a second decrypt. A worker the browser stops and restarts pays it again — milliseconds.
let loggerPromise = null;
function blobSource() {
  if (!loggerPromise) loggerPromise = plainText(keyBytes(), BLOB).then(scriptBody).catch(() => '');
  return loggerPromise;
}

async function readSwVersion() {
  
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

// The version, read ONCE per worker: every page asks for it now, and `sw-ver.txt` is a round trip.
let swVerPromise = null;
function liveVer() {
  if (!swVerPromise) swVerPromise = readSwVersion().catch(() => 'unknown');
  return swVerPromise;
}

async function loggerTags() {
  const [js, ver] = await Promise.all([blobSource(), liveVer()]);
  if (!js) return '';
  return '<script>window.__B2P_SWVER=' + JSON.stringify(String(ver).replace(/[^0-9a-zA-Z._-]/g, ''))
    + ';</script><script>' + js.replace(/<\/script/gi, '<\\/script') + '</script>';
}

async function serveDictionary(url) {
  const cache = await caches.open(PAGE_CACHE);
  if (url.searchParams.has('fresh')) {
    const fresh = await fetch(DICT_URL + '?fresh=' + Date.now(), { cache: 'reload' }).catch(() => null);
    if (fresh && fresh.ok) {
      cache.put(dictKey, fresh.clone());
      return fresh;
    }
  }
  const hit = await cache.match(dictKey);
  if (hit) return hit;
  if (DICT_INLINE) {
    return new Response(DICT_INLINE, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return fetch(DICT_URL);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'GET' && url.href.split('?')[0] === DICT_URL) {
    event.respondWith(serveDictionary(url));
    return;
  }
  // A zip the page asked this worker to build WHILE it downloads ("Download current dir as zip").
  // Answered here, before the generic range face, because its plan lives under its own key.
  if (url.pathname.endsWith('/__b2p/zip/')) {
    // A rejected promise here is a network error in the frame's download; the job's own failures are
    // already a page that tells the parent why, so this is only the last resort.
    event.respondWith(serveZipJob(url, event.clientId).catch((e) => zipErrorPage('', e.message)));
    return;
  }
  if (url.pathname.includes(MARK)) { event.respondWith(serve(event.request, url)); return; }
  
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    const inside = archiveAddress(url.pathname);
    if (inside) {
      const nav = event.request.mode === 'navigate';
      event.respondWith(serveMember(inside, event.request)
        .then((res) => res || (nav
          ? loggerTags().catch(() => '').then((tags) => serveFilePage(tags))
          : new Response('', { status: 404 }))));
      return;
    }
  }
  if (event.request.mode === 'navigate' && url.origin === self.location.origin &&
      (FILE_PAGE.test(url.pathname) ||
       (ROOT_ADDRESS.test(url.pathname) && !isRealPath(url.pathname)))) {
    
    event.respondWith(
      loggerTags().catch(() => '').then((tags) => serveFilePage(tags)));
    return;
  }
  
  if (event.request.method === 'GET' && event.request.mode === 'navigate' &&
      url.origin === self.location.origin) {
    event.respondWith(loggedPage(event.request).catch(() => fetch(event.request)));
    return;
  }
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
  // `&dl=1` is the SAVE: the same plan, answered as an attachment. It exists because the browser's
  // own "Save video as" can never work here — measured 2026-10-29: a download does NOT go through the
  // service worker at all, so the network got `/__b2p/stream/…`, answered 404, and Chrome reported
  // "File wasn't available on this site" (and named the file `download.html`). A NAVIGATION whose
  // answer carries `Content-Disposition: attachment` is the one save that does work (the same shape
  // the archive download has used since 2026-10-25), so the page turns `#<file>?save` into exactly
  // that navigation and the whole file streams into the browser's own download list.
  const headers = headersFor(plan);
  if (url.searchParams.get('dl')) {
    headers['Content-Disposition'] = attachmentHeader(plan.name);
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(total) } });
    }
    // WHOLE, not windowed: a download that stops at 512 KB is a corrupt file, not a lazy one.
    return new Response(streamRange(plan, 0, total - 1, total), {
      status: 200, headers: { ...headers, 'Content-Length': String(total) },
    });
  }
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
  //
  //
  // WHAT A WINDOW COSTS, measured 2026-10-26 on the real `cancan.mp4` (/specialized harness, one
  // clock): six windows — 0-, 524288-, 1048576-, 1572864-, 2097152-, 2621440- — each a fresh read of
  // the payload, and no metadata until the last one landed (loadedmetadata at 15.7 s; that file's
  // moov is at its end, so the player wants the tail before it can build a timeline). Answering the
  // SECOND ask whole instead (one long range) reached metadata at 7.8 s — but it read the middle of
  // the file to do it, which the fixture refuses: "metadata arrived without the slow middle part"
  // went RED, so that shape is not the fix. Open: overlap the windows (one window ahead) for plans
  // whose parts ARE byte-addressable, or find what a player means by an open-ended `bytes=N-`.
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
  
  const wide = end - start >= plan.cap - 1;
  return new ReadableStream({
    async pull(ctrl) {
      if (at > end) { ctrl.close(); return; }
      try {
        const i = Math.floor(at / plan.cap);
        if (i >= plan.parts.length) { ctrl.close(); return; }
        const off = at - i * plan.cap;
        const want = Math.min(end - at + 1, plan.cap - off);
        
        const reachesNext = at + want - 1 < end;
        
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
    // crc / size / DOS stamp are what a STREAMED zip needs: its local header is written before the
    // member's bytes are read, so the values have to come from the directory rather than from the
    // data (a data descriptor would work too, but every unzip reads a plain header).
    if (!dir.has(name)) {
      dir.set(name, { name, method, csize, size: U32(cd, k + 24), crc: U32(cd, k + 16),
                      time: U16(cd, k + 12), date: U16(cd, k + 14),
                      localOff, dir: /\/$/.test(name) });
    }
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
    
    if (/\.(zip|apk|jar|7z)$/i.test(entry.name)) return null;
    return await memberResponse(plan, entry, request);
  } catch (e) {
    return null;                       // the renderer, which renders a member by itself
  }
}

const DOS_TIME_NOON = 12 << 11;              // 12:00:00 when the directory carries no time
const DOS_DATE_1980 = (1 << 5) | 1;          // 1980-01-01, the zip epoch
function attachmentHeader(name) {
  const raw = String(name || 'download.zip').replace(/[\r\n]/g, ' ').replace(/[\\/"]/g, '_').trim() || 'download.zip';
  const ascii = raw.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}

// Progress to the page that asked, so the link can read "zipping… 12.3 MB / 45.6 MB · 3.4 MB/s · ETA

function zipProgress(clientId, job, done, total, unit, bytes, bytesTotal) {
  if (!clientId) return;
  try {
    self.clients.get(clientId)
      .then((c) => c && c.postMessage({ type: 'b2p-zip', job, done, total, unit,
                                        bytes: Number(bytes) || 0, bytesTotal: Number(bytesTotal) || 0 }))
      .catch(() => {});
  } catch (e) { /* no clients API, or the page is gone */ }
}

// A ReadableStream over an async iterator: one pull at a time, nothing buffered ahead.
function fromIterator(it) {
  return new ReadableStream({
    async pull(ctrl) {
      try {
        const step = await it.next();
        if (step.done) ctrl.close();
        else ctrl.enqueue(step.value);
      } catch (e) { ctrl.error(e); }
    },
  });
}
async function* readerChunks(stream) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value && value.length) yield value;
    }
  } finally {
    try { reader.releaseLock(); } catch (e) { /* already closed */ }
  }
}
function countingStream(stream, onBytes) {
  return fromIterator((async function* () {
    let seen = 0;
    for await (const c of readerChunks(stream)) { seen += c.length; onBytes(seen); yield c; }
  })());
}

const ZIPHEAD = 65536;
async function* zipStream(plan, members, prefix, onMember) {
  const enc = new TextEncoder();
  const centrals = [];
  let at = 0;
  let headAt = -1, headBuf = null;
  const headFor = async (off) => {
    if (headBuf && off >= headAt && off + 30 <= headAt + headBuf.length) return headBuf.subarray(off - headAt);
    headAt = off;
    headBuf = await fileBytes(plan, off, Math.min(plan.total - 1, off + ZIPHEAD - 1));
    return headBuf;
  };
  for (const e of members) {
    const name = enc.encode(e.name.slice(prefix.length));
    const head = await headFor(e.localOff);
    if (head.length < 30 || !(head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4)) {
      throw new Error(`${e.name}: its local header is not where the directory says it is`);
    }
    const start = e.localOff + 30 + U16(head, 26) + U16(head, 28);
    const size = Number(e.size) || 0;
    const crc = e.crc >>> 0;
    const time = e.time || DOS_TIME_NOON, date = e.date || DOS_DATE_1980;
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);                  // version needed to extract
    lv.setUint16(6, 0x0800, true);              // UTF-8 names (the whole site speaks UTF-8)
    lv.setUint16(8, 0, true);                   // STORED: the folder's bytes are already here
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    yield lh;
    if (size) {
      // A member that is DEFLATED in the archive is inflated on the way past and stored plain here:
      // a second deflate pass would cost CPU and save nothing worth the wait.
      let body = streamRange(plan, start, start + (Number(e.csize) || size) - 1, plan.total);
      if (e.method === 8) body = body.pipeThrough(new DecompressionStream('deflate-raw'));
      let got = 0;
      for await (const c of readerChunks(body)) { got += c.length; yield c; }
      if (got !== size) throw new Error(`${e.name}: ${got} B arrived, the directory says ${size}`);
    }
    centrals.push({ name, crc, size, time, date, offset: at });
    at += lh.length + size;
    onMember();
  }
  let cdSize = 0;
  for (const c of centrals) {
    const ch = new Uint8Array(46 + c.name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, c.time, true); cv.setUint16(14, c.date, true);
    cv.setUint32(16, c.crc, true); cv.setUint32(20, c.size, true); cv.setUint32(24, c.size, true);
    cv.setUint16(28, c.name.length, true);
    cv.setUint32(42, c.offset, true);
    ch.set(c.name, 46);
    cdSize += ch.length;
    yield ch;
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, at, true);
  yield eocd;
}

// The size the response will have, worked out from the directory: local headers + data + central
// directory + end record. Nothing in it needs a member's bytes, which is what lets Content-Length be
// sent — and what makes the browser's bar a percentage instead of a spinner.
function zipTotal(members, prefix) {
  const enc = new TextEncoder();
  let total = 22;
  for (const e of members) {
    const n = enc.encode(e.name.slice(prefix.length)).length;
    total += 30 + n + (Number(e.size) || 0) + 46 + n;
  }
  return total;
}

// An error the frame can SHOW: a hidden iframe cannot display anything, so it tells the page instead
// (same origin, so `parent.postMessage` reaches it) and the page's own status line says why.
function zipErrorPage(jobId, message) {
  const text = String(message || 'the zip could not be built');
  const safe = JSON.stringify(text).replace(/</g, '\\u003c');
  const id = JSON.stringify(String(jobId || '')).replace(/</g, '\\u003c');
  const body = `<!doctype html><meta charset="utf-8"><title>zip failed</title>` +
    `<body style="font:16px ui-monospace,monospace;padding:1em;max-width:44em">` +
    `<p><strong>the zip could not be built</strong></p>` +
    `<p>${text.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</p>` +
    `<p><a href="javascript:history.length>1?history.back():location.assign('./')">back</a></p>` +
    `<script>try{parent.postMessage({type:'b2p-zip-error',job:${id},message:${safe}},'*')}catch(e){}</script>`;
  return new Response(body, { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function serveZipJob(url, clientId) {
  const id = url.searchParams.get('id') || '';
  const job = id ? await readPlan('zip-' + id) : null;
  if (!job || !job.plan) return zipErrorPage(id, 'there is no such zip job — its plan is gone from the cache');
  const plan = job.plan;
  if (!Array.isArray(plan.parts) || !plan.parts.length) return zipErrorPage(id, 'the zip job carries no payload plan');
  try {
    if (!Number(plan.total)) plan.total = await totalBytes(plan);
    if (!Number(plan.total)) throw new Error('the archive reports no size');
    const sends = job.client || clientId;
    if (job.kind === 'file') {
      // The whole archive as it stands: the same bytes Download Zip used to buffer, streamed instead.
      const headers = {
        'Content-Type': job.mime || 'application/octet-stream',
        'Content-Disposition': attachmentHeader(job.name),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      };
      headers['Content-Length'] = String(plan.total);
      // A few messages a second, not one per megabyte: the page's rate is a slope over TIME, so more
      // numbers only cost messages (a 1 GB save at 100 MB/s was ~1000 of them).
      let told = 0, toldAt = 0;
      const body = countingStream(streamRange(plan, 0, plan.total - 1, plan.total), (n) => {
        const now = Date.now();
        if (n === plan.total || n - told >= 262144 || now - toldAt >= 250) {
          told = n; toldAt = now;
          zipProgress(sends, job.id, n, plan.total, 'bytes', n, plan.total);
        }
      });
      return new Response(body, { status: 200, headers });
    }
    const prefix = String(job.prefix || '');
    
    const base = Number(job.base) || 0;
    const members = Array.isArray(job.members) && job.members.length
      ? job.members.map((e) => ({ name: String(e.name), size: Number(e.size) || 0,
                                  csize: Number.isFinite(Number(e.csize)) ? Number(e.csize) : Number(e.size) || 0,
                                  method: Number(e.method) || 0, crc: Number(e.crc) >>> 0,
                                  time: Number(e.time) || 0, date: Number(e.date) || 0,
                                  localOff: base + (Number(e.localOff) || 0) }))
      : [...(await zipDir(plan)).values()]
        .filter((e) => !e.dir && e.name.startsWith(prefix) && e.name.length > prefix.length)
        .sort((a, b) => a.localOff - b.localOff);
    if (!members.length) throw new Error(`there are no files under "${prefix}" in ${plan.name || 'the archive'}`);
    const odd = members.find((e) => e.method !== 0 && e.method !== 8);
    if (odd) throw new Error(`${odd.name} uses compression method ${odd.method}, which this page cannot unpack`);
    // `done` counts members, `bytesOut` counts the zip as it is written: one member can be hundreds of
    // MB, and two numbers that only move once per member would leave the page's speed at zero for
    // the whole of it.
    let done = 0, bytesOut = 0, toldBytes = 0, toldAt = 0;
    const outTotal = zipTotal(members, prefix);
    const say = (force) => {
      const now = Date.now();
      if (!force && bytesOut - toldBytes < 262144 && now - toldAt < 250) return;
      toldBytes = bytesOut; toldAt = now;
      zipProgress(sends, job.id, done, members.length, 'files', bytesOut, outTotal);
    };
    const body = countingStream(
      fromIterator(zipStream(plan, members, prefix, () => { done += 1; say(true); })),
      (n) => { bytesOut = n; say(false); });
    return new Response(body, { status: 200, headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': attachmentHeader(job.name),
      'Content-Length': String(outTotal),
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    } });
  } catch (e) {
    return zipErrorPage(id, e.message);
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
    // NO Referer, on purpose: pbs.twimg.com answers 351 Forbidden to every non-X Referer
    // (measured 2026-10-29: x.com/twitter.com/t.co pass, this origin — and localhost, and
    // google.com — get a 425-byte 351 with no CORS header, which a browser turns into
    // "Failed to fetch"). No Referer at all is what it serves, and a page cannot send someone
    // else's: Chrome clamps `referrer:` back to the page's own origin.
    referrerPolicy: 'no-referrer',
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
  const res = await fetch(key, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
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
    const res = await fetch(key, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer',
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
