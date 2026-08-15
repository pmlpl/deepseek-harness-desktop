# DeepSeek Harness — Desktop

[简体中文](./README.zh-CN.md) | English

An unofficial desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`). It wraps the official `@deepseek-ai/dsh` Web UI in a native Electron window,
so you can use DeepSeek Harness by double-clicking an icon instead of running
`npx @deepseek-ai/dsh web` in a terminal.

## Download

Get the latest installer from the
[Releases page](https://github.com/pmlpl/deepseek-harness-desktop/releases):

- **`DeepSeek-Harness-Setup-0.1.0.exe`** — Windows x64 installer (NSIS).
  Choose your install folder; creates Desktop and Start Menu shortcuts.

## Features

- Launches the official `@deepseek-ai/dsh` Web GUI (v0.1.0-rc.6) inside a native Electron window
- Picks a free port automatically; stops the server when you quit
- Single-instance: launching the app again focuses the existing window
- Shares your existing `~/.dsh` configuration, sessions, and credentials
- Official DeepSeek black-whale icon (exe, shortcuts, installer)

## How it works

1. Starts the `dsh web` server as a child process (on a free port).
2. Waits until the GUI is ready.
3. Opens it in a native desktop window.
4. Stops the server when you close the window.

Harness data, settings and credentials live in the usual `~/.dsh` folder, so this
app shares the exact same configuration as the command-line tool.

## Requirements

- Windows 10/11 (x64)
- **Node.js v20+** installed — the app runs the `dsh` server with the system
  Node.js because its native modules (sharp, node-pty, koffi) are built against
  the Node ABI, not Electron's.

## Build from source

```sh
git clone https://github.com/pmlpl/deepseek-harness-desktop.git
cd deepseek-harness-desktop
npm install
npm run pack     # produces dist/win-unpacked/DeepSeek Harness.exe (unpacked)
npm run dist     # produces dist/DeepSeek-Harness-Setup-<version>.exe (NSIS installer)
```

## Project layout

- `main.js` — Electron main process; launches `dsh web --port 0`, parses the
  printed URL, then opens a window.
- `package.json` — app metadata + electron-builder config.
- `build/` — the app icon (`deepseek-whale.ico`, the official black whale
  from the `dsh` repository).
- `tools/repair-session-log.mjs` — session-log repair tool (see Troubleshooting).

## Troubleshooting

### "历史加载失败 / history unavailable ... corrupt session log: seq gap"

This error appears when the harness refuses to load a session whose event log
contains duplicated sequence numbers. A known upstream harness issue can write
duplicate seq ranges at seed-end/inbox-splice boundaries of a long-running
session.

This repo ships a repair tool:

```sh
# check a session log
node tools/repair-session-log.mjs "<DSH_HOME>/sessions/<project-dir>/<session-id>/session.jsonl.zstd"

# repair it (writes a .repair-backup next to the log first)
node tools/repair-session-log.mjs "<...>/session.jsonl.zstd" --fix
```

Restart the app after repairing, then reopen the session.

Note: while a session is actively open in a running harness, the bug can
recur at the next turn boundary. For a permanently clean log, repair after the
harness that owns the session has been closed, and consider reporting the
duplicate-seq issue upstream at
<https://github.com/deepseek-ai/deepseek-harness>.

## Notes

- This is a thin wrapper: it does not modify DeepSeek Harness itself.
- The official project: <https://github.com/deepseek-ai/deepseek-harness>
- License: MIT (matches upstream).
