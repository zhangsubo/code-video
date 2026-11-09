---
name: code-video-kimi
version: "1.0.0"
description: "面向 Kimi Code 等深度思考模型的瑞士国际主义海报风代码拍片工作流（零 npm 依赖，1080p 60fps）。主打『暖白纸感幕 ↔ 曜石黑 Bento 实机幕』12 小节节拍硬切、四模块零 Base64 手写解耦架构，并通过 FFmpeg 1920x360 节拍网格声波图将听觉卡点转化为高精度视觉自检，彻底解决无音频输入模型的音画同步难题。"
---

# Kimi 瑞士海报代码拍片（Code Video · Kimi Editorial Edition）

专为具备**深度思考（`always_thinking`）、强中文杂志排版审美、支持图像/视频理解但无原生音频输入**的编程智能体（如 Kimi Code CLI / Claude Code）定制的 `1920×1080 @ 60fps` 商业大片方案。

> 开源配套仓库与实测账单对比：`https://github.com/zhangsubo/code-video`

---

## 一、三大专属架构设计（扬长避短）

1. **「声波视觉化」补齐听觉模态缺口（Visualized Beat-Grid Gate）**
   - 针对无 `audio_in` 的模型，`audio_synth.py` 合成 `24.0s`（`120 BPM = 12 小节`）立体声配乐后，强制通过 FFmpeg `showwavespic=s=1920x360:split_channels=1,drawgrid=w=160:h=180` 导出节拍网格声波图 `audio-waveform.png`；
   - 画布宽 `1920px` 对应 `24.0s`，**每 `160px` 竖线严格等于 `1 小节（2.0s）`**，Agent 用眼睛看图即可核验重拍波峰卡点、削波或静音断档，还能抓出 `loudnorm` 暗升 `96kHz` 等采样坑。
2. **面向长思考模型的「零 Base64 手写 · 四文件解耦」**
   - 避免单文件塞入巨型图标与千行代码耗尽单轮输出预算，严格拆为 4 个模块：
     1. `build-assets.js` -> 自动生成 `assets.js`（严禁模型手敲 Base64）；
     2. `engine.js` -> 闭式阻尼弹簧 `spring()`、节拍换算 `beat(b)` / `bar(m)` 与 DOM 中心测量 `centerOf(id)`；
     3. `index.html` -> 语义化昼夜双调舞台与纯函数 `window.seek(t)`；
     4. `audio_synth.py` + `render.js` -> 音轨声波图合成与 4 进程并发超采样压片。
3. **瑞士网格大字报 × 昼夜交替节奏（Editorial Kinetic Typography）**
   - 痛点金句与收尾幕采用高质感暖白纸感舞台（`#F5F3EE`），实机特写切入深邃曜石 Bento 舞台（`#090D16`），严格踩在 `2.0s` 小节重拍硬切，制造极强的呼吸张力。

---

## 二、排版护栏与技术红线

详细规范见 `references/kimi-editorial-playbook.md`：

- **中文杂志级排版护栏**：画布安全边距 `>= 100px`；主标题字距 `-0.03em` 且严禁句末句号；动态数字强制 `font-variant-numeric: tabular-nums`；胶囊标签强制 `white-space: nowrap` 杜绝孤字折行。
- **确定性与合成器红线**：严禁 CSS `transition`、`@keyframes`、`setInterval`；严禁缩放层挂 `will-change`；严禁 `preserve-3d` 直接挂 `opacity`/`filter`；`file://` 下统一使用经典 `<script src="...">`。
- **零跨镜残影**：`render.js` 的 3 子帧动态模糊采样时间戳必须严格钳制在当前小节切点 `[sceneStart + 0.0001, sceneEnd - 0.0002]` 内部。

---

## 三、三道视觉与视频质检门禁

1. **Gate 1（声波网格与响度门禁）**：运行 `python3 audio_synth.py`，查看 `audio-waveform.png` 确认每 `160px` 小节重拍对齐、`(N, 2)` 双声道对称饱满，且 `ffprobe` 确认为 `48000 Hz`、`-14 LUFS`。
2. **Gate 2（12 帧排版探针门禁）**：运行 `node render.js --dir ./promo-video-kimi --probe`，查看 `probe-sheet.png` 修复任何孤字折行、对比度不足或光标偏移。
3. **Gate 3（60fps 成片切点终审）**：运行 `node render.js --dir ./promo-video-kimi --full`（禁用 `-shortest`），检查硬切点前后帧零残影并验收最终 `output.mp4`。

---

## 四、本地环境与安全透明声明

- 仅调用本机 Google Chrome、Node.js（`v22+` 原生 `WebSocket`，`npm install = 0`）、Python 3（`numpy`）与 `ffmpeg`。
- 临时目录严格置于系统 `/tmp/` 自动清理，全程离线本地执行，无任何外部凭证依赖或后台上报行为。
