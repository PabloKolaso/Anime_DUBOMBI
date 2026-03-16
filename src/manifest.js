const { version } = require('../package.json');

const host = process.env.PUBLIC_URL || 'http://localhost:7001';

const manifest = {
  id: 'community.hianime.dub.stremio',
  version,
  name: 'Anime DUBOMBI',
  logo: `${host}/logo/logo.png`,
  description: 'English dubbed anime streams. Provides dub stream options for anime series and movies. This addon does not store any files on its server. All contents are provided by non-affiliated third parties.',
  resources: ['stream'],
  types: ['series', 'movie'],
  // Only trigger for IMDB-prefixed IDs (tt...)
  idPrefixes: ['tt'],
  catalogs: [],
  behaviorHints: {
    adult: false,
    p2p: false,
  },
};

module.exports = manifest;
