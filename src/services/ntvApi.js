import { CONFIG } from '../config.js';
import { detectCountryFromName, getDliveChannels, getDliveSchedule, decodeHtmlEntities } from './dliveApi.js';

let channelsCache = {
  data: [],
  lastFetched: 0,
  total: 0
};

let matchesCache = {
  byServer: {},
  all: [],
  lastFetched: 0
};

/**
 * Fetch a page of channels directly from ntv.cx
 */
export async function fetchChannelsFromNtv(offset = 0, limit = 100, query = '') {
  const safeLimit = Math.min(100, Math.max(1, limit));
  const params = new URLSearchParams({
    limit: String(safeLimit),
    offset: String(offset)
  });
  if (query && query.trim()) {
    params.set('q', query.trim());
  }

  const url = `${CONFIG.NTV_BASE_URL}/api/get-channels?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': CONFIG.USER_AGENT,
      'Referer': `${CONFIG.NTV_BASE_URL}/channels`,
      'Accept': 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error(`ntv.cx get-channels returned HTTP ${res.status}`);
  }

  const json = await res.json();
  if (!json.success || !Array.isArray(json.channels)) {
    return { channels: [], total: 0, hasMore: false };
  }

  const normalized = json.channels.map(ch => normalizeChannel(ch));
  return {
    channels: normalized,
    total: json.total || normalized.length,
    hasMore: json.has_more || false,
    offset,
    limit: safeLimit
  };
}

/**
 * Warm up cache with multiple pages and DLive channels
 */
async function ensureCacheWarmed() {
  const now = Date.now();
  if (channelsCache.data.length >= 500 && (now - channelsCache.lastFetched) < CONFIG.CHANNELS_CACHE_TTL_MS) {
    return;
  }

  try {
    // 1. Fetch DLive channels first
    const dliveChannels = await getDliveChannels();

    // 2. Fetch first 500 channels from NTV
    const ntvChannels = [];
    let totalNtv = 10360;

    for (let offset = 0; offset < 500; offset += 100) {
      try {
        const page = await fetchChannelsFromNtv(offset, 100);
        if (!page.channels.length) break;
        ntvChannels.push(...page.channels);
        totalNtv = page.total || totalNtv;
      } catch (err) {
        console.warn(`[ntvApi] Warmup page ${offset} failed:`, err.message);
        break;
      }
    }

    // Combine NTV + DLive
    const combined = [...dliveChannels, ...ntvChannels];
    // Deduplicate by ID
    const map = new Map();
    for (const ch of combined) {
      if (!map.has(ch.id)) map.set(ch.id, ch);
    }

    channelsCache.data = Array.from(map.values());
    channelsCache.total = totalNtv + dliveChannels.length;
    channelsCache.lastFetched = now;

    console.log(`[ntvApi] Initial channel cache warmed with ${channelsCache.data.length} channels.`);

    // In background, continue loading more channels up to 2500
    backgroundWarmMore(500, totalNtv);
  } catch (e) {
    console.error('[ntvApi] Error warming channel cache:', e.message);
  }
}

async function backgroundWarmMore(startOffset, totalMax) {
  try {
    for (let offset = startOffset; offset < Math.min(2500, totalMax); offset += 100) {
      await new Promise(r => setTimeout(r, 300));
      const page = await fetchChannelsFromNtv(offset, 100);
      if (!page.channels.length) break;

      for (const ch of page.channels) {
        if (!channelsCache.data.some(c => c.id === ch.id)) {
          channelsCache.data.push(ch);
        }
      }
    }
    console.log(`[ntvApi] Deep cache warmed up: ${channelsCache.data.length} channels.`);
  } catch (e) {
    console.warn('[ntvApi] Background loading stopped:', e.message);
  }
}

/**
 * Get channels with in-memory caching, search, and country filtering
 */
export async function getChannels({ offset = 0, limit = 80, query = '', country = '', countries = [], server = '' } = {}) {
  await ensureCacheWarmed();

  let filtered = channelsCache.data;

  // If searching by text query
  if (query && query.trim()) {
    const qLower = query.trim().toLowerCase();
    const localMatches = filtered.filter(c =>
      c.name.toLowerCase().includes(qLower) ||
      (c.country || '').toLowerCase() === qLower ||
      (c.server || '').toLowerCase() === qLower
    );

    try {
      const remote = await fetchChannelsFromNtv(0, 100, query.trim());
      const map = new Map();
      for (const ch of [...localMatches, ...remote.channels]) {
        map.set(ch.id, ch);
      }
      filtered = Array.from(map.values());
    } catch {
      filtered = localMatches;
    }
  }

  // Filter by country or list of countries
  const targetCountries = [];
  if (country) targetCountries.push(country.toUpperCase());
  if (Array.isArray(countries) && countries.length) {
    targetCountries.push(...countries.map(c => c.toUpperCase()));
  }

  if (targetCountries.length > 0) {
    const set = new Set(targetCountries);
    if (set.has('GB')) set.add('UK');
    if (set.has('UK')) set.add('GB');
    if (set.has('US')) set.add('USA');
    if (set.has('USA')) set.add('US');

    filtered = filtered.filter(ch => {
      const chC = (ch.country || '').toUpperCase();
      return set.has(chC);
    });
  }

  // Filter by server if specified
  if (server) {
    const sLower = server.toLowerCase();
    filtered = filtered.filter(ch => (ch.server || '').toLowerCase() === sLower);
  }

  const paged = filtered.slice(offset, offset + limit);

  return {
    channels: paged,
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    offset,
    limit
  };
}

/**
 * Get a single channel by ID
 */
export async function getChannelById(id) {
  // Check cached list first
  const found = channelsCache.data.find(c => c.id === id);
  if (found) return found;

  // Check DLive channels
  const dliveChannels = await getDliveChannels();
  const dliveFound = dliveChannels.find(c => c.id === id);
  if (dliveFound) return dliveFound;

  // Otherwise extract raw id and server from composite id
  const parts = id.split('-');
  if (parts.length >= 3) {
    const server = parts[1];
    const rawId = parts.slice(2).join('-');
    const cleanName = `Channel ${rawId}`;
    return {
      id,
      server,
      rawId,
      name: cleanName,
      country: '',
      url: '',
      poster: generateChannelPoster(cleanName)
    };
  }

  return null;
}

/**
 * Fetch matches across all servers (NTV + DLive)
 */
export async function getMatches({ server = '', sport = '' } = {}) {
  const now = Date.now();
  if (!matchesCache.all.length || (now - matchesCache.lastFetched) > CONFIG.MATCHES_CACHE_TTL_MS) {
    await refreshMatches();
  }

  let matches = matchesCache.all;

  if (server && server.toLowerCase() !== 'all') {
    const sLower = server.toLowerCase();
    matches = matches.filter(m => 
      (m.servers && m.servers.map(s => s.toLowerCase()).includes(sLower)) || 
      m.server.toLowerCase() === sLower
    );
  }

  if (sport && sport !== 'All') {
    const spLower = sport.toLowerCase();
    matches = matches.filter(m => (m.category || '').toLowerCase().includes(spLower));
  }

  return matches;
}

/**
 * Get matches statistics across all servers
 */
export async function getMatchesStats() {
  const now = Date.now();
  if (!matchesCache.all.length || (now - matchesCache.lastFetched) > CONFIG.MATCHES_CACHE_TTL_MS) {
    await refreshMatches();
  }

  const byServerCounts = {};
  for (const s of ['all', ...CONFIG.MATCH_SERVERS, 'dlive']) {
    if (s === 'all') {
      byServerCounts['all'] = matchesCache.all.length;
    } else {
      const sLower = s.toLowerCase();
      byServerCounts[s] = matchesCache.all.filter(m => 
        (m.servers && m.servers.map(x => x.toLowerCase()).includes(sLower)) || 
        m.server.toLowerCase() === sLower
      ).length;
    }
  }

  const liveCount = matchesCache.all.filter(m => m.live).length;
  return {
    total: matchesCache.all.length,
    live: liveCount,
    byServer: byServerCounts
  };
}

/**
 * Get a single match by ID
 */
export async function getMatchById(id) {
  const matches = await getMatches();
  return matches.find(m => m.id === id) || null;
}

/**
 * Refresh matches from all ntv.cx servers + dlive.sx schedule
 */
async function refreshMatches() {
  const allMatches = [];
  const byServer = {};

  // 1. Fetch NTV matches across all servers
  for (const server of CONFIG.MATCH_SERVERS) {
    try {
      const url = `${CONFIG.NTV_BASE_URL}/api/get-matches?server=${server}&type=both`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Referer': `${CONFIG.NTV_BASE_URL}/matches/${server}`,
          'Accept': 'application/json'
        }
      });

      if (!res.ok) continue;
      const json = await res.json();
      const list = Array.isArray(json.all)
        ? json.all
        : (Array.isArray(json.matches) ? json.matches : (Array.isArray(json) ? json : []));

      const liveIds = new Set(Array.isArray(json.live) ? json.live.map(lm => lm.id) : []);

      const normalized = list.map(m => {
        const item = normalizeMatch(m, server);
        if (liveIds.has(m.id)) item.live = true;
        return item;
      });

      byServer[server] = normalized;
      allMatches.push(...normalized);
    } catch (e) {
      console.warn(`[ntvApi] Failed to fetch matches for server ${server}:`, e.message);
    }
  }

  // 2. Fetch DLive schedule events
  try {
    const dliveEvents = await getDliveSchedule();
    byServer['dlive'] = dliveEvents;
    allMatches.push(...dliveEvents);
  } catch (e) {
    console.warn('[ntvApi] Failed to fetch DLive schedule:', e.message);
  }

  // 3. Deduplicate events while MERGING ALL SOURCES & SERVERS
  const uniqueMap = new Map();
  for (const match of allMatches) {
    // Group key by simplified title
    const key = match.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    if (uniqueMap.has(key)) {
      const existing = uniqueMap.get(key);
      // Merge sources without duplicating
      for (const src of match.sources) {
        if (!existing.sources.some(s => (s.id && s.id === src.id) || (s.url && s.url === src.url))) {
          existing.sources.push(src);
        }
      }
      if (!existing.servers.includes(match.server)) {
        existing.servers.push(match.server);
      }
      if (match.live) existing.live = true;
      if (!existing.teams && match.teams) existing.teams = match.teams;
      if (!existing.tournament && match.tournament) existing.tournament = match.tournament;
      if (match.popular) existing.popular = true;
    } else {
      uniqueMap.set(key, {
        ...match,
        servers: match.servers ? [...match.servers] : [match.server],
        sources: [...match.sources]
      });
    }
  }

  const sorted = Array.from(uniqueMap.values()).sort((a, b) => {
    // Live first, then chronological by start date
    if (a.live && !b.live) return -1;
    if (!a.live && b.live) return 1;

    if (a.date && b.date && a.date !== b.date) {
      return a.date - b.date;
    }
    return (b.sources ? b.sources.length : 0) - (a.sources ? a.sources.length : 0);
  });

  matchesCache.all = sorted;
  matchesCache.byServer = byServer;
  matchesCache.lastFetched = Date.now();
  console.log(`[ntvApi] Matches cache refreshed: ${matchesCache.all.length} matches across all servers (including DLive).`);
}

/**
 * Normalize channel with auto-detected country
 */
function normalizeChannel(ch) {
  const rawId = String(ch.channel_id || '');
  const server = ch.server || 'dlhd';
  const id = `ntv-${server}-${rawId}`;
  const name = decodeHtmlEntities(ch.channel_name || `Channel ${rawId}`);

  // Priority 1: channel_code
  let country = (ch.channel_code || '').toUpperCase();
  // Priority 2: auto-detection from channel name
  if (!country) {
    country = detectCountryFromName(name);
  }

  const poster = ch.channel_image || generateChannelPoster(name, country);

  return {
    id,
    rawId,
    server,
    name,
    country,
    url: ch.channel_url || '',
    poster,
    type: 'tv'
  };
}

/**
 * Intelligent parser to extract teams and tournament from raw match titles
 */
export function parseTeamsAndTournament(rawTitle, defaultCat = 'Sports', defaultTourn = '') {
  let clean = (rawTitle || '')
    .replace(/[\u{1F300}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/\b(ALL SOCCER EVENTS|ALL BASKETBALL|ALL TENNIS|ALL MOTORSPORTS)\b/gi, '')
    .trim();

  let tournament = defaultTourn || '';
  let matchPart = clean;

  if (clean.includes(':')) {
    const colonIdx = clean.indexOf(':');
    const prefix = clean.slice(0, colonIdx).trim();
    const suffix = clean.slice(colonIdx + 1).trim();

    const cleanedPrefix = prefix
      .replace(/^[a-z]{2}\s+/i, '')
      .replace(/^[a-z]{2}\s*-\s*/i, '')
      .trim();

    if (cleanedPrefix.length > 2) {
      tournament = cleanedPrefix;
    }
    matchPart = suffix;
  }

  let teams = null;
  const vsMatch = matchPart.match(/^(.+?)\s+(?:vs\.?|v\.|contre)\s+(.+)$/i);
  if (vsMatch) {
    let homeName = vsMatch[1].trim();
    let awayName = vsMatch[2].trim();

    homeName = homeName.replace(/\s+[a-z]{2}$/i, '').replace(/^[a-z]{2}\s+/i, '').trim();
    awayName = awayName.replace(/\s+[a-z]{2}$/i, '').replace(/^[a-z]{2}\s+/i, '').trim();

    if (homeName.length > 1 && awayName.length > 1) {
      teams = {
        home: { name: homeName },
        away: { name: awayName }
      };
    }
  }

  return { tournament, teams, cleanTitle: clean };
}

function normalizeMatch(m, server) {
  const rawId = String(m.id || '');
  const id = `ntv-match-${server}-${rawId}`;
  const rawTitle = decodeHtmlEntities(m.title || 'Live Match');
  const category = decodeHtmlEntities(m.category || 'Sports');
  const defaultTourn = decodeHtmlEntities(m.tournament || '');

  const parsed = parseTeamsAndTournament(rawTitle, category, defaultTourn);
  const title = parsed.cleanTitle || rawTitle;
  const tournament = parsed.tournament || defaultTourn;
  const date = m.date ? Number(m.date) : Date.now();
  const isLive = m.live === true || m.status === 'live';

  const sources = (Array.isArray(m.sources) ? m.sources : []).map(s => ({
    ...s,
    server: s.server || server
  }));

  const formatBadge = (badge) => {
    if (!badge || typeof badge !== 'string') return '';
    const b = badge.trim();
    if (!b) return '';
    if (b.startsWith('http')) return b;
    if (b.startsWith('/')) return `${CONFIG.NTV_BASE_URL}${b}`;
    return `${CONFIG.NTV_BASE_URL}/api/images/proxy/${b}`;
  };

  let teams = parsed.teams;
  if (m.teams && m.teams.home && m.teams.away) {
    teams = {
      home: { 
        ...m.teams.home, 
        name: decodeHtmlEntities(m.teams.home.name || ''),
        badge: formatBadge(m.teams.home.badge)
      },
      away: { 
        ...m.teams.away, 
        name: decodeHtmlEntities(m.teams.away.name || ''),
        badge: formatBadge(m.teams.away.badge)
      }
    };
  }

  const poster = m.poster
    ? (m.poster.startsWith('http') ? m.poster : `${CONFIG.NTV_BASE_URL}${m.poster}`)
    : generateMatchPoster(title, tournament || category);

  return {
    id,
    rawId,
    server,
    servers: [server],
    title,
    category,
    tournament,
    date,
    live: isLive,
    poster,
    sources,
    teams,
    popular: !!m.popular,
    type: 'tv'
  };
}

function getBrandTheme(name) {
  const n = (name || '').toUpperCase();
  if (n.includes('CANAL')) return { c1: '#07080d', c2: '#161324', accent: '#fbbf24', tag: 'CANAL+' };
  if (n.includes('BEIN')) return { c1: '#140526', c2: '#2c0b4d', accent: '#c084fc', tag: 'beIN SPORTS' };
  if (n.includes('RMC')) return { c1: '#200508', c2: '#4c0c16', accent: '#f87171', tag: 'RMC SPORT' };
  if (n.includes('TF1')) return { c1: '#081432', c2: '#16387c', accent: '#60a5fa', tag: 'TF1' };
  if (n.includes('FRANCE 2') || n.includes('FRANCE 3') || n.includes('FRANCE 4') || n.includes('FRANCE 5') || n.includes('FRANCE TV')) return { c1: '#0f172a', c2: '#1e293b', accent: '#38bdf8', tag: 'FRANCE TV' };
  if (n.includes('M6') || n.includes('W9') || n.includes('6TER')) return { c1: '#260624', c2: '#581452', accent: '#f472b6', tag: 'M6' };
  if (n.includes('SKY')) return { c1: '#052338', c2: '#034a74', accent: '#38bdf8', tag: 'SKY SPORTS' };
  if (n.includes('TNT') || n.includes('SPORT TV')) return { c1: '#032612', c2: '#0b5327', accent: '#4ade80', tag: 'TNT SPORTS' };
  if (n.includes('ESPN')) return { c1: '#360606', c2: '#7f1212', accent: '#f87171', tag: 'ESPN' };
  if (n.includes('DAZN')) return { c1: '#090a0f', c2: '#1c1e28', accent: '#facc15', tag: 'DAZN' };
  if (n.includes('EUROSPORT')) return { c1: '#06234b', c2: '#0f4880', accent: '#38bdf8', tag: 'EUROSPORT' };
  if (n.includes('EQUIPE')) return { c1: '#17120a', c2: '#3b280a', accent: '#fbbf24', tag: 'L\'ÉQUIPE' };
  if (n.includes('PRIME')) return { c1: '#061a29', c2: '#0d3b5e', accent: '#00a8e1', tag: 'PRIME' };

  let hash = 0;
  for (let i = 0; i < n.length; i++) hash = (hash * 31 + n.charCodeAt(i)) & 0xffffff;
  const hues = [
    { c1: '#0a0f1d', c2: '#161f38', accent: '#818cf8' },
    { c1: '#061f2e', c2: '#0c3e5a', accent: '#22d3ee' },
    { c1: '#041f0e', c2: '#0c401e', accent: '#4ade80' },
    { c1: '#1f0a38', c2: '#3d166d', accent: '#c084fc' },
    { c1: '#2f0512', c2: '#5a0c24', accent: '#fb7185' },
    { c1: '#18140f', c2: '#332918', accent: '#f59e0b' }
  ];
  const theme = hues[Math.abs(hash) % hues.length];
  return { ...theme, tag: 'TV' };
}

/**
 * Modern widescreen obsidian glass channel slate (Linear / Apple TV standard)
 */
export function generateChannelPoster(name, country = '') {
  const clean = (name || '')
    .replace(/[()[\]{}_:\-.,/\\#|]/g, ' ')
    .replace(/France|USA|UK|Spain|HD|FHD|\d+fps|1080p|720p/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const words = clean.split(/\s+/).filter(w => w.length > 0);
  let badgeText = '';
  if (words.length >= 2) {
    badgeText = (words[0][0] + words[1][0]).toUpperCase();
  } else if (words.length === 1 && words[0].length <= 5) {
    badgeText = words[0].toUpperCase();
  } else if (words.length === 1) {
    badgeText = words[0].slice(0, 3).toUpperCase();
  } else {
    badgeText = 'TV';
  }

  const shortName = clean.slice(0, 22).toUpperCase();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <defs>
      <linearGradient id="bgObsidian" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0E1015"/>
        <stop offset="50%" stop-color="#14161F"/>
        <stop offset="100%" stop-color="#0A0B0E"/>
      </linearGradient>
      <linearGradient id="glassPill" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.08)"/>
        <stop offset="100%" stop-color="rgba(255,255,255,0.02)"/>
      </linearGradient>
      <pattern id="microDots" width="16" height="16" patternUnits="userSpaceOnUse">
        <circle cx="2" cy="2" r="0.75" fill="rgba(255,255,255,0.035)"/>
      </pattern>
    </defs>
    <!-- Frame -->
    <rect width="320" height="180" rx="10" fill="url(#bgObsidian)"/>
    <rect width="320" height="180" fill="url(#microDots)"/>
    <rect x="0.5" y="0.5" width="319" height="179" rx="9.5" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>

    <!-- Subtle Center Frosted Plate -->
    <rect x="36" y="38" width="248" height="84" rx="10" fill="url(#glassPill)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    
    <!-- Channel Monogram Emblem -->
    <text x="160" y="85" font-family="-apple-system, BlinkMacSystemFont, 'Inter Tight', 'Inter', sans-serif" font-size="28" font-weight="700" fill="#F7F8F8" text-anchor="middle" letter-spacing="-0.03em">
      ${escapeXml(badgeText)}
    </text>

    <!-- Subtitle / Channel Name -->
    <text x="160" y="105" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="500" fill="#9CA3AF" text-anchor="middle" letter-spacing="0.08em">
      ${escapeXml(shortName)}
    </text>

    <!-- Top-Left Quality Pill -->
    <rect x="14" y="12" width="46" height="18" rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
    <text x="37" y="24" font-family="'JetBrains Mono', monospace" font-size="8.5" font-weight="600" fill="#9CA3AF" text-anchor="middle" letter-spacing="0.05em">1080p</text>

    <!-- Top-Right Live Dot -->
    <circle cx="304" cy="21" r="3" fill="#22C55E"/>
    <circle cx="304" cy="21" r="6" fill="#22C55E" fill-opacity="0.2"/>
  </svg>`;

  return `data:image/svg+xml;utf8,${safeEncodeUriComponent(svg)}`;
}

