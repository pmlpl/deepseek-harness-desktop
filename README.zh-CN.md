# DeepSeek Harness — 桌面版

English | [简体中文](./README.zh-CN.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的非官方桌面应用。
它把官方 `@deepseek-ai/dsh` Web 界面封装进一个原生 Electron 窗口，让你可以双击图标使用
DeepSeek Harness，而不必在终端里执行 `npx @deepseek-ai/dsh web`。

## 下载

请从 [Releases 页面](https://github.com/pmlpl/deepseek-harness-desktop/releases)
获取最新安装包：

- **`DeepSeek-Harness-Setup-0.1.0.exe`** — Windows x64 安装包（NSIS）。
  可选择安装目录，并自动创建桌面与开始菜单快捷方式。

## 功能特性

- 在原生 Electron 窗口中运行官方 `@deepseek-ai/dsh` Web 界面（v0.1.0-rc.6）
- 自动选择空闲端口；退出时自动关闭服务
- 单实例运行：再次启动时聚焦已有窗口
- 与命令行工具共享已有的 `~/.dsh` 配置、会话和凭据
- 使用官方 DeepSeek 黑鲸图标（主程序、快捷方式、安装包）

## 工作原理

1. 以子进程方式启动 `dsh web` 服务（使用空闲端口）。
2. 等待 GUI 就绪。
3. 在原生桌面窗口中打开界面。
4. 关闭窗口时停止服务。

Harness 的数据、设置与凭据仍然存放在 `~/.dsh` 目录，因此本应用与命令行工具使用完全相同的配置。

## 系统要求

- Windows 10/11（x64）
- **已安装 Node.js v20+** —— 应用使用系统 Node.js 运行 `dsh` 服务，
  因为其原生模块（sharp、node-pty、koffi）是基于 Node ABI 编译的，而非 Electron ABI。

## 从源码构建

```sh
git clone https://github.com/pmlpl/deepseek-harness-desktop.git
cd deepseek-harness-desktop
npm install
npm run pack     # 生成 dist/win-unpacked/DeepSeek Harness.exe（免安装版）
npm run dist     # 生成 dist/DeepSeek-Harness-Setup-<版本>.exe（NSIS 安装包）
```

## 项目结构

- `main.js` — Electron 主进程；启动 `dsh web --port 0`，解析打印的 URL，然后打开窗口。
- `package.json` — 应用元数据 + electron-builder 配置。
- `build/` — 应用图标（`deepseek-whale.ico`，取自 `dsh` 官方仓库的黑鲸图标）。
- `tools/repair-session-log.mjs` — 会话日志修复工具（见下方"故障排查"）。

## 故障排查

### "历史加载失败 / history unavailable ... corrupt session log: seq gap"

当 Harness 拒绝加载某个会话日志（其中包含重复的序列号）时，会出现此错误。
上游 Harness 的一个已知问题可能在长会话的 seed-end/inbox-splice 边界写入重复的 seq 区间。

本仓库附带一个修复工具：

```sh
# 检查会话日志
node tools/repair-session-log.mjs "<DSH_HOME>/sessions/<项目目录>/<会话ID>/session.jsonl.zstd"

# 修复（修复前会先在日志旁生成 .repair-backup 备份）
node tools/repair-session-log.mjs "<...>/session.jsonl.zstd" --fix
```

修复完成后重启应用，再重新打开该会话。

注意：当会话仍被运行中的 Harness 打开时，该问题可能在下一个回合边界再次出现。
如需彻底修复日志，请先关闭拥有该会话的 Harness 再进行修复，并可考虑在上游
<https://github.com/deepseek-ai/deepseek-harness> 反馈该重复 seq 问题。

## 说明

- 这是一个轻量封装，不会修改 DeepSeek Harness 本身。
- 官方项目：<https://github.com/deepseek-ai/deepseek-harness>
- 许可证：MIT（与上游一致）。
