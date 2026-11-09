# Kimi Code「用代码拍视频」实战方案（基于 `opus-video-prompts` × Orca 编排适配）

> 源自 [`joeseesun/opus-video-prompts`](https://github.com/joeseesun/opus-video-prompts)（54 个代码渲染视频案例、18 份完整提示词），针对 **Kimi Code CLI（`kimi-code/k3.1-pro`）** 的真实能力边界（`always_thinking` + `image_in` + `video_in`、无原生 `audio_in`、极强的中文杂志级排版与动效审美）以及 **Orca 多智能体工作区编排** 定制的生产级出片方案。

---

## 一、三大模型「用代码拍视频」能力象限对比（Opus vs. Gemini vs. Kimi）

不同模型的多模态输入模态、推理习惯与 CLI 架构差异巨大，照搬同一套提示词会导致工具空转或单文件截断。三者的精准定位如下：

| 维度 | Claude Opus 5.5（原仓基准） | Gemini 方案 | **Kimi 方案（`kimi-code/k3.1-pro` + Orca）** |
|---|---|---|---|
| **多模态自检边界** | 仅 `image_in`（只能抽单帧静态图，看不见动态也听不见声音） | `image_in` + `video_in` + `audio_in`（直接观看并聆听 `.mp4`） | **`image_in` + `video_in`（原生支持看 `.mp4` 视频流审动态！）**，但**无 `audio_in`** —— 需配合 **`showwavespic` 节拍网格声波图** 将听觉对齐转化为视觉自检 |
| **思考与输出特征** | 单次长文本直出强，偶发过度复杂 CSS | 百万上下文全仓吞吐快 | 默认开启 **`always_thinking`（步步深思）**；若单文件塞入 Base64 与千行代码易消耗输出预算，最适合 **4 文件模块化拆分** |
| **美学与文案长板** | 偏硅谷英文 SaaS 深色科技风 | 忠实源码结构与工程信息密度 | **中文叙事张力、瑞士网格杂志感（Editorial Kinetic Typography）、明暗双调 Bento 卡片编排** 极具灵气 |
| **智能体编排方式** | Claude Code 本地单跑 | Antigravity / Gemini CLI 原生闭环 | 支持 **Orca CLI（`orca agent launch --agent kimi`）** 跨终端托管 + Kimi 专属 **`--agent-file` 导演角色挂载** |

---

## 二、Kimi 专属四大架构设计（针对 `k3.1-pro` 扬长避短）

### 1. 「声波视觉化」补齐音频模态缺口（Visualized Beat-Grid Audio Gate）
Kimi `k3.1-pro` 拥有 `image_in` 与 `video_in`，可以用 `ReadMediaFile` 直接检视 `probe-sheet.png` 和最终 `.mp4` 的运动顺滑度与转场切点，但它**听不到音轨**。
因此在 Kimi 方案中，`audio.py` 在合成 `24.0s`（`120 BPM` = `12 小节`）立体声配乐与拟音后，强制通过 FFmpeg 产出一张 **`1920×360` 节拍网格声波图（`audio-waveform.png`）**：
- 画布宽 `1920px` 对应 `24.0s` → **每 `160px` 竖线严格等于 `1 小节（2.0s）`**，每 `80px` 等于 `1 拍`！
- Kimi 直接读取 `audio-waveform.png` + `ebur128` 响度日志（目标 `-14 LUFS`、`True Peak <= -1.5 dBTP`），用肉眼即可精确核验每一次转场重拍（`4.0s = 320px`、`8.0s = 640px`、`12.0s = 960px`...）是否落在波峰上，以及是否存在削波平顶或静音断档。

### 2. 面向 `always_thinking` 的「零 Base64 手写 · 四文件解耦」架构
为避免模型在单次文件写入中混杂巨型资源与动画数学公式，固定拆分为 4 个零外部 `npm` 依赖模块：
1. **`build-assets.mjs` → `assets.js`**：用 20 行脚本自动读取仓库真实 PNG 资源（吉祥物大图先经 `sips -Z 320` 缩略减重）导出至 `window.ASSETS`，**严禁大模型在思考/输出中手打 Base64**。
2. **`engine.js`**：挂载 `window.Engine`（使用经典 `<script src>` 引入以规避 Chrome `file://` 下 ES Module CORS 限制），封装纯确定性数学内核——闭式二阶阻尼弹簧 `spring(t, t0, omega, zeta)`、节拍换算器 `beat(b)` / `bar(m)`、固定种子伪随机 `mulberry32(seed)`、以及运行时 DOM 靶心测量 `centerOf(id)`。
3. **`index.html`**：`1920×1080` 语义化舞台 + CSS 变量主题 + 纯函数 `window.seek(t)` 6 幕状态编排（直接打开带底部交互进度条，`?render=1` 自动隐藏）。
4. **`audio.py` + `render.mjs`**：纯 Python（`wave` + `numpy.fft`，禁用易出 ABI 冲突的 `scipy`）合成音轨与声波图；Node.js 原生 `WebSocket` 直连本机 Chrome CDP 4 标签页并行超采样，经 `ffmpeg tmix=frames=3:weights='1 2 1'` 输出真实快门动态模糊与 `yuv420p (tv range)` MP4。

### 3. 发挥 Kimi 强项的「Editorial Bento × 昼夜交替」视觉母题
继承 `opus-video-prompts` 中最受欢迎的 `#07` / `#15` (`@twoclipping`) / `#18` 导演技法，鼓励 Kimi 采用**高反差明暗节奏 + 瑞士国际主义大字排版**：
- **明暗呼吸切镜**：痛点大字与品牌收尾可采用高质感暖白纸感/浅灰舞台（Editorial Light）或深邃曜石舞台（Obsidian Dark）形成章节呼吸对比，桌面实机演示幕则还原 macOS 真实壁纸与毛玻璃 HUD。
- **中文大字报级排版护栏**：主标题字距紧缩（`letter-spacing: -0.03em`），严禁句末句号；所有滚动金额/百分比/倒计时强制开启 `font-variant-numeric: tabular-nums`；胶囊标签强制 `white-space: nowrap` 杜绝孤字折行。

### 4. 继承自 `opus-video-prompts` 的七条确定性红线（`<banned>`）
- **状态纯函数化**：严禁 CSS `transition`、`@keyframes`、`setInterval`、`requestAnimationFrame` 累加器；任意时刻调 `window.seek(7.25)` 与顺序播放到 `7.25s` 必须像素级一致。
- **渲染器防糊铁律**：严禁在执行 `scale()` 的容器上声明 `will-change: transform`（会导致 Chrome 将图层栅格化为低清纹理，放大后字体发虚）；严禁在 `preserve-3d` 元素上直接挂 `opacity < 1` 或 `filter`。
- **反 AI 廉价特效**：严禁粒子爆炸、RGB 故障色散、镜头光晕、霓虹发光汤、透视网格地板、果冻回弹（$\zeta$ 锁定在 `0.82–0.88`）。
- **零跨镜残影**：子帧动态模糊采样 `[t - \Delta t, t, t + \Delta t]` 必须钳制在当前镜头切点 `[sceneStart, sceneEnd - 0.0002]` 内部。

---

## 三、通过 Orca 调度 Kimi Code 的标准工作流

```text
1. 注册/定位工作区   orca repo add --path /abs/path/to/repo --json
2. 启动 Kimi 智能体  orca agent launch --agent kimi --surface terminal --worktree id:<repoId>::<path> --prompt "<任务指令>" --json
3. 等待阶段完成      orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 300000 --json
4. 屏幕巡检与续推    orca terminal read --terminal <handle> --screen --json
                     （如遇权限确认或需微调，通过 orca terminal send --terminal <handle> 交互）
```

> 亦可直接使用 Kimi Code 原生 `--agent-file` 独立启动：
> `kimi --yolo --agent-file promo-video-kimi/kimi-video-director.md -p "按方案为当前项目制作 24 秒产品介绍视频"`

---

## 四、可直接复制的 Kimi Code 视频生成提示词模板（Copy-Ready）

```xml
<role>
你是 Kimi Motion Director——兼具瑞士平面排版功底、Apple Keynote 动效克制感与前端图形学工程能力的导演。请阅读当前仓库文档、UI 源码与真实图标，在独立目录 `promo-video-kimi/` 下用纯确定性代码与零 npm 依赖管线，制作一支 24 秒、1920×1080 @ 60fps 的商业级产品发布视频。
</role>

<aesthetic_and_pacing>
- 曲速与总长：120 BPM（1 拍 = 0.5s，1 小节 = 2.0s），总长 24.0s（12 小节 / 1440 帧）。
- 视觉风格：瑞士网格动态大字排版（Editorial Kinetic Typography）结合高精度 macOS 原生 Bento UI 特写。允许利用「高质感暖白浅色幕 ↔ 深邃曜石实机幕」的小节硬切制造明暗呼吸张力。
- 中文排版护栏：画布安全边距 >= 100px；大标题不加句号；动态数字一律 `font-variant-numeric: tabular-nums`；徽章与短标签一律 `white-space: nowrap`。
- 100% 真实资产：写脚本自动将项目真实图标打包为 `assets.js`，严禁手敲 Base64，严禁使用灰框假图标；鼠标点击坐标必须在 `window.seek(t)` 内用 `getBoundingClientRect()` 实时读取按钮中心。
</aesthetic_and_pacing>

<banned>
严禁出现：粒子爆炸、RGB 色差故障、霓虹泛光汤、镜头光晕、透视网格地板、果冻回弹缓动（bouncy easing）。
技术红线：严禁任何 CSS `transition`、`@keyframes`、`setInterval` 或跨帧可变状态；严禁在缩放层声明 `will-change`；严禁在 `preserve-3d` 容器直接设置 `opacity` 或 `filter`。
</banned>

<modular_architecture>
在 `promo-video-kimi/` 下按 4 模块解耦实现（零 `npm install`）：
1. `build-assets.mjs` -> 生成 `assets.js`（提取真实 PNG 图标 Data URI）。
2. `engine.js` -> 闭式阻尼弹簧 `spring(t, t0, omega=18, zeta=0.85)`、节拍辅助函数与 DOM 中心点测量器。
3. `index.html` -> 1920×1080 舞台与异步纯函数 `window.seek(t)`（浏览器直开带底部播放/拖拽条，`?render=1` 自动隐藏）。
4. `audio.py` + `render.mjs` ->
   - `audio.py`：仅用 Python `wave` + `numpy.fft`（禁用 `scipy`）合成 48kHz 立体声 120 BPM 配乐与采样峰值对齐的 UI 拟音，经 `ffmpeg loudnorm=I=-14:TP=-1.5:LRA=11` 输出 `audio.wav`，并用 `ffmpeg showwavespic=s=1920x360:split_channels=1,drawgrid=w=160:h=180:t=1:c=white@0.25` 导出 `audio-waveform.png`（每 160px 对应 1 小节 2.0s）。
   - `render.mjs`：用 Node 原生 `WebSocket` 直连本机 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new`（CDP `Target.createTarget({ url })` + `Emulation.setDeviceMetricsOverride`），支持 `--probe`（输出 12 关键帧与 `3×4` `probe-sheet.png`）与 `--full`（4 标签页并发，每帧在镜头切点边界内超采样 3 子帧管道输入 `ffmpeg` 执行 `tmix=frames=3:weights='1 2 1'`、`scale=in_range=pc:out_range=tv,format=yuv420p`、`-color_range tv` 封装 `tokenuse-kimi-promo.mp4`）。
</modular_architecture>

<kimi_multimodal_qa>
必须调用你原生的 `ReadMediaFile`（`image_in` + `video_in`）完成三道质检门：
- Gate 1（声波与响度自检）：运行 `audio.py`，用 `ReadMediaFile` 查看 `audio-waveform.png`，确认重拍波峰精准踩在 160px 小节网格线上、无削波或死寂断档。
- Gate 2（12 帧排版探针）：运行 `node render.mjs --probe`，用 `ReadMediaFile` 检查 `probe-sheet.png` 及复杂 UI 单帧，修复任何文字折行、重叠、对比度或光标偏移问题并重跑验证。
- Gate 3（60fps 成片动态终审）：运行 `node render.mjs --full` 生成 MP4，用 `ReadMediaFile` 直接观看 `.mp4` 成片，确认弹簧节奏、快门模糊与切镜无残影后收工。
</kimi_multimodal_qa>
