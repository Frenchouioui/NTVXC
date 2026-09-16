import { Router } from 'express';
import { CONFIG } from '../config.js';
import { getChannels, getChannelById, getMatches, getMatchById } from '../services/ntvApi.js';
import { resolveStream } from '../services/streamResolver.js';

const router = Router();

/**
 * Decode user configuration from base64 URL param
 */
function parseConfig(configParam) {
  if (!configParam) return getDefaultConfig();

  try {
    let raw = configParam.replace(/-/g, '+').replace(/_/g, '/');
    while (raw.length % 4) raw += '=';
    const jsonStr = Buffer.from(raw, 'base64').toString('utf-8');
    const parsed = JSON.parse(jsonStr);
    return {
      countries: Array.isArray(parsed.countries) ? parsed.countries.map(c => c.toLowerCase()) : [],
      servers: Array.isArray(parsed.servers) ? parsed.servers.map(s => s.toLowerCase()) : CONFIG.MATCH_SERVERS,
      enableSports: parsed.enableSports !== false,
      enableTv: parsed.enableTv !== false,
      enableSearch: parsed.enableSearch !== false
    };
  } catch (e) {
    return getDefaultConfig();
  }
}

function getDefaultConfig() {
  return {
    countries: [], // Empty means show all countries
    servers: ['titan', 'falcon', 'phoenix', 'kobra', 'raptor', 'dlive'],
    enableSports: true,
    enableTv: true,
    enableSearch: true
  };
}

/**
 * Build Stremio Addon Manifest
 */
