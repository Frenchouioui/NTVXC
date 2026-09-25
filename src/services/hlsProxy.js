import { Readable } from 'node:stream';
import { CONFIG } from '../config.js';

function decodeUrlParam(raw) {
  if (!raw) return '';
  let str = String(raw).trim();
  try {
    while (str.includes('%3A') || str.includes('%2F') || str.includes('%3a') || str.includes('%2f')) {
      str = decodeURIComponent(str);
    }
  } catch {}
  return str;
}

function getOriginFromReferer(ref) {
  try {
    return new URL(ref).origin;
  } catch {
    return CONFIG.NTV_BASE_URL;
  }
}

import { fetchDliveRealStream } from './streamResolver.js';

/**
 * Handle HLS playlist proxying and segment URL rewriting
 */
export async function handleHlsProxy(req, res) {
  let targetUrl = decodeUrlParam(req.query.url);
  let referer = decodeUrlParam(req.query.ref) || CONFIG.NTV_BASE_URL;
  const channelId = req.query.channel || req.query.channelId;

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).send('Missing or invalid url parameter');
  }

  try {
    let upstreamRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Referer': referer,
        'Origin': getOriginFromReferer(referer)
      }
    });

    // SELF-HEALING: If token expired (403, 404, 410) and channelId is known, re-extract fresh stream!
    if ((upstreamRes.status === 403 || upstreamRes.status === 404 || upstreamRes.status === 410) && channelId) {
      console.warn(`[hlsProxy] Token expired for channel ${channelId} (${upstreamRes.status}), auto-healing with fresh token...`);
      const freshData = await fetchDliveRealStream(channelId, true);
      if (freshData && freshData.streamUrl) {
        targetUrl = freshData.streamUrl;
        referer = freshData.referer || referer;
        upstreamRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': CONFIG.USER_AGENT,
            'Referer': referer,
            'Origin': getOriginFromReferer(referer)
          }
        });
      }
    }

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send(`Upstream error: ${upstreamRes.statusText}`);
    }

    const playlistText = await upstreamRes.text();
    const hostBase = `${req.protocol}://${req.get('host')}`;
    const targetUrlObj = new URL(targetUrl);
    const channelParam = channelId ? `&channel=${encodeURIComponent(channelId)}` : '';

    // Rewrite lines in m3u8
    const lines = playlistText.split(/\r?\n/);
    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return line;
      }

      // Resolve relative URI to absolute URI
      let absoluteUri;
      try {
        absoluteUri = new URL(trimmed, targetUrlObj.href).href;
      } catch {
        return line;
      }

      // If it's a sub-playlist (.m3u8)
      if (trimmed.includes('.m3u8') || absoluteUri.includes('.m3u8')) {
        return `${hostBase}/proxy/hls?url=${encodeURIComponent(absoluteUri)}&ref=${encodeURIComponent(referer)}${channelParam}`;
      }

      // If it's a segment (.ts or other chunk)
      return `${hostBase}/proxy/ts?url=${encodeURIComponent(absoluteUri)}&ref=${encodeURIComponent(referer)}`;
    });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(rewritten.join('\n'));
  } catch (e) {
    console.error('[hlsProxy] Error proxying playlist:', e.message);
    res.status(500).send(`Proxy error: ${e.message}`);
  }
}

/**
 * Handle binary TS chunk streaming without buffering in memory
 */
export async function handleTsProxy(req, res) {
  const targetUrl = decodeUrlParam(req.query.url);
  const referer = decodeUrlParam(req.query.ref) || CONFIG.NTV_BASE_URL;

  if (!targetUrl || !targetUrl.startsWith('http')) {
    return res.status(400).send('Missing or invalid url parameter');
  }

  try {
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    const upstreamRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Referer': referer,
        'Origin': getOriginFromReferer(referer)
      }
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send(`Upstream chunk error: ${upstreamRes.statusText}`);
    }

    const contentLength = upstreamRes.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    if (upstreamRes.body) {
      const nodeStream = Readable.fromWeb(upstreamRes.body);
      nodeStream.on('error', (err) => {
        if (!res.headersSent) res.status(500).end();
      });
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error('[hlsProxy] Error streaming TS segment:', e.message);
    if (!res.headersSent) {
      res.status(500).send(`TS proxy error: ${e.message}`);
    }
  }
}
