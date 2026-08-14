# DeepSeek Harness — Desktop

An unofficial desktop app for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`). It wraps the official `@deepseek-ai/dsh` Web UI in a native Electron window,
so you can use DeepSeek Harness by double-clicking an icon instead of running
`npx @deepseek-ai/dsh web` in a terminal.

## What it does

1. Starts the `dsh web` server as a child process (on a free port).
2. Waits until the GUI is ready.
3. Opens it in a native desktop window.
4. Stops the server when you close the window.

Harness data, settings and credentials live in the usual `~/.dsh` folder, so this
app shares the exact same configuration as the command-line tool.

## Requirements

- Windows
- **Node.js v20+** installed — the app runs the `dsh` server with the system
  Node.js because its native modules (sharp, node-pty, koffi) are built against
  the Node ABI, not Electron's.

## Use

Build the packaged app, then double-click `DeepSeek Harness.exe`:

```sh
npm install
npm run pack     # produces dist/win-unpacked/DeepSeek Harness.exe
```

## Project layout

- `main.js` — Electron main process; launches `dsh web --port 0`, parses the
  printed URL, then opens a window.
- `package.json` — app metadata + electron-builder config.
- `build/` — the app icon (`deepseek-whale.ico`, the official black whale
  from the `dsh` repository).

## Notes

- This is a thin wrapper: it does not modify DeepSeek Harness itself.
- The official project: <https://github.com/deepseek-ai/deepseek-harness>
- License: MIT (matches upstream).
