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

const dliveStreamCache = new Map();
const DLIVE_STREAM_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

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
 * Dynamically extract live M3U8 from dlive.sx
 * Extracts both primary (Player 1 assetrage.net) and secondary (Player 2 tiestep.top) direct CDN streams
 * Decodes _econfig, Clappr atob, or direct .m3u8 URLs
 */
export async function fetchDliveRealStream(channelId) {
  const cleanId = String(channelId).replace(/[^0-9]/g, '');
  if (!cleanId) return null;

  const cached = dliveStreamCache.get(cleanId);
  if (cached && (Date.now() - cached.time) < DLIVE_STREAM_CACHE_TTL) {
    return cached.data;
  }

  const dliveBase = 'https://dlive.sx';
  const playerPaths = [
    { name: 'stream', label: 'Serveur Principal' },
    { name: 'cast', label: 'Serveur Alternatif' },
    { name: 'watch', label: 'Serveur Secours' }
  ];

  const foundStreams = [];

  for (const p of playerPaths) {
    try {
      const playerUrl = `${dliveBase}/${p.name}/stream-${cleanId}.php`;
      const res1 = await fetch(playerUrl, {
        signal: AbortSignal.timeout(4000),
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Referer': `${dliveBase}/watch.php?id=${cleanId}`
        }
      });
      if (!res1.ok) continue;
      const html1 = await res1.text();

      // Find any iframe pointing to an embed server (assetrage.net, tiestep.top, hamis, etc.)
      const iframeMatch = html1.match(/<iframe[^>]+src=["'](https?:\/\/[^"']+)["']/i);
      if (!iframeMatch) continue;
      const embedUrl = iframeMatch[1];

      const res2 = await fetch(embedUrl, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Referer': playerUrl
        }
      });
      if (!res2.ok) continue;
      const html2 = await res2.text();

      // 1. Check for _econfig (assetrage.net, tiestep.top, etc.)
      const econfigMatch = html2.match(/window\._econfig\s*=\s*['"]([^'"]+)['"]/);
      if (econfigMatch) {
        const config = decodeEConfig(econfigMatch[1]);
        const streamUrl = config.stream_url || config.stream_url_nop2p;
        if (streamUrl && !foundStreams.some(s => s.streamUrl === streamUrl)) {
          foundStreams.push({
            label: p.label,
            streamUrl,
            referer: embedUrl
          });
          // If we found both primary and secondary, that's enough
          if (foundStreams.length >= 2) break;
          continue;
        }
      }

      // 2. Check for Clappr base64 encoded source
      const atobMatch = html2.match(/source\s*:\s*window\.atob\(['"]([^'"]+)['"]\)/i) ||
                        html2.match(/source\s*:\s*atob\(['"]([^'"]+)['"]\)/i);
      if (atobMatch) {
        try {
          const decodedUrl = Buffer.from(atobMatch[1], 'base64').toString('utf8');
          if (decodedUrl.includes('.m3u8') && !foundStreams.some(s => s.streamUrl === decodedUrl)) {
            foundStreams.push({
              label: p.label,
              streamUrl: decodedUrl,
              referer: embedUrl
            });
            if (foundStreams.length >= 2) break;
            continue;
          }
        } catch {}
      }

      // 3. Check for direct .m3u8 in html
      const m3u8Match = html2.match(/https?:\/\/[^'"\s<>]+\.m3u8[^'"\s<>]*/i);
      if (m3u8Match && !foundStreams.some(s => s.streamUrl === m3u8Match[0])) {
        foundStreams.push({
          label: p.label,
          streamUrl: m3u8Match[0],
          referer: embedUrl
        });
        if (foundStreams.length >= 2) break;
      }
    } catch (e) {
      // Try next player path
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

  const dliveBase = 'https://dlive.sx';

  // 1. Extract live HLS streams dynamically (Player 1 + Player 2)
  const dliveData = await fetchDliveRealStream(cleanId);
  if (dliveData && dliveData.streams && dliveData.streams.length > 0) {
    dliveData.streams.forEach((st, idx) => {
      const isPrimary = idx === 0;
      const sName = isPrimary ? 'Serveur Principal' : `Serveur Alternatif ${idx > 1 ? idx : ''}`.trim();

      // 1. Proxy HLS (Essential for CORS & Referer protection, plays instantly everywhere)
      if (baseUrl) {
        const proxyUrl = `${baseUrl}/proxy/hls?url=${encodeURIComponent(st.streamUrl)}&ref=${encodeURIComponent(st.referer)}`;
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

  // 2. Official DLive Web player link (opens clean watch page in new tab)
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

/**
 * Resolver for Live Sports Match events (NTV & DLive)
 * ENSURES ALL SOURCES ARE SHOWN AND ACCURATELY RESOLVED!
 */
export async function resolveMatchStream(matchId, baseUrl) {
  const { getMatchById } = await import('./ntvApi.js');
  const match = await getMatchById(matchId);

  if (!match || !Array.isArray(match.sources) || !match.sources.length) {
    return [];
  }

  // Resolve all sources in parallel via Promise.allSettled
  const sourcePromises = match.sources.map(async (src, i) => {
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
  });

  const settled = await Promise.allSettled(sourcePromises);
  const streams = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      streams.push(...res.value);
    }
  }

  // Sort: All Direct in-app streams FIRST, all external web links / redirects LAST
  return streams.sort((a, b) => {
    const aExt = !!a.externalUrl;
    const bExt = !!b.externalUrl;
    if (!aExt && bExt) return -1;
    if (aExt && !bExt) return 1;
    return 0;
  });
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
