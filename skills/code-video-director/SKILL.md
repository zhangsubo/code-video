---
name: code-video-director
version: "1.0.0"
description: "零外部 npm 依赖为软件仓库、开源项目、独立应用或技术主题制作 1080p 60fps 商业级产品宣传片与技术拆解视频（确定性前端代码 + Headless Chrome 超采样截帧 + Python 音频合成 + FFmpeg 快门模糊压片）。当用户要求『用代码拍视频』『给项目做宣传片/演示视频/Promo Video』『不用剪映写代码生成 MP4』时触发，自动按本地可用模型路由至 Gemini 极速流、Kimi 瑞士海报风或 MiniMax 三模态有声大片。"
---

# 用代码拍视频总导演（Code Video Director）

用 **100% 确定性前端图形代码（HTML / CSS / Canvas / SVG）+ 本地无头 Chrome 超采样截帧 + Python 音频工程 + FFmpeg 快门动态模糊压片**，直接为任意软件仓库或产品原型拍出矢量锐利、弹簧丝滑、声画卡点的 `1920×1080 @ 60fps`（或 `1080×1920` 竖屏）商业级成片。

> 开源配套仓库与完整实机案例：`https://github.com/zhangsubo/code-video`

---

## 一、三档制片路线自动路由（开始前先决策）

接手任务后，先读取目标项目的 `README.md`、核心 UI 源码与真实品牌图标，再根据用户手头环境选择以下三档路线之一（详细分步规范按需读取 `references/model-routing-guide.md`）：

1. **路线 A · 极速单模态实机流（推荐 Gemini / Claude / 通用多模态 Agent，约 20 分钟出片）**
   - 适用：不配置额外语音/生图 API Key，追求最快速度还原真实软件桌面交互流。
   - 特征：通读项目源码提取真实配色与图标 -> `120 BPM` 节拍锁死 -> 单文件 `index.html` 毛玻璃连续推镜 + Python 合成电子氛围乐与交互拟音。
2. **路线 B · 瑞士国际主义昼夜海报风（推荐 Kimi Code / 深度思考模型，无音频输入环境）**
   - 适用：强调中文金句张力、高对比杂志排版（暖白纸感幕 ↔ 曜石黑 Bento 实机幕小节硬切），或当前 Agent 不支持直接听音频。
   - 特征：四文件解耦（`assets.js` + `engine.js` + `index.html` + `render.js`）+ 强制输出 `1920×360` 节拍网格声波图（`audio-waveform.png`）「用眼睛审声音」。
3. **路线 C · 三模态发布会级有声大片（推荐配置有 `MINIMAX_API_KEY` 的环境）**
   - 适用：正式产品发布，需要温润真人级旁白解说 + 摄影级桌面光影底板 + 锐利代码 UI。
   - 特征：**Voice-First 声画锁相环**（先用 `speech-2.8-hd` 生成旁白并提取毫秒级字幕时间戳反推总帧数）+ **三明治光学合成**（底层 `image-01` 无字光学底板 + 中层遮罩 + 顶层确定性代码 UI + 底部同步字幕）+ `-7.5 dB` 包络闪避混音。

---

## 二、去 AI 塑料感的 7 条硬核工程铁律（全路线强制遵守）

详细底层排障字典见 `references/seven-laws-and-pitfalls.md`，编写任何代码前必须严格执行：

