'use strict';

// ydotool injects input through the kernel uinput device, independent of the
// display server, so it works on both X11 and Wayland (including KDE Plasma,
// where wtype cannot). It needs the ydotoold daemon running and access to
// /dev/uinput. Used as the universal fallback on Linux, hence the lower
// priority than the session-native tools.
//
// Keycodes: 29 = Left Ctrl, 47 = V (Linux input event codes). The ":1"/":0"
// suffixes are key-down / key-up.
module.exports = {
  name: 'ydotool',
  bin: 'ydotool',
  platforms: ['linux'],
  session: 'any',
  priority: 100,
  buildArgs: () => ['key', '29:1', '47:1', '47:0', '29:0']
};
