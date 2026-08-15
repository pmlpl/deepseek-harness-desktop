'use strict';

/*
 * DeepSeek Harness - Desktop wrapper
 *
 * Launches the @deepseek-ai/dsh "web" profile (the same GUI served by
 * "npx @deepseek-ai/dsh web") as a child process, waits for it to come up,
 * then shows it inside a native Electron window. Closing the window stops
 * the server.
 *
 * The dsh server is a Node.js program with native modules (sharp, node-pty,
 * node-addon-*). Those are compiled against the *system* Node ABI, not
 * Electron's, so we run the server with the system Node binary instead of
 * Electron's embedded runtime.
 */

const { app, BrowserWindow, shell, dialog, Menu, ipcMain } = require('electron');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const APP_NAME = 'DeepSeek Harness';
const APP_ID = 'com.deepseek.harness.desktop';
const START_TIMEOUT_MS = 90 * 1000;

let serverProc = null;
let mainWindow = null;
let splashWindow = null;
let serverUrl = null;
let quitting = false;

function logFile() {
  try { return path.join(app.getPath('userData'), 'server.log'); }
  catch { return path.join(require('os').tmpdir(), 'deepseek-harness-desktop.log'); }
}
function log(msg) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
    fs.appendFileSync(logFile(), '[' + new Date().toISOString() + '] ' + msg + '\n');
  } catch { /* ignore */ }
}

function findNodeBinary() {
  const candidates = [
    process.env.DSH_NODE_BINARY,
    process.env.NODE_BINARY,
    (app.isPackaged ? path.join(process.resourcesPath, 'runtime', 'node.exe') : null),
    'C:\\nvm4w\\nodejs\\node.exe',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'nodejs', 'node.exe') : null,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
    path.join(process.env.APPDATA || '', 'nvm', 'current', 'node.exe'),
  ].filter(Boolean);

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }

  try {
    const r = spawnSync('where', ['node'], { encoding: 'utf8', windowsHide: true });
    const first = (r.stdout || '').trim().split(/\r?\n/)[0];
    if (first && fs.existsSync(first)) return first;
  } catch { /* ignore */ }

  return null;
}

function findDshBin() {
  return path.join(__dirname, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
}

function createSplash() {
  try {
    splashWindow = new BrowserWindow({
      width: 420,
      height: 360,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      center: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        spellcheck: false,
      },
    });
    splashWindow.setMenuBarVisibility(false);
    splashWindow.once('ready-to-show', () => { if (!quitting && splashWindow) splashWindow.show(); });
    splashWindow.on('closed', () => { splashWindow = null; });
    splashWindow.loadFile(path.join(__dirname, 'splash.html')).catch(() => {});
  } catch {
    splashWindow = null;
  }
}

function setSplashStatus(text) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  try {
    splashWindow.webContents.executeJavaScript(
      'window.__splash && window.__splash.setStatus(' + JSON.stringify(String(text)) + ')'
    ).catch(() => {});
  } catch { /* ignore */ }
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    const w = splashWindow;
    splashWindow = null;
    try { w.destroy(); } catch { /* ignore */ }
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const node = findNodeBinary();
    if (!node) {
      reject(new Error(
        'Node.js was not found on this computer.\n\n' +
        'The desktop app runs DeepSeek Harness with the system Node.js. ' +
        'Please install Node.js v20+ (https://nodejs.org) and try again.'
      ));
      return;
    }
    const bin = findDshBin();
    if (!fs.existsSync(bin)) {
      reject(new Error('dsh CLI not found at: ' + bin));
      return;
    }

    log('node: ' + node);
    log('dsh : ' + bin);

    serverProc = spawn(node, [bin, 'web', '--port', '0'], {
      cwd: app.getPath('userData'),
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let buffer = '';
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    const onChunk = (data) => {
      const text = String(data);
      buffer += text;
      log('[server] ' + text.trim());
      const m = buffer.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+)/);
      if (m) done(resolve, m[1]);
    };

    serverProc.stdout.on('data', onChunk);
    serverProc.stderr.on('data', onChunk);
    serverProc.on('error', (err) => done(reject, err));
    serverProc.on('exit', (code) => {
      if (!settled) done(reject, new Error('dsh server exited early with code ' + code + '. See ' + logFile()));
    });

    setTimeout(() => done(reject, new Error('Timed out waiting for dsh web to start. See ' + logFile())), START_TIMEOUT_MS);
  });
}

