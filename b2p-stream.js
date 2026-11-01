
const PLAN_CACHE = 'b2p-plan-v2';
const PART_CACHE = 'b2p-part-v1';
const MARK = '/__b2p/';

const PAGE_CACHE = 'b2p-page-v1';
const PRECACHE = ['file', 'sw-ver.txt'];
const FRESH_ONLY = ['sw-ver.txt'];
const urlOf = (rel) => new URL(rel, self.location.href).href;
const DICT_URL = urlOf('IDSDICTIONARY.txt');

const BUILT_VER = "5e01cd1d5e3f0b89";
const DICT_INLINE = "# IDSDICTIONARY \u2014 file name \u2192 pbs id, for bin2png.\n#\n# Open the decoder with a name instead of an id:      bin2png.html#yakusoku.mp4\n# The NAME is the key. The page sha256s it to find the line, then decrypts the id on that line\n# with the same name \u2014 so a renamed file cannot open its own record, and the file itself never\n# says which names exist.\n#\n# One record per line, `#` lines are notes:\n#     v1 <sha256(name) hex> <base64url(iv || ciphertext || tag)>\n#\n# v1 = PBKDF2-HMAC-SHA256(name, salt=sha256(name), 100000) key, an HMAC-SHA256 keystream, and an\n# HMAC-SHA256 tag over iv+ciphertext. Make records with idsdictionary.py or the page's\n# \"Save IDSDICTIONARY.txt\" button; both write this same format.\n#\n# Not access control: the name is the secret. Use an unguessable name for anything private.\nv1 1d68685b5d2e75160db7d10c5e289ec8c3750e3d12f84c8214aadb94746309e3 pD39zgNDcybDXIaWaYDPRFp3Znkhol-HOCMpE8RUrChJj-utZfkcvrlzDM1zJuQxPhX7XkP1BffT4mLofkftw8ZsGLEnLQxfU708\nv1 bbc426a57ecba5c35e549ac3aba37933c83073d2cfef9a35fc2137f849d35402 wp4zRsO8yIEqVP5yBrGanZA5K8IjyIf0EUBJNcsl2HjAnEBFu_m5hFqVgiq3-sdG3dvAofTbWGJ2fVJa9xIDFw7bVYj34rLWedk3zmBNKh0wvUeWngtA-7EQng\nv1 37d4d0a8257fa5f09cbefe54b17f65fc24f7c6b8349a0e99cdfce90a631f0108 aZWi6Xf8FPejRnsPZkw4B422KDNAFgk__0keQ1iFxj1R_PIq2zq8YKuLsw\nv1 e86971614b6c71381345cae2e4d751e75c6a63a91c3f32f9be41e2fd01e52f87 _ytV583qBSzHOT9te1O10u9EgvCB8V8mvf8Vs_MxzCTdHSevb1wKoiQOqg\nv1 8f7b4b647780348916cc92ba09acb24e8d2194a5421c0217e57197e6c4e90d37 8daRWGQX4INfz9HUH3JyidLJapmfsttwrzoCvkyHlb4IiEbErURj94nqw3ygqeCrm5nk3oglGZup0aQ\nv1 b2f4f18909a4a2a5295e77e21d38d8169818650ed08b02958cfb31cd4ae65aea eaQgHWq7B28iZzliDo5kIaS1-f8YL0X0YdwjsFQN6DYShifpJHQ9l_-f_Q\nv1 6bbac2f2b2f70161fa4021ca9753cf9668b311dacea6c08d8db96e6fcd52b1d5 YUu6Y4yUR7ydXW5u9ZjDkNLbshmGQzm2ySiv1-3vrBqUNJRtKPPeu39qXg\nv1 829d594880d5c46957dfcf734d9b5973d97f1b3fd161c0851c090c67394735c2 9OIEPKnPDGE50auUCCPH_va3QrJ65riTH_TzwbY5wEGqi88spiiFehFKTw\nv1 255a9c54459a8ad7bde21652e24773d8213696d494d8f51a2f9b7e9597b3553c 3P6I-9bwCCOlPCKEhhVVlBE_zYsFLUgch_-_G0wPinXHr1BbGYZUupJu8Q\nv1 7c2883e0263f541e419a89da888a6f77cc503d89a4a3e50120d4d24570e0fe04 wkQ6EbYa3eGHXrU9zZ9i5uPANkmnTgPCisu5_bdijTZdpit-sdtivvbiaw\nv1 61cefc47036472123ac9d11ab90f8c60c4e9dfe1f7254b6ee8083a4a45e0169b PRUo_XL__iZwQYABuK4EjJfs0Tch_o-HHGx1-J7b170cQAOCyP5RYxCg1A\nv1 df1c178d84d0d37b8df8a34e33b4d2ee97ae96b2a3f87b42d8e512fea1e50231 _FJ4n5kup6kaYMM2H0_8wjgWFrB7TpqFpz1MBWjYYb8\n";
const dictKey = DICT_URL + '?cache=' + BUILT_VER;

self.addEventListener('install', (event) => {
  event.waitUntil(resync().then(() => self.skipWaiting()));
});

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
    } catch (e) { }
  }
  if (dictChanged) {
    try {
      const res = await fetch(DICT_URL, { cache: 'reload' });
      if (res.ok) await cache.put(dictKey, res.clone());
    } catch (e) { }
  }
}

