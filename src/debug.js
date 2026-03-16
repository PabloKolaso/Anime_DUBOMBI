/**
 * Debug module — live log capture and diagnostic HTTP routes.
 *
 * Must be required FIRST in index.js so console is patched before
 * any other module logs anything.
 */

const { Router } = require('express');
const resolver = require('./bridge/resolver');

// ─── Log capture ─────────────────────────────────────────────────────────────

const MAX_LOGS = 300;
const logBuffer = [];

function capture(level, original) {
  return function (...args) {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(a =>
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    ).join(' ')}`;
    logBuffer.push(line);
    if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    original.apply(console, args);
  };
}

console.log   = capture('LOG',   console.log);
console.warn  = capture('WARN',  console.warn);
console.error = capture('ERROR', console.error);

function getLogs() {
  return logBuffer.slice();
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * GET /debug
 * Redirects to the dashboard logs tab.
 */
router.get('/debug', (req, res) => {
  res.redirect('/dashboard?tab=logs');
});

/**
 * GET /debug/resolve/:imdbId
 * Forces re-resolution of an IMDB ID and returns JSON with the HiAnime ID + logs.
 */
router.get('/debug/resolve/:imdbId', async (req, res) => {
  const { imdbId } = req.params;

  if (!/^tt\d{7,10}$/.test(imdbId)) {
    return res.json({ imdbId, hianimeId: null, error: 'Invalid IMDB ID format', logs: [] });
  }

  const logsBefore = logBuffer.length;

  let result = null;
  let error = null;

  try {
    resolver.clearCache(imdbId);
    result = await resolver.resolveImdbToHiAnime(imdbId);
  } catch (err) {
    error = err.message;
  }

  const newLogs = logBuffer.slice(logsBefore);

  res.json({ imdbId, hianimeId: result?.hianimeId || null, title: result?.title || null, method: result?.method || null, error, logs: newLogs });
});

/**
 * GET /debug/logs
 * Raw JSON array of all buffered log lines.
 */
router.get('/debug/logs', (req, res) => {
  res.json(getLogs());
});

module.exports = { router, getLogs };
