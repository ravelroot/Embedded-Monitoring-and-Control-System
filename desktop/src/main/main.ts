import { join } from 'node:path';

import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron';

import { DeviceManager } from './device/manager';
import { AppController } from './ipc';
import { Database } from './storage/database';

const ALLOWED_PERMISSIONS = new Set(['notifications']);

let mainWindow: BrowserWindow | null = null;
let controller: AppController | null = null;
let manager: DeviceManager | null = null;
let database: Database | null = null;
let maintenance: NodeJS.Timeout[] = [];

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: 'Malha',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#f5f4f4',
    icon: join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\//.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  void window.loadFile(join(__dirname, 'renderer', 'index.html'));
  return window;
}

async function start(): Promise<void> {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission));
  const userData = app.getPath('userData');
  database = new Database(join(userData, 'malha.db'));
  manager = new DeviceManager({
    wasmPath: join(__dirname, 'firmware-core.wasm'),
    simulatorNvsPath: join(userData, 'simulador-nvs.bin'),
  });
  controller = new AppController(manager, database);
  controller.register();
  mainWindow = createWindow();
  controller.attach(mainWindow);
  const settings = controller.currentSettings();
  database.prune(settings.retentionDays);
  maintenance = [
    setInterval(() => database?.flush(), 1000),
    setInterval(() => database?.prune(controller?.currentSettings().retentionDays ?? 30), 3_600_000),
  ];
  if (settings.autoConnect && settings.lastTarget) {
    void manager.connect(settings.lastTarget);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.ravelroot.malha');
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault());
  });
  app.whenReady().then(start).catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) {
      return;
    }
    quitting = true;
    event.preventDefault();
    for (const timer of maintenance) {
      clearInterval(timer);
    }
    void (manager?.disconnect('Aplicativo fechado.') ?? Promise.resolve())
      .catch(() => undefined)
      .finally(() => {
        database?.close();
        app.quit();
      });
  });
}
