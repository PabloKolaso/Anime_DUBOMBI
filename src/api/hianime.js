/**
 * HiAnime API client — wraps the `aniwatch` npm package.
 *
 * Used to:
 *  1. Search anime by title → get HiAnime anime ID (slug)
 *  2. Get episode list for an anime
 *  3. Get dub stream sources for a specific episode (MegaCloud server)
 *
 * HiAnime IDs look like: "one-piece-100"
 * Episode IDs look like:  "one-piece-100?ep=2142"
 */

const NodeCache = require('node-cache');

// Lazy-load aniwatch so we don't crash if it's not installed yet
let _scraper = null;
function getScraper() {
  if (!_scraper) {
    const { HiAnime } = require('aniwatch');
    _scraper = new HiAnime.Scraper();
  }
  return _scraper;
}

let _Servers = null;
function getServers() {
  if (!_Servers) {
    const { HiAnime } = require('aniwatch');
    _Servers = HiAnime.Servers;
  }
  return _Servers;
}

// Cache search results for 1 hour, episode lists for 30 min, sources for 15 min
const searchCache  = new NodeCache({ stdTTL: 3600 });
const episodeCache = new NodeCache({ stdTTL: 1800 });
const sourceCache  = new NodeCache({ stdTTL: 900 });

/**
 * Search HiAnime for anime by title.
 * @param {string} query
 * @returns {Promise<Array<{ id: string, name: string }>>}
 */
async function searchAnime(query) {
  const key = `search:${query.toLowerCase().trim()}`;
  if (searchCache.has(key)) return searchCache.get(key);

  const scraper = getScraper();
  const result = await scraper.search(query);
  const animes = result?.animes || [];
  searchCache.set(key, animes);
  return animes;
}

/**
 * Get episode list for a HiAnime anime ID.
 * @param {string} animeId - e.g. "one-piece-100"
 * @returns {Promise<Array<{ id: string, number: number, title: string|null, isFiller: boolean }>>}
 */
async function getEpisodes(animeId) {
  if (episodeCache.has(animeId)) return episodeCache.get(animeId);

  const scraper = getScraper();
  const result = await scraper.getEpisodes(animeId);
  const episodes = result?.episodes || [];
  episodeCache.set(animeId, episodes);
  return episodes;
}

/**
 * Get dub stream sources for a specific episode.
 * Tries MegaCloud first (primary), falls back to VideoStan.
 *
 * @param {string} episodeId - e.g. "one-piece-100?ep=2142"
 * @returns {Promise<Array<{ url: string, isM3U8: boolean, quality: string }>>}
 */
async function getDubSources(episodeId) {
  const key = `dub:${episodeId}`;
  if (sourceCache.has(key)) return sourceCache.get(key);

  const scraper = getScraper();
  const Servers = getServers();

  // VidStreaming ("hd-1") maps to data-server-id=4 in the HiAnime HTML (VidSrc/MegaCloud CDN).
  // VidCloud ("hd-2") maps to data-server-id=1 (MegaCloud) but its key extraction often fails.
  // Try VidStreaming first, then VidCloud as fallback.
  const servers = [Servers.VidStreaming, Servers.VidCloud];

  for (const server of servers) {
    try {
      const result = await scraper.getEpisodeSources(episodeId, server, 'dub');
      const sources = result?.sources || [];
      if (sources.length > 0) {
        sourceCache.set(key, sources);
        return sources;
      }
    } catch (err) {
      console.warn(`[hianime] Server ${server} failed for ${episodeId}: ${err.message}`);
    }
  }

  sourceCache.set(key, []);
  return [];
}

/**
 * Get the episode servers list to check if dub is available.
 * @param {string} episodeId
 * @returns {Promise<{ dub: Array, sub: Array }>}
 */
async function getEpisodeServers(episodeId) {
  const scraper = getScraper();
  try {
    const result = await scraper.getEpisodeServers(episodeId);
    return { dub: result?.dub || [], sub: result?.sub || [] };
  } catch {
    return { dub: [], sub: [] };
  }
}

module.exports = { searchAnime, getEpisodes, getDubSources, getEpisodeServers };
