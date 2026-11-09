---
name: code-video-gemini
version: "1.0.0"
description: "基于超长上下文与原生音视频多模态直读能力的 20 分钟极速代码拍片工作流（零 npm 依赖，1080p 60fps）。适用于 Gemini CLI、Antigravity 或支持长上下文与视频读取的 Agent：自动啃透项目源码还原真实 UI 与品牌色，构建单文件毛玻璃连续交互舞台，经 4 进程无头 Chrome 180fps 快门超采样直出 MP4 并原生看片终审。"
---

# Gemini 极速代码拍片（Code Video · Gemini Edition）

专为具备**百万级上下文窗口**与**原生 `.mp4` 视听直读能力**的多模态编程智能体（如 Gemini CLI / Antigravity）定制的零依赖商业产品宣传片工作流，约 **20–25 分钟**即可将任意软件仓库转化为 `1920×1080 @ 60fps` 成片。

> 开源配套仓库与实测账单对比：`https://github.com/zhangsubo/code-video`

---

## 一、核心优势与设计母题

1. **源码级像素还原（拒绝灰框占位符）**：利用大上下文一次性通读目标仓库的 `README.md`、核心视图源码（SwiftUI / React / Vue 配色常量、圆角半径、数据模型）与真实图标目录，写 20 行小脚本打包真实图标为 `assets.js`，无需人工喂截图。
2. **连续暗色毛玻璃桌面流**：采用同一深色桌面空间内的 `6 幕 × 4.0s = 24.0s`（`120 BPM`，`1440` 帧）连续推拉聚焦与真实指针点击驱动，消除硬切眩晕感。
3. **原生直读 `.mp4` 三道门禁闭环**：不仅看静态关键帧拼图，更在全量压片后直接读取 `.mp4` 文件同时核验弹簧丝滑度、快门模糊与音画卡点。

---

## 二、7 条确定性工程红线（必守）

详细底层排障说明见 `references/gemini-3gate-playbook.md`：

- **纯时间函数**：`index.html` 暴露 `window.seek(t)`，每一帧所有 DOM/Canvas 属性唯一由秒数 `t` 闭式算出；严禁 CSS `transition`、`@keyframes`、`setInterval` 或跨帧累加变量。
- **物理弹簧与数字护栏**：统一采用 `zeta = 0.84` 二阶阻尼弹簧（约 `0.8%` 微过冲）；所有跳动数字开启 `font-variant-numeric: tabular-nums`；短徽章开启 `white-space: nowrap`。
- **合成器红线**：严禁在缩放层挂 `will-change`（防位图化发糊）；严禁在 `preserve-3d` 元素直接设 `opacity < 1` 或 `filter`；`file://` 协议下禁用 `<script type="module">`。
- **运行时靶心测量**：鼠标点击落点必须在 `window.seek(t)` 内通过 `getBoundingClientRect()` 动态测量按钮中心，严禁手猜坐标。
- **反塑料感黑名单**：严禁粒子爆炸、RGB 故障色散、霓虹泛光汤、镜头光晕、透视网格地板与大标题句号。

---

## 三、三阶段执行流（3-Gate Multimodal QA）

可从本技能包的 `assets/stage-starter.html`、`scripts/render.js` 与 `scripts/audio_synth.py` 复制起步：

1. **Gate 1 · 源码采风 + `120 BPM` 音轨合成**
   - 梳理 12 小节分镜表与点击时刻表；
   - 运行 `python3 audio_synth.py`（仅用标准库 `wave` + `numpy`，确保 `(N, 2)` C-order 交错 `int16`）输出 `-14 LUFS`、`48000 Hz` 的 `audio.wav` 与 `audio-waveform.png`。
2. **Gate 2 · 12 帧探针拼图自检（`--probe`）**
   - 运行 `node render.js --dir ./promo-video --probe` 秒出 `probe-sheet.png`；
   - 用视觉工具逐格检查中英文折行、元素重叠、对比度与指针落点，微调至零瑕疵。
3. **Gate 3 · 4 进程超采样压片与原生看片终审（`--full`）**
   - 运行 `node render.js --dir ./promo-video --full`（每帧在镜头切点边界内取 3 子帧执行 `tmix=frames=3:weights='1 2 1'`，混流禁用 `-shortest`）；
   - 直接读取生成的 `output.mp4` 复核运动节奏与音画同步后交付。

---

## 四、本地环境与安全透明声明

- 仅调用本机已安装的 Google Chrome、Node.js（`v22+` 原生 `WebSocket`，`npm install = 0`）、Python 3（`numpy`）与 `ffmpeg`。
- Chrome 临时目录创建于系统 `/tmp/` 并在退出时自动清理；全程离线本地执行，无需外部 API Key，无任何后台联网上报行为。
