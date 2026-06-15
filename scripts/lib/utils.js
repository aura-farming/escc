/**
 * Adapted from Everything Claude Code (ECC) scripts/lib/utils.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * Cross-platform utility functions for Claude Code hooks and scripts.
 * Works on macOS, Linux, and Windows.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');

// Platform detection
const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

const SESSION_DATA_DIR_NAME = 'session-data';
const LEGACY_SESSIONS_DIR_NAME = 'sessions';
const DEFAULT_CLAUDE_DIR_NAME = '.claude';
const AGENT_DATA_HOME_ENV = 'ESCC_AGENT_DATA_HOME';

const WINDOWS_RESERVED_SESSION_IDS = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

/**
 * Get the user's home directory (cross-platform).
 *
 * NOTE: scripts/lib/agent-data-home.js intentionally duplicates this logic to
 * avoid a require cycle (utils <-> agent-data-home). Do NOT import
 * agent-data-home here; keep the home-dir resolution self-contained.
 */
function getHomeDir() {
  const explicitHome = process.env.HOME || process.env.USERPROFILE;
  if (explicitHome && explicitHome.trim().length > 0) {
    return path.resolve(explicitHome);
  }
  return os.homedir();
}

/**
 * Resolve the ESCC agent data home (memory persistence root).
 *
 * Claude Code only: honors ESCC_AGENT_DATA_HOME when set, otherwise defaults to
 * ~/.claude. Resolution is kept inline (rather than importing agent-data-home)
 * to avoid a circular dependency, since agent-data-home requires utils helpers.
 */
function getAgentDataHome() {
  const fromEnv = process.env[AGENT_DATA_HOME_ENV];
  if (fromEnv && fromEnv.trim().length > 0) {
    const trimmed = fromEnv.trim();
    if (trimmed.startsWith('~')) {
      const remainder = trimmed.slice(1).replace(/^[/\\]+/, '');
      return remainder ? path.join(getHomeDir(), remainder) : getHomeDir();
    }
    return path.resolve(trimmed);
  }
  return path.join(getHomeDir(), DEFAULT_CLAUDE_DIR_NAME);
}

/**
 * Get the Claude config directory (alias of getAgentDataHome for backwards
 * compatibility).
 */
function getClaudeDir() {
  return getAgentDataHome();
}

/**
 * Get the sessions directory
 */
function getSessionsDir() {
  return path.join(getClaudeDir(), SESSION_DATA_DIR_NAME);
}

/**
 * Get the legacy sessions directory used by older ESCC installs
 */
function getLegacySessionsDir() {
  return path.join(getClaudeDir(), LEGACY_SESSIONS_DIR_NAME);
}

/**
 * Get all session directories to search, in canonical-first order
 */
function getSessionSearchDirs() {
  return Array.from(new Set([getSessionsDir(), getLegacySessionsDir()]));
}

/**
 * Get the learned skills directory
 */
function getLearnedSkillsDir() {
  return path.join(getClaudeDir(), 'skills', 'learned');
}

/**
 * Get the temp directory (cross-platform)
 */
function getTempDir() {
  return os.tmpdir();
}

/**
 * Ensure a directory exists (create if not)
 * @param {string} dirPath - Directory path to create
 * @returns {string} The directory path
 * @throws {Error} If directory cannot be created (e.g., permission denied)
 */
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (err) {
    // EEXIST is fine (race condition with another process creating it)
    if (err.code !== 'EEXIST') {
      throw new Error(`Failed to create directory '${dirPath}': ${err.message}`);
    }
  }
  return dirPath;
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get current time in HH:MM format
 */
function getTimeString() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Get current datetime in YYYY-MM-DD HH:MM:SS format
 */
function getDateTimeString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Get the git repository name
 */
function getGitRepoName() {
  const result = runCommand('git rev-parse --show-toplevel');
  if (!result.success) return null;
  return path.basename(result.output);
}

/**
 * Get project name from git repo or current directory
 */
function getProjectName() {
  const repoName = getGitRepoName();
  if (repoName) return repoName;
  return path.basename(process.cwd()) || null;
}

/**
 * Sanitize a string for use as a session filename segment.
 * Replaces invalid characters with hyphens, collapses runs, strips
 * leading/trailing hyphens, and removes leading dots so hidden-dir names
 * like ".claude" map cleanly to "claude".
 *
 * Pure non-ASCII inputs get a stable 8-char hash so distinct names do not
 * collapse to the same fallback session id. Mixed-script inputs retain their
 * ASCII part and gain a short hash suffix for disambiguation.
 */
