'use strict';

// macOS paste via osascript driving System Events to press Cmd+V. The short
// delay lets focus return to the previously active application first.
module.exports = {
  name: 'osascript',
  bin: 'osascript',
  platforms: ['darwin'],
  session: 'any',
  priority: 10,
  buildArgs: () => [
    '-e', 'delay 0.09',
    '-e', 'tell application "System Events" to keystroke "v" using command down'
  ]
};