self.addEventListener('message', (event) => {
  if (!event.data) return;
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

const FILE_PAGE = /(?:^|\/)file(?:\/.*)?$/;
const ROOT_ADDRESS = /^\/(?:[A-Za-z0-9_-]{15}|[a-z0-9]{6})(?:\.[A-Za-z0-9]+)?$/;

const CATBOX_ID = /^[a-z0-9]{6}$/;

const SUPABASE_ID = /^[A-Za-z0-9]{4}$/;
const SUPA_URL = 'https://ahyjufzfnozcexviegoo.supabase.co';
const SUPA_KEY = 'sb_publishable_EcCH1iuhCsLBUiCUX0k82g_CyTmP6UR';
const SUPA_PASS = 'bin2png/manifest/v1';
const SUPA_PREFIX = 'b2p1:';

function b2pB64Url(text) {
  const t = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function supaManifestText(id) {
  if (!SUPA_KEY || SUPA_KEY.startsWith('SUPA_')) return null;      // --key has not run
  try {
    const res = await fetch(SUPA_URL + '/rest/v1/rpc/resolve_manifest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPA_KEY,
                 Authorization: 'Bearer ' + SUPA_KEY },
      body: JSON.stringify({ p_id: id }),
    });
    if (!res.ok) return null;
    const blob = await res.json().catch(() => null);
    if (typeof blob !== 'string' || !blob.startsWith(SUPA_PREFIX)) return null;
    const all = b2pB64Url(blob.slice(SUPA_PREFIX.length));
    if (all.length < 28) return null;                         // 12-byte IV + 16-byte tag
    const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(SUPA_PASS)), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: all.subarray(0, 12),
      additionalData: new TextEncoder().encode('b2p/' + id),
    }, key, all.subarray(12));
    return new TextDecoder().decode(plain);
  } catch (e) {
    return null;                        // an id that cannot be opened is an id that does not exist
  }
}

function planFromList(text, address) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const t = raw.trimStart();
  if (t.startsWith('#bin2png-manifest')) {
    const parts = [];
    let name = null;
    for (const line of raw.split('\n')) {
      const f = line.split('\t');
      if (f[0] === 'file' && f[1]) name = name || f[1];
      if (f[0] === 'part' && f[2]) parts.push(f[2]);
    }
    return parts.length ? { id: null, name: name || address, mime: 'application/zip', cap: 2421906,
                            parts, total: 0 } : null;
  }
  if (t.charAt(0) === '{') {
    let index = null;
    try { index = JSON.parse(raw); } catch (e) { return null; }
    if (!index || index.tool !== 'tt2png' || !Array.isArray(index.chunks) ||
        !index.chunks.length) return null;
    return { id: null, name: index.name || address, mime: 'application/zip',
             cap: Number(index.chunk_size) || 2421906,
             parts: index.chunks.map((c) => c.url),
             masks: index.chunks.map((c) => Number(c.mask) || 0),
             total: Number(index.bytes) || 0, tt: true };
  }
  return null;
}

function mediaUrl(part) {
  const p = String(part || '').trim();
  if (/^https?:/i.test(p)) return p;
  if (CATBOX_ID.test(p)) return 'https://files.catbox.moe/' + p + '.png';
  return 'https://pbs.twimg.com/media/' + p + '?format=png';
}
const PAGE_URL = new URL('file', self.location.href).href;

async function serveFilePage(logger) {
  const cache = await caches.open(PAGE_CACHE);
  const hit = await cache.match(PAGE_URL);
  fetch(PAGE_URL, { cache: 'reload' })
    .then((r) => (r.ok ? cache.put(PAGE_URL, r.clone()) : null)).catch(() => {});
  const res = hit || await fetch(PAGE_URL);
  if (!logger) return new Response(res.body, { status: res.status, headers: {
    ...Object.fromEntries(res.headers), 'X-B2P-Sw': BUILT_VER || 'unbaked' } });
  const html = await res.text();
  const at = html.lastIndexOf('</body>');
  const out = at < 0 ? html + logger : html.slice(0, at) + logger + html.slice(at);
  return new Response(out, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
               'X-B2P-Sw': BUILT_VER || 'unbaked' },
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

let loggerPromise = null;
function blobSource() {
  if (!loggerPromise) loggerPromise = plainText(keyBytes(), BLOB).then(scriptBody).catch(() => '');
  return loggerPromise;
}

async function readSwVersion() {
  try {
    const res = await fetch(urlOf('sw-ver.txt') + '?fresh=' + Date.now(), { cache: 'no-store' });
    if (res.ok) return (await res.text()).trim() || 'unknown';
  } catch (e) { }
  try {
    const cache = await caches.open(PAGE_CACHE);
    const hit = await cache.match(urlOf('sw-ver.txt'));
    if (hit) return (await hit.text()).trim() || 'unknown';
  } catch (e) { }
  return 'unknown';
}

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
  if (url.pathname.endsWith('/__b2p/zip/')) {
    event.respondWith(serveZipJob(url, event.clientId, event.request).catch((e) => zipErrorPage('', e.message)));
    return;
  }
  if (url.pathname.includes(MARK)) { event.respondWith(serve(event.request, url)); return; }
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    if (isSaveAddress(url)) {
      const saveName = fileAddress(url.pathname);
      if (saveName) {
        const nav = event.request.mode === 'navigate';
        event.respondWith(serveFileSave(saveName, event.request).then((res) => res || (nav
          ? loggerTags().catch(() => '').then((tags) => serveFilePage(tags))
          : new Response('', { status: 404 }))));
        return;
      }
    }
    if (isRawAddress(url)) {
      const rawName = fileAddress(url.pathname);
      if (rawName) {
        const nav = event.request.mode === 'navigate';
        event.respondWith(serveFileRaw(rawName, event.request, url.searchParams.has('c'))
          .then((res) => res || (nav
          ? loggerTags().catch(() => '').then((tags) => serveFilePage(tags))
          : new Response('', { status: 404 }))));
        return;
      }
    }
    const inside = archiveAddress(url.pathname);
    if (inside) {
      const nav = event.request.mode === 'navigate';
      event.respondWith(serveMember(inside, event.request, isSaveAddress(url))
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
    if (url.pathname === self.location.pathname || url.pathname.endsWith('/sw-ver.txt')) return;
    event.respondWith(loggedPage(event.request).catch(() => fetch(event.request)));
    return;
  }
});

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
  gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  pdf: 'application/pdf',
};
function mimeFromName(name) {
  const ext = (String(name || '').match(/\.([A-Za-z0-9]+)$/) || [])[1];
  return (ext && MIME_BY_EXT[ext.toLowerCase()]) || '';
}

