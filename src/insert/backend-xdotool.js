'use strict';

// xdotool injects input through the X11 XTEST extension. X11 sessions only.
module.exports = {
  name: 'xdotool',
  bin: 'xdotool',
  platforms: ['linux'],
  session: 'x11',
  priority: 10,
  buildArgs: () => ['key', '--clearmodifiers', 'ctrl+v']
};
