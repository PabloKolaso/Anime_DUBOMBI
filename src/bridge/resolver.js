/**
 * ID Bridge & Title Resolver
 *
 * Connects Stremio's IMDB IDs to HiAnime anime IDs using:
 *  1. Fribb anime-lists (IMDB → MAL/AniList ID)
 *  2. AniList API (AniList ID → canonical titles)
 *  3. HiAnime search + Fuse.js fuzzy matching
 *
 * The resolved mapping is cached in memory (and persisted to disk)
 * so each anime is only looked up once per server lifetime.
 */

const fs   = require('fs');
const path = require('path');
const Fuse = require('fuse.js');
const NodeCache = require('node-cache');

const CACHE_FILE = path.resolve(__dirname, '../../data/resolver-cache.json');

// ─── Title normalization helpers ─────────────────────────────────────────────

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'and', 'or', 'no', 'wo', 'ga', 'wa']);

function normalizeWords(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
}

function significantWords(str, n = 2) {
  return normalizeWords(str).filter(w => w.length >= 3 && !STOP_WORDS.has(w)).slice(0, n);
}

const mappingCache = require('../mapping/cache');
const hianime     = require('../api/hianime');
const anilist     = require('../api/anilist');
const imdbApi     = require('../api/imdb');

// Cache: imdbId -> resolution object (permanent for this session)
const resolvedMap = new NodeCache({ stdTTL: 86400, checkperiod: 600 });

// ─── Disk persistence ─────────────────────────────────────────────────────────

function loadPersistedCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    const now = Date.now();
    let loaded = 0;
    for (const [key, entry] of Object.entries(data)) {
      if (!entry) continue;
      const { value, expiresAt } = entry;
      if (expiresAt && expiresAt < now) continue;
      const ttl = expiresAt ? Math.max(60, Math.round((expiresAt - now) / 1000)) : 86400;
      resolvedMap.set(key, value !== undefined ? value : null, ttl);
      loaded++;
    }
    if (loaded > 0) console.log(`[resolver] Loaded ${loaded} cached resolutions from disk.`);
  } catch (err) {
    console.warn('[resolver] Failed to load persisted cache:', err.message);
  }
}

function flushToDisk() {
  try {
    const keys = resolvedMap.keys();
    const out = {};
    for (const key of keys) {
      const value     = resolvedMap.get(key);
      const expiresAt = resolvedMap.getTtl(key);
      out[key] = { value: value !== undefined ? value : null, expiresAt: expiresAt || 0 };
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(out));
  } catch (err) {
    console.warn('[resolver] Failed to flush cache to disk:', err.message);
  }
}

let _flushTimer = null;
function scheduleFlush() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => { flushToDisk(); _flushTimer = null; }, 5000);
}

// ─── HiAnime search + fuzzy matching ─────────────────────────────────────────

/**
 * Search HiAnime by title and return the best matching anime ID.
 * Uses Fuse.js to compare against search results.
 *
 * @param {string[]} titleVariants
 * @returns {Promise<{ hianimeId: string, animeName: string }|null>}
 */
async function searchHiAnime(titleVariants) {
  for (const title of titleVariants) {
    if (!title || title.length < 2) continue;
    // Skip purely non-Latin titles
    if (!/[a-zA-Z]/.test(title)) continue;

    let results;
    try {
      results = await hianime.searchAnime(title);
    } catch (err) {
      console.warn(`[resolver] HiAnime search failed for "${title}":`, err.message);
      continue;
    }

    if (!results || results.length === 0) continue;

    // Use Fuse.js to find the best match among the returned results
    const fuse = new Fuse(results, {
      keys: [{ name: 'name', weight: 1 }],
      threshold: 0.35,
      includeScore: true,
    });

    const fuseResults = fuse.search(title, { limit: 3 });
    if (fuseResults.length === 0) continue;

    const best = fuseResults[0].item;
    const bestScore = fuseResults[0].score;

    // Validate: first significant word of query must match best result
    const queryWords = significantWords(title, 2);
    const resultWords = significantWords(best.name || '', 2);

    if (queryWords.length === 0 || resultWords.length === 0) continue;
    if (queryWords[0] !== resultWords[0]) {
      console.log(`[resolver] HiAnime search "${title}" discarded: "${best.name}" (first word mismatch)`);
      continue;
    }

    console.log(`[resolver] HiAnime search "${title}" → ${best.id} (${best.name}, score ${bestScore?.toFixed(3)})`);
    return { hianimeId: best.id, animeName: best.name };
  }

  return null;
}

