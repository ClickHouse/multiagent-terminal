/**
 * Search worker source code — serialized as a string and written to a temp
 * file at runtime, then loaded via `new Worker(path)`.
 *
 * The worker maintains a trigram index over terminal log files:
 * - On startup: scans all existing logs and builds the index.
 * - On 'index' message: incrementally indexes new lines from writeLog.
 * - On 'search' message: uses trigram intersection to find candidate files,
 *   verifies matches line-by-line, returns results.
 * - On 'remove' message: drops an agent from the index.
 *
 * File contents are cached with mtime invalidation.
 */

export const SEARCH_WORKER_CODE = `
'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const logsBase = workerData.logsDir;

// Memory bounds. Terminal logs capture full Claude sessions verbatim and can
// reach hundreds of MB each; indexing them whole OOMs the worker (it holds two
// full copies per file plus a trigram set per line). So: only index a recent
// tail of each file, cap the total bytes held across all files (newest first),
// and skip pathologically long lines (data dumps) from the trigram index.
const MAX_FILE_TAIL_BYTES = 1024 * 1024;     // index only the last 1 MB of a log
const MAX_TOTAL_INDEX_BYTES = 128 * 1024 * 1024; // hard ceiling across all files
const MAX_INDEX_LINE_LEN = 2000;             // don't trigram-index longer lines

// trigram → Set of file keys ("agentId/filename")
const trigramIndex = new Map();

// fileKey → { mtime, lines, bytes }
const fileCache = new Map();

// fileKey → mtimeMs at which this file was last indexed (drives lazy refresh).
const indexedMtime = new Map();

function extractTrigrams(text) {
  const t = new Set();
  const lower = text.toLowerCase();
  for (let i = 0; i <= lower.length - 3; i++) {
    t.add(lower.slice(i, i + 3));
  }
  return t;
}

function addToIndex(fileKey, text) {
  for (const tri of extractTrigrams(text)) {
    let set = trigramIndex.get(tri);
    if (!set) { set = new Set(); trigramIndex.set(tri, set); }
    set.add(fileKey);
  }
}

function dropFileKeyFromIndex(fileKey) {
  for (const [tri, set] of trigramIndex) {
    set.delete(fileKey);
    if (set.size === 0) trigramIndex.delete(tri);
  }
}

function removeFromIndex(agentId) {
  const prefix = agentId + '/';
  for (const [tri, set] of trigramIndex) {
    for (const key of set) {
      if (key.startsWith(prefix)) set.delete(key);
    }
    if (set.size === 0) trigramIndex.delete(tri);
  }
  for (const key of fileCache.keys()) {
    if (key.startsWith(prefix)) fileCache.delete(key);
  }
  for (const key of indexedMtime.keys()) {
    if (key.startsWith(prefix)) indexedMtime.delete(key);
  }
}

// Read at most the last MAX_FILE_TAIL_BYTES of a file. For oversized logs we
// open and read only the tail, then drop the (likely partial) first line.
function readTail(filePath, size) {
  if (size <= MAX_FILE_TAIL_BYTES) return fs.readFileSync(filePath, 'utf8');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(MAX_FILE_TAIL_BYTES);
    fs.readSync(fd, buf, 0, MAX_FILE_TAIL_BYTES, size - MAX_FILE_TAIL_BYTES);
    let content = buf.toString('utf8');
    const nl = content.indexOf('\\n');
    return nl >= 0 ? content.slice(nl + 1) : content;
  } finally {
    fs.closeSync(fd);
  }
}

function readFileLines(filePath, fileKey) {
  try {
    const stat = fs.statSync(filePath);
    const cached = fileCache.get(fileKey);
    if (cached && cached.mtime === stat.mtimeMs) return cached;

    const content = readTail(filePath, stat.size);
    const lines = content.split('\\n');
    // Store one copy only; search lowercases on demand. Track byte cost so the
    // global budget can evict / skip.
    const entry = { mtime: stat.mtimeMs, lines, bytes: content.length };
    fileCache.set(fileKey, entry);
    return entry;
  } catch {
    return null;
  }
}

// Scan logsBase and (re)index any file whose mtime is newer than what we
// previously indexed. Cheap when nothing changed — a directory walk plus
// a stat per file. Called once at startup and before each search, replacing
// the old per-chunk 'index' message path.
function refreshIndex() {
  let indexed = 0;
  let skipped = 0;
  try {
    // Collect every log file with its mtime/size, then process newest first so
    // the byte budget is spent on the most relevant (recent) output.
    const all = [];
    const agents = fs.readdirSync(logsBase, { withFileTypes: true })
      .filter(e => e.isDirectory());
    for (const agent of agents) {
      const agentDir = path.join(logsBase, agent.name);
      let files;
      try {
        files = fs.readdirSync(agentDir)
          .filter(f => f.startsWith('session-') && f.endsWith('.log'));
      } catch { continue; }
      for (const file of files) {
        const filePath = path.join(agentDir, file);
        let stat;
        try { stat = fs.statSync(filePath); } catch { continue; }
        all.push({ fileKey: agent.name + '/' + file, filePath, mtime: stat.mtimeMs, size: stat.size });
      }
    }
    all.sort((a, b) => b.mtime - a.mtime);

    let totalBytes = 0;
    for (const f of all) {
      const prev = indexedMtime.get(f.fileKey);

      // Budget check: each file contributes min(size, tail cap). Once the
      // ceiling is reached, stop indexing further (older) files entirely.
      const cost = Math.min(f.size, MAX_FILE_TAIL_BYTES);
      if (totalBytes + cost > MAX_TOTAL_INDEX_BYTES) {
        // Evict anything previously indexed beyond the budget so memory drops.
        if (prev !== undefined) {
          dropFileKeyFromIndex(f.fileKey);
          fileCache.delete(f.fileKey);
          indexedMtime.delete(f.fileKey);
        }
        skipped++;
        continue;
      }
      totalBytes += cost;

      if (prev === f.mtime) continue; // unchanged — already indexed

      // File grew or changed — drop its old trigrams + cached lines, re-index.
      if (prev !== undefined) {
        dropFileKeyFromIndex(f.fileKey);
        fileCache.delete(f.fileKey);
      }
      const entry = readFileLines(f.filePath, f.fileKey);
      if (!entry) continue;
      for (const line of entry.lines) {
        if (line.length >= 3 && line.length <= MAX_INDEX_LINE_LEN) addToIndex(f.fileKey, line);
      }
      indexedMtime.set(f.fileKey, f.mtime);
      indexed++;
    }
    if (skipped > 0) {
      parentPort.postMessage({ type: 'log', message: 'index budget reached: ' + skipped + ' older log(s) not indexed' });
    }
  } catch {}
  return indexed;
}

function buildIndex() {
  const indexed = refreshIndex();
  parentPort.postMessage({ type: 'ready', fileCount: indexed, trigramCount: trigramIndex.size });
}

function search(query, agentIds, maxResults) {
  if (!query || query.length < 2) return [];

  const queryLower = query.toLowerCase();
  const queryTrigrams = extractTrigrams(queryLower);

  // Trigram intersection to find candidate files
  let candidates = null;
  for (const tri of queryTrigrams) {
    const set = trigramIndex.get(tri);
    if (!set) return []; // no files contain this trigram
    if (!candidates) {
      candidates = new Set(set);
    } else {
      for (const key of candidates) {
        if (!set.has(key)) candidates.delete(key);
      }
    }
    if (candidates.size === 0) return [];
  }

  // Short queries (<3 chars): scan all cached files
  if (!candidates) {
    candidates = new Set(fileCache.keys());
  }

  // Filter by agent
  if (agentIds && agentIds.length > 0) {
    const allowed = new Set(agentIds);
    for (const key of candidates) {
      if (!allowed.has(key.split('/')[0])) candidates.delete(key);
    }
  }

  // Newest first
  const sorted = Array.from(candidates).sort((a, b) => b.localeCompare(a));
  const matches = [];

  for (const fileKey of sorted) {
    if (matches.length >= maxResults) break;
    const parts = fileKey.split('/');
    const agentId = parts[0];
    const fileName = parts.slice(1).join('/');
    const filePath = path.join(logsBase, agentId, fileName);

    const entry = readFileLines(filePath, fileKey);
    if (!entry) continue;

    for (let i = 0; i < entry.linesLower.length; i++) {
      if (matches.length >= maxResults) break;
      if (entry.linesLower[i].includes(queryLower)) {
        matches.push({
          agentId,
          logFile: fileName,
          line: entry.lines[i],
          lineNumber: i + 1,
          contextBefore: i > 0 ? entry.lines[i - 1] : '',
          contextAfter: i < entry.lines.length - 1 ? entry.lines[i + 1] : '',
        });
      }
    }
  }

  return matches;
}

parentPort.on('message', (msg) => {
  switch (msg.type) {
    case 'search': {
      // Lazy-refresh: pick up any file growth since the last search.
      refreshIndex();
      const results = search(msg.query, msg.agentIds, msg.maxResults || 200);
      parentPort.postMessage({ type: 'searchResult', id: msg.id, results });
      break;
    }
    case 'remove': {
      removeFromIndex(msg.agentId);
      break;
    }
  }
});

buildIndex();
`
