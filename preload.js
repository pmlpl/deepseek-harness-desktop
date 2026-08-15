'use strict';
/*
 * Preload for the DeepSeek Harness web window.
 *
 * Owns the in-app updater indicator: an icon button injected next to the
 * "settings" entry in the sidebar footer. It appears only while an update is
 * relevant (available / downloading / downloaded / error), and clicking it
 * triggers the matching action in the main process over IPC.
 *
 * The dsh UI is a React app whose class names are content-hashed, so the
 * anchor is located by the stable semantic suffix `_settingsArea` and kept
 * mounted through a MutationObserver + polling fallback.
 */
const { ipcRenderer } = require('electron');

const STYLE_ID = '__dsh_updater_style';
const BTN_CLASS = '__dshUpdaterBtn';
const DOT_CLASS = '__dshUpdaterDot';

let status = null; // { state, version, percent, message }

/* ------------------------------------------------------------------ */
/* Status from main process                                            */
/* ------------------------------------------------------------------ */
ipcRenderer.on('update:status', (_event, payload) => {
  status = payload || { state: 'idle' };
  render();
});

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    '.' + BTN_CLASS + '{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary,#9aa7b8);cursor:pointer;display:none;align-items:center;justify-content:center;z-index:30;transition:background .15s ease,color .15s ease;-webkit-app-region:no-drag;}',
    '.' + BTN_CLASS + ':hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#eef2f7);}',
    '.' + BTN_CLASS + '.' + BTN_CLASS + '--show{display:inline-flex;}',
    '.' + BTN_CLASS + '--spinning svg{animation:__dshUpdaterSpin 1s linear infinite;}',
    '.' + BTN_CLASS + '--ready{color:#6ee7c8;}',
    '@keyframes __dshUpdaterSpin{to{transform:rotate(360deg);}}',
    '.' + DOT_CLASS + '{position:absolute;top:3px;right:3px;width:8px;height:8px;border-radius:50%;background:#4da3ff;box-shadow:0 0 6px rgba(77,163,255,.9);display:none;}',
    '.' + BTN_CLASS + '--available .' + DOT_CLASS + '{display:block;}'
  ].join('\n');
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/* Icon                                                                */
/* ------------------------------------------------------------------ */
const ICON = [
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">',
  '<path d="M8 2.5v6.3M8 8.8 5.1 5.9M8 8.8l2.9-2.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  '<path d="M3 11.2v1.1A1.7 1.7 0 0 0 4.7 14h6.6a1.7 1.7 0 0 0 1.7-1.7v-1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  '</svg>'
].join('');

let btn = null;

function ensureButton() {
  ensureStyle();
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute('aria-label', '检查更新');
    btn.innerHTML = ICON + '<span class="' + DOT_CLASS + '"></span>';
    btn.addEventListener('click', onClick);
  }
  return btn;
}

function onClick() {
  const s = status ? status.state : 'idle';
  if (s === 'downloaded') ipcRenderer.send('update:install');
  else if (s === 'available') ipcRenderer.send('update:download');
  else ipcRenderer.send('update:check');
}

/* ------------------------------------------------------------------ */
/* Render state into the button                                        */
/* ------------------------------------------------------------------ */
function render() {
  const b = btn;
  if (!b) return;
  const s = status ? status.state : 'idle';
  const show = s === 'available' || s === 'downloading' || s === 'downloaded' || s === 'error';

  b.classList.remove(BTN_CLASS + '--show', BTN_CLASS + '--spinning', BTN_CLASS + '--ready', BTN_CLASS + '--available');
  if (show) b.classList.add(BTN_CLASS + '--show');

  switch (s) {
    case 'available':
      b.classList.add(BTN_CLASS + '--available');
      b.title = (status.version ? '发现新版本 v' + status.version : '发现新版本') + ' · 点击下载更新';
      b.style.opacity = '1';
      break;
    case 'downloading':
      b.classList.add(BTN_CLASS + '--spinning');
      b.title = '正在下载更新 ' + (status.percent != null ? status.percent + '%' : '…');
      b.style.opacity = '1';
      break;
    case 'downloaded':
      b.classList.add(BTN_CLASS + '--ready');
      b.title = '更新已就绪 · 点击安装并重启';
      b.style.opacity = '1';
      break;
    case 'error':
      b.title = '检查更新失败，点击重试';
      b.style.opacity = '.6';
      break;
    default:
      b.title = '检查更新';
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Mounting: keep the button attached next to the settings entry       */
/* ------------------------------------------------------------------ */
function tryMount() {
  const b = ensureButton();
  if (b.parentElement) return;
  const area = document.querySelector('[class*="_settingsArea"]');
  if (!area) return;
  if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
  area.appendChild(b);
  render();
}

const observer = new MutationObserver(() => tryMount());
observer.observe(document.documentElement, { childList: true, subtree: true });
setInterval(tryMount, 1500);
tryMount();
