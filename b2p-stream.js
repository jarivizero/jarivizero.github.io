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

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.includes(MARK)) return;              // an ordinary request: leave it alone
  event.respondWith(serve(event.request, url));
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

function headersFor(plan) {
  return {
    'Content-Type': plan.mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  };
}

function parseRange(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m) return null;
  if (m[1] === '') {
    const n = parseInt(m[2], 10);
    if (!n) return { unsatisfiable: true };
    return { start: Math.max(0, total - n), end: total - 1 };
  }
  const start = parseInt(m[1], 10);
  const end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
    return { unsatisfiable: true };
  }
  return { start, end };
}

async function serve(request, url) {
  if (url.pathname.endsWith('/plan/') || url.pathname.includes('/plan/')) {
    return new Response('plan storage is the Cache API, not a request', { status: 405 });
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
  return new Response(streamRange(plan, r.start, r.end, total), {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${r.start}-${r.end}/${total}`,
      'Content-Length': String(r.end - r.start + 1),
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
        const part = await partBytes(plan, i);
        const off = at - i * plan.cap;
        const n = Math.min(end - at + 1, part.length - off);
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
  const last = await partBytes(plan, plan.parts.length - 1);
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

const inflight = new Map();

// The PAYLOAD of part i — the file bytes that part's PNG carries — from cache when it has been
// read before, from the network once otherwise. The cache key is the part URL, so two plans that
// share a part share the download.
function partBytes(plan, i) {
  const key = plan.parts[i];
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const cache = await caches.open(PART_CACHE);
    const hit = await cache.match(key);
    let bytes = null;
    if (hit) {
      bytes = new Uint8Array(await hit.arrayBuffer());
    } else {
      const res = await fetch(key, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`part ${i + 1}: HTTP ${res.status}`);
      bytes = await pngPayload(new Uint8Array(await res.arrayBuffer()));
      if (!bytes) throw new Error(`part ${i + 1} is not a bin2png PNG`);
      await cache.put(key, new Response(bytes, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    }
    const last = i === plan.parts.length - 1;
    if (!last && bytes.length !== plan.cap) {
      // A short part in the middle means the file was not cut at this capacity, so every offset
      // after it would be wrong. Refusing is the only honest answer.
      throw new Error(`part ${i + 1} holds ${bytes.length} B, not the planned ${plan.cap} — ` +
                      'this payload was not encoded at the default canvas');
    }
    return bytes;
  })();
  inflight.set(key, p);
  p.catch(() => inflight.delete(key)).then(() => inflight.delete(key));
  return p;
}

// ─── the codec, in the worker ──────────────────────────────────────────────────────────────────
// The same two forms the page reads: colour type 6 (RGBA, alpha = byte count) and colour type 3
// (palette + tRNS, which is what X re-encodes an upload to).
async function pngPayload(bytes) {
  if (!(bytes && bytes.length > 33 && bytes[0] === 0x89 && bytes[1] === 0x50)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const start = off + 8;
    if (type === 'IHDR') {
      w = dv.getUint32(start); h = dv.getUint32(start + 4);
      depth = bytes[start + 8]; color = bytes[start + 9]; interlace = bytes[start + 12];
    } else if (type === 'PLTE') plte = bytes.subarray(start, start + len);
    else if (type === 'tRNS') trns = bytes.subarray(start, start + len);
    else if (type === 'IDAT') idat.push(bytes.subarray(start, start + len));
    else if (type === 'IEND') break;
    off = start + len + 4;
  }
  const palette = color === 3 && depth === 8 && plte && plte.length >= 3;
  if (depth !== 8 || interlace !== 0 || !w || !h || !idat.length) return null;
  if (color !== 6 && !palette) return null;
  const zip = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let z = 0;
  for (const c of idat) { zip.set(c, z); z += c.length; }
  return decompressedPayload(zip, w, h, color, plte, trns);
}

async function decompressedPayload(zip, w, h, color, plte, trns) {
  const raw = new Uint8Array(await new Response(
    new Blob([zip]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const bpp = color === 3 ? 1 : 4;
  const stride = w * bpp;
  if (raw.length < h * (stride + 1)) return null;
  const px = new Uint8Array(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
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