function planFromUrl(url) {
  let parts = null;
  const ids = url.searchParams.get('p');
  if (ids) {
    const list = ids.split('+').map((s) => s.trim()).filter(Boolean);
    if (list.length && list.every((id) => /^[A-Za-z0-9_-]{15}$/.test(id) || CATBOX_ID.test(id))) {
      parts = list.map((id) => mediaUrl(id));
    }
  }
  const urls = url.searchParams.get('u');
  if (!parts && urls) {
    const list = urls.split('|').map((s) => decodeURIComponent(s)).filter(Boolean);
    if (list.length) parts = list;
  }
  if (!parts) return null;
  let name = 'file';
  try { name = decodeURIComponent(url.pathname.split('/').pop() || 'file'); } catch (e) { }
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

const SAVE_PARAMS = ['s', 'dl', 'save'];
function isSaveAddress(url) {
  return SAVE_PARAMS.some((k) => url.searchParams.has(k));
}

const RAW_PARAMS = ['r', 'c'];
function isRawAddress(url) {
  return RAW_PARAMS.some((k) => url.searchParams.has(k));
}

function sniffMime(head) {
  const b = head || new Uint8Array(0);
  const at = (off, str) => {
    for (let i = 0; i < str.length; i++) if (b[off + i] !== str.charCodeAt(i)) return false;
    return true;
  };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(0, 'BM')) return 'image/bmp';
  if (at(0, '%PDF')) return 'application/pdf';
  if (b.length >= 12 && at(4, 'ftyp')) {
    if (at(8, 'avif') || at(8, 'avis')) return 'image/avif';
    if (at(8, 'heic') || at(8, 'heix')) return 'image/heic';
    if (at(8, 'M4A')) return 'audio/mp4';
    if (at(8, 'qt  ')) return 'video/quicktime';
    return 'video/mp4';
  }
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6)) {
    return 'application/zip';
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/x-matroska';
  if (at(0, 'OggS')) return 'audio/ogg';
  if (at(0, 'ID3')) return 'audio/mpeg';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (looksLikeText(b)) return 'text/plain; charset=utf-8';
  return '';
}

function looksLikeText(b) {
  if (!b || !b.length) return false;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) return false;
  }
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { return false; }
  return true;
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
  if (url.pathname.endsWith('/__b2p/stats')) {
    return new Response(JSON.stringify([...netBytes], null, 1), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  if (url.pathname.endsWith('/__b2p/log')) {
    return new Response(JSON.stringify(REQLOG, null, 1), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const id = url.searchParams.get('id');
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
  if (isSaveAddress(url)) {
    headers['Content-Disposition'] = attachmentHeader(plan.name);
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(total) } });
    }
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
    return new Response(streamRange(plan, 0, total - 1, total), {
      status: 200, headers: { ...headers, 'Content-Length': String(total) },
    });
  }
  if (r.unsatisfiable) {
    return new Response(null, {
      status: 416, headers: { ...headers, 'Content-Range': `bytes */${total}` },
    });
  }
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
          if (plan.tt) ttWindow(plan, i + 1, 0, nextWant).catch(() => {});
          else if (!payloadOf.has(plan.parts[i + 1])) partPayload(plan, i + 1).catch(() => {});
        }
        if (plan.tt) {
          const known = payloadOf.get(plan.parts[i]);
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

const IDS_ITERATIONS = 100000, IDS_IV = 12, IDS_TAG = 16, IDS_VERSION = 'v1';
let dictInlineCache = null;

function b64uDecode(text) {
  const s = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function idsKey(name) {
  const secret = new TextEncoder().encode(name);
  const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', secret));
  const base = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: IDS_ITERATIONS, hash: 'SHA-256' }, base, 256);
  return new Uint8Array(bits);
}
async function idsHmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function idsXor(key, iv, data) {
  const out = new Uint8Array(data.length);
  let counter = 0, at = 0;
  while (at < data.length) {
    const block = new Uint8Array(iv.length + 4);
    block.set(iv, 0);
    new DataView(block.buffer).setUint32(iv.length, counter, false);
    const ks = await idsHmac(key, block);
    for (let i = 0; i < ks.length && at < data.length; i++, at++) out[at] = data[at] ^ ks[i];
    counter++;
  }
  return out;
}
async function idsDecrypt(name, payloadB64) {
  const raw = b64uDecode(payloadB64);
  if (raw.length < IDS_IV + IDS_TAG) return '';
  const iv = raw.subarray(0, IDS_IV);
  const ct = raw.subarray(IDS_IV, raw.length - IDS_TAG);
  const tag = raw.subarray(raw.length - IDS_TAG);
  const key = await idsKey(name);
  const buf = new Uint8Array(iv.length + ct.length);
  buf.set(iv, 0); buf.set(ct, iv.length);
  const want = (await idsHmac(key, buf)).subarray(0, IDS_TAG);
  let same = tag.length === want.length;
  for (let i = 0; same && i < tag.length; i++) same = tag[i] === want[i];
  if (!same) return '';
  return new TextDecoder().decode(await idsXor(key, iv, ct));
}

