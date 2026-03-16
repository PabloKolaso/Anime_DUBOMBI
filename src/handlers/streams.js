/**
 * Stream Handler
 *
 * Called by Stremio when a user selects an episode.
 * Stremio provides: type = "series" | "movie", id = "tt0388629:1:5"
 *
 * Returns stream objects with English dub HLS URLs from HiAnime (MegaCloud).
 */

const resolver   = require('../bridge/resolver');
const hianime    = require('../api/hianime');
const gogoanime  = require('../api/gogoanime');
const imdbApi    = require('../api/imdb');
const logger     = require('../logger');
const stats      = require('../stats');

const IMDB_RE = /^tt\d{7,10}$/;

/**
 * Parse a Stremio series ID into its components.
 * "tt0388629:1:5" → { imdbId: "tt0388629", season: 1, episode: 5 }
 * "tt0388629"     → { imdbId: "tt0388629", season: null, episode: null }
 */
function parseId(id) {
  const parts = id.split(':');
  return {
    imdbId:  parts[0],
    season:  parts[1] ? parseInt(parts[1], 10) : null,
    episode: parts[2] ? parseInt(parts[2], 10) : null,
  };
}

/**
 * Given a flat HiAnime episodes array and an episode number,
 * find the matching episode object.
 *
 * HiAnime stores all episodes as a flat list (number 1, 2, 3…).
 * For multi-season anime, Stremio sends season+episode but HiAnime only
 * knows absolute episode numbers. We match by episode number directly —
 * this works for most single-season anime. For multi-season, users may
 * need to find the absolute episode number.
 */
function findEpisode(episodes, episode) {
  if (!episodes || episodes.length === 0) return null;

  // Direct number match
  const byNumber = episodes.find(e => e.number === episode);
  if (byNumber) return byNumber;

  // Index-based fallback
  if (episode >= 1 && episode <= episodes.length) {
    return episodes[episode - 1];
  }

  return null;
}

/**
 * Build stream objects from HiAnime sources.
 * @param {Array<{ url: string, isM3U8: boolean, quality: string }>} sources
 * @param {string} animeName
 * @param {number} episodeNumber
 * @param {string} imdbId
 * @returns {object[]}
 */
function buildStreams(sources, animeName, episodeNumber, imdbId) {
  const streams = [];

  for (const source of sources) {
    if (!source.url) continue;

    // Quality label
    const quality = source.quality || 'Auto';
    const label = quality === 'default' || quality === 'auto' ? 'Auto' : quality;

    streams.push({
      url: source.url,
      name: `HiAnime\nEng Dub`,
      description: `${animeName} • Episode ${episodeNumber}\nEnglish Dub • HLS`,
      behaviorHints: {
        notWebReady: true,
        bingeGroup: `hianime-dub-${imdbId}`,
      },
    });
  }

  return streams;
}

/**
 * When HiAnime resolves to a "part-N" entry (e.g. season-2-part-2),
 * Stremio still sends absolute episode numbers (e.g. S2E22).
 * This function calculates the episode offset by summing the episode counts
 * of all previous parts (part-1 … part-(N-1)).
 *
 * Returns the total offset to subtract from the Stremio episode number,
 * or 0 if this isn't a multi-part entry or Part 1 can't be resolved.
 *
 * @param {string} hianimeId  e.g. "mushoku-tensei-season-2-part-2-19147"
 * @param {string[]} titleVariants  canonical titles from AniList/IMDB
 * @returns {Promise<number>}
 */
async function resolvePartOffset(hianimeId, titleVariants) {
  const partMatch = hianimeId.match(/part-(\d+)/i);
  if (!partMatch) return 0;

  const partNum = parseInt(partMatch[1], 10);
  if (partNum <= 1) return 0;

  let totalOffset = 0;

  for (let p = 1; p < partNum; p++) {
    // Build title variants pointing at the previous part
    const prevPartVariants = (titleVariants || [])
      .filter(t => t && /[a-zA-Z]/.test(t))
      .map(t => t.replace(/part\s*\d+/i, `Part ${p}`).replace(/cour\s*\d+/i, `Part ${p}`))
      .filter((t, i, arr) => arr.indexOf(t) === i); // dedupe

    if (prevPartVariants.length === 0) break;

    try {
      const match = await resolver.resolveByTitles(prevPartVariants);
      if (!match?.hianimeId) {
        console.warn(`[streams] Part offset: couldn't find Part ${p} for ${hianimeId}`);
        break;
      }
      const prevEps = await hianime.getEpisodes(match.hianimeId);
      console.log(`[streams] Part offset: Part ${p} = ${match.hianimeId} (${prevEps.length} eps)`);
      totalOffset += prevEps.length;
    } catch (err) {
      console.warn(`[streams] Part offset lookup failed for Part ${p}:`, err.message);
      break;
    }
  }

  return totalOffset;
}

/**
 * Try Gogoanime as a fallback source.
 * Returns stream objects or an empty array if nothing found.
 */
