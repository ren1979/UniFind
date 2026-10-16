'use strict';

// Insert orchestrator. "Insert" is the general concept of placing the chosen
// character into the previously focused application; the mechanism underneath
// is a clipboard write plus a paste keystroke sent by one of several tools.
//
// This loads the declarative backend definitions, selects the ones that apply
// to the current platform/session, orders them by priority, detects which are
// installed, and runs them with fall-through.
//
// Adding a new insert tool is a matter of dropping a backend-*.js file into
// this directory and listing it in BACKENDS below.

const { runAndCheck, spawnDetached, hasBinary } = require('./runner');

const BACKENDS = [
  require('./backend-wtype'),
  require('./backend-xdotool'),
  require('./backend-ydotool'),
  require('./backend-powershell'),
  require('./backend-osascript')
];

function currentSession() {
  if (process.platform !== 'linux') return 'any';
  const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY);
  return wayland ? 'wayland' : 'x11';
}

// Backends that apply to the current platform and session, ordered by priority
// (lower first). Session-native tools come before the universal fallback.
function applicableBackends() {
  const platform = process.platform;
  const session = currentSession();
  return BACKENDS
    .filter((backend) => backend.platforms.includes(platform))
    .filter((backend) => backend.session === 'any' || backend.session === session)
    .sort((a, b) => a.priority - b.priority);
}

// Resolves the applicable backends whose binaries are installed, in order.
// On Windows/macOS the interpreter is assumed present (no probe).
async function availableBackends() {
  const needsProbe = process.platform === 'linux';
  const available = [];
  for (const backend of applicableBackends()) {
    if (needsProbe && !(await hasBinary(backend.bin))) continue;
    available.push(backend);
  }
  return available;
}

// Executes a single backend. On Linux we wait for the exit status so a runtime
// failure can fall through; elsewhere we fire-and-forget.
function runBackend(backend) {
  const args = backend.buildArgs();
  return process.platform === 'linux'
    ? runAndCheck(backend.bin, args)
    : spawnDetached(backend.bin, args);
}

/**
 * Attempts to insert using the first available backend that succeeds. The
 * caller must hide its window beforehand so focus returns to the target
 * application. The underlying mechanism is a paste keystroke, so the result
 * reports whether that paste actually happened. Returns:
 *   { pasted: true, backend }                          on success
 *   { pasted: false, installed: false, reason }        when no tool is installed
 *   { pasted: false, installed: true, tried, reason }  when tools ran but failed
 */
async function attemptInsert() {
  const available = await availableBackends();
  if (available.length === 0) {
    return {
      pasted: false,
      installed: false,
      reason: 'No insert tool installed. On KDE Wayland, install ydotool for auto-insert.'
    };
  }

  const failed = [];
  for (const backend of available) {
    if (await runBackend(backend)) {
      return { pasted: true, backend: backend.name };
    }
    failed.push(backend.name);
  }

  return {
    pasted: false,
    installed: true,
    tried: failed,
    reason: `Insert tools failed (${failed.join(', ')}). Character is on the clipboard.`
  };
}

/**
 * Describes the detected auto-insert mechanism for startup logging.
 * Returns { level: 'log' | 'warn', message }.
 */
async function describeInsertMechanism() {
  const available = await availableBackends();
  if (available.length === 0) {
    return {
      level: 'warn',
      message: 'UniFind: no auto-insert tool detected; insert will copy to the clipboard '
        + 'only. Install wtype, xdotool, or ydotool for automatic insertion.'
    };
  }

  const names = available.map((backend) => backend.name);
  return {
    level: 'log',
    message: `UniFind: auto-insert will use "${names[0]}"`
      + (names.length > 1 ? ` (fallbacks: ${names.slice(1).join(', ')}).` : '.')
  };
}

module.exports = {
  applicableBackends,
  availableBackends,
  attemptInsert,
  describeInsertMechanism
};