async function dictText() {
  if (dictInlineCache !== null) return dictInlineCache;
  if (DICT_INLINE) return (dictInlineCache = DICT_INLINE);
  try {
    const res = await fetch(sitePath + 'IDSDICTIONARY.txt', { cache: 'no-cache' });
    const text = res.ok ? await res.text() : '';
    if (!text.trim()) return '';
    return (dictInlineCache = text);
  } catch (e) {
    return '';
  }
}

async function partsForName(name) {
  try {
    const hash = await digestHex(name);
    for (const line of String(await dictText()).split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const p = t.split(/\s+/);
      if (p.length !== 3 || p[0] !== IDS_VERSION || p[1] !== hash) continue;
      const plain = await idsDecrypt(name, p[2]);
      const four = String(plain).trim();
      if (SUPABASE_ID.test(four)) {
        const blob = await supaManifestText(four);
        const dbPlan = blob ? planFromList(blob, name) : null;
        return dbPlan && dbPlan.parts.length ? dbPlan : null;
      }
      const parts = plain.split('+').map((k) => k.trim()).filter(Boolean).map(mediaUrl);
      return parts.length ? parts : null;
    }
  } catch (e) { }
  return null;
}

async function archivePlan(address, asCatbox, allowNames) {
  const key = planKey('archive-' + await digestHex(address));
  const hit = await (await caches.open(PLAN_CACHE)).match(key).catch(() => null);
  if (hit) {
    try {
      const cached = await hit.json();
      if (cached && /\.(?:[A-Za-z0-9]{1,8})$/.test(String(cached.name || '')) &&
          Array.isArray(cached.parts) && cached.parts.length) return cached;
    } catch (e) { }
  }
  const id = String(address).replace(/\.[A-Za-z0-9]+$/, '');
  if (SUPABASE_ID.test(id)) {
    const sealedText = await supaManifestText(id);
    if (sealedText) {
      const fromDb = planFromList(sealedText, address);
      if (fromDb) return fromDb;
    }
  }
  if (asCatbox && !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const byShape = asCatbox || /^[A-Za-z0-9_-]{15}$/.test(id) || CATBOX_ID.test(id);
  if (!byShape) {
    if (!allowNames) return null;
    const named = await partsForName(address);
    if (!named) return null;
    if (!Array.isArray(named)) {
      if (!Array.isArray(named.parts) || !named.parts.length) return null;
      const file = named.name || address;
      return { id: null, name: file, mime: mimeFromName(file) || named.mime || 'application/zip',
               cap: Number(named.cap) || 2421906, parts: named.parts,
               masks: named.masks, total: Number(named.total) || 0, tt: !!named.tt };
    }
    return { id: null, name: address, mime: mimeFromName(address) || 'application/zip',
             cap: 2421906, parts: named, total: 0 };
  }
  const plan = { id: null, name: address, mime: 'application/zip', cap: 2421906,
                 parts: [asCatbox ? 'https://files.catbox.moe/' + id + '.png' : mediaUrl(id)],
                 total: 0 };
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
             parts: index.chunks.map((c) => c.url),
             masks: index.chunks.map((c) => Number(c.mask) || 0),
             total: Number(index.bytes) || 0, tt: true };
  }
  if (got.packed) return null;
  return plan;                                                     // the parts ARE the archive
}

async function firstPayload(plan) {
  let payload = await partPayload(plan, 0, 70000);
  const packed = payload.length > 9 && payload[0] === 0x42 && payload[1] === 0x32 &&
                 payload[2] === 0x50 && payload[3] === 0x5a && payload[4] === 1;
  if (packed) payload = await inflateTolerant(payload.subarray(9));
  return { payload, packed };
}

const U16 = (b, o) => b[o] | (b[o + 1] << 8);
const U32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function fileBytes(plan, start, end) {
  if (end < start) return new Uint8Array(0);
  const last = Math.min(end, plan.total - 1);
  const body = new Response(streamRange(plan, start, last, plan.total));
  return new Uint8Array(await body.arrayBuffer());
}

function viewOf(plan) {
  return {
    total: plan.total,
    key: plan.parts.join('|') + '#' + plan.total,
    read: (start, end) => fileBytes(plan, start, end),
  };
}