export function generateMatchPoster(title, category = 'Live Sports') {
  const safeTitle = Array.from(title || '').slice(0, 36).join('');
  const safeCat = Array.from(category || '').slice(0, 24).join('').toUpperCase();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <defs>
      <linearGradient id="bgMatchObsidian" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0E1015"/>
        <stop offset="100%" stop-color="#161822"/>
      </linearGradient>
    </defs>
    <rect width="320" height="180" rx="10" fill="url(#bgMatchObsidian)"/>
    <rect x="0.5" y="0.5" width="319" height="179" rx="9.5" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
    
    <rect x="14" y="14" width="56" height="20" rx="4" fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.3)" stroke-width="1"/>
    <circle cx="24" cy="24" r="2.5" fill="#22c55e"/>
    <text x="44" y="27.5" font-family="'JetBrains Mono', monospace" font-size="9" font-weight="700" fill="#86efac" text-anchor="middle">LIVE</text>
    
    <text x="160" y="85" font-family="-apple-system, BlinkMacSystemFont, 'Inter Tight', 'Inter', sans-serif" font-size="14" font-weight="600" fill="#F7F8F8" text-anchor="middle">
      ${escapeXml(safeTitle)}
    </text>
    <text x="160" y="112" font-family="'JetBrains Mono', monospace" font-size="9.5" font-weight="500" fill="#9CA3AF" text-anchor="middle" letter-spacing="0.08em">
      ${escapeXml(safeCat)}
    </text>
  </svg>`;

  return `data:image/svg+xml;utf8,${safeEncodeUriComponent(svg)}`;
}

function safeEncodeUriComponent(str) {
  try {
    const wellFormed = typeof str.toWellFormed === 'function' ? str.toWellFormed() : str;
    return encodeURIComponent(wellFormed);
  } catch {
    return encodeURIComponent(str.replace(/[\ud800-\udfff]/g, ''));
  }
}

function escapeXml(unsafe) {
  return (unsafe || '').replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}
