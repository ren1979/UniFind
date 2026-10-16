# UniFind

UniFind is a keyboard-first Unicode character picker for Windows, with
best-effort Linux support. Press **Ctrl+,**, search by a Unicode name, alias,
block, literal character, or code point, then press **Enter** to insert it into
the application you were using.

Examples: `right arrow`, `greek pi`, `currency`, `U+2192`, or `→`.

## Current MVP

- Global **Ctrl+,** shortcut with **Ctrl+Shift+Space** as a fallback when the
  preferred shortcut is already owned by another application.
- Fast offline search across the Unicode Character Database.
- Keyboard navigation, recent characters, and favorites.
- Automatic paste on Windows; the selected character also remains on the
  clipboard.
- Clipboard-first fallback on Linux. Automatic paste tries `wtype` on Wayland
  or `xdotool` on X11, then falls back to `ydotool` (which works on both,
  including KDE Plasma Wayland). See [Linux auto-paste](#linux-auto-paste).
- Dark and light themes that follow the system preference.
- Tray menu and optional start-at-login on Windows.

## Development

Requirements: Node.js 24 or newer.

```powershell
npm install
npm run data:build
npm test
npm start
```

## Windows downloads

- [`UniFind Setup 0.1.0.exe`](dist/UniFind%20Setup%200.1.0.exe) — Windows
  installer.
- [`UniFind 0.1.0.exe`](dist/UniFind%200.1.0.exe) — portable build; no
  installation required.
- [`SHA256SUMS.txt`](dist/SHA256SUMS.txt) — checksums for both downloads.

The executables are stored with Git LFS. Install Git LFS before cloning if you
want Git to retrieve the binaries automatically.

The checked-in `src/data/characters.json` is generated from Unicode 18.0.0.
To rebuild it from the official source files:

```powershell
$env:UCD_VERSION = '18.0.0'
npm run data:build
```

## Build installers

```powershell
npm run dist:win
```

Linux packages can be built on Linux with `npm run dist:linux`.

## Platform notes

- Windows cannot send keystrokes from a normal process into an elevated
  administrator process. In that case UniFind still copies the character.
- On Linux, global shortcuts and window focus depend on the desktop compositor.
  Modern Electron uses the desktop portal on Wayland; X11 is the most broadly
  compatible path today.
- Some Unicode characters need an appropriate font to display their glyph.

### Linux auto-paste

Without a helper tool, UniFind copies the selected character to the clipboard
and you paste it manually with **Ctrl+V**. For automatic insertion, install one
of the following keystroke tools. UniFind picks the first one that works:

| Session | Preferred | Universal fallback |
| --- | --- | --- |
| X11 | `xdotool` | `ydotool` |
| Wayland (GNOME, wlroots) | `wtype` | `ydotool` |
| Wayland (KDE Plasma) | `ydotool` | — |

On **KDE Plasma Wayland**, `wtype` does not work because KWin does not implement
the virtual-keyboard protocol it relies on. Use `ydotool` instead.

#### Installing ydotool

Install both the client and its daemon from your distribution:

```bash
# Arch / Manjaro
sudo pacman -S ydotool
# Fedora
sudo dnf install ydotool
# Debian / Ubuntu
sudo apt install ydotool
```

`ydotool` injects input through the kernel `uinput` device, so the `ydotoold`
daemon must be running and your user needs read/write access to `/dev/uinput`.

Start the daemon:

```bash
ydotoold
```

If it reports `READY`, you are set. If `ydotool` later complains it cannot reach
the daemon, export the socket path the daemon printed, for example:

```bash
export YDOTOOL_SOCKET=/run/user/$(id -u)/.ydotool_socket
```

To run the daemon without root, grant your user access to `/dev/uinput` with a
udev rule (create `/etc/udev/rules.d/80-uinput.rules`):

```
KERNEL=="uinput", GROUP="input", MODE="0660", OPTIONS+="static_node=uinput"
```

Add yourself to the `input` group (`sudo usermod -aG input "$USER"`), then log
out and back in. Alternatively, run `ydotoold` as root.

#### Starting ydotoold with systemd

Running `ydotoold` by hand does not persist across reboots. On systems with
systemd you can run it as a user service so it starts at login and restarts if
it exits. This needs no root as long as your user can access `/dev/uinput` (see
the udev rule above).

Create `~/.config/systemd/user/ydotoold.service`:

```ini
[Unit]
Description=ydotoold user daemon (virtual input for UniFind auto-paste)

[Service]
Type=simple
Restart=always
RestartSec=1
Environment=YDOTOOL_SOCKET=%t/.ydotool_socket
ExecStart=/usr/bin/ydotoold --socket-path=%t/.ydotool_socket
ExecReload=/usr/bin/kill -HUP $MAINPID
KillMode=process
TimeoutSec=180

[Install]
WantedBy=default.target
```

`%t` expands to the user runtime directory (for example `/run/user/1000`), so
the daemon and `ydotool` clients share the same socket path. Enable and start
it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ydotoold.service
systemctl --user status ydotoold.service
```

The service runs for the duration of your graphical login and stops at logout.
If you want it to run even when you are not logged in, enable lingering with
`sudo loginctl enable-linger "$USER"`.

Some distributions also ship a system-wide `ydotool.service` (running as root).
Using the user service above instead keeps the socket owned by your user, which
avoids socket-permission issues for `ydotool` clients.

## Search data

The data generator reads `UnicodeData.txt`, `Blocks.txt`, and `NameAliases.txt`
from the Unicode Character Database. Algorithmic ranges such as Hangul syllables
and CJK ideographs are expanded so direct code-point searches work offline.