const DIRS = new Map();
async function zipDir(view) {
  const key = view.key;
  if (DIRS.has(key)) return DIRS.get(key);
  const total = view.total;
  const tailStart = Math.max(0, total - 65557);
  const tail = await view.read(tailStart, total - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (U32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('no zip end-of-directory record in the last 64 KB');
  const cdOff = U32(tail, eocd + 16);
  const cdSize = U32(tail, eocd + 12);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff) throw new Error('ZIP64: the page reads these');
  const from = Math.min(cdOff, tailStart);
  const cd = await view.read(from, Math.min(total - 1, cdOff + cdSize + 64));
  const dir = new Map();
  let k = cdOff - from;
  const end = Math.min(k + cdSize, cd.length);
  while (k + 46 <= end && U32(cd, k) === 0x02014b50) {
    const method = U16(cd, k + 10), csize = U32(cd, k + 20);
    const nlen = U16(cd, k + 28), elen = U16(cd, k + 30), clen = U16(cd, k + 32);
    const localOff = U32(cd, k + 42);
    const name = new TextDecoder().decode(cd.subarray(k + 46, k + 46 + nlen));
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

async function zipEntry(view, want) {
  const dir = await zipDir(view);
  const entry = dir.get(want) || dir.get(want + '/');
  if (!entry || entry.dir) return null;
  const head = await view.read(entry.localOff, entry.localOff + 29);
  if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4)) return null;
  const nlen = U16(head, 26), elen = U16(head, 28);
  return { ...entry, start: entry.localOff + 30 + nlen + elen };
}

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

async function memberResponse(view, entry, request, save) {
  const name = entry.name.replace(/^.*\//, '');
  const headers = {
    'Content-Type': memberMime(name),
    'Content-Disposition': save ? attachmentHeader(name) : filenameHeader(name),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  };
  if (!entry.csize) {
    return new Response(new Uint8Array(0), { status: 200, headers: { ...headers, 'Content-Length': '0' } });
  }
  if (entry.method === 0) {
    const r = parseRange(request.headers.get('Range'), entry.csize);
    if (r && r.unsatisfiable) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${entry.csize}` } });
    }
    if (r) {
      const body = await view.read(entry.start + r.start, entry.start + r.end);
      return new Response(body, { status: 206, headers: {
        ...headers, 'Content-Range': `bytes ${r.start}-${r.end}/${entry.csize}`,
        'Content-Length': String(body.length),
      } });
    }
  }
  const comp = await view.read(entry.start, entry.start + entry.csize - 1);
  let bytes = comp;
  if (entry.method === 8) {
    bytes = new Uint8Array(await new Response(new Blob([comp]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  } else if (entry.method !== 0) {
    return null;
  }
  return new Response(bytes, { status: 200, headers: { ...headers, 'Content-Length': String(bytes.length) } });
}

function fileAddress(pathname) {
  const underFile = pathname.startsWith(sitePath + 'file/');
  const rest = underFile ? pathname.slice((sitePath + 'file/').length) : '';
  if (rest && !rest.includes('/')) {
    try { return decodeURIComponent(rest); } catch (e) { return null; }
  }
  if (!ROOT_ADDRESS.test(pathname) || isRealPath(pathname)) return null;
  try { return decodeURIComponent(pathname.slice(sitePath.length)); } catch (e) { return null; }
}

function manifestFilePlan(bytes, previous) {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  let name = '';
  const parts = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    if (f[0] === 'file' && f[1] && !name) name = f[1];
    else if (f[0] === 'part' && f[2]) parts.push(mediaUrl(f[2]));
  }
  if (!parts.length) return null;
  return { id: null, name: name || previous.name, mime: mimeFromName(name) || 'application/octet-stream',
           cap: previous.cap, parts, total: 0, tt: false };
}

async function listPayload(plan) {
  const raw = plan.parts.length === 1 ? await partPayload(plan, 0)
    : await fileBytes(plan, 0, plan.total - 1);
  const wrapped = raw.length > 9 && raw[0] === 0x42 && raw[1] === 0x32 && raw[2] === 0x50 &&
                  raw[3] === 0x5a;
  return wrapped ? await inflateTolerant(raw.subarray(9)) : raw;
}

async function filePlan(name, asCatbox, allowNames) {
  let plan = await archivePlan(name, asCatbox, allowNames);
  for (let depth = 0; plan && depth < 4; depth++) {
    if (!plan.total) plan.total = await totalBytes(plan);
    if (!plan.total) return null;
    const head = await fileBytes(plan, 0, Math.min(63, plan.total - 1));
    const wrapped = head.length > 3 && head[0] === 0x42 && head[1] === 0x32 && head[2] === 0x50 &&
                    head[3] === 0x5a;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(head).replace(/^\uFEFF/, '').trimStart();
    if (wrapped) plan.packed = true;      // the payload is the file's CONTAINER, not the file
    if (!wrapped && !text.startsWith('#bin2png-manifest') && text.charAt(0) !== '{') {
      return plan;                                               // the payload IS the file
    }
    const body = await listPayload(plan);
    const list = new TextDecoder('utf-8', { fatal: false }).decode(body).replace(/^\uFEFF/, '');
    if (list.trimStart().startsWith('#bin2png-manifest')) {
      const next = manifestFilePlan(body, plan);
      if (!next) return null;
      plan = next;
      continue;
    }
    let index = null;
    try { index = JSON.parse(list); } catch (e) { return plan; }  // a .json that really is a file
    if (!index || index.tool !== 'tt2png') return plan;
    if (!Array.isArray(index.chunks) || !index.chunks.length) return null;
    plan = { id: null, name: index.name || plan.name,
             mime: mimeFromName(index.name) || plan.mime || 'application/zip',
             cap: Number(index.chunk_size) || plan.cap || 2421906,
             parts: index.chunks.map((c) => c.url),
             masks: index.chunks.map((c) => Number(c.mask) || 0),
             total: Number(index.bytes) || 0, tt: true };
  }
  return null;
}

async function packedResponse(plan, named, request, save) {
  const bytes = await listPayload(plan);         // already inflates a B2PZ body, tolerantly
  const full = bytes.length;
  if (!full) throw new Error('a packed payload inflated to nothing');
  const type = sniffMime(bytes.subarray(0, Math.min(31, full - 1))) ||
    mimeFromName(named) || plan.mime || 'application/octet-stream';
  const headers = {
    'Content-Type': save ? (mimeFromName(named) || type) : type,
    'Content-Disposition': save ? attachmentHeader(named) : filenameHeader(named),
    'Accept-Ranges': 'bytes',
    'Cache-Control': save ? 'no-store' : 'public, max-age=600',
    'ETag': '"b2p-' + full.toString(16) + '-' + (type.includes('image') ? 'i' : 'f') + '"',
    'Access-Control-Allow-Origin': '*',
    'X-B2P-Packed': String(Number(plan.total) || 0),
  };
  if (save) {
    const from = resumeStart(request, full);
    headers['Content-Length'] = String(full - from);
    if (from > 0) headers['Content-Range'] = `bytes ${from}-${full - 1}/${full}`;
    return new Response(bytes.subarray(from), { status: from > 0 ? 206 : 200, headers });
  }
  const rng = parseRange(request.headers.get('Range'), full);
  if (rng && rng.unsatisfiable) {
    return new Response(null, { status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${full}`, 'Content-Length': '0' } });
  }
  const from = rng ? rng.start : 0;
  const to = rng ? rng.end : full - 1;
  headers['Content-Length'] = String(to - from + 1);
  if (rng) headers['Content-Range'] = `bytes ${from}-${to}/${full}`;
  return new Response(bytes.subarray(from, to + 1), { status: rng ? 206 : 200, headers });
}

