import { CONFIG } from '../config.js';
import { getActiveMirror, getAllMirrors } from './mirrorManager.js';

/**
 * Main stream resolver entrypoint
 */
export async function resolveStream(id, baseUrl) {
  const streams = [];

  // Case 1: Match event (NTV or DLive schedule event)
  if (id.startsWith('ntv-match-') || id.startsWith('ntv-dlive-match-')) {
    return resolveMatchStream(id, baseUrl);
  }

  // Case 2: 24/7 Channel
  // Format: ntv-{server}-{rawId} or {server}-{rawId}
  let server = 'dlhd';
  let rawId = id;
  if (id.startsWith('ntv-')) {
    const parts = id.split('-');
    if (parts.length >= 3) {
      server = parts[1];
      rawId = parts.slice(2).join('-');
    }
  } else if (id.includes('-')) {
    const parts = id.split('-');
    server = parts[0];
    rawId = parts.slice(1).join('-');
  }


  try {
    if (server === 'dlhd' || server === 'dlive') {
      const dlhdStreams = await resolveDlhd(rawId, baseUrl, server.toUpperCase());
      streams.push(...dlhdStreams);
    } else if (server === 'cdnlive') {
      const cdnLiveStreams = await resolveCdnLive(rawId, baseUrl);
      streams.push(...cdnLiveStreams);
    } else if (server === 'hesgoales') {
      const hesStreams = await resolveHesgoal(rawId, baseUrl);
      streams.push(...hesStreams);
    } else {
      // General fallback
      const fallbackStreams = await resolveDlhd(rawId, baseUrl, 'DIRECT');
      streams.push(...fallbackStreams);
    }
  } catch (e) {
    console.error(`[streamResolver] Error resolving stream for ${id}:`, e.message);
  }

  return streams;
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EMBEDS_FILE = path.join(__dirname, '../../data/dlive_embeds.json');

let dliveEmbeds = {};
try {
  if (fs.existsSync(EMBEDS_FILE)) {
    dliveEmbeds = JSON.parse(fs.readFileSync(EMBEDS_FILE, 'utf-8'));
  }
} catch (e) {
  console.warn('[streamResolver] Error reading dlive_embeds.json:', e.message);
}

function saveEmbeds() {
  try {
    fs.writeFileSync(EMBEDS_FILE, JSON.stringify(dliveEmbeds, null, 2), 'utf-8');
  } catch {}
}

export function getDliveEmbedUrl(channelId) {
  const cleanId = String(channelId).replace(/[^0-9]/g, '');
  return dliveEmbeds[cleanId]?.primary || `https://dlive.sx/stream/stream-${cleanId}.php`;
}

const dliveStreamCache = new Map();
const DLIVE_STREAM_CACHE_TTL = 60 * 1000; // 60 seconds fresh TTL to avoid expired tokens

function decodeEConfig(str) {
  const order = [2, 0, 3, 1];
  const chunksCount = 4;
  const s1 = Buffer.from(str, 'base64').toString('binary');
  const len = s1.length;
  const chunkSize = Math.ceil(len / chunksCount);
  const chunks = [];
  let offset = 0;
  for (let i = 0; i < chunksCount; i++) {
    chunks.push(s1.substr(offset, chunkSize));
    offset += chunkSize;
  }
  const reordered = [];
  for (let i = 0; i < order.length; i++) {
    let chunk = String(chunks[i]);
    chunk = chunk.slice(0, 3) + chunk.slice(4);
    reordered[order[i]] = Buffer.from(chunk, 'base64').toString('binary');
  }
  const joined = reordered.join('');
  const finalStr = Buffer.from(joined, 'base64').toString('utf-8');
  return JSON.parse(finalStr);
}

/**
 * Dynamically extract live M3U8 from dlive.sx / assetrage.net
 * Extracts both primary (Player 1 assetrage.net) and secondary (Player 2 tiestep.top) direct CDN streams
 * Decodes _econfig, Clappr atob, or direct .m3u8 URLs
 */
export async function fetchDliveRealStream(channelId, forceRefresh = false) {
  const cleanId = String(channelId).replace(/[^0-9]/g, '');
  if (!cleanId) return null;

  const cached = dliveStreamCache.get(cleanId);
  if (!forceRefresh && cached && (Date.now() - cached.time) < DLIVE_STREAM_CACHE_TTL) {
    return cached.data;
  }

  const foundStreams = [];

  // Helper function to extract stream from an embed URL
  async function extractFromEmbed(embedUrl, label, refererUrl) {
    if (!embedUrl) return null;
    try {
      const res = await fetch(embedUrl, {
        signal: AbortSignal.timeout(3500),
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Referer': refererUrl || embedUrl
        }
      });
      if (!res.ok) return null;
      const html = await res.text();

      // 1. Check for _econfig
      const econfigMatch = html.match(/window\._econfig\s*=\s*['"]([^'"]+)['"]/);
      if (econfigMatch) {
        const config = decodeEConfig(econfigMatch[1]);
        const streamUrl = config.stream_url || config.stream_url_nop2p;
        if (streamUrl) {
          return { label, streamUrl, referer: embedUrl };
        }
      }

      // 2. Check for Clappr base64
      const atobMatch = html.match(/source\s*:\s*window\.atob\(['"]([^'"]+)['"]\)/i) ||
                        html.match(/source\s*:\s*atob\(['"]([^'"]+)['"]\)/i);
      if (atobMatch) {
        try {
          const decoded = Buffer.from(atobMatch[1], 'base64').toString('utf8');
          if (decoded.includes('.m3u8')) {
            return { label, streamUrl: decoded, referer: embedUrl };
          }
        } catch {}
      }

      // 3. Direct m3u8 in html
      const m3u8Match = html.match(/https?:\/\/[^'"\s<>]+\.m3u8[^'"\s<>]*/i);
      if (m3u8Match) {
        return { label, streamUrl: m3u8Match[0], referer: embedUrl };
      }
    } catch (e) {
      // Timeout or network error on embed host
    }
    return null;
  }

  // FAST PATH: Check if we have cached embed URLs for this channel (e.g. Arte 958)
  const cachedEmbeds = dliveEmbeds[cleanId];
  if (cachedEmbeds) {
    if (cachedEmbeds.primary) {
      const st = await extractFromEmbed(cachedEmbeds.primary, 'Serveur Principal', `https://dlive.sx/stream/stream-${cleanId}.php`);
      if (st) foundStreams.push(st);
    }
    if (cachedEmbeds.secondary) {
      const st = await extractFromEmbed(cachedEmbeds.secondary, 'Serveur Alternatif', `https://dlive.sx/cast/stream-${cleanId}.php`);
      if (st && !foundStreams.some(s => s.streamUrl === st.streamUrl)) foundStreams.push(st);
    }
  }

  // SLOW PATH: If not in embed cache or both failed, fetch the stream page from DLive mirrors
  if (foundStreams.length === 0) {
    const mirrors = ['https://dlive.sx', 'https://dlhd.st', 'https://dlhd.pk', 'https://dlstreams.st'];
    const active = getActiveMirror('dlive');
    if (active && !mirrors.includes(active)) mirrors.unshift(active);

    const playerPaths = [
      { name: 'stream', label: 'Serveur Principal', key: 'primary' },
      { name: 'cast', label: 'Serveur Alternatif', key: 'secondary' }
    ];

    for (const p of playerPaths) {
      if (foundStreams.length >= 2) break;
      let embedUrl = null;

      for (const m of mirrors) {
        try {
          const playerUrl = `${m}/${p.name}/stream-${cleanId}.php`;
          const res = await fetch(playerUrl, {
            signal: AbortSignal.timeout(3500),
            headers: {
              'User-Agent': CONFIG.USER_AGENT,
              'Referer': `${m}/watch.php?id=${cleanId}`
            }
          });
          if (!res.ok) continue;
          const html = await res.text();
          const iframeMatch = html.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
          if (iframeMatch) {
            embedUrl = iframeMatch[1];
            break;
          }
        } catch {}
      }

      if (embedUrl) {
        if (!dliveEmbeds[cleanId]) dliveEmbeds[cleanId] = {};
        dliveEmbeds[cleanId][p.key] = embedUrl;
        saveEmbeds();

        const st = await extractFromEmbed(embedUrl, p.label, `https://dlive.sx/${p.name}/stream-${cleanId}.php`);
        if (st && !foundStreams.some(s => s.streamUrl === st.streamUrl)) {
          foundStreams.push(st);
        }
      }
    }
  }

  if (foundStreams.length > 0) {
    const primary = foundStreams[0];
    const data = {
      streamUrl: primary.streamUrl,
      referer: primary.referer,
      streams: foundStreams
    };
    dliveStreamCache.set(cleanId, { data, time: Date.now() });
    return data;
  }

  return null;
}

/**
 * Resolver for DaddyLive / DLHD / DLive channels
 * Pure high-definition direct HLS streams and anti-bug proxy (NO broken third-party iframes)
 */
export async function resolveDlhd(channelId, baseUrl, labelPrefix = 'DLHD') {
  const streams = [];
  const cleanId = channelId.replace(/[^0-9]/g, '');

  if (!cleanId) return streams;

  const dliveBase = getActiveMirror('dlive') || 'https://dlive.sx';

  // 1. Extract live HLS streams dynamically (Player 1 + Player 2)
  const dliveData = await fetchDliveRealStream(cleanId);
  if (dliveData && dliveData.streams && dliveData.streams.length > 0) {
    dliveData.streams.forEach((st, idx) => {
      const isPrimary = idx === 0;
      const sName = isPrimary ? 'Serveur Principal' : `Serveur Alternatif ${idx > 1 ? idx : ''}`.trim();

      // 1. Proxy HLS (Essential for CORS & Referer protection, plays instantly everywhere, with self-healing channel ID)
      if (baseUrl) {
        const proxyUrl = `${baseUrl}/proxy/hls?url=${encodeURIComponent(st.streamUrl)}&ref=${encodeURIComponent(st.referer)}&channel=${cleanId}`;
        streams.push({
          name: `NTVio • ${labelPrefix} (Proxy)`,
          title: `🛡️ ${sName} [Proxy Anti-Bug]`,
          url: proxyUrl,
          behaviorHints: { notWebReady: false }
        });
      }

      // 2. Direct HLS CDN
      streams.push({
        name: `NTVio • ${labelPrefix} [${sName}]`,
        title: `⚡ ${sName} [CDN HD]`,
        url: st.streamUrl,
        behaviorHints: { notWebReady: false }
      });
    });
  }

  // 3. Sandboxed Direct Web Player (Runs INSIDE the player without redirection!)
  if (baseUrl) {
    streams.push({
      name: `NTVio • Web Player [Secours]`,
      title: `📺 Lecteur Web Intégré [Secours 100%]`,
      url: `${baseUrl}/api/embed/${cleanId}`,
      isEmbed: true,
      behaviorHints: { notWebReady: false }
    });
  }

  // 4. Official DLive Web player link (opens clean watch page in new tab)
  streams.push({
    name: `DLive.sx • [Officiel]`,
    title: `🌐 DLive.sx Officiel: #${cleanId} ↗`,
    externalUrl: `${dliveBase}/watch.php?id=${cleanId}`,
    isExternal: true
  });

  return streams;
}

/**
 * Resolver for Titan / CDNLive channels
 */
export async function resolveCdnLive(channelRawId, baseUrl) {
  const streams = [];
  let name = channelRawId;
  let code = 'us';

  try {
    const { getChannelById } = await import('./ntvApi.js');
    const fullId = channelRawId.startsWith('ntv-') ? channelRawId : `ntv-cdnlive-${channelRawId}`;
    const ch = await getChannelById(fullId);

    if (ch) {
      if (ch.url && ch.url.includes('cdnlivetv.tv')) {
        try {
          const parsedUrl = new URL(ch.url);
          name = parsedUrl.searchParams.get('name') || ch.name || name;
          code = parsedUrl.searchParams.get('code') || ch.country || code;
        } catch {}
      } else {
        if (ch.name) name = ch.name;
        if (ch.country) code = ch.country.toLowerCase();
      }
    }
  } catch (e) {
    console.warn('[streamResolver] Failed to resolve channel details for cdnLive:', e.message);
  }

  const playerUrl = `https://cdnlivetv.tv/api/v1/channels/player/?name=${encodeURIComponent(name)}&code=${encodeURIComponent(code.toLowerCase())}&user=ntvstream&plan=free`;
  return resolveCdnLiveFromUrl(playerUrl, 'CDNLive Stream', baseUrl);
}

/**
 * Direct extractor from cdnlivetv.tv player URL
 */
export async function resolveCdnLiveFromUrl(playerUrl, label = 'CDNLive Stream', baseUrl) {
  const streams = [];
  if (!playerUrl) return streams;

  try {
    const res = await fetch(playerUrl, {
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Referer': `${CONFIG.NTV_BASE_URL}/`
      }
    });

    if (!res.ok) return streams;
    const html = await res.text();

    // Strategy 1: Look for decoded playlist.m3u8 pattern
    const m3u8Match = html.match(/https?:\/\/[^\s"'<>]+\/secure\/api\/v1\/[a-f0-9]+\/playlist\.m3u8\?token=[^\s"'<>]+/i);
    if (m3u8Match) {
      const url = m3u8Match[0];
      streams.push({
        name: 'NTVio • TITAN',
        title: `⚡ ${label} [HD]`,
        url,
        behaviorHints: { notWebReady: false }
      });
      if (baseUrl) {
        streams.push({
          name: 'NTVio • TITAN (Proxy)',
          title: `🛡️ ${label} [Proxy Anti-Bug]`,
          url: `${baseUrl}/proxy/hls?url=${encodeURIComponent(url)}&ref=${encodeURIComponent('https://cdnlivetv.tv/')}`,
          behaviorHints: { notWebReady: false }
        });
      }
      return streams;
    }

    // Strategy 2: Extract and decode base64 variable chunks
    const b64Regex = /var\s+([a-zA-Z0-9_]+)\s*=\s*'([A-Za-z0-9+/=_-]+)';/g;
    const vars = {};
    let match;
    while ((match = b64Regex.exec(html)) !== null) {
      vars[match[1]] = match[2];
    }

    const concatMatch = html.match(/([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+\([a-zA-Z0-9_]+\)(?:\s*\+\s*[a-zA-Z0-9_]+\([a-zA-Z0-9_]+\))+);/);
    if (concatMatch) {
      const parts = concatMatch[2].match(/[a-zA-Z0-9_]+\(([a-zA-Z0-9_]+)\)/g);
      if (parts) {
        let assembledUrl = '';
        for (const p of parts) {
          const varName = p.match(/\(([^)]+)\)/)[1];
          if (vars[varName]) {
            try {
              let b64 = vars[varName].replace(/-/g, '+').replace(/_/g, '/');
              while (b64.length % 4) b64 += '=';
              assembledUrl += Buffer.from(b64, 'base64').toString('utf-8');
            } catch {}
          }
        }

        if (assembledUrl.includes('playlist.m3u8')) {
          streams.push({
            name: 'NTVio • TITAN',
            title: `⚡ ${label} [HD]`,
            url: assembledUrl,
            behaviorHints: { notWebReady: false }
          });
          if (baseUrl) {
            streams.push({
              name: 'NTVio • TITAN (Proxy)',
              title: `🛡️ ${label} [Proxy Anti-Bug]`,
              url: `${baseUrl}/proxy/hls?url=${encodeURIComponent(assembledUrl)}&ref=${encodeURIComponent('https://cdnlivetv.tv/')}`,
              behaviorHints: { notWebReady: false }
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('[streamResolver] cdnLive resolution error:', e.message);
  }

  return streams;
}

/**
 * Resolver for Hesgoal / Falcon channels
 */
export async function resolveHesgoal(channelId, baseUrl) {
  const streams = [];
  const cleanId = channelId.replace(/^f-/, '');

  try {
    const playerUrl = `https://wideiptv.top/player/${encodeURIComponent(cleanId)}`;
    const res = await fetch(playerUrl, {
      headers: {
        'User-Agent': CONFIG.USER_AGENT,
        'Referer': 'https://hesgoal.team/'
      }
    });

    if (res.ok) {
      const html = await res.text();
      const streamMatch = html.match(/streamUrl:\s*["']([^"']+)["']/);
      if (streamMatch) {
        const streamUrl = streamMatch[1].replace(/\\\//g, '/');
        if (baseUrl) {
          streams.push({
            name: 'NTVio • FALCON (Proxy)',
            title: '⚡ Hesgoal Stream (HD)',
            url: `${baseUrl}/proxy/hls?url=${encodeURIComponent(streamUrl)}&ref=${encodeURIComponent('https://wideiptv.top/')}`,
            behaviorHints: { notWebReady: false }
          });
        }
        streams.push({
          name: 'NTVio • FALCON',
          title: '⚡ Hesgoal Stream Direct',
          url: streamUrl,
          behaviorHints: { notWebReady: false }
        });
      }
    }
  } catch (e) {
    console.error('[streamResolver] hesgoal error:', e.message);
  }

  return streams;
}

const matchStreamCache = new Map();
const MATCH_STREAM_CACHE_TTL = 45 * 1000; // 45s cache for resolved match streams

/**
 * Resolver for Live Sports Match events (NTV & DLive)
 * ENSURES ALL SOURCES ARE SHOWN AND ACCURATELY RESOLVED!
 */
export async function resolveMatchStream(matchId, baseUrl) {
  const cacheKey = `${matchId}_${baseUrl || ''}`;
  const cached = matchStreamCache.get(cacheKey);
  if (cached && (Date.now() - cached.time) < MATCH_STREAM_CACHE_TTL) {
    return cached.streams;
  }

  const { getMatchById } = await import('./ntvApi.js');
  const match = await getMatchById(matchId);

  if (!match || !Array.isArray(match.sources) || !match.sources.length) {
    return [];
  }

  // Helper with per-source timeout to prevent slow sources from delaying others
  const withTimeout = (promise, ms = 3500) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Source timeout')), ms))
    ]);

  // Resolve all sources in parallel via Promise.allSettled with timeout
  const sourcePromises = match.sources.map(async (src, i) => {
    return withTimeout((async () => {
      const sourceStreams = [];
      const sourceUrl = src.url || '';
      const label = src.channelName || (src.source ? `${src.source.toUpperCase()} ${src.id || ''}` : `Source ${i + 1}`);
      const serverName = (src.server || match.server || 'Server').toUpperCase();
      const sourceIndex = i + 1;

    // 1. Direct M3U8 inside query parameter or URL (e.g. Falcon / livelive24 feeds)
    if (sourceUrl.includes('.m3u8') || sourceUrl.includes('url=') || sourceUrl.includes('livelive24')) {
      const m3u8Url = extractDirectM3u8(sourceUrl);
      if (m3u8Url) {
        sourceStreams.push({
          name: `NTVio • [${serverName}]`,
          title: `⚽ Source ${sourceIndex}: ${label} [Direct HD]`,
          url: m3u8Url,
          behaviorHints: { notWebReady: false }
        });

        if (baseUrl) {
          sourceStreams.push({
            name: `NTVio • [${serverName}] (Proxy)`,
            title: `🛡️ Source ${sourceIndex}: ${label} [Proxy Anti-Bug]`,
            url: `${baseUrl}/proxy/hls?url=${encodeURIComponent(m3u8Url)}&ref=${encodeURIComponent('https://livelive24.com/')}`,
            behaviorHints: { notWebReady: false }
          });
        }

        // Also add web link if it had a wrapper
        if (sourceUrl.startsWith('http') && !sourceUrl.endsWith('.m3u8')) {
          sourceStreams.push({
            name: `NTVio • [${serverName}] (Web)`,
            title: `🌐 Source ${sourceIndex}: ${label} ↗`,
            externalUrl: sourceUrl
          });
        }
        return sourceStreams;
      }
    }

    // 2. DLHD / DLive / Golf numeric stream channel resolution
    const chId = src.channelId || 
                 (src.id && /^\d+$/.test(String(src.id)) ? String(src.id) : null) || 
                 (src.source && (src.source === 'golf' || src.source === 'dlive' || src.source === 'dlhd') && src.id ? String(src.id) : null) ||
                 (sourceUrl.match(/stream-(\d+)\.php/) || sourceUrl.match(/watch\.php\?id=(\d+)/) || [])[1];

    if (chId && chId !== '00') {
      const realDlive = await fetchDliveRealStream(chId);
      if (realDlive && realDlive.streams && realDlive.streams.length > 0) {
        realDlive.streams.forEach((st, sIdx) => {
          const isPrimary = sIdx === 0;
          const sLabel = isPrimary ? 'Principal' : 'Alternatif';

          if (baseUrl) {
            sourceStreams.push({
              name: `NTVio • [${serverName}] (Proxy)`,
              title: `🛡️ Source ${sourceIndex}: ${label} [Proxy Anti-Bug ${sLabel}]`,
              url: `${baseUrl}/proxy/hls?url=${encodeURIComponent(st.streamUrl)}&ref=${encodeURIComponent(st.referer)}`,
              behaviorHints: { notWebReady: false }
            });
          }

          sourceStreams.push({
            name: `NTVio • [${serverName}]`,
            title: `⚽ Source ${sourceIndex}: ${label} [Direct CDN ${sLabel}]`,
            url: st.streamUrl,
            behaviorHints: { notWebReady: false }
          });
        });
      }

      // Legitimate official watch page on DLive (clean external tab)
      sourceStreams.push({
        name: `DLive.sx • [Officiel]`,
        title: `🌐 DLive.sx Officiel: ${label} ↗`,
        externalUrl: `https://dlive.sx/watch.php?id=${chId}`,
        isExternal: true
      });
      return sourceStreams;
    }

    // 2.5 Titan / CDNLive player URLs (Direct HLS & Proxy instead of broken embeds)
    if (src.server === 'titan' || (sourceUrl && sourceUrl.includes('cdnlivetv.tv'))) {
      const cdnStreams = await resolveCdnLiveFromUrl(sourceUrl, `Source ${sourceIndex}: ${label}`, baseUrl);
      if (cdnStreams.length > 0) {
        sourceStreams.push(...cdnStreams);
        return sourceStreams;
      }
    }

    // 3. Kobra & Raptor embed providers (e.g. admin, hotel, echo, delta, embedindia, kobra, etc.)
    if (src.source && src.id && !sourceUrl.includes('.m3u8')) {
      const serverLower = (src.server || match.server || 'kobra').toLowerCase();
      const ntvOfficialUrl = `https://ntv.cx/watch/${serverLower}/${match.rawId || match.id}?source=${i}`;

      // Admin provider on Kobra has 2 sub-streams (#1 and #2)
      if (String(src.source).toLowerCase() === 'admin') {
        sourceStreams.push({
          name: `NTVio • [${serverName}]`,
          title: `⚽ Source ${sourceIndex}: ${label} #1 [Lecteur Intégré]`,
          url: `https://embed.st/embed/${encodeURIComponent(src.source)}/${encodeURIComponent(src.id)}/1`,
          isEmbed: true,
          behaviorHints: { notWebReady: false }
        });

        sourceStreams.push({
          name: `NTVio • [${serverName}]`,
          title: `⚽ Source ${sourceIndex}: ${label} #2 [Lecteur Intégré]`,
          url: `https://embed.st/embed/${encodeURIComponent(src.source)}/${encodeURIComponent(src.id)}/2`,
          isEmbed: true,
          behaviorHints: { notWebReady: false }
        });
      } else {
        const embedUrl = `https://embed.st/embed/${encodeURIComponent(src.source)}/${encodeURIComponent(src.id)}/1`;
        sourceStreams.push({
          name: `NTVio • [${serverName}]`,
          title: `⚽ Source ${sourceIndex}: ${label} [Lecteur Intégré]`,
          url: embedUrl,
          isEmbed: true,
          behaviorHints: { notWebReady: false }
        });
      }

      // Optional secondary external link
      sourceStreams.push({
        name: `NTV.cx • [Officiel]`,
        title: `🌐 NTV.cx: ${label} ↗`,
        externalUrl: ntvOfficialUrl,
        isExternal: true
      });
      return sourceStreams;
    }

    // 4. Any other web link (clean up DaddyLive URLs to prevent Access Blocked)
    if (sourceUrl) {
      if (sourceUrl.includes('.m3u8')) {
        sourceStreams.push({
          name: `NTVio • [${serverName}]`,
          title: `⚽ Source ${sourceIndex}: ${label} [Direct M3U8]`,
          url: sourceUrl
        });
      } else if (sourceUrl.includes('embedindia.st') || sourceUrl.includes('embed.st')) {
        sourceStreams.push({
          name: `NTVio • [${serverName}]`,
          title: `⚽ Source ${sourceIndex}: ${label} [Lecteur Intégré]`,
          url: sourceUrl,
          isEmbed: true,
          behaviorHints: { notWebReady: false }
        });
      } else {
        const cleanWatchUrl = sourceUrl
          .replace(/\/stream\/stream-(\d+)\.php/, '/watch.php?id=$1')
          .replace(/dlhd\.st|dlhd\.sx|daddylive\.(?:me|sx|mp)/g, 'dlive.sx');

        sourceStreams.push({
          name: `NTVio • [${serverName}] (Web)`,
          title: `🌐 Source ${sourceIndex}: ${label} ↗`,
          externalUrl: cleanWatchUrl,
          isExternal: true
        });
      }
    }

    return sourceStreams;
    })(), 3500).catch(() => []);
  });

  const settled = await Promise.allSettled(sourcePromises);
  const streams = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      streams.push(...res.value);
    }
  }

  // Sort: All Direct in-app streams FIRST, all external web links / redirects LAST
  const sorted = streams.sort((a, b) => {
    const aExt = !!a.externalUrl;
    const bExt = !!b.externalUrl;
    if (!aExt && bExt) return -1;
    if (aExt && !bExt) return 1;
    return 0;
  });

  matchStreamCache.set(cacheKey, { streams: sorted, time: Date.now() });
  return sorted;
}

export function extractDirectM3u8(wrapperUrl) {
  if (!wrapperUrl) return null;

  // Pattern 1: Base64-encoded URL inside query parameter (e.g. livelive24.com/dlhd.html?url=aHR0cHM6...)
  const b64Match = wrapperUrl.match(/[?&]url=([A-Za-z0-9+/=]+)/);
  if (b64Match && b64Match[1] && b64Match[1].startsWith('aHR0c')) {
    try {
      const decoded = Buffer.from(b64Match[1], 'base64').toString('utf-8');
      if (decoded.includes('.m3u8') || decoded.startsWith('http')) {
        return decoded;
      }
    } catch {}
  }

  // Pattern 2: Nested URL inside query parameter (url=http... or url=https...)
  const urlIdx = wrapperUrl.indexOf('url=http');
  if (urlIdx !== -1) {
    let extracted = wrapperUrl.substring(urlIdx + 4);
    try {
      extracted = decodeURIComponent(extracted);
    } catch {}
    return extracted;
  }

  // Pattern 3: Standard direct M3U8 regex
  const match = wrapperUrl.match(/https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/i);
  return match ? match[0] : null;
}