async function tryGogoanime(titleVariants, episodeNum, imdbId) {
  for (const title of (titleVariants || []).slice(0, 3)) {
    if (!title || !/[a-zA-Z]/.test(title)) continue;
    try {
      const anime = await gogoanime.findDub(title);
      if (!anime) continue;

      const episodes = await gogoanime.getEpisodes(anime.id);
      const ep = episodes.find(e => e.number === episodeNum) ||
                 (episodeNum >= 1 && episodeNum <= episodes.length ? episodes[episodeNum - 1] : null);
      if (!ep) continue;

      const sources = await gogoanime.getSources(ep.id);
      if (sources.length === 0) continue;

      console.log(`[streams] AnimeKai fallback: ${sources.length} source(s) for "${anime.title}" ep ${episodeNum}`);
      return sources
        .filter(s => s.url)
        .map(s => ({
          url: s.url,
          name: `AnimeKai\nEng Dub`,
          description: `${anime.title} • Episode ${episodeNum}\nEnglish Dub • HLS`,
          behaviorHints: {
            notWebReady: true,
            bingeGroup: `animekai-dub-${imdbId}`,
          },
        }));
    } catch (err) {
      console.warn(`[streams] AnimeKai fallback failed for "${title}":`, err.message);
    }
  }
  return [];
}

/**
 * Main stream handler.
 * @param {{ type: string, id: string }} args
 * @returns {{ streams: object[] }}
 */
