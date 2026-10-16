'use strict';

// Windows paste via PowerShell + System.Windows.Forms SendKeys. The brief sleep
// lets focus settle on the previously active window before Ctrl+V is sent.
const SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  'Start-Sleep -Milliseconds 90',
  '[System.Windows.Forms.SendKeys]::SendWait("^v")'
].join('; ');

module.exports = {
  name: 'powershell',
  bin: 'powershell.exe',
  platforms: ['win32'],
  session: 'any',
  priority: 10,
  buildArgs: () => [
    '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-Command', SCRIPT
  ]
};
