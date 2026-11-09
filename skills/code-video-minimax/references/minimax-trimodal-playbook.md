# MiniMax 三模态「用代码拍视频」实战手册（Text × Image × Speech 协同版）

> 基于 [`joeseesun/opus-video-prompts`](https://github.com/joeseesun/opus-video-prompts) 方法论演进，专门针对 **MiniMax 三模态模型矩阵（`MiniMax-M3` 代码智能体 + `speech-2.8-hd` 毫秒级时间戳语音 + `image-01` 光学背景图 + `mcode-tools` 多模态质检）** 设计的商业级产品大片方案。

---

## 一、为什么 MiniMax 三模态会彻底改变「代码生成视频」？（四模型象限对比）

纯代码渲染视频（HTML/CSS/SVG + Chrome CDP + FFmpeg）最大的优势是**文字与 UI 100% 锐利零乱码、物理曲线精确可控**；但纯单模态代码视频往往存在两个短板：
1. **「默片感」**：没有真人级配音解说时，观众必须在阅读大段屏幕文案与观察复杂 UI 交互之间来回分心；
2. **「纯 CSS 渐变塑料感」**：只靠 CSS `radial-gradient` 很难做出 Apple / Linear 发布会那种温润建筑光影、暗色曜石玻璃折射等摄影级桌面质感；而纯 AI 视频模型又会把小字号 UI 数字和图标画成乱码。

**MiniMax（文字 + 图像 + 语音）恰好构成了补齐这两块拼图的黄金三角**：

| 维度 | Claude Opus 5.5（原仓） | Gemini 方案 | Kimi 方案（Orca） | **MiniMax 三模态方案（`mcode`）** |
|---|---|---|---|---|
| **核心模型栈** | Opus 5.5 文本代码 | Gemini 多模态理解 + 代码 | Kimi `k3.1-pro` 深度思考 + 代码 | **`MiniMax-M3`（代码）+ `speech-2.8-hd`（配音/时间戳）+ `image-01`（光学底板）** |
| **时间轴主时钟** | 手写固定节拍（默片） | 手写固定 6×4s（默片） | 120 BPM 12×2s 硬切（默片） | **「Voice-First 声画锁相环」**：先合成旁白并提取毫秒级 `subtitle_file`，用真实人声呼吸驱动分镜切点、弹簧交互与字幕高亮 |
| **画面层次结构** | 纯 DOM / Canvas | 纯 DOM 毛玻璃 + CSS 渐变 | 瑞士暖白纸感 ↔ 纯暗色 DOM | **「三明治光学合成」**：底层 `image-01` 16:9 摄影级背景微推镜 + 中层对比度遮罩 + 顶层 100% 矢量化真实 App UI 与动态字幕 |
| **声音工程** | 无或简易合成音 | Python 电子合成配乐 | Python 120 BPM 节拍器配乐 | **真人级发布会旁白 + 包络闪避（Sidechain Ducking）环境配乐 + 交互峰值拟音（`-14 LUFS`）** |
| **多模态闭环质检** | 仅抽静态单帧看图 | 原生 `image/video/audio` 直读 | `ReadMediaFile` 看图/视频 + 声波图 | **`mcode-tools` Matrix 理解套件（`describe_images` + `videos_understand` + `audios_understand`）+ `ebur128`/`ffprobe` 硬门禁** |

---

## 二、MiniMax 三模态两大核心架构创新

### 1. Voice-First Master Clock（声画锁相环）
严禁先拍脑袋写死每幕 4 秒再硬塞配音（会导致语速忽快忽慢或尾音被生硬切断）。标准流水线必须**先声夺人**：

1. **并行合成旁白与精确时间戳（`build-voiceover.py`）**：
   - 调用 `POST https://api.minimaxi.com/v1/t2a_v2`，模型设为 `speech-2.8-hd`，音色推荐 `Chinese (Mandarin)_Gentleman`（温润磁性发布会男声，`speed: 1.05`），并开启 `"subtitle_enable": true`。
   - 接口返回的 `data.audio` 为 Hex 编码音频字节（`bytes.fromhex(...)`），`data.subtitle_file` 为毫秒级时间戳 JSON（包含每句/分句的 `time_begin`、`time_end`）。
   - 将每幕干声转码为 `48000 Hz` 双声道 WAV，精确测量采样帧数：每幕前后自动留出自然呼吸气口（如前导 `0.38s`、尾韵 `0.45s`，收尾幕留 `1.35s` 品牌余韵），拼接输出 `voiceover-clean.wav`，并自动生成全局唯一真值源 **`timeline.js`（挂载 `window.TIMELINE`）与 `timeline.json`**：
     ```js
     window.TIMELINE = {
       fps: 60,
       duration: 26.4, // 由真实人声采样精确算出并对齐到 1/60s 整数帧
       totalFrames: 1584,
       scenes: [
         {
           id: "pain",
           index: 0,
           start: 0.0,
           end: 4.35,
           voiceStart: 0.40,
           voiceEnd: 3.88,
           backdrop: "warm-studio",
           caption: "同时驾驭五款 AI 编程助手，最怕写到一半，配额突然见底。",
           subtitles: [ /* 来自 subtitle_file 的毫秒偏移转换秒数 */ ]
         }
       ]
     };
     ```
2. **包络闪避混音（Sidechain Envelope Ducking，`audio_mix.py`）**：
   - 使用 Python `wave` + `numpy` 合成克制温润的 Apple Keynote 风格环境底乐（柔和电钢琴泛音和弦 + 低频温暖脉冲 + 锁定交互时刻的清脆 UI 点击/切换拟音）。
   - 计算 `voiceover-clean.wav` 的平滑包络（Attack `25ms` / Release `280ms`），当旁白发声时自动将背景音乐压低约 `-7.5 dB`，旁白停顿与转场气口处音乐自然回升；最后经 FFmpeg `loudnorm=I=-14:TP=-2.5:LRA=11,aresample=48000` 标准化输出 `48kHz` 立体声母带。

### 2. Sandwich Layer Compositing（三明治光学合成架构）
严格遵守 **「AI 画光影质感，代码画精准界面」** 的黄金分工：

- **Layer 0 — `image-01` 16:9 摄影级背景底板（`build-backdrops.py`）**：
  - 并发调用 `POST https://api.minimaxi.com/v1/image_generation`（`model: "image-01"`, `aspect_ratio: "16:9"`, `timeout=120`），生成 3 张**严禁包含任何文字或 UI 框**的抽象光学摄影底板（如暗色曜石玻璃折射、北欧暖光洞石桌面光影、深海蓝宝石棱镜散射）。
  - 在 `window.seek(t)` 中赋予极克制的光学呼吸推镜（`scale(1.02 -> 1.07)` 线性缓推，严禁加 `will-change`）。
- **Layer 1 — 光学对比度护栏层（Optical Scrim）**：
  - 叠加径向暗角与半透明遮罩（暗色幕约 `rgba(7, 10, 16, 0.54)`，暖光幕约 `rgba(245, 242, 236, 0.76)`），确保前景文字与背景对比度恒定高于 `7:1`。
- **Layer 2 — 100% 确定性 HTML/CSS/SVG 产品实机界面**：
  - 真实提取项目图标资产（`build-assets.mjs`），用闭式阻尼弹簧（$\zeta \in [0.82, 0.88]$）驱动真实 UI 组件、`font-variant-numeric: tabular-nums` 滚动计数器与实时 `getBoundingClientRect()` 靶心光标。
- **Layer 3 — 发布会级声画同步字幕条（Keynote Synced Caption）**：
  - 位于底部安全区（距底边 `68px`），随 `window.TIMELINE` 的 `voiceStart ~ voiceEnd` 及分句时间戳做柔和渐显与当前分句高亮，绝不遮挡主视觉。

---

## 三、工程护栏与环境避坑红线（macOS 实测固化）

1. **密钥零泄露红线**：
   - 所有脚本仅允许在运行时从用户显式导出的环境变量（`MINIMAX_API_KEY`）动态读取凭证，**严禁在任何代码、JSON、HTML 或终端日志中打印、缓存或硬编码密钥**。
   - 必须将 `speech-2.8-hd` 的实际调用字数/耗时写入 `voiceover-stats.json`，将 `image-01` 的生成张数/耗时写入 `image-stats.json` 以便成本审计。
2. **纯函数时间驱动与渲染管线**：
   - 禁用一切 CSS `transition`、`@keyframes`、`requestAnimationFrame` 自跑循环或跨帧可变累加器；画面只能是 `window.seek(t)` 的纯函数。
   - 禁用缩放元素上的 `will-change`（防 Chrome 位图缓存发糊）；禁用 `preserve-3d` 父节点上的 `opacity`/`filter`。
   - `file://` 协议下禁用 `<script type="module">`，统一使用经典 `<script src="...">` 挂载全局变量（`window.ASSETS`、`window.TIMELINE`、`window.Engine`）。
   - Chrome Headless CDP 连接时，`Target.createTarget({ url })` **不传 `width`/`height`**，随后用 `Emulation.setDeviceMetricsOverride({ width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })` 锁定视口。
   - Python 统一使用 `/opt/anaconda3/bin/python3`（含 `numpy`，**严禁 `import scipy`**，用标准库 `wave` + `numpy` + `/opt/homebrew/bin/ffmpeg`）。
3. **高速无损快门模糊与零跨镜残影**：
   - 含摄影背景图时使用 `Page.captureScreenshot({ format: 'jpeg', quality: 95 })` 通过 `image2pipe`（`-f image2pipe -framerate 180 -c:v mjpeg`）喂给 FFmpeg。
   - 每帧采样 3 个子帧执行 `tmix=frames=3:weights='1 2 1'`，且 3 个子帧时间戳必须严格钳制在当前 `scene` 的 `[scene.start + 0.0001, scene.end - 0.0001]` 内，彻底杜绝转场重影。
   - 视频强制 `scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p` 与 BT.709 `tv` 标记；混流严禁加 `-shortest`（避免音频采样微差截断末尾 2~3 帧）；音频强制 `-ar 48000` 与 `TP=-2.5` 防 AAC 有损过冲。
4. **实测固化的三条底层避坑经验**：
   - **4 独立 Chrome 进程替代单进程多后台标签页**：单实例多后台 Tab 易触发 Chrome 合成器后台节流，改用 4 个独立无头 Chrome 实例分片并行可将吞吐拉满；
   - **立体声 PCM 交错序与干声相关性断言**：Python `wave` 写入双声道 `int16` 时必须为 `(N, 2)` C-order 交错有符号整型（严禁写成 `(2, N)` 平面序或误加 `+32768` 无符号偏置），混音后可计算与干声包络相关性断言；
   - **`mcode-tools` 听觉终审不可替代**：单纯 `ebur128` 数值达标（`-14 LUFS`）无法识别相位撕裂杂音，必须通过 `videos_understand` / `audios_understand` 做真实多模态听觉验收。

---

## 四、三道多模态质检门禁（`mcode-tools` + 数值断言）

1. **Gate 1（人声时间轴与母带响度门禁）**：
   - 校验 6 段干声全部合成成功且无截断，导出 `audio-waveform.png` 波形图；
   - 运行 `ffprobe` 与 `ffmpeg -af ebur128` 断言 `48000 Hz`、集成响度 `-14 ± 1.0 LUFS`、真峰值 `<= -1.5 dBTP`。
2. **Gate 2（12 帧关键帧排版与背景对比度门禁）**：
   - 运行 `node render.mjs --probe` 导出每幕 2 帧（入场态 + 稳定态）共 12 张探针图及九宫/十二宫联络表 `probe-sheet.png`；
   - 通过 `mcode-tools upload-temp-url promo-video-minimax/probe-sheet.png` + `mcode-tools connector call connector__matrix__describe_images` 调用 MiniMax 视觉理解模型审查文字清晰度、对比度、零溢出遮挡与光标落点，发现瑕疵立即修 DOM 重跑单帧探针。
3. **Gate 3（成片视频、切点零残影与音画终审门禁）**：
   - 运行 `node render.mjs --full` 输出 `tokenuse-minimax-promo.mp4`，抽取全部场景硬切点前后帧拼成 `cut-boundaries.png` 验证零残影；
   - 通过 `mcode-tools upload-temp-url promo-video-minimax/tokenuse-minimax-promo.mp4` + `connector__matrix__videos_understand`（及 `audios_understand`）完成成片动态与旁白清晰度终审。

---

## 五、标准调用方式（`mcode` CLI / Orca 终端）

```bash
# 方式 A：使用 MiniMax Code CLI (mcode) 无交互全自动执行
~/.minimax-code/bin/mcode exec \
  --permission full \
  --model minimax/MiniMax-M3 \
  --cwd <PROJECT_ROOT> \
  --timeout 45m \
  --max-steps 120 \
  --append-system-prompt-file promo-video-minimax/minimax-video-director.md \
  "请阅读 README.md、核心 UI 源码与真实图标，严格按 promo-video-minimax/minimax-video-playbook.md 在 promo-video-minimax/ 下调用 MiniMax 语音(speech-2.8-hd)、图像(image-01)与代码能力制作并验收产品介绍视频。"

# 方式 B：通过 Orca 创建可视化终端运行 mcode
orca terminal create \
  --worktree "id:<repoId>::<PROJECT_ROOT>" \
  --title "MiniMax Tri-Modal Video" \
  --command "~/.minimax-code/bin/mcode --model minimax/MiniMax-M3 --append-system-prompt-file promo-video-minimax/minimax-video-director.md" \
  --json
```
