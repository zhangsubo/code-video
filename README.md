# 用代码拍视频（Code-Rendered Video Studio）

> 从 [`joeseesun/opus-video-prompts`](https://github.com/joeseesun/opus-video-prompts) 出发，系统沉淀面向 **Gemini**、**Kimi Code（Orca 编排）** 与 **MiniMax 三模态（文字 + 图像 + 语音）** 的零外部 `npm` 依赖商业级代码视频方案、可复用提示词套件（Copy-Ready）、完整实战工程与零估算遥测评测报告。

---

## 一、核心理念：为什么「代码渲染 + 多模态协同」是产品视频的最优解？

纯 AI 视频生成模型（Sora / Veo / Hailuo 等）擅长光影氛围，但面对软件界面、小字号数字与品牌图标时极易出现乱码与形变；而传统纯单模态代码视频（HTML/CSS/SVG + Headless Chrome + FFmpeg）虽然**文字与 UI 100% 矢量锐利、弹簧曲线精确可控**，却容易陷入「无旁白默片感」与「纯 CSS 渐变塑料感」。

本项目以真实开源 macOS 应用 [`TokenUse`](https://github.com/zhangsubo/token-use) 为统一考题，横向实测了三套渐进式原生方案，完整验证了从**单模态确定性代码视频**到**三模态有声光学合成大片**的演进路径：

| 方案版本 | 方案拆解与质检图谱 | 工程源码目录 | 时长 / 帧数 | 核心技术特征与导演风格 | 净耗时 | 活跃 Token (`In+Out`) |
|---|---|---|---:|---|---:|---:|
| **01 · Gemini 版** | [01-gemini-scheme.md](docs/01-gemini-scheme.md) | [cases/tokenuse-gemini/](cases/tokenuse-gemini/) | `24.00s` / `1440` 帧 | 百万上下文源码级复刻 + 连续暗色毛玻璃桌面流 + 原生 `.mp4` 视听直读终审 | **22m 15s** | **316.8K** |
| **02 · Kimi 版（Orca）** | [02-kimi-scheme.md](docs/02-kimi-scheme.md) | [cases/tokenuse-kimi/](cases/tokenuse-kimi/) | `24.00s` / `1440` 帧 | 瑞士国际主义暖白纸感 ↔ 曜石黑 Bento 12 小节硬切 + 声波图视觉卡点门禁 | **40m 11s** | **493.6K** |
| **03 · MiniMax 三模态版** | [03-minimax-trimodal-scheme.md](docs/03-minimax-trimodal-scheme.md) | [cases/tokenuse-minimax/](cases/tokenuse-minimax/) | **`44.03s` / `2642` 帧** | **`speech-2.8-hd` 发布会男声旁白与毫秒级时间戳主时钟 + `image-01` 摄影级底板 + 代码锐利 UI + `mcode-tools` 视听自愈** | **40m 04s** | **617.3K** |

> 📊 **完整耗时与 Token 账单横评**：详见 [docs/04-benchmark-gemini-kimi-minimax.md](docs/04-benchmark-gemini-kimi-minimax.md)。  
> 💡 **轻量仓库说明**：为保持 Git 树轻快干净，本仓库仅收录全套零依赖源码、提示词、AI 光学底板与 PNG 质检图谱（不含本地编译产出的 `.mp4` 与 `.wav` 大体积二进制文件）。克隆后可直接双击各案例下的 `index.html` 在浏览器拖拽预览，或按下方命令在本地一键合成音轨并渲染 `1080p @ 60fps` 成片。

---

## 二、项目目录结构

```text
.
├── README.md                                  # 项目总览与快速上手指南
├── AGENTS.md                                  # AI 智能体工作区规范（可直接将本仓库作为视频工坊调用）
├── LICENSE                                    # MIT 开源协议
├── docs/                                      # 完整方案拆解与零估算实测评测报告
│   ├── 01-gemini-scheme.md                    # Gemini 方案与去 AI 塑料感 7 条工程铁律
│   ├── 02-kimi-scheme.md                      # Kimi Code + Orca 编排方案与声波视觉门禁
│   ├── 03-minimax-trimodal-scheme.md          # MiniMax 文字×图像×语音三模态架构与自愈实录
│   └── 04-benchmark-gemini-kimi-minimax.md    # 三方实测耗时、Token 账单与单位秒性价比深度对比
├── prompts/                                   # 可直接复制到任意新项目的实战手册与导演角色定义（Copy-Ready）
│   ├── gemini-video-playbook.md
│   ├── kimi-video-playbook.md
│   ├── kimi-video-director.md
│   ├── minimax-video-playbook.md
│   └── minimax-video-director.md
└── cases/                                     # 三套完整可预览、可重渲的实战源码工程（npm install = 0）
    ├── tokenuse-gemini/                       # 01: 单文件纯函数舞台 + 12 帧探针图谱
    ├── tokenuse-kimi/                         # 02: 四模块解耦引擎 + 声波网格图 + 11 切点零残影拼图
    └── tokenuse-minimax/                      # 03: 毫秒级语音时间轴 timeline.js + 3 张 AI 光学底板 + 闪避混音器
```

---

## 三、快速体验与本地复现指南

### 1. 零安装交互式舞台预览
所有案例均遵循 `window.seek(t)` 纯时间函数架构（无任何外部 `npm` 依赖）：
- 直接用 Chrome 浏览器打开任意案例下的 `index.html`（如 `cases/tokenuse-gemini/index.html`），即可实时播放或拖拽时间轴逐帧检视动画与排版（渲染模式 `?render=1` 会自动隐藏底部控制栏）。

### 2. 本地一键合成音轨与 60fps 快门模糊成片
前置环境（macOS）：本机安装有 Google Chrome、Node.js（`v22+`，原生内置全局 `WebSocket`）、FFmpeg 与 Python 3（含 `numpy`）。

```bash
# 示例 A：复现 Gemini / Kimi 无旁白方案成片
cd cases/tokenuse-gemini   # 或 cases/tokenuse-kimi
python3 audio.py           # 合成 48kHz 立体声 120 BPM 配乐与峰值对齐拟音 (audio.wav)
node render.mjs --probe    # 数秒内生成 12 关键帧巡检拼图 probe-sheet.png
node render.mjs --full     # 4 并发 180fps 子帧 tmix 动态模糊渲染输出 1080p 60fps MP4

# 示例 B：复现 MiniMax 三模态有声大片（需配置 MINIMAX_API_KEY）
cd cases/tokenuse-minimax
export MINIMAX_API_KEY="your_api_key_here"
python3 build-voiceover.py # 调用 speech-2.8-hd 合成旁白干声并更新毫秒时间轴（已内置 timeline.js 可跳过生图）
python3 audio_mix.py       # 生成 -7.5dB 包络闪避混音母带 (audio.wav)
node render.mjs --full     # 合成最终 44.03s 有声产品大片
```

### 3. 为你自己的新项目拍一支代码视频（3 步复用 `prompts/`）
- **追求 20 分钟极速出片（无旁白）**：复制 [prompts/gemini-video-playbook.md](prompts/gemini-video-playbook.md) 或参考 [docs/01-gemini-scheme.md](docs/01-gemini-scheme.md) 中的触发提示词交给 Gemini。
- **追求高对比度瑞士杂志感大字报（无旁白）**：使用 `kimi --yolo --agent-file prompts/kimi-video-director.md` 配合 [prompts/kimi-video-playbook.md](prompts/kimi-video-playbook.md)。
- **追求发布会级真人配音 + 摄影底板商业大片**：使用 `mcode exec --permission full --model minimax/MiniMax-M3 --append-system-prompt-file prompts/minimax-video-director.md` 配合 [prompts/minimax-video-playbook.md](prompts/minimax-video-playbook.md)。

---

## 四、Roadmap（后续探索更新预告）

- [ ] **跨模型合体编排工作流**：串联 **Gemini**（百万上下文源码穿透与本地 `.mp4` 视听终审）+ **Kimi**（凝练中文分镜金句与瑞士昼夜版式）+ **MiniMax**（发布会人声主时钟与 AI 摄影光学底板），探索各取所长的混合制片上限。
- [ ] **Google 原生多模态全家桶实测**：结合 Google AI 套餐附赠的 Cloud Credits 与 Flow / Whisk 生态，横向对比纯血多模态管线的成本与成片表现。

---

## 五、开源协议

本项目基于 [MIT License](LICENSE) 开源。

---

## 六、致谢

本项目的工程方法论拆解与提示词体系设计，深受开源仓库 [`joeseesun/opus-video-prompts`](https://github.com/joeseesun/opus-video-prompts) 的启发：

- 感谢仓库维护者 **[@joeseesun](https://github.com/joeseesun)** 对社区代码生成视频案例、原版提示词与多技术栈路线的系统性收集、分类与开源归档；
- 感谢该仓库中所收录提示词与代表性案例的各位原作者——包括 **@twoclipping (zero)**、**Danny Stuart**、**WY**、**Deedy**，以及所有在 GitHub、X、B 站、Linux.do 等社区无私公开原版 Prompt、源码工程与实战经验的创作者们。正是这些开放共享的一手沉淀，让跨模型确定性代码拍片的探索得以站在坚实的肩膀上继续向前。