async function serveFileSave(name, request) {
  try {
    const plan = await filePlan(name, false, true);
    if (!plan || !Array.isArray(plan.parts) || !plan.parts.length) return null;
    const named = plan.name || name;
    if (!/\.[A-Za-z0-9]{1,8}$/.test(named)) return null;          // no usable file name
    if (!Number(plan.total)) plan.total = await totalBytes(plan);
    const total = Number(plan.total) || 0;
    if (!total) return null;
    if (plan.packed) return packedResponse(plan, named, request, true);
    if (plan.parts && plan.parts.length) {
      try {
        const cache = await caches.open(PLAN_CACHE);
        await cache.put(planKey('archive-' + await digestHex(name)), new Response(JSON.stringify(plan), {
          headers: { 'Content-Type': 'application/json' },
        }));
      } catch (e) { }
    }
    const from = resumeStart(request, total);
    const headers = {
      'Content-Type': mimeFromName(named) || plan.mime || 'application/octet-stream',
      'Content-Disposition': attachmentHeader(named),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': String(total - from),
      'X-B2P-Save': named,
      'X-B2P-Sw': BUILT_VER || 'unbaked',
    };
    if (from > 0) headers['Content-Range'] = `bytes ${from}-${total - 1}/${total}`;
    return new Response(streamRange(plan, from, total - 1, total), {
      status: from > 0 ? 206 : 200, headers,
    });
  } catch (e) {
    return null;
  }
}

