import { Router } from 'express';
import { CONFIG } from '../config.js';
import { getChannels, getChannelById, getMatches, getMatchById, getMatchesStats, getUnifiedCalendar } from '../services/ntvApi.js';
import { resolveStream } from '../services/streamResolver.js';

const router = Router();

/**
 * Unified Interactive Schedule / Calendar
 */
router.get('/schedule', async (req, res) => {
  try {
    const date = (req.query.date || 'today').trim();
    const sport = (req.query.sport || '').trim();
    const q = (req.query.q || '').trim();

    const calendar = await getUnifiedCalendar({ date, sport, q });
    res.json(calendar);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


/**
 * Global stats
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getMatchesStats();
    res.json({
      success: true,
      channelsCount: 10360,
      matchesCount: stats.total,
      liveMatchesCount: stats.live,
      byServer: stats.byServer,
      servers: CONFIG.MATCH_SERVERS,
      countries: CONFIG.POPULAR_COUNTRIES
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Supported countries list
 */
router.get('/countries', (req, res) => {
  res.json(CONFIG.POPULAR_COUNTRIES);
});

/**
 * Matches list with filters (sport, server, search, liveOnly)
 */
router.get(['/matches', '/live-matches'], async (req, res) => {
  try {
    const sport = (req.query.sport || '').trim();
    const server = (req.query.server || '').trim();
    const q = (req.query.q || '').trim().toLowerCase();
    const liveOnly = req.query.live === 'true' || req.query.liveOnly === 'true';

    let matches = await getMatches({ server, sport });

    if (liveOnly) {
      matches = matches.filter(m => m.live);
    }

    if (q) {
      matches = matches.filter(m =>
        m.title.toLowerCase().includes(q) ||
        (m.category || '').toLowerCase().includes(q) ||
        (m.tournament || '').toLowerCase().includes(q) ||
        (m.sources || []).some(s => (s.channelName || '').toLowerCase().includes(q))
      );
    }

    const stats = await getMatchesStats();

    res.json({
      success: true,
      total: matches.length,
      byServer: stats.byServer,
      matches: matches.slice(0, 300)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Channels list with filters & pagination
 */
router.get('/channels', async (req, res) => {
  try {
    const offset = parseInt(req.query.offset || '0', 10);
    const limit = Math.min(150, Math.max(1, parseInt(req.query.limit || '60', 10)));
    const query = (req.query.q || '').trim();
    const country = (req.query.country || '').trim();
    const server = (req.query.server || '').trim();

    const result = await getChannels({
      offset,
      limit,
      query,
      country,
      server
    });

    res.json({
      success: true,
      ...result
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Unified Global Search preview (channels + live matches)
 */
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res.json({ success: true, query: q, channels: [], matches: [], totalChannels: 0, totalMatches: 0 });
  }

  try {
    const qLower = q.toLowerCase();

    // 1. Search channels
    const { channels, total: totalChannels } = await getChannels({ query: q, limit: 10 });

    // 2. Search matches
    const allMatches = await getMatches();
    const matchingEvents = allMatches.filter(m =>
      m.title.toLowerCase().includes(qLower) ||
      (m.category || '').toLowerCase().includes(qLower) ||
      (m.sources || []).some(s => (s.channelName || '').toLowerCase().includes(qLower))
    );

    res.json({
      success: true,
      query: q,
      channels: channels.slice(0, 8),
      totalChannels,
      matches: matchingEvents.slice(0, 8),
      totalMatches: matchingEvents.length
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Fast channel search preview
 */
router.get('/search-channels', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const { channels } = await getChannels({ query: q, limit: 12 });
    res.json(channels);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Stream resolver for any item (match or channel)
 */
router.get('/stream/:id', async (req, res) => {
  const { id } = req.params;
  const hostBase = `${req.protocol}://${req.get('host')}`;

  try {
    let item = null;
    if (id.startsWith('ntv-match-') || id.startsWith('ntv-dlive-match-')) {
      item = await getMatchById(id);
    } else {
      item = await getChannelById(id);
    }

    const streams = await resolveStream(id, hostBase);

    res.json({
      success: true,
      id,
      item: item ? {
        title: item.title || item.name,
        category: item.category || (item.country ? `Pays: ${item.country}` : '24/7 TV'),
        poster: item.poster,
        live: item.live,
        server: item.server,
        sourcesCount: Array.isArray(item.sources) ? item.sources.length : 1
      } : null,
      streams
    });
  } catch (e) {
    console.error('[api stream] Error resolving stream:', e.message);
    res.status(500).json({ error: e.message, streams: [] });
  }
});

/**
 * Clean embed player iframe wrapper (sandboxed, ad-shielded)
 */
router.get('/embed/:channelId', (req, res) => {
  const channelId = req.params.channelId.replace(/[^0-9]/g, '');
  if (!channelId) return res.status(400).send('Invalid channel ID');

  const embedUrl = `https://dlive.sx/stream/stream-${channelId}.php`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NTVio • Lecteur Sécurisé #${channelId}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
    iframe { width: 100%; height: 100%; border: none; display: block; }
  </style>
</head>
<body>
  <iframe src="${embedUrl}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="no-referrer"></iframe>
</body>
</html>`;

  res.send(html);
});

export default router;
