const path = require('node:path');
const { writeFile } = require('node:fs/promises');
const { registerKdeGlobalShortcut } = require('./kde-global-shortcut');
const { attemptInsert, availableBackends, describeInsertMechanism } = require('./insert');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen
} = require('electron');

const PRIMARY_SHORTCUT = 'CommandOrControl+,';
const FALLBACK_SHORTCUT = 'CommandOrControl+Shift+Space';
const POPUP_WIDTH = 780;
const POPUP_HEIGHT = 580;

let mainWindow;
let tray;
let isQuitting = false;
let activeShortcut = null;
let disposeKdeShortcut = null;
const captureArgument = process.argv.find((argument) => argument.startsWith('--capture-ui='));
const capturePath = captureArgument ? captureArgument.slice('--capture-ui='.length) : null;
if (capturePath) activeShortcut = PRIMARY_SHORTCUT;

app.setName('UniFind');
if (process.platform === 'linux') app.setDesktopName('unifind.desktop');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#11131a',
    icon: appIconPath(),
    title: 'UniFind',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !capturePath
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenu(null);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('blur', () => {
    if (!capturePath && !mainWindow.webContents.isDevToolsOpened()) mainWindow.hide();
  });
}

function appIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png');
}

async function captureUiAndQuit() {
  mainWindow.showInactive();
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const isReady = await mainWindow.webContents.executeJavaScript(
      'document.documentElement.dataset.resultsReady === "true"'
    );
    if (isReady) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const image = await mainWindow.webContents.capturePage();
  await writeFile(capturePath, image.toPNG());
  isQuitting = true;
  app.quit();
}

function popupPosition() {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  return {
    x: Math.round(workArea.x + (workArea.width - POPUP_WIDTH) / 2),
    y: Math.round(workArea.y + Math.max(32, (workArea.height - POPUP_HEIGHT) * 0.27))
  };
}

function showPopup() {
  if (!mainWindow) return;
  const position = popupPosition();
  mainWindow.setPosition(position.x, position.y, false);
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
  mainWindow.webContents.send('popup:shown', appStatus());
}

function togglePopup() {
  if (mainWindow?.isVisible()) mainWindow.hide();
  else showPopup();
}

function isWaylandSession() {
  return process.platform === 'linux' && (
    process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY)
  );
}

async function registerShortcut() {
  // On Wayland, Electron's globalShortcut.register() frequently returns true
  // while the shortcut never actually fires, because the compositor does not
  // grant X11-style key grabs. Don't trust it there; go straight to the KDE
  // D-Bus path, which routes the real keypress through KWin.
  if (!isWaylandSession()) {
    if (globalShortcut.register(PRIMARY_SHORTCUT, togglePopup)) {
      activeShortcut = PRIMARY_SHORTCUT;
      console.log(`UniFind: registered "${PRIMARY_SHORTCUT}" via Electron.`);
      return;
    }

    if (globalShortcut.register(FALLBACK_SHORTCUT, togglePopup)) {
      activeShortcut = FALLBACK_SHORTCUT;
      console.warn(
        `UniFind: "${PRIMARY_SHORTCUT}" could not be registered; using fallback "${FALLBACK_SHORTCUT}".`
      );
      return;
    }
  } else {
    console.log('UniFind: Wayland session detected; using KDE kglobalaccel for the global shortcut.');
  }

  // KDE Plasma: register a session-scoped shortcut through KWin over D-Bus.
  const kde = await registerKdeGlobalShortcut({
    shortcuts: [PRIMARY_SHORTCUT, FALLBACK_SHORTCUT],
    onToggle: () => togglePopup()
  }).catch((error) => ({ ok: false, reason: `exception: ${error.message}` }));

  if (kde.ok) {
    activeShortcut = kde.shortcut;
    disposeKdeShortcut = kde.dispose;
    console.log(`UniFind: registered "${kde.shortcut}" via KDE kglobalaccel (session only).`);
    return;
  }

  console.warn(
    `UniFind: no global shortcut could be registered (KDE path: ${kde.reason}). ` +
      'Bind a desktop custom shortcut to launch UniFind instead, which will toggle the window.'
  );
}

