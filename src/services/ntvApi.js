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
    // Live first, then chronological
    if (a.live && !b.live) return -1;
    if (!a.live && b.live) return 1;
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

function normalizeMatch(m, server) {
  const rawId = String(m.id || '');
  const id = `ntv-match-${server}-${rawId}`;
  const title = decodeHtmlEntities(m.title || 'Live Match');
  const category = decodeHtmlEntities(m.category || 'Sports');
  const tournament = decodeHtmlEntities(m.tournament || '');
  const date = m.date ? Number(m.date) : Date.now();
  const isLive = m.live === true || m.status === 'live';
  const poster = m.poster
    ? (m.poster.startsWith('http') ? m.poster : `${CONFIG.NTV_BASE_URL}${m.poster}`)
    : generateMatchPoster(title, category);

  const sources = (Array.isArray(m.sources) ? m.sources : []).map(s => ({
    ...s,
    server: s.server || server
  }));

  let teams = null;
  if (m.teams && m.teams.home && m.teams.away) {
    teams = {
      home: { ...m.teams.home, name: decodeHtmlEntities(m.teams.home.name || '') },
      away: { ...m.teams.away, name: decodeHtmlEntities(m.teams.away.name || '') }
    };
  }

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
 * Modern 16:9 widescreen channel badge generator without duplicate titles
 */
export function generateChannelPoster(name, country = '') {
  const theme = getBrandTheme(name);
  // Clean punctuation and extraneous words
  const clean = (name || '')
    .replace(/[()[\]{}_:\-.,/\\#|]/g, ' ')
    .replace(/France|USA|UK|Spain|HD|FHD|\d+fps|1080p|720p/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  let displayTag = theme.tag;

  if (displayTag === 'TV') {
    const words = clean.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
      displayTag = (words[0][0] + words[1][0]).toUpperCase();
    } else if (words.length === 1 && words[0].length <= 8) {
      displayTag = words[0].toUpperCase();
    } else if (words.length === 1) {
      displayTag = words[0].slice(0, 4).toUpperCase();
    } else {
      displayTag = 'TV LIVE';
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${theme.c1}"/>
        <stop offset="100%" stop-color="${theme.c2}"/>
      </linearGradient>
      <radialGradient id="glowSpot" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stop-color="${theme.accent}" stop-opacity="0.35"/>
        <stop offset="60%" stop-color="${theme.accent}" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="${theme.accent}" stop-opacity="0"/>
      </radialGradient>
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      </pattern>
    </defs>
    <!-- Background Card -->
    <rect width="320" height="180" rx="12" fill="url(#bgGrad)"/>
    <rect width="320" height="180" fill="url(#grid)"/>
    <circle cx="160" cy="90" r="95" fill="url(#glowSpot)"/>
    <rect x="1" y="1" width="318" height="178" rx="11" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>

    <!-- Central Broadcast Badge -->
    <rect x="55" y="44" width="210" height="72" rx="16" fill="rgba(10,12,20,0.65)" stroke="${theme.accent}" stroke-width="1.8" stroke-opacity="0.6"/>
    <text x="160" y="88" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Outfit', sans-serif" font-size="20" font-weight="900" fill="${theme.accent}" text-anchor="middle" letter-spacing="1.5">
      ${escapeXml(displayTag)}
    </text>

    <!-- Top-Right Live Pulse Dot -->
    <circle cx="295" cy="22" r="3.5" fill="#ef4444"/>
    <circle cx="295" cy="22" r="7.5" fill="#ef4444" fill-opacity="0.35"/>

    <!-- Top-Left Quality Pill -->
    <rect x="16" y="14" width="38" height="18" rx="4" fill="rgba(255,255,255,0.08)"/>
    <text x="35" y="27" font-family="sans-serif" font-size="9" font-weight="800" fill="rgba(255,255,255,0.75)" text-anchor="middle" letter-spacing="0.5">24/7</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${safeEncodeUriComponent(svg)}`;
}

export function generateMatchPoster(title, category = 'Live Sports') {
  const safeTitle = Array.from(title || '').slice(0, 24).join('');
  const safeCat = Array.from(category || '').slice(0, 20).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
    <defs>
      <linearGradient id="gradMatch" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0F1016"/>
        <stop offset="100%" stop-color="#1F1B2C"/>
      </linearGradient>
    </defs>
    <rect width="300" height="450" rx="16" fill="url(#gradMatch)" stroke="#8b5cf6" stroke-opacity="0.4" stroke-width="2"/>
    <rect x="20" y="24" width="70" height="26" rx="6" fill="#ef4444"/>
    <text x="55" y="42" font-family="sans-serif" font-size="12" font-weight="bold" fill="#FFFFFF" text-anchor="middle">● LIVE</text>
    <circle cx="150" cy="180" r="50" fill="#8b5cf6" fill-opacity="0.2" stroke="#8b5cf6" stroke-width="2"/>
    <polygon points="144,160 166,180 144,200" fill="#8b5cf6"/>
    <text x="150" y="280" font-family="sans-serif" font-size="18" font-weight="bold" fill="#FFFFFF" text-anchor="middle">${escapeXml(safeTitle)}</text>
    <text x="150" y="315" font-family="sans-serif" font-size="13" font-weight="500" fill="#a78bfa" text-anchor="middle">${escapeXml(safeCat)}</text>
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