function sanitizeSessionId(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const hasNonAscii = Array.from(raw).some(char => char.codePointAt(0) > 0x7f);
  const normalized = raw.replace(/^\.+/, '');
  const sanitized = normalized
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (sanitized.length > 0) {
    const suffix = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 6);
    if (WINDOWS_RESERVED_SESSION_IDS.has(sanitized.toUpperCase())) {
      return `${sanitized}-${suffix}`;
    }
    if (!hasNonAscii) return sanitized;
    return `${sanitized}-${suffix}`;
  }

  const meaningful = normalized.replace(/[\s\p{P}]/gu, '');
  if (meaningful.length === 0) return null;

  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
}

/**
 * Get short session ID from CLAUDE_SESSION_ID environment variable
 * Returns last 8 characters, falls back to a sanitized project name then 'default'.
 */
function getSessionIdShort(fallback = 'default') {
  const sessionId = process.env.CLAUDE_SESSION_ID;
  if (sessionId && sessionId.length > 0) {
    const sanitized = sanitizeSessionId(sessionId.slice(-8));
    if (sanitized) return sanitized;
  }
  return sanitizeSessionId(getProjectName()) || sanitizeSessionId(fallback) || 'default';
}

/**
 * Find files matching a pattern in a directory (cross-platform alternative to find)
 * @param {string} dir - Directory to search
 * @param {string} pattern - File pattern (e.g., "*.tmp", "*.md")
 * @param {object} options - Options { maxAge: days, recursive: boolean }
 */
