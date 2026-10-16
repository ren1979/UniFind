'use strict';

// wtype sends keystrokes via the virtual-keyboard-unstable-v1 Wayland protocol.
// Works on wlroots-based and GNOME compositors; does NOT work on KDE/KWin,
// which has not implemented that protocol. On KDE it is installed-but-failing,
// so the orchestrator tries it first then falls through to ydotool.
module.exports = {
  name: 'wtype',
  bin: 'wtype',
  platforms: ['linux'],
  session: 'wayland',
  priority: 10,
  buildArgs: () => ['-M', 'ctrl', 'v', '-m', 'ctrl']
};