async function serveFileRaw(name, request, asCatbox) {
  try {
    const plan = await filePlan(name, asCatbox, true);     // `?r` resolves a NAME, nobody else
    if (!plan || !Array.isArray(plan.parts) || !plan.parts.length) return null;
    const named = plan.name || name;
    if (!Number(plan.total)) plan.total = await totalBytes(plan);
    const total = Number(plan.total) || 0;
    if (!total) return null;
    if (plan.packed) return packedResponse(plan, named, request, false);
    try {
      const cache = await caches.open(PLAN_CACHE);
      await cache.put(planKey('archive-' + await digestHex(name)), new Response(JSON.stringify(plan), {
        headers: { 'Content-Type': 'application/json' },
      }));
    } catch (e) { }
    const head = await fileBytes(plan, 0, Math.min(31, total - 1)).catch(() => new Uint8Array(0));
    const type = sniffMime(head) || mimeFromName(named) || plan.mime || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Content-Disposition': filenameHeader(named),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=600',
      'ETag': '"b2p-' + total.toString(16) + '-' + (type.includes('image') ? 'i' : 'f') + '"',
      'Access-Control-Allow-Origin': '*',
      'X-B2P-Raw': named,
      'X-B2P-Sw': BUILT_VER || 'unbaked',
    };
    const rng = parseRange(request.headers.get('Range'), total);
    if (rng && rng.unsatisfiable) {
      return new Response(null, { status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${total}`, 'Content-Length': '0' } });
    }
    const from = rng ? rng.start : 0;
    const to = rng ? rng.end : total - 1;
    headers['Content-Length'] = String(to - from + 1);
    if (rng) headers['Content-Range'] = `bytes ${from}-${to}/${total}`;
    return new Response(streamRange(plan, from, to, total), {
      status: rng ? 206 : 200, headers,
    });
  } catch (e) {
    return new Response('', { status: 500,
      headers: { 'X-B2P-Raw-Err': String((e && e.message) || e).slice(0, 160) } });
  }
}

const NESTED_ARCHIVE = /\.(zip|apk|jar|7z)$/i;
const NEST_MAX = 64 * 1024 * 1024;
const NESTS = new Map();
async function openNested(view, entry) {
  if (entry.dir || !entry.csize) return null;
  const key = view.key + '/' + entry.name + '#' + entry.csize;
  if (NESTS.has(key)) return NESTS.get(key);
  let nested = null;
  if (entry.method === 0) {
    const from = entry.start, size = entry.csize;
    nested = { total: size, key, read: (s, e) => view.read(from + s, from + Math.min(e, size - 1)) };
  } else if (entry.method === 8 && entry.csize <= NEST_MAX && Number(entry.size) <= NEST_MAX) {
    const comp = await view.read(entry.start, entry.start + entry.csize - 1);
    const mem = new Uint8Array(await new Response(new Blob([comp]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    nested = { total: mem.length, key, read: (s, e) => mem.subarray(s, Math.min(e, mem.length - 1) + 1) };
  }
  if (nested) NESTS.set(key, nested);     // one inflate per nested archive, like the directories
  return nested;
}

async function serveMember(address, request, save) {
  try {
    const plan = await archivePlan(address.archive, undefined, true);
    if (!plan) return null;
    if (!Number(plan.total)) plan.total = await totalBytes(plan);
    const segs = String(address.member).split('/');
    let view = viewOf(plan), prefix = '', depth = 0;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!seg) return null;
      const last = i === segs.length - 1;
      const entry = await zipEntry(view, prefix + seg);
      if (!entry) {
        if (last) return null;
        prefix += seg + '/';
        continue;
      }
      if (last) {
        if (NESTED_ARCHIVE.test(entry.name)) return null;
        return await memberResponse(view, entry, request, save);
      }
      if (!NESTED_ARCHIVE.test(entry.name) || ++depth > 3) return null;
      const nested = await openNested(view, entry);
      if (!nested) return null;          // too big to inflate here: the renderer's job
      view = nested;
      prefix = '';
    }
    return null;
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

function zipProgress(clientId, job, done, total, unit, bytes, bytesTotal) {
  if (!clientId) return;
  try {
    self.clients.get(clientId)
      .then((c) => c && c.postMessage({ type: 'b2p-zip', job, done, total, unit,
                                        bytes: Number(bytes) || 0, bytesTotal: Number(bytesTotal) || 0 }))
      .catch(() => {});
  } catch (e) { }
}

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
    try { reader.releaseLock(); } catch (e) { }
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

function zipTotal(members, prefix) {
  const enc = new TextEncoder();
  let total = 22;
  for (const e of members) {
    const n = enc.encode(e.name.slice(prefix.length)).length;
    total += 30 + n + (Number(e.size) || 0) + 46 + n;
  }
  return total;
}

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

function windowStream(skip, take) {
  let seen = 0, left = take;
  return new TransformStream({
    transform(chunk, ctrl) {
      let from = 0;
      if (seen < skip) {
        const cut = Math.min(chunk.length, skip - seen);
        seen += cut; from = cut;
      }
      if (from >= chunk.length || left <= 0) return;
      const piece = chunk.subarray(from, Math.min(chunk.length, from + left));
      left -= piece.length;
      if (piece.length) ctrl.enqueue(piece);
      if (left <= 0) ctrl.terminate();
    },
  });
}

function resumeStart(request, total) {
  const r = parseRange(request && request.headers.get('Range'), total);
  if (!r || r.unsatisfiable) return 0;
  return r.start;
}

async function serveZipJob(url, clientId, request) {
  const id = url.searchParams.get('id') || '';
  const job = id ? await readPlan('zip-' + id) : null;
  if (!job || !job.plan) return zipErrorPage(id, 'there is no such zip job — its plan is gone from the cache');
  const plan = job.plan;
  if (!Array.isArray(plan.parts) || !plan.parts.length) return zipErrorPage(id, 'the zip job carries no payload plan');
  try {
    if (!Number(plan.total)) plan.total = await totalBytes(plan);
    if (!Number(plan.total)) throw new Error('the archive reports no size');
    const sends = job.client || clientId;
    if (job.kind === 'file' && job.member && job.inner && Number.isFinite(Number(job.inner.localOff))) {
      const inner = job.inner, m = job.member;
      const head = await fileBytes(plan, inner.localOff, inner.localOff + 29);
      if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4)) {
        throw new Error('the nested archive header is not where the directory says it is');
      }
      const dataStart = inner.localOff + 30 + U16(head, 26) + U16(head, 28);
      const out = Number(m.size) > 0 ? Number(m.size) : 0;
      const headers = {
        'Content-Type': job.mime || 'application/octet-stream',
        'Content-Disposition': attachmentHeader(job.name),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      };
      if (out) headers['Content-Length'] = String(out);
      let body = streamRange(plan, dataStart, dataStart + Number(inner.csize) - 1, Number(inner.csize));
      if ((Number(inner.method) || 0) === 8) body = body.pipeThrough(new DecompressionStream('deflate-raw'));
      body = body.pipeThrough(windowStream(Number(m.localOff) || 0, Number(m.csize) || 0));
      if ((Number(m.method) || 0) === 8) body = body.pipeThrough(new DecompressionStream('deflate-raw'));
      let told = 0, toldAt = 0;
      body = countingStream(body, (n) => {
        const now = Date.now();
        if ((out && n === out) || n - told >= 262144 || now - toldAt >= 250) {
          told = n; toldAt = now;
          zipProgress(sends, job.id, n, out || 1, 'bytes', n, out || 1);
        }
      });
      return new Response(body, { status: 200, headers });
    }
    if (job.kind === 'file' && job.member && Number.isFinite(Number(job.member.localOff))) {
      const m = job.member;
      const localOff = (Number(job.base) || 0) + Number(m.localOff);
      const csize = Number(m.csize), method = Number(m.method) || 0;
      if (method !== 0 && method !== 8) throw new Error(`the member uses compression method ${method}`);
      const head = await fileBytes(plan, localOff, localOff + 29);
      if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4)) {
        throw new Error('the member local header is not where the directory says it is');
      }
      const start = localOff + 30 + U16(head, 26) + U16(head, 28);
      const out = Number(m.size) > 0 ? Number(m.size) : (method === 0 ? csize : 0);
      const headers = {
        'Content-Type': job.mime || 'application/octet-stream',
        'Content-Disposition': attachmentHeader(job.name),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      };
      const from = method === 0 ? resumeStart(request, csize) : 0;
      if (out) headers['Content-Length'] = String(Math.max(0, out - from));
      if (method === 0) {
        headers['Accept-Ranges'] = 'bytes';
        if (from > 0) headers['Content-Range'] = `bytes ${from}-${csize - 1}/${csize}`;
      }
      let body = streamRange(plan, start + from, start + csize - 1, csize);
      if (method === 8) body = body.pipeThrough(new DecompressionStream('deflate-raw'));
      let told = from, toldAt = 0;
      body = countingStream(body, (n) => {
        const done = from + n;
        const now = Date.now();
        if ((out && done === out) || done - told >= 262144 || now - toldAt >= 250) {
          told = done; toldAt = now;
          zipProgress(sends, job.id, done, out || csize, 'bytes', done, out || csize);
        }
      });
      return new Response(body, { status: from > 0 ? 206 : 200, headers });
    }
    if (job.kind === 'file') {
      const from = resumeStart(request, plan.total);
      const headers = {
        'Content-Type': job.mime || 'application/octet-stream',
        'Content-Disposition': attachmentHeader(job.name),
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      headers['Content-Length'] = String(plan.total - from);
      if (from > 0) headers['Content-Range'] = `bytes ${from}-${plan.total - 1}/${plan.total}`;
      let told = from, toldAt = 0;
      const body = countingStream(streamRange(plan, from, plan.total - 1, plan.total), (n) => {
        const done = from + n;
        const now = Date.now();
        if (done === plan.total || done - told >= 262144 || now - toldAt >= 250) {
          told = done; toldAt = now;
          zipProgress(sends, job.id, done, plan.total, 'bytes', done, plan.total);
        }
      });
      return new Response(body, { status: from > 0 ? 206 : 200, headers });
    }
    const prefix = String(job.prefix || '');
    const base = Number(job.base) || 0;
    const members = Array.isArray(job.members) && job.members.length
      ? job.members.map((e) => ({ name: String(e.name), size: Number(e.size) || 0,
                                  csize: Number.isFinite(Number(e.csize)) ? Number(e.csize) : Number(e.size) || 0,
                                  method: Number(e.method) || 0, crc: Number(e.crc) >>> 0,
                                  time: Number(e.time) || 0, date: Number(e.date) || 0,
                                  localOff: base + (Number(e.localOff) || 0) }))
      : [...(await zipDir(viewOf(plan))).values()]
        .filter((e) => !e.dir && e.name.startsWith(prefix) && e.name.length > prefix.length)
        .sort((a, b) => a.localOff - b.localOff);
    if (!members.length) throw new Error(`there are no files under "${prefix}" in ${plan.name || 'the archive'}`);
    const odd = members.find((e) => e.method !== 0 && e.method !== 8);
    if (odd) throw new Error(`${odd.name} uses compression method ${odd.method}, which this page cannot unpack`);
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
    const want = need === Infinity
      ? (1 << 30)
      : Math.max(65536, Math.ceil(need * 1.08) + 8192 - e.bytes.length);
    const got = await fetchPrefix(key, e.bytes.length, want);
    e.bytes = concatBytes([e.bytes, got.bytes]);
    e.eof = got.whole || got.bytes.length < want;
  }
  throw new Error(`part ${i + 1} could not be read past ${e.bytes.length} B`);
}

async function fetchPrefix(url, from, want) {
  const res = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { Range: `bytes=${from}-${from + want - 1}` },
  });
  if (!res.ok) throw new Error(`part: HTTP ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  netBytes.set(url, (netBytes.get(url) || 0) + body.length);
  noteReq('prefix', url, from, want, body.length);

  return { bytes: body, whole: res.status !== 206 };
}

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

const TTHDR = new Map();        // part url -> the payload's byte offset in the PNG
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
  const raw = new Uint8Array(await res.arrayBuffer());
  netBytes.set(key, (netBytes.get(key) || 0) + raw.length);
  noteReq('win:' + String(plan.name || plan.id || '?').slice(0, 12), key, off, want, raw.length);
  const body = unmaskBytes(raw, ttMask(plan, i));
  if (off === 0 && plan.cap && body.length === plan.cap) {
    payloadOf.set(key, body);
    prefixOf.delete(key);
  } else {
    ttWinPut(key, off, body);
  }
  return body;
}

function ttMask(plan, i) {
  const m = plan && plan.masks ? plan.masks[i] : 0;
  return Number(m) || 0;
}

function unmaskBytes(bytes, mask) {
  if (!mask || !bytes) return bytes;
  const out = new Uint8Array(bytes.length);
  for (let k = 0; k < bytes.length; k++) out[k] = bytes[k] ^ mask;
  return out;
}

async function ttPartPayload(plan, i, need = Infinity) {
  const mask = ttMask(plan, i);
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
      const tail = unmaskBytes(pngTail(e.bytes), mask);
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

function settle(plan, i, payload) {
  const key = plan.parts[i];
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
  } catch (e) { }
  if (chunks.length === 1) return chunks[0];
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return all;
}

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
