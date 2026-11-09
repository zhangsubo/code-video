# Gemini「用代码拍视频」实战方案（基于 `opus-video-prompts` 深度提炼与适配）

> 源自对 [`joeseesun/opus-video-prompts`](https://github.com/joeseesun/opus-video-prompts)（54 个全网案例、18 份完整提示词、9 条技术路线）的系统拆解，结合 **Gemini 超长上下文（源码级还原）+ 原生多模态视频/音频理解（直接看 MP4 成片审片返工）** 打造的零外部 npm 依赖出片工作流。

---

## 一、`opus-video-prompts` 核心规律提炼：为什么大模型写视频能达到商业级质感？

通过对仓库中 54 个案例（尤其是 `@twoclipping (zero)` 的高收藏模板 #15/#16、`Danny Stuart` 的产品宣传片 #12/#13、`PDoomVideo`、`WY` 的科普长片 #09）的横向解剖，高质量代码视频不是靠“堆砌炫酷形容词”，而是靠 **7 条硬核工程铁律**：

1. **纯时间函数确定性渲染（`window.seek(t)`）**
   - 严禁使用 CSS `transition`、`@keyframes`、`setInterval` 或跨帧可变状态。
   - 每一帧的所有 DOM/Canvas 属性（位移、透明度、弹簧形变、圆环角度、数字滚动、鼠标位置）**必须唯一由秒数 `t` 闭式计算得出**。如此既能消除无头浏览器截帧抖动，又能开启多标签页并发加速渲染。
2. **闭式物理弹簧（Closed-Form Spring）替代廉价缓动**
   - 摒弃模板感极强的回弹动画（bouncy easing），统一使用临界/微欠阻尼二阶系统阶跃响应（$\zeta \approx 0.82\text{–}0.86$），只保留约 `0.8%` 的微过冲，获得 Apple 发布会的丝滑阻尼感。
3. **BPM 节拍网格锁死剪辑与交互（Beat-Grid Lock）**
   - 设定明确曲速（如 `120 BPM`：`1 拍 = 0.5s`，`1 小节 = 2.0s`）。镜头切换（Hard Cut / Match Cut）严格踩在小节重拍（Downbeat），UI 点击与开关翻转踩在正拍，音效**波峰位置（Peak Offset）**对齐事件时刻而非音频文件开头。
4. **负面禁用清单（Anti-Slop `<banned>`）去 AI 模板味**
   - 显式禁止：粒子爆炸、RGB 故障分离、镜头炫光、霓虹泛光汤、透视网格地板、大标题句号、镜头抖动。
   - **渲染器避坑铁律**：禁止在被缩放容器上挂 `will-change`（会导致 Chrome 位图缓存文字发糊）；禁止在 `preserve-3d` 元素上直接设 `opacity`/`filter`（会导致 3D 层被拍扁）。
5. **真实产品资产与源码级 UI 还原（Real Assets Only）**
   - 拒绝空洞的灰框占位卡片；直接嵌入项目真实图标、吉祥物、真实配色（`sRGB`）与真实业务指标，并用 `getBoundingClientRect()` 在运行时实时测量按钮中心，确保鼠标点击与波纹零像素偏差。
6. **子帧超采样快门动态模糊（Subframe `tmix` Motion Blur）+ `-14 LUFS` 响度标准化**
   - 每输出 1 帧（60fps）在当前镜头边界内采样 `[t - Δt, t, t + Δt]` 3 个子帧，经 `ffmpeg tmix=frames=3:weights='1 2 1'` 融合出真实 170° 快门动态模糊（同时钳制在镜头切点内防止跨镜鬼影），音频经 `loudnorm=I=-14:TP=-1.5:LRA=11` 母带级响度归一。
7. **先分镜、先抽帧自检，再全量渲染**
   - 先对齐节拍分镜表，再输出关键帧巡检图（Contact Sheet），修净文字折行、重叠与对比度问题后再跑全量 60fps 渲染。

---

## 二、为什么不能照搬 Claude 提示词？面向 Gemini 的 4 项专属增强

| 维度 | Opus 5.5 原始做法 | **Gemini 专属升级方案（Antigravity / Gemini CLI）** |
|---|---|---|
| **审片自检闭环（最大优势）** | 只能截静态 JPG 单张看图，无法感知运动节奏与音画同步 | **三级多模态质检（3-Gate Multimodal QA）**：Gemini 原生支持**直接观看完整 `.mp4` 视频与音轨**！不仅在 Gate 2 看 `3×4` 关键帧拼图查排版，还能在 Gate 3 直接审看 `.mp4` 成片核验转场丝滑度、动态模糊与卡点同步 |
| **代码库上下文穿透** | 常需手动粘贴品牌色、文案或上传多张截图 | 利用 **Gemini 百万级上下文窗口**直接通读项目源码（如 SwiftUI 视图色值、圆角参数、数据模型与 `Resources/*.png`），一键生成像素级还原的产品级 UI，无需人工喂图 |
| **工具链极简化（零 npm 依赖）** | 频繁安装 `playwright`（下载数百 MB 浏览器）或 `remotion` 脚手架 | **原生瘦身管线**：`index.html`（单文件场景）+ `audio.py`（Python `wave` + `numpy` FFT 合成音轨）+ `render.mjs`（Node 原生 `WebSocket` 直连本机 Chrome CDP 4 并发截帧管道直推 `ffmpeg`），**0 个外部 npm 包** |
| **中文排版与几何约束** | 英文提示词未考虑中英混排换行，容易出现孤字折行或撑破卡片 | 在 Gemini 提示词模板中内置 **CJK 排版护栏**：显式画布安全边距（`110px`）、等宽数字（`tabular-nums` 防滚动抖动）、明确列宽网格与不换行徽章约束 |

---

## 三、Gemini 代码生成视频标准三阶段工作流（3-Gate Workflow）

```text
[Gate 1: 源码采风 + 节拍分镜表]
  读取目标仓库 README / UI 源码 / 真实图标资源 ──▶ 输出 120 BPM 小节级分镜与音效时刻表
        │
        ▼
[Gate 2: 确定性场景 + 12 帧拼图自检 (--probe)]
  编写 index.html (纯 window.seek(t)) + audio.py + render.mjs ──▶ 4 秒产出 probe-sheet.png
  Gemini 视觉检查：文字溢出？鼠标点偏？对比度不足？ ──▶ 定向微调 DOM / 实时测量坐标
        │
        ▼
[Gate 3: 并发超采样渲染 (--full) + 原生看片终审]
  4 标签页并发渲染 3× 子帧 ──▶ FFmpeg tmix 动态模糊 + -14 LUFS 混流 MP4
  Gemini 直接读取 .mp4 视频复核节奏、转场与音画卡点 ──▶ 交付成片
```

---

## 四、可直接复制的 Gemini 通用产品宣传片提示词模板（Copy-Ready）

将以下提示词粘贴给 Gemini（Antigravity 或 Gemini CLI），即可为任意软件/开源项目生成商业级代码渲染产品视频：

```xml
<role>
你是一位兼具 Apple 发布会视觉品味与图形学工程能力的 Motion Design Director。请深度阅读当前项目的源码、文档与图标资源，用纯确定性前端代码与本地渲染管线，为本项目制作支 1920×1080 @ 60fps 的商业级产品发布视频（MP4）。
</role>

<creative_direction>
- 时长与节拍：24 秒，120 BPM（1 拍 = 0.5s，1 小节 = 2.0s，共 12 小节 / 1440 帧）。
- 视觉语言：高对比深色玻璃拟态或纯净极简设计，单画面单核心信息，留白充裕，数字全部开启 `font-variant-numeric: tabular-nums`。
- 真实素材：直接提取并内嵌项目仓库中的真实应用图标、品牌配色与真实 UI 组件结构，严禁使用灰框占位符。
- 交互驱动：用真实的 macOS 指针移动、悬停、按压缩放与点击波纹驱动界面状态变化；所有点击目标必须通过运行时 `getBoundingClientRect()` 动态取中心点，严禁手猜硬编码像素坐标。
</creative_direction>

<banned>
严禁出现：粒子爆炸、RGB 故障色散、霓虹发光汤、镜头光晕、透视网格地面、卡通回弹缓动（bouncy easing）、大标题句号。
渲染红线：严禁在缩放容器上使用 `will-change`（会导致文字位图化模糊）；严禁使用 CSS `transition`、`@keyframes`、`setInterval` 或任何跨帧状态；严禁在 `preserve-3d` 元素上直接设置 `opacity` 或 `filter`。
</banned>

<architecture>
在 `promo-video/` 目录下构建零外部 npm 依赖的极简三件套：
1. `index.html`（1920×1080）：
   - 暴露异步纯函数 `window.seek(t)`，每一帧的所有样式仅由 `t` 闭式计算。
   - 使用闭式二阶阻尼弹簧 `spring(t, t0, omega=18, zeta=0.84)`。
   - 非渲染模式下底部提供 Play/Pause 与进度拖拽条便于浏览器实时预览；`?render=1` 下自动隐藏控制条。
2. `audio.py`：
   - 仅用 Python 标准库 `wave` + `numpy` 合成 48kHz 立体声 120 BPM 配乐与 UI 交互音效（点击、滑动、通知提示音）。
   - 音效以其峰值偏移（Peak Offset）精确对齐视觉事件时刻，并用 `ffmpeg loudnorm=I=-14:TP=-1.5:LRA=11` 生成 `audio.wav`。
3. `render.mjs`：
   - 使用 Node.js 原生 `WebSocket` 直连本机 Chrome `--headless=new`（CDP 协议），无需安装 Playwright/Puppeteer。
   - 支持 `--probe`（秒出 12 张关键帧与 `3×4` `probe-sheet.png` 拼图）和 `--full`（4 个标签页并发超采样，每帧在当前镜头切点边界内取 `[t-1/210, t, t+1/210]` 3 个子帧，管道输入 `ffmpeg` 执行 `tmix=frames=3:weights='1 2 1'` 快门动态模糊与 H.264 `crf 16`、`yuv420p tv` 色域 + AAC 混流）。
</architecture>

<qa_gates>
严格执行三阶段多模态质检：
1. Gate 1：先设计 12 小节分镜与音效卡点表。
2. Gate 2：运行 `node render.mjs --probe`，用视觉工具亲自检查 `probe-sheet.png` 及高密度 UI 单帧，修复任何中英文折行、元素重叠、留白失衡或鼠标点偏问题，重跑 `--probe` 直至完美。
3. Gate 3：运行 `node render.mjs --full` 导出最终 MP4，直接读取观看 `.mp4` 视频文件复查流畅度、镜头切点与音画同步后交付。
</qa_gates>
```

---

## 五、本方案在 `TokenUse` 产品介绍视频中的落地目录

- `promo-video/index.html`：1920×1080 确定性动画主场景（6 幕 12 小节，复刻毛玻璃边缘侧边栏、彗星活跃环、5 平台电池配额 HUD、Codex 一键原子切号、官方跨端计费对账面板、跨屏磁吸/隐私打码/48h 重置券通知、Swift 6 原生架构与开源尾版）。
- `promo-video/assets.js`：从 `Sources/TokenUse/Resources/` 提取的 5 大平台真实图标与吉祥物 Base64 资源包。
- `promo-video/audio.py` & `audio.wav`：120 BPM 立体声电子氛围配乐 + 采样级对齐的 UI 交互音效（`-14 LUFS`）。
- `promo-video/render.mjs`：零依赖 Node CDP 4 并发无头 Chrome 超采样动态模糊渲染器。
- `promo-video/tokenuse-promo.mp4`：最终 1080p 60fps 产品宣传片成片。
