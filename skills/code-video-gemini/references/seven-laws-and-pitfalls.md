# 去 AI 塑料感 7 条工程铁律与底层排障字典

本清单提炼自近 60 个社区代码视频案例与三方模型实机踩坑复盘，用于彻底消除「廉价网页录屏感」「跨镜鬼影」与「音频撕裂杂音」。

---

## 1. 渲染与浏览器合成器排障

### 坑点 A：放大特写时 UI 字体边缘发虚模糊
- **根因**：在父容器或卡片上写了 `will-change: transform` 或固定栅格化层，Chrome 按 `1x` 分辨率缓存纹理后再做 GPU 放大。
- **解法**：删除所有缩放容器上的 `will-change`；直接用 `transform: translate3d(x, y, 0) scale(s)` 让文本每帧按目标字号锐利重绘。

### 坑点 B：3D 倾斜卡片（`preserve-3d`）突然失去透视被拍扁
- **根因**：W3C CSS Transforms Level 2 规范规定，`opacity < 1`、`filter`、`backdrop-filter` 或 `overflow: hidden` 会强制创建 Grouping Property，把子级 `transform-style: preserve-3d` 压平为 2D 平面。
- **解法**：透明度淡入淡出律动写在最外层正交包装器或最内层叶子节点上，绝不直接挂在 `preserve-3d` 容器自身。

### 坑点 C：`Target.createTarget` 传入宽高导致右侧/底部黑边裁切
- **根因**：部分 Headless Chrome 版本在 `Target.createTarget({ url, width, height })` 时窗口边框计算不一致。
- **解法**：`Target.createTarget({ url })` 仅传 `url`，紧接着对 `sessionId` 调用 `Emulation.setDeviceMetricsOverride({ width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })`。

### 坑点 D：单 Chrome 实例开 4 个后台 Tab 越跑越慢，或 PNG 截帧卡死 I/O
- **根因**：后台 Tab 易触发合成器节流；含摄影背景图的全画幅 `PNG` 单帧高达 `2–3 MB`，千帧管道吞吐瓶颈严重。
- **解法**：启动 **4 个独立无头 Chrome 子进程**（各自绑定独立 `/tmp/` 临时用户目录，退出时在 `finally` 中 `rmSync` 清理），截帧统一用 `Page.captureScreenshot({ format: 'jpeg', quality: 95 })`（体积缩小 75% 且肉眼无损，渲染提速约 3 倍）。

---

## 2. 快门动态模糊与转场零鬼影

- **170° 电影快门超采样**：输出 `60fps` 时，对第 `f` 帧（中心时刻 `t = (f + 0.5) / 60`）采样 `[t - 1/240, t, t + 1/240]` 三个子帧，管道喂入 `180fps` `image2pipe`，由 FFmpeg `tmix=frames=3:weights='1 2 1'` 加权融合后每 3 帧取 1 帧输出。
- **镜头边界硬钳制（防跨镜重影）**：若 `t` 位于镜头 `[sceneStart, sceneEnd]` 内，三个子帧时间必须执行 `clamp(subT, sceneStart + 0.0001, sceneEnd - 0.0001)`，确保切点前后绝不把上一幕与下一幕混融在同一帧里。

---

## 3. 音频合成与 FFmpeg 混流红线

### 坑点 E：`-14 LUFS` 数值检测全绿，但播放全是刺耳电锯破音
- **根因**：Python 标准库 `wave.writeframes()` 要求双声道 16-bit PCM 数据在内存中严格为 **`(N, 2)` C-order 交错有符号 `int16`（`<i2`，范围 `[-32767, 32767]`）**。若误写成 `(2, N)` 平面数组直接 `.tobytes()`，或对 `int16` 误加 `+ 32768` 无符号直流偏置，波形会发生周期性整数溢出折返，而 `ebur128` 仍可能测出 `-14.0 LUFS`！
- **解法**：
  ```python
  stereo = np.column_stack([left, right])  # 确认 shape == (N, 2)
  assert stereo.ndim == 2 and stereo.shape[1] == 2
  pcm = np.round(np.clip(stereo, -0.98, 0.98) * 32767.0).astype('<i2')
  wf.writeframes(pcm.tobytes(order='C'))
  ```

### 坑点 F：`loudnorm` 暗升采样率到 `96000 Hz` 或 `-shortest` 吞掉末尾帧
- **根因**：FFmpeg 的 `loudnorm` 滤镜内部为做真峰值过采样，常将输出流自动翻倍为 `96kHz` 或 `192kHz`；混流加 `-shortest` 可能因 AAC 帧边界微差截断视频最后 2–3 帧。
- **解法**：`loudnorm` 后显式接 `,aresample=48000`，混流命令锁定 `-ar 48000 -ac 2` 且**严禁传 `-shortest`**；真峰值目标设为 `TP=-2.5` 预留 AAC 有损编码裕量。
