// ==UserScript==
// @name         Twitter MP4 Extractor / Video Downloader
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Adds purple download button next to Share button on Twitter to extract MP4 from TweetDetail API
// @author       jarivizero
// @match        https://twitter.com/*
// @match        https://x.com/*
// @grant        GM_setClipboard
// @updateurl    https://jarivizero.github.io/XTwitter_MP4_Extract.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Intercept XHR + fetch for TweetDetail ──────────────────────────────────
  const capturedVideos = new Map(); // tweetId → mp4 url

  function extractMp4(variants) {
    if (!Array.isArray(variants) || variants.length === 0) return null;
    // Try index 3 first, then walk down until mp4 found
    const start = Math.min(3, variants.length - 1);
    for (let i = start; i >= 0; i--) {
      const v = variants[i];
      if (v && v.url && v.url.includes('.mp4')) return v.url;
    }
    // Fallback: any mp4
    for (const v of variants) {
      if (v && v.url && v.url.includes('.mp4')) return v.url;
    }
    return null;
  }

  function parseAndStore(json) {
    try {
      const instr =
        json?.data?.threaded_conversation_with_injections_v2?.instructions;
      if (!Array.isArray(instr)) return;

      for (const instruction of instr) {
        const entries = instruction?.entries;
        if (!Array.isArray(entries)) continue;

        for (const entry of entries) {
          // Primary tweet
          tryExtractFromResult(
            entry?.content?.itemContent?.tweet_results?.result
          );
          // Quoted tweet
          tryExtractFromResult(
            entry?.content?.itemContent?.tweet_results?.result
              ?.quoted_status_result?.result
          );
        }
      }
    } catch (e) {
      console.debug('[TVD] parse error', e);
    }
  }

  function tryExtractFromResult(result) {
    if (!result) return;
    const tweetId = result?.rest_id || result?.legacy?.id_str;
    const media = result?.legacy?.entities?.media;
    if (!Array.isArray(media)) return;

    for (const m of media) {
      const variants = m?.video_info?.variants;
      if (!variants) continue;
      const url = extractMp4(variants);
      if (url && tweetId) {
        capturedVideos.set(tweetId, url);
        // Also store by path segment for matching
        capturedVideos.set('latest', url);
        console.debug('[TVD] captured', tweetId, url);
      }
    }
  }

  // ── Patch fetch ────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (url.includes('TweetDetail')) {
      const clone = res.clone();
      clone.json().then(parseAndStore).catch(() => {});
    }
    return res;
  };

  // ── Patch XHR ──────────────────────────────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._tvdUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._tvdUrl && this._tvdUrl.includes('TweetDetail')) {
      this.addEventListener('load', () => {
        try {
          parseAndStore(JSON.parse(this.responseText));
        } catch (e) {}
      });
    }
    return origSend.apply(this, args);
  };

  // ── UI helpers ─────────────────────────────────────────────────────────────
  function getTweetIdFromUrl() {
    const m = location.pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function getBestUrl() {
    const tweetId = getTweetIdFromUrl();
    if (tweetId && capturedVideos.has(tweetId)) return capturedVideos.get(tweetId);
    if (capturedVideos.has('latest')) return capturedVideos.get('latest');
    return null;
  }

  function makeButton() {
    const btn = document.createElement('button');
    btn.id = 'tvd-btn';
    btn.title = 'Download MP4';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>`;
    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#7c3aed',
      color: '#fff',
      border: 'none',
      borderRadius: '9999px',
      width: '34px',
      height: '34px',
      cursor: 'pointer',
      marginLeft: '6px',
      flexShrink: '0',
      transition: 'background 0.2s',
    });
    btn.addEventListener('mouseenter', () => (btn.style.background = '#6d28d9'));
    btn.addEventListener('mouseleave', () => (btn.style.background = '#7c3aed'));

    btn.addEventListener('click', async () => {
      const url = getBestUrl();
      if (!url) {
        btn.style.background = '#dc2626';
        setTimeout(() => (btn.style.background = '#7c3aed'), 1500);
        alert('[TVD] No MP4 found yet. Play/open the tweet first.');
        return;
      }
      // Open in new tab
      window.open(url, '_blank');
      // Copy to clipboard
      try {
        GM_setClipboard(url);
      } catch {
        try { await navigator.clipboard.writeText(url); } catch {}
      }
      // Flash green
      btn.style.background = '#16a34a';
      setTimeout(() => (btn.style.background = '#7c3aed'), 1500);
    });

    return btn;
  }

  // ── Inject button next to Share ────────────────────────────────────────────
  function injectButton() {
    if (document.getElementById('tvd-btn')) return;

    // Share button: aria-label="Share post" or similar
    const shareBtn = document.querySelector(
      '[data-testid="shareButton"], [aria-label*="Share"]'
    );
    if (!shareBtn) return;

    const container = shareBtn.closest('[role="group"]') || shareBtn.parentElement;
    if (!container) return;

    const btn = makeButton();
    container.appendChild(btn);
  }

  // ── Observe DOM ────────────────────────────────────────────────────────────
  let injectTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(injectButton, 600);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial attempt
  setTimeout(injectButton, 1500);

  // Re-inject on SPA navigation
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      document.getElementById('tvd-btn')?.remove();
      setTimeout(injectButton, 1500);
    }
  }, 500);

})();
