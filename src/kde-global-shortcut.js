'use strict';

// Best-effort runtime global shortcut registration for KDE Plasma (X11 and
// Wayland) via the org.kde.kglobalaccel D-Bus service. Electron's own
// globalShortcut API cannot grab hotkeys on Wayland, so when it fails we ask
// KWin to route a shortcut to us instead.
//
// The registration is session-scoped (flag 2 = NoAutoloading): it exists only
// while this process runs and is not written into the user's KDE config. This
// is intended for `npm start`-style usage.
//
// This module is a no-op on non-Linux platforms, when `gdbus` is unavailable,
// or when the kglobalaccel service is not on the session bus. Every failure is
// swallowed and reported via the returned result so the caller can fall back.

const { spawn, execFile } = require('node:child_process');

const SERVICE = 'org.kde.kglobalaccel';
const KGA_PATH = '/kglobalaccel';
const KGA_IFACE = 'org.kde.KGlobalAccel';

// Qt key encodings: Key value OR'd with modifier flags.
// ControlModifier = 0x04000000, ShiftModifier = 0x02000000.
const QT_KEYS = {
  'CommandOrControl+,': 0x2c | 0x04000000, // 67108908
  'CommandOrControl+Shift+Space': 0x20 | 0x04000000 | 0x02000000 // 100663328
};

function gdbusCall(args) {
  return new Promise((resolve) => {
    execFile('gdbus', args, { timeout: 4000 }, (error, stdout) => {
      if (error) resolve({ ok: false, error });
      else resolve({ ok: true, stdout: String(stdout) });
    });
  });
}

async function serviceAvailable() {
  const result = await gdbusCall([
    'call', '--session',
    '--dest', 'org.freedesktop.DBus',
    '--object-path', '/org/freedesktop/DBus',
    '--method', 'org.freedesktop.DBus.NameHasOwner', SERVICE
  ]);
  return result.ok && result.stdout.includes('true');
}

// actionId is the 4-string identifier KDE uses: [component, componentFriendly,
// uniqueActionName, actionFriendly]. The component unique name determines the
// /component/<name> object path that emits globalShortcutPressed.
function buildActionId(component, action) {
  return [component, 'UniFind', action, `UniFind ${action}`];
}

function asStringArray(values) {
  return `['${values.map((value) => value.replace(/'/g, "\\'")).join("', '")}']`;
}

async function doRegister(actionId) {
  return gdbusCall([
    'call', '--session', '--dest', SERVICE,
    '--object-path', KGA_PATH,
    '--method', `${KGA_IFACE}.doRegister`,
    asStringArray(actionId)
  ]);
}

async function setShortcutKeys(actionId, qtKey) {
  // setShortcut(actionId: as, keys: ai, flags: u). flags=2 => NoAutoloading,
  // which registers for this session without persisting to disk. Passing no
  // key clears the binding (used during teardown).
  const keys = qtKey === undefined ? '[]' : `[${qtKey}]`;
  return gdbusCall([
    'call', '--session', '--dest', SERVICE,
    '--object-path', KGA_PATH,
    '--method', `${KGA_IFACE}.setShortcut`,
    asStringArray(actionId),
    keys,
    '2'
  ]);
}

async function unregister(actionId) {
  // Clearing the keys and unregistering releases the grab in KWin.
  await setShortcutKeys(actionId, undefined).catch(() => {});
  await gdbusCall([
    'call', '--session', '--dest', SERVICE,
    '--object-path', KGA_PATH,
    '--method', `${KGA_IFACE}.unRegister`,
    asStringArray(actionId)
  ]).catch(() => {});
}

// Listens for the component's globalShortcutPressed signal via a long-lived
// `gdbus monitor`. Returns the child process so it can be killed on cleanup.
function monitorPresses(component, onPress) {
  const componentPath = `/component/${component}`;
  const monitor = spawn('gdbus', [
    'monitor', '--session',
    '--dest', SERVICE,
    '--object-path', componentPath
  ], { stdio: ['ignore', 'pipe', 'ignore'] });

  monitor.stdout.setEncoding('utf8');
  monitor.stdout.on('data', (chunk) => {
    if (chunk.includes('globalShortcutPressed')) onPress();
  });
  monitor.on('error', () => {});
  return monitor;
}

/**
 * Attempt to register a KDE global shortcut that invokes `onToggle` when
 * pressed. Returns { ok, shortcut, dispose } where dispose() tears everything
 * down. Safe to call on any platform; resolves to { ok: false } when the
 * mechanism is unavailable.
 */
async function registerKdeGlobalShortcut({ shortcuts, component = 'unifind', onToggle }) {
  if (process.platform !== 'linux') return { ok: false, reason: 'not-linux' };

  const desktop = `${process.env.XDG_CURRENT_DESKTOP || ''} ${process.env.DESKTOP_SESSION || ''}`;
  if (!/kde|plasma/i.test(desktop)) return { ok: false, reason: 'not-kde' };

  if (!(await serviceAvailable())) return { ok: false, reason: 'no-kglobalaccel' };

  for (const shortcut of shortcuts) {
    const qtKey = QT_KEYS[shortcut];
    if (qtKey === undefined) continue;

    const actionId = buildActionId(component, 'Toggle');
    const registered = await doRegister(actionId);
    if (!registered.ok) continue;

    const bound = await setShortcutKeys(actionId, qtKey);
    if (!bound.ok) {
      await unregister(actionId);
      continue;
    }

    // Confirm KWin accepted our requested key rather than silently assigning a
    // different one (which happens when the combo is already taken).
    const confirmed = await gdbusCall([
      'call', '--session', '--dest', SERVICE,
      '--object-path', KGA_PATH,
      '--method', `${KGA_IFACE}.shortcut`,
      asStringArray(actionId)
    ]);
    if (!confirmed.ok || !confirmed.stdout.includes(String(qtKey))) {
      await unregister(actionId);
      continue;
    }

    const monitor = monitorPresses(component, onToggle);
    return {
      ok: true,
      shortcut,
      dispose: async () => {
        try { monitor.kill(); } catch { /* ignore */ }
        await unregister(actionId);
      }
    };
  }

  return { ok: false, reason: 'registration-failed' };
}

module.exports = { registerKdeGlobalShortcut };