async function streamHandler({ type, id }) {
  const startTime = Date.now();
  const { imdbId, season, episode } = parseId(id);

  if (!IMDB_RE.test(imdbId)) return { streams: [] };

  console.log(`[streams] Request: type=${type} imdb=${imdbId} s=${season} e=${episode}`);

  // Step 1: resolve IMDB ID to HiAnime anime ID
  let resolution;
  try {
    resolution = await resolver.resolveImdbToHiAnime(imdbId);
  } catch (err) {
    console.error(`[streams] Resolution error for ${imdbId}:`, err.message);
    logger.log({
      imdbId, stremioId: id, type,
      outcome: 'error', title: null, isAnime: null, method: null,
      responseTimeMs: Date.now() - startTime,
      streamCount: 0, error: err.message,
    });
    stats.recordRequest({ outcome: 'error', isAnime: null });
    return {
      streams: [{
        name: 'HiAnime Dub\n\u26A0 Error',
        description: `Temporary error looking up this anime.\n${err.message}\nTry again in a moment.`,
        externalUrl: 'https://hianime.to',
      }],
    };
  }

  const hianimeId = resolution.hianimeId;

  if (!hianimeId) {
    console.log(`[streams] No HiAnime match for ${imdbId} — trying Gogoanime fallback`);
    if (episode !== null && resolution.titleVariants?.length > 0) {
      const fallback = await tryGogoanime(resolution.titleVariants, episode, imdbId);
      if (fallback.length > 0) {
        logger.log({
          imdbId, stremioId: id, type,
          outcome: 'success', title: resolution.title, isAnime: true, method: 'gogoanime',
          responseTimeMs: Date.now() - startTime,
          streamCount: fallback.length, error: null,
        });
        stats.recordRequest({ outcome: 'success', isAnime: true });
        return { streams: fallback };
      }
    }
    const isAnime = resolution.inFribb ? true : null;
    logger.log({
      imdbId, stremioId: id, type,
      outcome: 'not_found', title: resolution.title, isAnime, method: null,
      responseTimeMs: Date.now() - startTime,
      streamCount: 0, error: null,
    });
    stats.recordRequest({ outcome: 'not_found', isAnime });
    const failedTitle = resolution.title || resolution.titleVariants?.[0] || null;
    stats.recordFailedLookup(imdbId, failedTitle, isAnime);
    if (isAnime === null) {
      imdbApi.fetchTitleInfo(imdbId).then(info => {
        if (info) {
          stats.updateFailedLookup(imdbId, { title: info.title, isAnime: info.isAnime });
          logger.updateLastLog(imdbId, { title: info.title, isAnime: info.isAnime });
        }
      }).catch(() => {});
    }
    const notFoundDesc = isAnime === false
      ? `This title doesn't appear to be anime.\nIMDB: ${imdbId}`
      : `No match found on HiAnime or AnimeKai.\nTitle: ${failedTitle || imdbId}\nThis anime may not have an English dub.`;
    return {
      streams: [{
        name: 'HiAnime Dub\n\u26A0 Not Found',
        description: notFoundDesc,
        externalUrl: 'https://hianime.to',
      }],
    };
  }

  // Step 2: fetch episode list from HiAnime
  let episodes;
  try {
    episodes = await hianime.getEpisodes(hianimeId);
  } catch (err) {
    console.error(`[streams] Failed to fetch episodes for ${hianimeId}:`, err.message);
    logger.log({
      imdbId, stremioId: id, type,
      outcome: 'error', title: resolution.title, isAnime: true, method: resolution.method,
      responseTimeMs: Date.now() - startTime,
      streamCount: 0, error: err.message,
    });
    stats.recordRequest({ outcome: 'error', isAnime: true });
    return {
      streams: [{
        name: 'HiAnime Dub\n\u26A0 Error',
        description: `Could not load episode data.\n${err.message}\nTry again in a moment.`,
        externalUrl: 'https://hianime.to',
      }],
    };
  }

  if (!episodes || episodes.length === 0) {
    console.log(`[streams] No episodes found for ${hianimeId}`);
    logger.log({
      imdbId, stremioId: id, type,
      outcome: 'success', title: resolution.title, isAnime: true, method: resolution.method,
      responseTimeMs: Date.now() - startTime,
      streamCount: 0, error: null,
    });
    stats.recordRequest({ outcome: 'success', isAnime: true });
    return { streams: [] };
  }

  // Step 3: find the target episode
  let targetEpisode;
  if (type === 'movie' || episode === null) {
    targetEpisode = episodes[0];
  } else {
    targetEpisode = findEpisode(episodes, episode);
  }

  if (!targetEpisode) {
    console.log(`[streams] Episode ${episode} not found in ${hianimeId} (${episodes.length} eps) — trying part offset`);

    // Part-offset correction: HiAnime "part-2" entries number episodes locally (1–12),
    // but Stremio sends absolute episode numbers. Look up previous parts to get the offset.
    const offset = await resolvePartOffset(hianimeId, resolution.titleVariants);
    if (offset > 0) {
      const adjustedEp = episode - offset;
      console.log(`[streams] Part offset=${offset}, adjusted ep: ${episode} → ${adjustedEp}`);
      targetEpisode = findEpisode(episodes, adjustedEp);
    }

    if (!targetEpisode) {
      console.log(`[streams] Episode still not found after offset — trying AnimeKai fallback`);
      if (episode !== null && resolution.titleVariants?.length > 0) {
        const fallback = await tryGogoanime(resolution.titleVariants, episode, imdbId);
        if (fallback.length > 0) {
          logger.log({
            imdbId, stremioId: id, type,
            outcome: 'success', title: resolution.title, isAnime: true, method: 'animekai',
            responseTimeMs: Date.now() - startTime,
            streamCount: fallback.length, error: null,
          });
          stats.recordRequest({ outcome: 'success', isAnime: true });
          return { streams: fallback };
        }
      }
      logger.log({
        imdbId, stremioId: id, type,
        outcome: 'not_found', title: resolution.title, isAnime: true, method: resolution.method,
        responseTimeMs: Date.now() - startTime,
        streamCount: 0, error: null,
      });
      stats.recordRequest({ outcome: 'not_found', isAnime: true });
      return {
        streams: [{
          name: 'HiAnime Dub\n\u26A0 Not Found',
          description: `Episode ${episode} not found\nHiAnime: ${hianimeId} (${episodes.length} eps)${offset > 0 ? `, offset=${offset}` : ''}\nAnimeKai: no dub available\nTry HiAnime directly`,
          externalUrl: 'https://hianime.to',
        }],
      };
    }
  }

  // Step 4: get dub sources for this episode
  let sources;
  try {
    sources = await hianime.getDubSources(targetEpisode.episodeId);
  } catch (err) {
    console.error(`[streams] Failed to fetch dub sources for ${targetEpisode.id}:`, err.message);
    logger.log({
      imdbId, stremioId: id, type,
      outcome: 'error', title: resolution.title, isAnime: true, method: resolution.method,
      responseTimeMs: Date.now() - startTime,
      streamCount: 0, error: err.message,
    });
    stats.recordRequest({ outcome: 'error', isAnime: true });
    return {
      streams: [{
        name: 'HiAnime Dub\n\u26A0 Error',
        description: `Could not load stream sources.\n${err.message}\nTry again in a moment.`,
        externalUrl: 'https://hianime.to',
      }],
    };
  }

  const animeName = resolution.title || hianimeId;
  let resultStreams = buildStreams(sources, animeName, targetEpisode.number, imdbId);

  // If HiAnime returned no usable sources, try Gogoanime as fallback
  if (resultStreams.length === 0 && episode !== null) {
    console.log(`[streams] HiAnime returned no sources for ${imdbId} ep ${episode} — trying Gogoanime`);
    const fallback = await tryGogoanime(resolution.titleVariants, episode, imdbId);
    if (fallback.length > 0) resultStreams = fallback;
  }

  console.log(`[streams] Returning ${resultStreams.length} dub stream(s) for ${imdbId} s${season}e${episode}`);

  logger.log({
    imdbId, stremioId: id, type,
    outcome: 'success', title: resolution.title, isAnime: true, method: resolution.method,
    responseTimeMs: Date.now() - startTime,
    streamCount: resultStreams.length, error: null,
  });
  stats.recordRequest({ outcome: 'success', isAnime: true });

  return { streams: resultStreams };
}

module.exports = { streamHandler };
