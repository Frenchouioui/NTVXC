import { Router } from 'express';
import { 
  getAllMirrors, 
  setActiveMirror, 
  addMirror, 
  removeMirror, 
  checkAllHealth, 
  checkMirrorHealth 
} from '../services/mirrorManager.js';
import { resolveStream } from '../services/streamResolver.js';
import { clearCache, getMatchesStats } from '../services/ntvApi.js';

const router = Router();

/**
 * Get system status, mirrors configuration and health
 */
router.get('/status', async (req, res) => {
  try {
    const mirrors = getAllMirrors();
    const stats = await getMatchesStats().catch(() => ({ total: 0, live: 0 }));
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      mirrors,
      stats: {
        matchesTotal: stats.total || 0,
        matchesLive: stats.live || 0,
        serverUptimeSec: Math.floor(process.uptime()),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Test connectivity / health of all mirrors
 */
router.get('/health', async (req, res) => {
  try {
    const health = await checkAllHealth();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      health
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Set active mirror
 */
router.post('/mirrors/active', (req, res) => {
  try {
    const { service, url } = req.body || {};
    if (!service || !url) {
      return res.status(400).json({ success: false, error: 'Missing service or url' });
    }
    const updated = setActiveMirror(service, url);
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Add a new mirror
 */
router.post('/mirrors/add', (req, res) => {
  try {
    const { service, url } = req.body || {};
    if (!service || !url) {
      return res.status(400).json({ success: false, error: 'Missing service or url' });
    }
    const cleanUrl = url.trim().replace(/\/+$/, '');
    const updated = addMirror(service, cleanUrl);
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Remove a mirror
 */
router.post('/mirrors/remove', (req, res) => {
  try {
    const { service, url } = req.body || {};
    if (!service || !url) {
      return res.status(400).json({ success: false, error: 'Missing service or url' });
    }
    const updated = removeMirror(service, url);
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Test stream resolution for any channel or match ID
 */
router.post('/test-stream', async (req, res) => {
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ success: false, error: 'Missing item id (ex: ntv-dlive-31)' });
  }

  const start = Date.now();
  try {
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const streams = await resolveStream(id.trim(), baseUrl);
    const durationMs = Date.now() - start;

    res.json({
      success: true,
      id,
      durationMs,
      streamsCount: streams.length,
      streams: streams.map(s => ({
        name: s.name,
        title: s.title,
        url: s.url,
        isEmbed: s.isEmbed || false,
        isProxy: (s.url || '').includes('/proxy/'),
        externalUrl: s.externalUrl || null
      }))
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      id,
      durationMs: Date.now() - start,
      error: err.message
    });
  }
});

/**
 * Clear server memory caches
 */
router.post('/clear-cache', (req, res) => {
  try {
    if (typeof clearCache === 'function') {
      clearCache();
    }
    res.json({
      success: true,
      message: 'Memory cache purged successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