// ─── Core resolution ──────────────────────────────────────────────────────────

/**
 * Internal resolution logic returning full metadata.
 * @param {string} imdbId
 * @returns {{ hianimeId: string|null, animeName: string|null, method: string|null, titleVariants: string[], inFribb: boolean }}
 */
async function _resolve(imdbId) {
  let hianimeId = null;
  let animeName = null;
  let method = null;
  let titleVariants = [];

  try {
    // Step 1: get associated IDs from Fribb mapping
    const ids = await mappingCache.getByImdb(imdbId);

    if (ids?.anilist_id || ids?.mal_id) {
      // Step 2: fetch canonical titles from AniList
      if (ids.anilist_id) {
        const media = await anilist.getById(ids.anilist_id);
        if (media) titleVariants = anilist.collectTitles(media);
      }
      if (titleVariants.length === 0 && ids.mal_id) {
        const results = await anilist.searchAnime(`mal:${ids.mal_id}`).catch(() => []);
        const match = results.find(r => r.idMal === ids.mal_id);
        if (match) titleVariants = anilist.collectTitles(match);
      }

      // Put English title first for HiAnime search (it catalogs by English names)
      // collectTitles returns [english, romaji, native, ...synonyms]
      // This order is already ideal for HiAnime
    }

    // Fallback: if Fribb has no mapping, try IMDB title → AniList search
    if (titleVariants.length === 0) {
      const info = await imdbApi.fetchTitleInfo(imdbId).catch(() => null);
      if (info?.title) {
        console.log(`[resolver] Fribb miss for ${imdbId}, searching AniList by IMDB title: "${info.title}"`);
        const anilistResults = await anilist.searchAnime(info.title).catch(() => []);
        if (anilistResults.length > 0) {
          titleVariants = anilist.collectTitles(anilistResults[0]);
        }
        if (!titleVariants.includes(info.title)) {
          titleVariants.push(info.title);
        }
      }
    }

    console.log(`[resolver] Trying titles for ${imdbId}:`, titleVariants.slice(0, 3));

    if (titleVariants.length > 0) {
      // Step 3: search HiAnime
      const match = await searchHiAnime(titleVariants);
      if (match) {
        hianimeId = match.hianimeId;
        animeName = match.animeName;
        method = 'search';
      }
    }

    if (!hianimeId) {
      console.warn(`[resolver] No HiAnime match for ${imdbId} (titles: ${titleVariants.slice(0, 2).join(', ')})`);
    }
  } catch (err) {
    console.error(`[resolver] Error resolving ${imdbId}:`, err.message);
    throw err;
  }

  const title = animeName || titleVariants[0] || null;
  const inFribb = titleVariants.length > 0;
  return { hianimeId, title, method, titleVariants, inFribb };
}

/**
 * Resolve an IMDB ID to a HiAnime anime ID with full metadata.
 * @param {string} imdbId
 * @returns {Promise<{ hianimeId: string|null, title: string|null, method: string|null, titleVariants: string[], inFribb: boolean }>}
 */
async function resolveImdbToHiAnime(imdbId) {
  const cached = resolvedMap.get(imdbId);
  if (cached !== undefined) {
    if (cached) return { ...cached, method: cached.method || 'cache' };
    return { hianimeId: null, title: null, method: null, titleVariants: [], inFribb: false };
  }

  const result = await _resolve(imdbId);

  if (result.hianimeId) {
    resolvedMap.set(imdbId, result);
  } else {
    resolvedMap.set(imdbId, null, 7200); // retry after 2 hours
  }
  scheduleFlush();
  return result;
}

/**
 * Remove a cached resolution so the next call re-resolves from scratch.
 */
function clearCache(imdbId) {
  resolvedMap.del(imdbId);
  scheduleFlush();
}

/**
 * Resolve directly from a list of title strings (for scripts/debug).
 * @param {string[]} titles
 * @returns {Promise<{ hianimeId: string|null, animeName: string|null }|null>}
 */
async function resolveByTitles(titles) {
  if (!titles || titles.length === 0) return null;
  return searchHiAnime(titles);
}

/** Whether the resolver cache is ready. Always true for HiAnime (no pre-built index needed). */
function isIndexReady() {
  return true;
}

module.exports = {
  resolveImdbToHiAnime,
  resolveByTitles,
  clearCache,
  loadPersistedCache,
  flushToDisk,
  isIndexReady,
};
