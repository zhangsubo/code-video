The video is complete and all three quality gates pass.

## 交付成果

**成片**：`tokenuse-minimax-promo.mp4` — 44.03s / 2642 帧 / 1920×1080@60fps / h264 yuv420p (tv) + AAC 48kHz 立体声

## 制作链路（全部 MiniMax 独立产出）

| 阶段 | 产物 | 关键实测 |
|---|---|---|
| `speech-2.8-hd` 旁白 | `voiceover-clean.wav` | 6 幕并发合成，212 字，38.15s 净语音；毫秒级 `subtitle_file` 时间戳 → `timeline.js/json`（2642 帧对齐） |
| `image-01` 光学底板 | `backdrops/*.jpg` | 3 张 16:9 无文字摄影底板，统一 1920×1080 |
| 真实图标提取 | `assets.js` | 7 个仓库真实图标（AppIcon.icns + 5 平台 + 吉祥物），sips 缩至 320px 后 base64 内嵌，零手绘假图标 |
| 包络闪避母带 | `audio.wav` | 电钢琴底乐 + 精确对齐交互的 UI 拟音，7.5dB sidechain ducking，**-14.6 LUFS / 真峰值 -2.5 dBFS** |
| 三明治光学合成 | `index.html` + `engine.js` | 底板微推镜 → Scrim → 纯 HTML/CSS/SVG 实机界面 → 毫秒同步字幕条；画面唯一入口 `window.seek(t)`，弹簧 ζ∈[0.82,0.88] 闭式解 |

## 三道门禁结果

- **Gate 1 音频**：7 项断言全过（48kHz / -14±1 LUFS / 真峰值 ≤ -1.5 dBFS）
- **Gate 2 排版**：`mcode-tools` 视觉审查 12 帧联络表 → 首轮判定**未达标**，指出第 8 格 Toast 压住标题、暖光幕白字对比度不足。已修：Toast 移至底部安全区、暖幕改暖墨色遮罩、标题加投影，复审通过
- **Gate 3 成片**：`videos_understand` 首轮判定**音轨致命损坏**（撕裂杂音、无旁白）。本地复算定位到两处叠加缺陷：立体声 WAV 写成平面序、16bit 转换误加 +32768 直流偏置（导致反相削波）。修复后混音与原声相关性由 0.007 升至 **0.97–0.99**，终审结论"完全符合发布标准"

## 过程中修正的实质缺陷

`window.seek` 未挂载全局（探针全为空帧）→ 已修；后台标签页合成器节流（仅 1/4 进度）→ 改为 4 个独立 Chrome 实例；`tmix` 组帧边界与 mjpeg 探测吞帧 → 预热帧 + `select` 精确取帧；`-shortest` 按音频长度截掉 3 帧 → 移除后帧数精确 2642。

<deliver-assets>
<media type="video" src="tokenuse-minimax-promo.mp4" name="tokenuse-minimax-promo.mp4" />
</deliver-assets>

所有产出严格位于 `promo-video-minimax/`，未读取或修改 `promo-video/`、`promo-video-kimi/` 及仓库其他既有文件；密钥仅运行时读取，未写入任何文件或日志。