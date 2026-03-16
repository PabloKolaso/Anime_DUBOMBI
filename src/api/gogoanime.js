/**
 * AnimeKai API client — wraps @consumet/extensions ANIME.AnimeKai.
 *
 * Used as a fallback provider when HiAnime is unavailable or an episode
 * is not found in HiAnime (e.g. split-season numbering mismatches).
 * AnimeKai supports English-dubbed anime with explicit dub filtering.
 */

const NodeCache = require('node-cache');
const Fuse      = require('fuse.js');

let _client = null;
function getClient() {
  if (!_client) {
    const { ANIME } = require('@consumet/extensions');
    _client = new ANIME.AnimeKai();
  }
  return _client;
}

const searchCache  = new NodeCache({ stdTTL: 3600 });
const infoCache    = new NodeCache({ stdTTL: 1800 });
const sourceCache  = new NodeCache({ stdTTL: 900  });

/**
 * Find the best matching English-dubbed anime on AnimeKai.
 * @param {string} title
 * @returns {Promise<{ id: string, title: string }|null>}
 */
async function findDub(title) {
  const key = `dub:${title.toLowerCase().trim()}`;
  if (searchCache.has(key)) return searchCache.get(key);

  const client = getClient();

  let results = [];
  try {
    const r = await client.search(title);
    results = r?.results || [];
  } catch (_) {}

  if (results.length === 0) {
    searchCache.set(key, null, 1800);
    return null;
  }

  // Fuzzy-match to pick best result
  const fuse = new Fuse(results, { keys: ['title'], threshold: 0.4, includeScore: true });
  const hits  = fuse.search(title, { limit: 3 });
  const candidates = hits.length > 0 ? hits.map(h => h.item) : results.slice(0, 3);

  // Check each candidate for dub availability
  for (const candidate of candidates) {
    try {
      const info = await client.fetchAnimeInfo(candidate.id);
      if (info?.hasDub || info?.subOrDub === 'dub' || info?.subOrDub === 'both') {
        const result = { id: candidate.id, title: info.title || candidate.title };
        searchCache.set(key, result);
        return result;
      }
    } catch (_) {}
  }

  searchCache.set(key, null, 1800);
  return null;
}

/**
 * Get episode list for an AnimeKai anime ID.
 * @param {string} animeId
 * @returns {Promise<Array<{ id: string, number: number }>>}
 */
async function getEpisodes(animeId) {
  if (infoCache.has(animeId)) return infoCache.get(animeId);

  const client = getClient();
  const info   = await client.fetchAnimeInfo(animeId);
  const episodes = (info?.episodes || []).map(ep => ({
    id:     ep.id,
    number: ep.number,
  }));
  infoCache.set(animeId, episodes);
  return episodes;
}

/**
 * Get HLS stream sources for an AnimeKai episode ID (dub).
 * @param {string} episodeId
 * @returns {Promise<Array<{ url: string, quality: string, isM3U8: boolean }>>}
 */
async function getSources(episodeId) {
  const key = `src:${episodeId}`;
  if (sourceCache.has(key)) return sourceCache.get(key);

  const client  = getClient();
  const result  = await client.fetchEpisodeSources(episodeId, undefined, 'dub');
  const sources = (result?.sources || []).map(s => ({
    url:    s.url,
    quality: s.quality || 'auto',
    isM3U8: s.isM3U8 ?? (s.url?.includes('.m3u8') ?? false),
  }));
  sourceCache.set(key, sources);
  return sources;
}

module.exports = { findDub, getEpisodes, getSources };