function buildManifest(config, hostBase) {
  const catalogs = [];

  // 1. Live Sports Catalog
  if (config.enableSports) {
    catalogs.push({
      type: 'tv',
      id: 'ntv-sports',
      name: '⚽ NTV • Live Sports & Matchs',
      genres: ['All', 'Football', 'Basketball', 'Tennis', 'Motorsports', 'Wrestling', 'Rugby', 'DLive Events'],
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    });
  }

  // 2. 24/7 Live TV Channels Catalog
  if (config.enableTv) {
    const countryGenres = CONFIG.POPULAR_COUNTRIES.map(c => `${c.flag} ${c.name}`);
    catalogs.push({
      type: 'tv',
      id: 'ntv-tv',
      name: '📺 NTV & DLive • Chaînes 24/7',
      genres: ['All', '📺 DLive 24/7', ...countryGenres],
      extra: [
        { name: 'search', isRequired: false },
        { name: 'genre', isRequired: false },
        { name: 'skip', isRequired: false }
      ]
    });
  }

  return {
    id: CONFIG.ADDON_ID,
    version: CONFIG.ADDON_VERSION,
    name: CONFIG.ADDON_NAME,
    description: 'Plus de 10 000 chaînes 24/7 et tous les matchs de sport en direct (NTV.cx & DLive.sx)',
    logo: `${hostBase}/logo.svg`,
    background: `${hostBase}/logo.svg`,
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs,
    idPrefixes: ['ntv-'],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

// Manifest endpoints
router.get('/manifest.json', (req, res) => {
  const hostBase = `${req.protocol}://${req.get('host')}`;
  const manifest = buildManifest(getDefaultConfig(), hostBase);
  res.json(manifest);
});

router.get('/:config/manifest.json', (req, res) => {
  const hostBase = `${req.protocol}://${req.get('host')}`;
  const config = parseConfig(req.params.config);
  const manifest = buildManifest(config, hostBase);
  res.json(manifest);
});

// Catalog handlers (supports standard Stremio extra path parameters :extra.json as well as query params)
router.get([
  '/catalog/:type/:id.json',
  '/catalog/:type/:id/:extra.json',
  '/:config/catalog/:type/:id.json',
  '/:config/catalog/:type/:id/:extra.json'
], async (req, res) => {
  const { type, id } = req.params;
  const config = parseConfig(req.params.config);

  // Extract parameters from both query string and /:extra.json path segment
  const extraParams = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (v) extraParams.set(k, String(v));
  }
  if (req.params.extra) {
    let raw = req.params.extra;
    if (raw.endsWith('.json')) raw = raw.slice(0, -5);
    const parsed = new URLSearchParams(raw);
    for (const [k, v] of parsed.entries()) {
      extraParams.set(k, v);
    }
  }

  const search = (extraParams.get('search') || '').trim();
  const genre = (extraParams.get('genre') || '').trim();
  const skip = parseInt(extraParams.get('skip') || '0', 10);
  const limit = 80; // Large page size for smooth Stremio infinite scroll

  if (type !== 'tv') {
    return res.json({ metas: [] });
  }

  try {
    // --- 1. LIVE SPORTS CATALOG ---
    if (id === 'ntv-sports') {
      let matches = await getMatches();

      // Genre filter
      if (genre && genre !== 'All') {
        if (genre === 'DLive Events') {
          matches = matches.filter(m => m.server === 'dlive');
        } else {
          const gLower = genre.toLowerCase();
          matches = matches.filter(m => (m.category || '').toLowerCase().includes(gLower));
        }
      }

      // Search filter
      if (search) {
        const sLower = search.toLowerCase();
        matches = matches.filter(m =>
          m.title.toLowerCase().includes(sLower) ||
          (m.category || '').toLowerCase().includes(sLower)
        );
      }

      const paged = matches.slice(skip, skip + limit);
      const metas = paged.map(m => {
        const dateStr = new Date(m.date).toLocaleString('fr-FR', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const statusTag = m.live ? '🔴 EN DIRECT' : `🕒 ${dateStr}`;
        const sourceCount = Array.isArray(m.sources) ? m.sources.length : 1;

        return {
          id: m.id,
          type: 'tv',
          name: m.title,
          poster: m.poster,
          posterShape: 'regular',
          genres: ['Sports', m.category || 'Event'],
          description: `${statusTag} | Serveur: ${(m.server || '').toUpperCase()} | ⚡ ${sourceCount} sources disponibles.`
        };
      });

      return res.json({ metas });
    }

    // --- 2. 24/7 CHANNELS CATALOG ---
    if (id === 'ntv-tv') {
      let countryCode = '';
      let serverFilter = '';

      if (genre && genre !== 'All') {
        if (genre.includes('DLive')) {
          serverFilter = 'dlive';
        } else {
          const foundCountry = CONFIG.POPULAR_COUNTRIES.find(c =>
            genre.includes(c.flag) ||
            genre.toLowerCase().includes(c.name.toLowerCase()) ||
            c.name.toLowerCase().includes(genre.toLowerCase()) ||
            genre.toUpperCase().includes(c.code.toUpperCase())
          );
          if (foundCountry) {
            countryCode = foundCountry.code.toLowerCase();
          }
        }
      }

      // If user selected a specific country genre, filter by it.
      // Otherwise, respect user's configured countries (if any specified).
      let countriesToFilter = [];
      if (countryCode) {
        countriesToFilter = [countryCode];
      } else if (!serverFilter && config.countries && config.countries.length > 0) {
        countriesToFilter = config.countries;
      }

      const { channels } = await getChannels({
        offset: skip,
        limit,
        query: search,
        country: countryCode,
        countries: countriesToFilter,
        server: serverFilter
      });

      const metas = channels.map(c => {
        const countryLabel = c.country ? `Pays: ${c.country}` : 'Global';
        const serverLabel = c.server ? `Source: ${c.server.toUpperCase()}` : 'Live TV';

        return {
          id: c.id,
          type: 'tv',
          name: c.name,
          poster: c.poster,
          posterShape: 'regular',
          genres: [countryLabel, serverLabel],
          description: `Chaîne 24/7 : ${c.name} (${c.country || 'International'}). Serveur: ${(c.server || '').toUpperCase()}`
        };
      });

      return res.json({ metas });
    }

    res.json({ metas: [] });
  } catch (e) {
    console.error('[stremio catalog] Error:', e.message);
    res.json({ metas: [] });
  }
});

// Meta handler
router.get(['/meta/:type/:id.json', '/:config/meta/:type/:id.json'], async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Match item
    if (id.startsWith('ntv-match-') || id.startsWith('ntv-dlive-match-')) {
      const match = await getMatchById(id);
      if (match) {
        const dateStr = new Date(match.date).toLocaleString('fr-FR', {
          dateStyle: 'medium',
          timeStyle: 'short'
        });

        const sourcesList = (match.sources || [])
          .map((s, idx) => `• Source ${idx + 1} : ${s.channelName || s.source} [${(s.server || match.server).toUpperCase()}]`)
          .join('\n');

        return res.json({
          meta: {
            id: match.id,
            type: 'tv',
            name: match.title,
            poster: match.poster,
            background: match.poster,
            posterShape: 'regular',
            genres: ['Live Sports', match.category],
            releaseInfo: dateStr,
            description: `${match.live ? '🔴 DIFFUSION EN DIRECT' : 'MATCH PROGRAMMÉ'}\n\nÉvénement : ${match.title}\nDate : ${dateStr}\nSport : ${match.category}\n\n${match.sources.length} sources de diffusion :\n${sourcesList}`
          }
        });
      }
    }

    // 2. Channel item
    const channel = await getChannelById(id);
    if (channel) {
      return res.json({
        meta: {
          id: channel.id,
          type: 'tv',
          name: channel.name,
          poster: channel.poster,
          background: channel.poster,
          posterShape: 'regular',
          genres: [channel.country ? `Pays: ${channel.country}` : 'Direct', `Serveur: ${(channel.server || '').toUpperCase()}`],
          description: `Regardez ${channel.name} en direct 24/7 en qualité HD sans interruption via NTV.cx & DLive.`
        }
      });
    }

    res.json({ meta: null });
  } catch (e) {
    console.error('[stremio meta] Error:', e.message);
    res.json({ meta: null });
  }
});

// Stream handler - Gathers all sources!
router.get(['/stream/:type/:id.json', '/:config/stream/:type/:id.json'], async (req, res) => {
  const { id } = req.params;
  const hostBase = `${req.protocol}://${req.get('host')}`;

  try {
    const streams = await resolveStream(id, hostBase);
    res.json({ streams });
  } catch (e) {
    console.error('[stremio stream] Error:', e.message);
    res.json({ streams: [] });
  }
});

export default router;
