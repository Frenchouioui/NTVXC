import { CONFIG } from '../config.js';

/**
 * Handle HLS playlist proxying and segment URL rewriting
 */
export async function handleHlsProxy(req, res) {
  const targetUrl = req.query.url;
  const referer = req.query.ref || CONFIG.NTV_BASE_URL;

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Referer': referer,
        'Origin': new URL(referer).origin
      }
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send(`Upstream error: ${upstreamRes.statusText}`);
    }

    const playlistText = await upstreamRes.text();
    const hostBase = `${req.protocol}://${req.get('host')}`;
    const targetUrlObj = new URL(targetUrl);

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
        return `${hostBase}/proxy/hls?url=${encodeURIComponent(absoluteUri)}&ref=${encodeURIComponent(referer)}`;
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
 * Handle binary TS chunk streaming
 */
export async function handleTsProxy(req, res) {
  const targetUrl = req.query.url;
  const referer = req.query.ref || CONFIG.NTV_BASE_URL;

  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Referer': referer,
        'Origin': new URL(referer).origin
      }
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send(`Upstream chunk error: ${upstreamRes.statusText}`);
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Convert fetch body to stream pipe if readable, or send arrayBuffer
    const buffer = await upstreamRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (e) {
    console.error('[hlsProxy] Error streaming TS segment:', e.message);
    res.status(500).send(`TS proxy error: ${e.message}`);
  }
}
