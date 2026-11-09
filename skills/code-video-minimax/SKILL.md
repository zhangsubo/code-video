---
name: code-video-minimax
version: "1.0.0"
description: "结合语音合成（TTS 毫秒级时间戳）、文生图光学底板与确定性前端代码的发布会级有声宣传片工作流（零 npm 依赖，1080p 60fps）。首创『Voice-First 人声锁相环』与『三明治光学合成架构』（AI 画桌面光影底板 + 代码画 100% 锐利 UI + -7.5dB 包络闪避混音），内置双声道交错 PCM 与干声包络相关性自检，彻底告别默片感与撕裂杂音。"
---

# MiniMax 三模态有声大片（Code Video · Tri-Modal Edition）

将**真人级语音合成（毫秒级字幕主时钟）× AI 摄影级光学底板 × 100% 确定性前端代码 UI**深度融合，解决传统代码视频「无旁白默片感」与「纯 CSS 渐变塑料感」两大痛点，直出 Apple / Linear 发布会质感的 `1920×1080 @ 60fps` 有声产品大片。

> 开源配套仓库与听觉自愈实录：`https://github.com/zhangsubo/code-video`

---

## 一、两大核心架构创新

### 1. Voice-First 声画锁相环（人声反推总帧数）
严禁先写死每幕 4 秒再硬塞配音！标准流水线必须**先声夺人**（参考 `scripts/build_voiceover_template.py`）：
1. 调用 MiniMax `speech-2.8-hd`（开启 `subtitle_enable: true`）合成每幕干声，提取毫秒级分句时间戳；
2. 转码为 `48000 Hz` WAV 精确测量采样数，每幕前后留出自然呼吸气口（前导 `0.38s`、尾韵 `0.45s`，收尾幕留 `1.35s` 余韵），拼接为 `voiceover-clean.wav`；
3. 自动生成全局唯一真值源 `timeline.js`（`window.TIMELINE`）与 `timeline.json`，所有画面切镜、弹簧触发与底部字幕均严格锁死在真实人声时间窗上。

### 2. 三明治光学合成架构（Sandwich Layer Compositing）
严格遵守**「AI 画光影质感，代码画精准界面」**的黄金分工：
- **Layer 0（AI 光学底板）**：调用 `image-01` 生成 3 张**严禁含任何文字或 UI 框**的 `16:9` 抽象摄影底板（暗色曜石玻璃折射、暖光洞石桌面、深海蓝宝石散射），在 `window.seek(t)` 中赋予 `scale(1.02 -> 1.07)` 缓慢推镜；
- **Layer 1（对比度遮罩）**：叠加径向暗角与半透明遮罩，确保文字对比度恒定 `> 7:1`；
- **Layer 2（确定性代码 UI）**：提取仓库真实图标，用 `zeta = 0.84` 闭式阻尼弹簧与 `getBoundingClientRect()` 实时靶心光标驱动锐利产品界面；
- **Layer 3（同步高亮字幕）**：底部安全区随 `window.TIMELINE` 分句时间戳柔和呼吸切换。

---

## 二、包络闪避混音与听觉自愈门禁（必守）

详细规范见 `references/minimax-trimodal-playbook.md` 与 `scripts/audio_ducking_mix.py`：

1. **`-7.5 dB` 侧链包络闪避（Sidechain Ducking）**：计算干声平滑包络（Attack `25ms` / Release `280ms`），人声响起时自动压低环境底乐 `-7.5 dB`，气口停顿处自然回升。
2. **双声道 PCM 铁律与干声相关性断言（防假达标破音）**：
   - Python `wave` 写入立体声 `int16` 时必须确认数组形状为 **`(N, 2)` C-order 交错有符号 `<i2`**（严禁写成 `(2, N)` 平面序或误加 `+32768` 无符号偏置，否则即使 `ebur128` 测出 `-14.0 LUFS` 也会产生刺耳电锯撕裂声）；
   - 混音脚本自动计算母带与干声的包络相关系数（断言 `corr > 0.65`），若配置有多模态音视频理解工具（如 `videos_understand` / `audios_understand`），必须在 Gate 3 做一次真耳终审。
3. **4 进程 `JPEG (quality: 95)` 超采样**：含摄影底板时用 `JPEG 95` 管道喂入 4 个独立 Chrome 进程执行 3 子帧 `tmix` 快门模糊；混流严禁 `-shortest`，锁定 `-ar 48000` 与 `TP=-2.5`。

---

## 三、本地环境与权限安全声明

- **本地依赖**：需本机安装 Google Chrome、Node.js（`v22+` 原生 `WebSocket`，`npm install = 0`）、Python 3（`numpy`）与 `ffmpeg`。
- **API 凭证透明规范**：调用 `speech-2.8-hd` 与 `image-01` 需用户自行在本地环境变量设置 `MINIMAX_API_KEY`；脚本仅在运行时从环境变量读取凭证并请求官方接口 `api.minimaxi.com`，**严禁硬编码、打印、缓存明文密钥或向任何第三方地址传输数据**。Chrome 临时目录创建于 `/tmp/` 并自动清理。