1. **纯时间函数 `window.seek(t)`**：严禁 CSS `transition`、`@keyframes`、`setInterval` 或跨帧累加状态；任意时刻调用 `window.seek(7.25)` 与顺序播放到 `7.25s` 必须像素级一致。
2. **闭式二阶阻尼弹簧（`zeta = 0.84`）**：摒弃果冻回弹（bouncy easing），统一使用临界/微欠阻尼阶跃响应（仅保留约 `0.8%` 微过冲），复刻 Apple 发布会物理阻尼感。
3. **节拍网格与声波波峰对齐**：无旁白片锁定 `120 BPM`（`1 拍 = 0.5s`，`1 小节 = 2.0s`），音效以**波峰偏移（Peak Offset）**对齐点击瞬间；有旁白片以真实干声采样帧数为主时钟。
4. **反塑料感黑名单（`<banned>`）**：严禁粒子爆炸、RGB 故障色散、廉价霓虹发光汤、镜头光晕、透视网格地板、大标题句末句号；所有动态数字强制开启 `font-variant-numeric: tabular-nums`。
5. **Chromium 合成器三条红线**：
   - 严禁在执行 `scale()` 的元素上声明 `will-change`（会导致位图缓存文字发糊）；
   - 严禁在 `preserve-3d` 元素上直接设置 `opacity < 1` 或 `filter`；
   - `file://` 本地协议下严禁 `<script type="module">`，统一使用经典 `<script src="...">`。
6. **镜头内 3 子帧 `tmix` 快门模糊 + 响度归一**：以 4 个独立无头 Chrome 进程分片并发，每帧在**当前镜头切点边界内**采样 3 个子帧经 FFmpeg `tmix=frames=3:weights='1 2 1'` 合成 170° 快门动态模糊（零跨镜鬼影）；混流严禁使用 `-shortest`，音频锁定 `-ar 48000` 与 `-14 LUFS`。
7. **运行时 `getBoundingClientRect()` 测靶心**：严禁手猜硬编码像素坐标，指针点击与波纹必须在运行时实时测量目标 DOM 中心点，并用真实项目图标替代灰框占位符。

---

## 三、标准四步执行与三道质检门禁（3-Gate QA）

可复制 `assets/stage-starter.html`、`scripts/render.js`（配同目录 `scripts/package.json`）与 `scripts/audio_synth.py` 到新建视频工程目录（如 `promo-video/`）作为起点：

1. **Step 1 · 源码采风与分镜表**：盘点目标仓库核心卖点、真实配色与图标资产，输出精确到秒的分镜与声音事件表。
2. **Gate 1 · 音频母带与波形门禁**：
   - 运行 `python3 audio_synth.py` 生成 `48000 Hz`、`(N, 2)` C-order 交错有符号 `int16` 立体声 `audio.wav` 及 `audio-waveform.png`；
   - 校验集成响度 `-14 ± 1.0 LUFS`、True Peak `<= -1.5 dBTP`，确认无声道错位削波或静音断档。
3. **Gate 2 · 12 帧探针拼图门禁（`--probe`）**：
   - 运行 `node render.js --probe` 在数秒内生成 12 张关键帧与 `probe-sheet.png`；
   - 逐帧审查文字对比度、中英文孤字换行、卡片溢出遮挡与鼠标落点，修净后再进入全量渲染。
4. **Gate 3 · 60fps 全量超采样与切点终审（`--full`）**：
   - 运行 `node render.js --full` 输出最终 H.264 `yuv420p` BT.709 `tv` 成片，并核验 `ffprobe` 总帧数、音画时长差（`<= 50ms`）与转场切点零残影。

---

## 四、本地环境与权限说明（安全透明声明）

- **本地依赖**：需本机已安装 Google Chrome（或 Chromium）、Node.js（`v22+`，使用原生全局 `WebSocket`，**全程 `npm install = 0`**）、Python 3（含 `numpy`）与 `ffmpeg`。
- **文件读写边界**：仅在当前项目的视频子目录读写前端舞台源码与渲染产物；Chrome 临时缓存目录严格创建于系统 `/tmp/` 并在渲染结束后自动清理，绝不污染工作区或触发云盘同步风暴。
- **凭证安全**：路线 A / B 完全离线本地运行，无需任何 API Key；若启用路线 C（三模态配音与生图），仅在脚本运行时从用户环境变量（如 `MINIMAX_API_KEY`）读取凭证，严禁硬编码、打印或上传任何本地密钥。
