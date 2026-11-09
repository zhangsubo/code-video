# AGENTS.md — 用代码拍视频（Code-Rendered Video Studio）

本仓库是独立的**「代码生成视频」方法论、可复用提示词模板与实战案例工作区**。当 AI 编程智能体在本工作区中为某个软件仓库或产品原型制作代码渲染视频时，请严格遵循以下工程准则。

## 1. 目录职责（Single Source of Truth）

- `docs/`：核心技术方案拆解与实测耗时 / Token 评测报告（`01` Gemini 方案、`02` Kimi 方案、`03` MiniMax 三模态方案、`04` 三方实测基准评测）。
- `prompts/`：跨项目可直接复制复用的 Playbook 与 Director 角色提示词模板。
- `cases/<case-name>/`：每个视频项目的独立源码目录（含 `index.html`、`render.mjs`、音频合成脚本与多模态质检图谱）。新建视频案例一律在 `cases/<new-case>/` 下独立创建，严禁覆盖已有案例。

## 2. 确定性渲染与多模态工程约定（macOS 已验证）

- **零外部 npm 依赖**：现代 Node.js（`v22+` / `v26+`）原生内置全局 `WebSocket`，直接使用 CDP（Chrome DevTools Protocol）直连本机 Chrome 截帧，**严禁安装 `playwright` / `puppeteer` / `remotion`**。
- **严禁留存临时缓存目录**：无头 Chrome 临时用户目录（如 `.chrome-*`）及音视频合成中转文件必须创建在系统临时目录（`os.tmpdir()` / `tempfile.mkdtemp()`）并在退出时清理，**严禁污染项目工作区**。
- **Python 音频脚本规范**：优先使用标准库 `wave` + `numpy` + `ffmpeg`（禁用 `scipy` 以避免不同架构下的二进制环境冲突）；写入双声道 16-bit WAV 时必须确认数组形状为 `(N, 2)` C-order 交错有符号 `int16`。
- **Chrome Headless CDP 铁律**：
  - `Target.createTarget({ url })` 不传 `width` / `height`，统一用 `Emulation.setDeviceMetricsOverride({ width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })` 锁定视口；
  - `file://` 本地协议下禁用 `<script type="module">`，统一使用经典 `<script src="...">`；
  - 全量渲染优先使用 **4 个独立无头 Chrome 进程** + `JPEG (quality: 95)` 管道 + 单镜头切点边界内 3 子帧 `tmix=frames=3:weights='1 2 1'`（170° 快门动态模糊）；混流禁用 `-shortest`，音轨统一锁定 `-ar 48000` 与 `loudnorm=I=-14:TP=-2.5:LRA=11`。
- **密钥零泄露**：调用 MiniMax 等多模态接口时，仅允许在脚本运行时从环境变量（如 `MINIMAX_API_KEY`）或本机安全配置读取凭证，严禁在终端日志或任何文件中打印、硬编码密钥。
