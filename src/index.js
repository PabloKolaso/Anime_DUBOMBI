/**
 * Stremio HiAnime Dub Addon — Entry Point
 */

// Must be first — patches console before any other module logs
const { router: debugRouter } = require('./debug');

const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const compression       = require('compression');
const manifest          = require('./manifest');
const mappingCache      = require('./mapping/cache');
const { streamHandler } = require('./handlers/streams');
const { loadPersistedCache, flushToDisk, isIndexReady } = require('./bridge/resolver');
const logger            = require('./logger');
const stats             = require('./stats');
const dashboardRouter   = require('./dashboard');

const PORT = process.env.PORT || 7001;

// ─── Crash guards ────────────────────────────────────────────────────────────

process.on('uncaughtException', err => {
  console.error('[uncaughtException]', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// ─────────────────────────────────────────────────────────────────────────────

async function start() {
  const host = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

  const builder = new addonBuilder(manifest);
  builder.defineStreamHandler(streamHandler);
  console.log('=== Anime DUBOMBI ===');

  // Load the Fribb IMDB mapping (required for all lookups)
  try {
    await mappingCache.load();
  } catch (err) {
    console.error('[boot] Fribb mapping failed to load:', err.message);
    console.warn('[boot] Retrying mapping load in 30 seconds...');
    setTimeout(() => mappingCache.load().catch(console.error), 30_000);
  }

  // Restore resolver cache from previous run
  loadPersistedCache();

  // Start the HTTP server
  const addonInterface = builder.getInterface();
  const app = express();
  app.use(cors());
  app.use(compression());

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // Bandwidth tracking
  app.use((req, res, next) => {
    const origEnd = res.end;
    res.end = function(chunk, encoding) {
      origEnd.call(this, chunk, encoding);
      const contentLength = parseInt(res.getHeader('content-length'), 10);
      const chunkSize = (chunk && (typeof chunk === 'string' || Buffer.isBuffer(chunk)))
        ? Buffer.byteLength(chunk)
        : 0;
      const bytes = contentLength || chunkSize;
      if (bytes > 0) stats.recordBandwidth(bytes);
    };
    next();
  });

  // Health endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      mappingLoaded: mappingCache.getMappingSize() > 0,
    });
  });

  app.use('/logo', express.static(require('path').join(__dirname, '../logo')));
  app.use('/', dashboardRouter);
  app.use('/', getRouter(addonInterface));
  app.use('/', debugRouter);

  const server = app.listen(PORT);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[error] Port ${PORT} is already in use.`);
      console.error(`        Kill the existing process or run: set PORT=7002 && npm start\n`);
      process.exit(1);
    }
    throw err;
  });
  logger.startCleanupInterval();

  console.log(`\nAddon running at: ${host}/manifest.json`);
  console.log(`Dashboard:        ${host}/dashboard`);
  console.log(`Health check:     ${host}/health`);
  console.log(`Debug resolve:    ${host}/debug/resolve/:imdbId`);
  console.log('Install in Stremio by opening the manifest URL above.\n');

  // Self-ping keep-alive
  let pingTimer = null;
  if (process.env.PUBLIC_URL) {
    const PING_INTERVAL = 12 * 60 * 1000;
    pingTimer = setInterval(() => {
      axios.get(`${process.env.PUBLIC_URL}/health`)
        .then(() => console.log('[keepalive] Ping OK'))
        .catch(err => console.warn('[keepalive] Ping failed:', err.message));
    }, PING_INTERVAL);
    console.log('[keepalive] Self-ping enabled (every 12 min)');
  }

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[shutdown] SIGTERM received, closing server...');
    if (pingTimer) clearInterval(pingTimer);
    logger.stopCleanupInterval();
    logger.flush();
    stats.flush();
    flushToDisk();
    server.close(() => {
      console.log('[shutdown] Server closed.');
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000);
  });
}

start().catch(err => {
  console.error('[boot] Fatal startup error:', err);
  process.exit(1);
});