function waitForHttp(url, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.setTimeout(1500, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) return reject(new Error('HTTP readiness timeout for ' + url));
      setTimeout(poll, 250);
    };
    poll();
  });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//i.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      const target = new URL(targetUrl);
      const current = new URL(url);
      if (target.origin !== current.origin) {
        event.preventDefault();
        shell.openExternal(targetUrl);
      }
    } catch { /* let electron decide */ }
  });

  mainWindow.once('ready-to-show', () => { if (!quitting) { mainWindow.show(); closeSplash(); } });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadURL(url).catch((err) => log('loadURL failed: ' + (err && err.message ? err.message : err)));
}

function stopServer() {
  if (!serverProc) return;
  const p = serverProc;
  serverProc = null;
  try { p.kill(); } catch { /* ignore */ }
}

function showError(message) {
  try { dialog.showErrorBox(APP_NAME, message + '\n\nLog file:\n' + logFile()); }
  catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Auto-update (electron-updater, GitHub provider)                     */
/* ------------------------------------------------------------------ */
let updater = null;
let updateVersion = null;

function sendUpdate(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', payload);
  }
}

function initUpdater() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    updater = autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
    autoUpdater.on('update-available', (info) => { updateVersion = info && info.version; sendUpdate({ state: 'available', version: updateVersion }); });
    autoUpdater.on('update-not-available', () => sendUpdate({ state: 'uptodate' }));
    autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: p ? Math.round(p.percent) : null, version: updateVersion }));
    autoUpdater.on('update-downloaded', (info) => { updateVersion = info && info.version; sendUpdate({ state: 'downloaded', version: updateVersion }); });
    autoUpdater.on('error', (err) => { log('updater error: ' + (err && err.message)); sendUpdate({ state: 'error', message: err && err.message }); });

    ipcMain.on('update:check', () => { if (updater) updater.checkForUpdates().catch((e) => log('update check failed: ' + e.message)); });
    ipcMain.on('update:download', () => { if (updater) updater.downloadUpdate().catch((e) => log('update download failed: ' + e.message)); });
    ipcMain.on('update:install', () => { if (updater) { try { updater.quitAndInstall(false, true); } catch (e) { log('quitAndInstall failed: ' + e.message); } } });

    // Optional forced preview (for testing the indicator UI without a real release)
    if (process.env.DSH_FORCE_UPDATE) {
      const v = typeof process.env.DSH_FORCE_UPDATE === 'string' && process.env.DSH_FORCE_UPDATE !== '1' ? process.env.DSH_FORCE_UPDATE : '0.1.2';
      setTimeout(() => sendUpdate({ state: 'available', version: v }), 2000);
    }

    log('updater initialized');
  } catch (err) {
    log('updater init failed: ' + (err && err.message));
  }
}

function scheduleUpdateChecks() {
  if (!updater) return;
  setTimeout(() => updater.checkForUpdates().catch(() => {}), 10 * 1000);
  setInterval(() => updater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

async function boot() {
  try {
    setSplashStatus('正在启动 DeepSeek Harness 服务…');
    serverUrl = await startServer();
    log('server ready at ' + serverUrl);
    setSplashStatus('服务已就绪 · 正在加载界面…');
    await waitForHttp(serverUrl);
    log('http ready, opening window');
    setSplashStatus('即将打开工作台…');
    createWindow(serverUrl);
    scheduleUpdateChecks();
  } catch (err) {
    log('boot failed: ' + (err && err.stack ? err.stack : err));
    closeSplash();
    showError(String((err && err.message) || err));
    app.quit();
  }
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); } catch { /* ignore */ }
    if (app.isPackaged) Menu.setApplicationMenu(null);
    log('=== DeepSeek Harness desktop starting (v' + app.getVersion() + ') ===');
    initUpdater();
    createSplash();
    boot();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; closeSplash(); stopServer(); });
  app.on('will-quit', () => stopServer());
  process.on('exit', () => stopServer());
}