function appStatus() {
  return {
    activeShortcut,
    requestedShortcut: PRIMARY_SHORTCUT,
    shortcutRegistered: Boolean(activeShortcut),
    platform: process.platform,
    insertSupport: process.platform === 'win32' ? 'native' : 'best-effort'
  };
}

function createTrayImage() {
  return nativeImage.createFromPath(appIconPath()).resize({
    width: process.platform === 'darwin' ? 22 : 32,
    height: process.platform === 'darwin' ? 22 : 32,
    quality: 'best'
  });
}

function rebuildTrayMenu() {
  if (!tray) return;
  const shortcutLabel = activeShortcut
    ? `Shortcut: ${activeShortcut.replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl')}`
    : 'Shortcut unavailable';
  const menu = [
    { label: 'Open UniFind', click: showPopup },
    { label: shortcutLabel, enabled: false },
    { type: 'separator' }
  ];

  if (process.platform === 'win32' || process.platform === 'darwin') {
    const loginSettings = app.getLoginItemSettings();
    menu.push({
      label: 'Start at login',
      type: 'checkbox',
      checked: loginSettings.openAtLogin,
      click: ({ checked }) => app.setLoginItemSettings({ openAtLogin: checked })
    });
    menu.push({ type: 'separator' });
  }

  menu.push({
    label: 'Quit UniFind',
    click: () => {
      isQuitting = true;
      app.quit();
    }
  });

  tray.setContextMenu(Menu.buildFromTemplate(menu));
}

function createTray() {
  tray = new Tray(createTrayImage());
  tray.setToolTip('UniFind — Unicode character picker');
  tray.on('click', togglePopup);
  rebuildTrayMenu();
}

function logInsertMechanism() {
  return describeInsertMechanism()
    .then(({ level, message }) => (level === 'warn' ? console.warn(message) : console.log(message)))
    .catch((error) => console.error(error));
}

function isValidCharacter(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 32;
}

ipcMain.handle('character:choose', async (_event, payload) => {
  if (!payload || !isValidCharacter(payload.character)) {
    return { ok: false, error: 'Invalid character selection.' };
  }

  await clipboard.writeText(payload.character);
  if (!payload.insert) return { ok: true, mode: 'copied' };

  // Check whether any insert tool is installed before hiding. If none is, keep
  // the window visible so the renderer can tell the user to paste manually.
  if ((await availableBackends()).length === 0) {
    const reason = 'No insert tool installed. On KDE Wayland, install ydotool for auto-insert.';
    console.warn(`UniFind: auto-insert unavailable; character copied to clipboard. ${reason}`);
    return { ok: true, mode: 'copied', reason };
  }

  // Hide first so keyboard focus returns to the previously active window before
  // the paste keystroke is delivered, then attempt the insert.
  mainWindow.hide();
  const result = await attemptInsert();
  if (result.pasted) return { ok: true, mode: 'pasted', backend: result.backend };

  console.warn(`UniFind: ${result.reason}`);
  return { ok: true, mode: 'copied', reason: result.reason };
});

ipcMain.on('popup:hide', () => mainWindow?.hide());
ipcMain.handle('app:status', () => appStatus());

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('io.github.unifind.Unifind');
  createWindow();

  if (capturePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      captureUiAndQuit().catch((error) => {
        console.error(error);
        isQuitting = true;
        app.exit(1);
      });
    });
    return;
  }

  registerShortcut().then(rebuildTrayMenu).catch((error) => console.error(error));
  logInsertMechanism().catch((error) => console.error(error));
  createTray();

  if (!process.argv.includes('--hidden')) {
    mainWindow.once('ready-to-show', showPopup);
  }
});

app.on('second-instance', togglePopup);
app.on('activate', showPopup);
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', (event) => {
  globalShortcut.unregisterAll();
  if (!disposeKdeShortcut) return;
  const dispose = disposeKdeShortcut;
  disposeKdeShortcut = null;
  event.preventDefault();
  Promise.resolve(dispose())
    .catch(() => {})
    .finally(() => app.quit());
});
app.on('window-all-closed', () => {
  // UniFind lives in the tray until explicitly quit.
});
