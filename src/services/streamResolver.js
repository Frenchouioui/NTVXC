import { CONFIG } from '../config.js';

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
  // Format: ntv-{server}-{rawId}
  const parts = id.split('-');
  if (parts.length < 3) return streams;

  const server = parts[1];
  const rawId = parts.slice(2).join('-');

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

/**
 * Resolver for DaddyLive / DLHD / DLive channels
 */
export async function resolveDlhd(channelId, baseUrl, labelPrefix = 'DLHD') {
  const streams = [];
  const cleanId = channelId.replace(/[^0-9]/g, '');

  if (!cleanId) return streams;

  // Direct fast stream (verified working without headers)
  const directM3u8 = `https://premium.hls.st/playlist/premium${cleanId}.m3u8`;

  streams.push({
    name: `NTVio • ${labelPrefix}`,
    title: `⚡ Direct M3U8 (HD)`,
    url: directM3u8,
    behaviorHints: { notWebReady: false }
  });

  // Proxy fallback (bypasses ISP block, CORS, and geo-restrictions)
  if (baseUrl) {
    const proxyUrl = `${baseUrl}/proxy/hls?url=${encodeURIComponent(directM3u8)}&ref=${encodeURIComponent('https://iplayer.is/')}`;
    streams.push({
      name: `NTVio • ${labelPrefix} (Proxy)`,
      title: `🛡️ Flux Sécurisé (Anti-Blocage FAI / CORS)`,
      url: proxyUrl,
      behaviorHints: { notWebReady: false }
    });
  }

  // Web player fallback (opens official DLive watch page with rel=noreferrer to avoid hotlink block)
  streams.push({
    name: `DLive.sx • [Officiel]`,
    title: `🌐 DLive.sx Officiel ↗`,
    externalUrl: `https://dlive.sx/watch.php?id=${cleanId}`,
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
        title: '⚡ CDNLive Stream (HD)',
        url,
        behaviorHints: { notWebReady: false }
      });
      if (baseUrl) {
        streams.push({
          name: 'NTVio • TITAN (Proxy)',
          title: '🛡️ Flux CDNLive Sécurisé',
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
            title: '⚡ CDNLive Stream (HD)',
            url: assembledUrl,
            behaviorHints: { notWebReady: false }
          });
          if (baseUrl) {
            streams.push({
              name: 'NTVio • TITAN (Proxy)',
              title: '🛡️ Flux CDNLive Sécurisé',
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
  const streams = [];
  const { getMatchById } = await import('./ntvApi.js');
  const match = await getMatchById(matchId);

  if (!match || !Array.isArray(match.sources) || !match.sources.length) {
    return streams;
  }

  // Iterate over EVERY SINGLE source
  for (let i = 0; i < match.sources.length; i++) {
    const src = match.sources[i];
    const sourceUrl = src.url || '';
    const label = src.channelName || (src.source ? `${src.source.toUpperCase()} ${src.id || ''}` : `Source ${i + 1}`);
    const serverName = (src.server || match.server || 'Server').toUpperCase();
    const sourceIndex = i + 1;

    // 1. Direct M3U8 inside query parameter or URL (e.g. Falcon feeds)
    if (sourceUrl.includes('.m3u8') || sourceUrl.includes('url=http')) {
      const m3u8Url = extractDirectM3u8(sourceUrl);
      if (m3u8Url) {
        streams.push({
          name: `NTVio • [${serverName}]`,
          title: `⚽ Source ${sourceIndex}: ${label} [Direct HD]`,
          url: m3u8Url,
          behaviorHints: { notWebReady: false }
        });

        if (baseUrl) {
          streams.push({
            name: `NTVio • [${serverName}] (Proxy)`,
            title: `🛡️ Source ${sourceIndex}: ${label} [Proxy Anti-Bug]`,
            url: `${baseUrl}/proxy/hls?url=${encodeURIComponent(m3u8Url)}&ref=${encodeURIComponent('https://livelive24.com/')}`,
            behaviorHints: { notWebReady: false }
          });
        }

        // Also add web link if it had a wrapper
        if (sourceUrl.startsWith('http') && !sourceUrl.endsWith('.m3u8')) {
          streams.push({
            name: `NTVio • [${serverName}] (Web)`,
            title: `🌐 Source ${sourceIndex}: ${label} ↗`,
            externalUrl: sourceUrl
          });
        }
        continue;
      }
    }

    // 2. DLHD / DLive / Golf numeric stream channel resolution
    const chId = src.channelId || 
                 (src.id && /^\d+$/.test(String(src.id)) ? String(src.id) : null) || 
                 (src.source && (src.source === 'golf' || src.source === 'dlive' || src.source === 'dlhd') && src.id ? String(src.id) : null) ||
                 (sourceUrl.match(/stream-(\d+)\.php/) || sourceUrl.match(/watch\.php\?id=(\d+)/) || [])[1];

    if (chId && chId !== '00') {
      const directM3u8 = `https://premium.hls.st/playlist/premium${chId}.m3u8`;
      streams.push({
        name: `NTVio • [${serverName}]`,
        title: `⚽ Source ${sourceIndex}: ${label} [M3U8 HD]`,
        url: directM3u8,
        behaviorHints: { notWebReady: false }
      });

      if (baseUrl) {
        streams.push({
          name: `NTVio • [${serverName}] (Proxy)`,
          title: `🛡️ Source ${sourceIndex}: ${label} [Proxy Anti-Bug]`,
          url: `${baseUrl}/proxy/hls?url=${encodeURIComponent(directM3u8)}&ref=${encodeURIComponent('https://iplayer.is/')}`,
          behaviorHints: { notWebReady: false }
        });
      }

      // Legitimate official watch page on DLive (NEVER blocked, unlike internal stream-*.php)
      streams.push({
        name: `DLive.sx • [Officiel]`,
        title: `🌐 DLive.sx Officiel: ${label} ↗`,
        externalUrl: `https://dlive.sx/watch.php?id=${chId}`,
        isExternal: true
      });
      continue;
    }

    // 3. Kobra & Raptor embed providers (e.g. admin, echo, delta, embedindia)
    if (src.source && src.id) {
      const embedUrl = `https://embed.st/embed/${encodeURIComponent(src.source)}/${encodeURIComponent(src.id)}/1`;
      const serverLower = (src.server || match.server || 'kobra').toLowerCase();
      const ntvOfficialUrl = `https://ntv.cx/watch/${serverLower}/${match.rawId || match.id}?source=${i}`;

      streams.push({
        name: `NTV.cx • [Officiel]`,
        title: `🌐 NTV.cx: ${label} ↗`,
        externalUrl: ntvOfficialUrl,
        isExternal: true
      });
      streams.push({
        name: `Embed.st • [Lecteur Web]`,
        title: `⚡ Lecteur Web: ${label} ↗`,
        externalUrl: embedUrl,
        isExternal: true
      });
      continue;
    }

    // 4. Any other web link (clean up DaddyLive URLs to prevent Access Blocked)
    if (sourceUrl) {
      if (sourceUrl.includes('.m3u8')) {
        streams.push({
          name: `NTVio • [${serverName}]`,
          title: `⚽ Source ${sourceIndex}: ${label} [Direct M3U8]`,
          url: sourceUrl
        });
      } else {
        const cleanWatchUrl = sourceUrl
          .replace(/\/stream\/stream-(\d+)\.php/, '/watch.php?id=$1')
          .replace(/dlhd\.st|dlhd\.sx|daddylive\.(?:me|sx|mp)/g, 'dlive.sx');

        streams.push({
          name: `NTVio • [${serverName}] (Web)`,
          title: `🌐 Source ${sourceIndex}: ${label} ↗`,
          externalUrl: cleanWatchUrl,
          isExternal: true
        });
      }
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

  // Pattern 1: Nested URL inside query parameter (preserves full token string)
  const urlIdx = wrapperUrl.indexOf('url=http');
  if (urlIdx !== -1) {
    return wrapperUrl.substring(urlIdx + 4);
  }

  // Pattern 2: Standard M3U8 regex
  const match = wrapperUrl.match(/https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/i);
  return match ? match[0] : null;
}
