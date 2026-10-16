'use strict';

// Shared execution and detection helpers used by the insert orchestrator.
// Backends themselves are declarative (see backend-*.js); all process spawning
// lives here so the behaviour is defined in one place.

const { spawn, execFile } = require('node:child_process');

// Runs a short-lived keystroke tool and waits for it to exit. Resolves true
// only on a clean exit (code 0). This lets a tool that launches but then fails
// -- e.g. wtype on KWin, which exits non-zero because KWin does not implement
// the virtual keyboard protocol -- be treated as a failure so callers can fall
// through to the next backend. If the tool is still running after timeoutMs it
// is assumed to be a long-lived success and left to continue detached.
function runAndCheck(command, args, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      try { child.unref(); } catch { /* ignore */ }
      done(true);
    }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); done(false); });
    child.once('exit', (code) => { clearTimeout(timer); done(code === 0); });
  });
}

// Spawns a tool detached and resolves true as soon as it launches. Used on
// Windows/macOS where the paste helper holds briefly (SendKeys / osascript)
// and we do not want to block on it.
function spawnDetached(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      windowsHide: true,
      stdio: 'ignore'
    });
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

// Cache of resolved binary availability so we only probe PATH once per tool.
const binaryCache = new Map();

function hasBinary(command) {
  if (binaryCache.has(command)) return binaryCache.get(command);
  const probe = new Promise((resolve) => {
    // `command -v` is a shell builtin, so run it through the shell on POSIX.
    const child = process.platform === 'win32'
      ? execFile('where', [command], () => {})
      : execFile('sh', ['-c', `command -v ${command}`], () => {});
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
  binaryCache.set(command, probe);
  return probe;
}

module.exports = { runAndCheck, spawnDetached, hasBinary };