function findFiles(dir, pattern, options = {}) {
  if (!dir || typeof dir !== 'string') return [];
  if (!pattern || typeof pattern !== 'string') return [];

  const { maxAge = null, recursive = false } = options;
  const results = [];

  if (!fs.existsSync(dir)) {
    return results;
  }

  // Escape all regex special characters, then convert glob wildcards.
  // Order matters: escape specials first, then convert * and ? to regex equivalents.
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`);

  function searchDir(currentDir) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isFile() && regex.test(entry.name)) {
          let stats;
          try {
            stats = fs.statSync(fullPath);
          } catch {
            continue; // File deleted between readdir and stat
          }

          if (maxAge !== null) {
            const ageInDays = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
            if (ageInDays <= maxAge) {
              results.push({ path: fullPath, mtime: stats.mtimeMs });
            }
          } else {
            results.push({ path: fullPath, mtime: stats.mtimeMs });
          }
        } else if (entry.isDirectory() && recursive) {
          searchDir(fullPath);
        }
      }
    } catch (_err) {
      // Ignore permission errors
    }
  }

  searchDir(dir);

  // Sort by modification time (newest first)
  results.sort((a, b) => b.mtime - a.mtime);

  return results;
}

/**
 * Read JSON from stdin (for hook input)
 * @param {object} options - Options
 * @param {number} options.timeoutMs - Timeout in milliseconds (default: 5000).
 *   Prevents hooks from hanging indefinitely if stdin never closes.
 * @returns {Promise<object>} Parsed JSON object, or empty object if stdin is empty
 */
async function readStdinJson(options = {}) {
  const { timeoutMs = 5000, maxSize = 1024 * 1024 } = options;

  return new Promise((resolve) => {
    let data = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        // Clean up stdin listeners so the event loop can exit
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        process.stdin.removeAllListeners('error');
        if (process.stdin.unref) process.stdin.unref();
        // Resolve with whatever we have so far rather than hanging
        try {
          resolve(data.trim() ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      }
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (data.length < maxSize) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch {
        // Consistent with timeout path: resolve with empty object
        // so hooks don't crash on malformed input
        resolve({});
      }
    });

    process.stdin.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Resolve with empty object so hooks don't crash on stdin errors
      resolve({});
    });
  });
}

/**
 * Log to stderr (visible to user in Claude Code)
 */
function log(message) {
  console.error(message);
}

/**
 * Output to stdout (returned to Claude)
 */
function output(data) {
  if (typeof data === 'object') {
    console.log(JSON.stringify(data));
  } else {
    console.log(data);
  }
}

/**
 * Read a text file safely
 */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Read and parse a JSON file safely.
 * @param {string} filePath - Path to the JSON file
 * @param {*} fallback - Value returned when the file is missing or invalid
 * @returns {*} Parsed JSON value, or the fallback (default: null)
 */
function readJson(filePath, fallback = null) {
  const content = readFile(filePath);
  if (content === null) return fallback;
  try {
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

/**
 * Write a text file
 */
function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

/**
 * Serialize a value to JSON and write it to a file.
 * @param {string} filePath - Destination path
 * @param {*} data - Value to serialize
 * @param {number} indent - JSON indentation (default: 2)
 */
function writeJson(filePath, data, indent = 2) {
  writeFile(filePath, JSON.stringify(data, null, indent));
}

/**
 * Atomically write a text file by writing to a temp file in the same
 * directory, then renaming it into place. Avoids partially written files if
 * the process is interrupted mid-write (rename is atomic on the same volume).
 * @param {string} filePath - Destination path
 * @param {string} content - File contents
 */
function atomicWriteFile(filePath, content) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup of the temp file on failure
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Atomically serialize a value to JSON and write it to a file.
 * @param {string} filePath - Destination path
 * @param {*} data - Value to serialize
 * @param {number} indent - JSON indentation (default: 2)
 */
function atomicWriteJson(filePath, data, indent = 2) {
  atomicWriteFile(filePath, JSON.stringify(data, null, indent));
}

/**
 * Append to a text file
 */
function appendFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, content, 'utf8');
}

/**
 * Convert an arbitrary string into a URL/filename-safe slug.
 * Lowercases, strips diacritics, replaces non-alphanumeric runs with a single
 * hyphen, and trims leading/trailing hyphens.
 * @param {string} input - Source string
 * @returns {string} Slugified string (empty string if input is unusable)
 */
function slugify(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Check if a command exists in PATH
 * Uses spawnSync to prevent command injection
 */
function commandExists(cmd) {
  // Validate command name - only allow alphanumeric, dash, underscore, dot
  if (!/^[a-zA-Z0-9_.-]+$/.test(cmd)) {
    return false;
  }

  try {
    if (isWindows) {
      // Use spawnSync to avoid shell interpolation
      const result = spawnSync('where', [cmd], { stdio: 'pipe' });
      return result.status === 0;
    } else {
      const result = spawnSync('which', [cmd], { stdio: 'pipe' });
      return result.status === 0;
    }
  } catch {
    return false;
  }
}

/**
 * Run a command and return output
 *
 * SECURITY NOTE: This function executes shell commands. Only use with
 * trusted, hardcoded commands. Never pass user-controlled input directly.
 * For user input, use spawnSync with argument arrays instead.
 *
 * @param {string} cmd - Command to execute (should be trusted/hardcoded)
 * @param {object} options - execSync options
 */
function runCommand(cmd, options = {}) {
  // Allowlist: only permit known-safe command prefixes
  const allowedPrefixes = ['git ', 'node ', 'npx ', 'which ', 'where '];
  if (!allowedPrefixes.some(prefix => cmd.startsWith(prefix))) {
    return { success: false, output: 'runCommand blocked: unrecognized command prefix' };
  }

  // Reject shell metacharacters. $() and backticks are evaluated inside
  // double quotes, so block $ and ` anywhere in cmd. Other operators
  // (;|&) are literal inside quotes, so only check unquoted portions.
  const unquoted = cmd.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
  if (/[;|&\n]/.test(unquoted) || /[`$]/.test(cmd)) {
    return { success: false, output: 'runCommand blocked: shell metacharacters not allowed' };
  }

  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    });
    return { success: true, output: result.trim() };
  } catch (err) {
    return { success: false, output: err.stderr || err.message };
  }
}

/**
 * Check if current directory is a git repository
 */
function isGitRepo() {
  return runCommand('git rev-parse --git-dir').success;
}

/**
 * Get git modified files, optionally filtered by regex patterns
 * @param {string[]} patterns - Array of regex pattern strings to filter files.
 *   Invalid patterns are silently skipped.
 * @returns {string[]} Array of modified file paths
 */
function getGitModifiedFiles(patterns = []) {
  if (!isGitRepo()) return [];

  const result = runCommand('git diff --name-only HEAD');
  if (!result.success) return [];

  let files = result.output.split('\n').filter(Boolean);

  if (patterns.length > 0) {
    // Pre-compile patterns, skipping invalid ones
    const compiled = [];
    for (const pattern of patterns) {
      if (typeof pattern !== 'string' || pattern.length === 0) continue;
      try {
        compiled.push(new RegExp(pattern));
      } catch {
        // Skip invalid regex patterns
      }
    }
    if (compiled.length > 0) {
      files = files.filter(file => compiled.some(regex => regex.test(file)));
    }
  }

  return files;
}

/**
 * Replace text in a file (cross-platform sed alternative)
 * @param {string} filePath - Path to the file
 * @param {string|RegExp} search - Pattern to search for. String patterns replace
 *   the FIRST occurrence only; use a RegExp with the `g` flag for global replacement.
 * @param {string} replace - Replacement string
 * @param {object} options - Options
 * @param {boolean} options.all - When true and search is a string, replaces ALL
 *   occurrences (uses String.replaceAll). Ignored for RegExp patterns.
 * @returns {boolean} true if file was written, false on error
 */
function replaceInFile(filePath, search, replace, options = {}) {
  const content = readFile(filePath);
  if (content === null) return false;

  try {
    let newContent;
    if (options.all && typeof search === 'string') {
      newContent = content.replaceAll(search, replace);
    } else {
      newContent = content.replace(search, replace);
    }
    writeFile(filePath, newContent);
    return true;
  } catch (err) {
    log(`[Utils] replaceInFile failed for ${filePath}: ${err.message}`);
    return false;
  }
}

/**
 * Count occurrences of a pattern in a file
 * @param {string} filePath - Path to the file
 * @param {string|RegExp} pattern - Pattern to count. Strings are treated as
 *   global regex patterns. RegExp instances are used as-is but the global
 *   flag is enforced to ensure correct counting.
 * @returns {number} Number of matches found
 */
function countInFile(filePath, pattern) {
  const content = readFile(filePath);
  if (content === null) return 0;

  let regex;
  try {
    if (pattern instanceof RegExp) {
      // Always create new RegExp to avoid shared lastIndex state; ensure global flag
      regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    } else if (typeof pattern === 'string') {
      regex = new RegExp(pattern, 'g');
    } else {
      return 0;
    }
  } catch {
    return 0; // Invalid regex pattern
  }
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Strip all ANSI escape sequences from a string.
 *
 * Handles:
 * - CSI sequences: \x1b[ … <letter>  (colors, cursor movement, erase, etc.)
 * - OSC sequences: \x1b] … BEL/ST    (window titles, hyperlinks)
 * - Charset selection: \x1b(B
 * - Bare ESC + single letter: \x1b <letter>  (e.g. \x1bM for reverse index)
 *
 * @param {string} str - Input string possibly containing ANSI codes
 * @returns {string} Cleaned string with all escape sequences removed
 */
function stripAnsi(str) {
  if (typeof str !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\([A-Z]|[A-Z])/g, '');
}

/**
 * Search for pattern in file and return matching lines with line numbers
 */
function grepFile(filePath, pattern) {
  const content = readFile(filePath);
  if (content === null) return [];

  let regex;
  try {
    if (pattern instanceof RegExp) {
      // Always create a new RegExp without the 'g' flag to prevent lastIndex
      // state issues when using .test() in a loop (g flag makes .test() stateful,
      // causing alternating match/miss on consecutive matching lines)
      const flags = pattern.flags.replace('g', '');
      regex = new RegExp(pattern.source, flags);
    } else {
      regex = new RegExp(pattern);
    }
  } catch {
    return []; // Invalid regex pattern
  }
  const lines = content.split('\n');
  const results = [];

  lines.forEach((line, index) => {
    if (regex.test(line)) {
      results.push({ lineNumber: index + 1, content: line });
    }
  });

  return results;
}

module.exports = {
  // Platform info
  isWindows,
  isMacOS,
  isLinux,

  // Directories
  getHomeDir,
  getAgentDataHome,
  getClaudeDir,
  getSessionsDir,
  getLegacySessionsDir,
  getSessionSearchDirs,
  getLearnedSkillsDir,
  getTempDir,
  ensureDir,

  // Date/Time
  getDateString,
  getTimeString,
  getDateTimeString,

  // Session/Project
  sanitizeSessionId,
  getSessionIdShort,
  getGitRepoName,
  getProjectName,

  // File operations
  findFiles,
  readFile,
  readJson,
  writeFile,
  writeJson,
  atomicWriteFile,
  atomicWriteJson,
  appendFile,
  replaceInFile,
  countInFile,
  grepFile,

  // String helpers
  stripAnsi,
  slugify,

  // Hook I/O
  readStdinJson,
  log,
  output,

  // System
  commandExists,
  runCommand,
  isGitRepo,
  getGitModifiedFiles
};
