import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');
const MIRRORS_FILE = path.join(DATA_DIR, 'mirrors.json');

// Default initial mirrors
const DEFAULT_MIRRORS = {
  dlive: {
    name: 'DLive / DaddyLive / DLHD',
    active: 'https://dlive.sx',
    mirrors: [
      'https://dlive.sx',
      'https://dlhd.so',
      'https://daddylive.mp',
      'https://dlhd.sx'
    ]
  },
  ntv: {
    name: 'NTV.cx Sports & Channels',
    active: 'https://ntv.cx',
    mirrors: [
      'https://ntv.cx',
      'https://ntvstream.com'
    ]
  },
  cdnlive: {
    name: 'CDNLive Stream Networks',
    active: 'https://cdnlive.tv',
    mirrors: [
      'https://cdnlive.tv',
      'https://cdnlive.sx'
    ]
  }
};

let mirrorsState = { ...DEFAULT_MIRRORS };

// Load persistent config from data/mirrors.json
function loadMirrors() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(MIRRORS_FILE)) {
      const raw = fs.readFileSync(MIRRORS_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      mirrorsState = { ...DEFAULT_MIRRORS, ...parsed };
    } else {
      saveMirrors();
    }
  } catch (e) {
    console.warn('[mirrorManager] Error loading mirrors.json, using defaults:', e.message);
  }
}

function saveMirrors() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(MIRRORS_FILE, JSON.stringify(mirrorsState, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[mirrorManager] Error saving mirrors.json:', e.message);
  }
}

loadMirrors();

/**
 * Get active mirror for a service
 */
export function getActiveMirror(service) {
  const s = mirrorsState[service.toLowerCase()];
  return s ? s.active : (service === 'ntv' ? CONFIG.NTV_BASE_URL : 'https://dlive.sx');
}

/**
 * Get full mirrors dictionary
 */
export function getAllMirrors() {
  return mirrorsState;
}

/**
 * Update or set active mirror
 */
export function setActiveMirror(service, mirrorUrl) {
  const key = service.toLowerCase();
  if (!mirrorsState[key]) {
    mirrorsState[key] = {
      name: service.toUpperCase(),
      active: mirrorUrl,
      mirrors: [mirrorUrl]
    };
  } else {
    mirrorsState[key].active = mirrorUrl;
    if (!mirrorsState[key].mirrors.includes(mirrorUrl)) {
      mirrorsState[key].mirrors.push(mirrorUrl);
    }
  }
  saveMirrors();
  return mirrorsState[key];
}

/**
 * Add a new mirror URL
 */
export function addMirror(service, mirrorUrl) {
  const key = service.toLowerCase();
  if (!mirrorsState[key]) {
    mirrorsState[key] = {
      name: service.toUpperCase(),
      active: mirrorUrl,
      mirrors: [mirrorUrl]
    };
  } else if (!mirrorsState[key].mirrors.includes(mirrorUrl)) {
    mirrorsState[key].mirrors.push(mirrorUrl);
  }
  saveMirrors();
  return mirrorsState[key];
}

/**
 * Remove a mirror URL
 */
export function removeMirror(service, mirrorUrl) {
  const key = service.toLowerCase();
  if (mirrorsState[key]) {
    mirrorsState[key].mirrors = mirrorsState[key].mirrors.filter(m => m !== mirrorUrl);
    if (mirrorsState[key].active === mirrorUrl && mirrorsState[key].mirrors.length > 0) {
      mirrorsState[key].active = mirrorsState[key].mirrors[0];
    }
    saveMirrors();
    return mirrorsState[key];
  }
  return null;
}

/**
 * Test health of a single mirror
 */
export async function checkMirrorHealth(url) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': CONFIG.USER_AGENT
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    const latency = Date.now() - start;
    return {
      url,
      ok: res.ok || res.status === 403 || res.status === 301 || res.status === 302, // 403 can be cloudflare, but server exists
      status: res.status,
      latencyMs: latency,
      error: res.ok ? null : `HTTP ${res.status}`
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      error: err.name === 'AbortError' ? 'Timeout (6s)' : err.message
    };
  }
}

/**
 * Check all mirrors health in parallel
 */
export async function checkAllHealth() {
  const results = {};
  for (const [key, group] of Object.entries(mirrorsState)) {
    results[key] = {
      name: group.name,
      active: group.active,
      mirrors: await Promise.all(group.mirrors.map(m => checkMirrorHealth(m)))
    };
  }
  return results;
}

/**
 * Fetch with automatic fallback to secondary mirrors
 */
export async function fetchWithFallback(service, pathAndQuery, fetchOptions = {}) {
  const key = service.toLowerCase();
  const group = mirrorsState[key];
  if (!group || !group.mirrors.length) {
    return fetch(pathAndQuery, fetchOptions);
  }

  // Put active mirror first, then fallbacks
  const orderedMirrors = [group.active, ...group.mirrors.filter(m => m !== group.active)];

  let lastError = null;
  for (const base of orderedMirrors) {
    const cleanBase = base.replace(/\/+$/, '');
    const cleanPath = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
    const fullUrl = `${cleanBase}${cleanPath}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(fullUrl, {
        ...fetchOptions,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        // If a fallback worked and wasn't the active one, auto-promote it
        if (base !== group.active) {
          console.log(`[mirrorManager] Auto-promoted working fallback mirror for ${service}: ${base}`);
          group.active = base;
          saveMirrors();
        }
        return res;
      } else {
        lastError = new Error(`HTTP ${res.status} on ${fullUrl}`);
      }
    } catch (e) {
      lastError = e;
      console.warn(`[mirrorManager] Mirror ${fullUrl} failed:`, e.message);
    }
  }

  throw lastError || new Error(`All mirrors failed for ${service}`);
}
