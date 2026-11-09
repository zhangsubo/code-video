#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TokenUse · MiniMax 三模态发布视频 —— 包络闪避母带音轨合成

仅使用标准库 wave + numpy + /opt/homebrew/bin/ffmpeg（严禁 import scipy）。

  1. 合成克制温润的发布会电钢琴泛音底乐 + 温暖低频脉冲
  2. 在精确对齐交互时刻叠加 UI 点击 / 切换轻拟音
  3. 依据 voiceover-clean.wav 的平滑包络（Attack 25ms / Release 280ms）执行
     Sidechain Ducking：人声说话时底乐压低 7.5dB，气口与收尾自然回升
  4. ffmpeg loudnorm=I=-14:TP=-2.5:LRA=11,aresample=48000 -> 48kHz 立体声 audio.wav
  5. 输出 1920x360 的 audio-waveform.png 并用 ebur128 校验
"""

import json
import math
import subprocess
import wave
from pathlib import Path

import numpy as np

BASE = Path(__file__).resolve().parent
TMP = BASE / ".tmp"
TMP.mkdir(parents=True, exist_ok=True)
FFMPEG = "/opt/homebrew/bin/ffmpeg"
SR = 48000
DUCK_DB = 7.5
VO_PEAK = 0.90      # 人声峰值目标（绝对主角）
MUSIC_PEAK = 0.22   # 底乐峰值目标（人声的约 1/4，闪避后再降 7.5dB）
ATTACK_S = 0.025
RELEASE_S = 0.280
TARGET_I = -14.0
TARGET_TP = -2.5
TARGET_LRA = 11.0


# --------------------------------------------------------------------------
# 读取
# --------------------------------------------------------------------------
def read_wav(path):
    with wave.open(str(path), "rb") as w:
        n, sr, ch, sw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)
    dt = {1: np.uint8, 2: np.int16, 4: np.int32}[sw]
    data = np.frombuffer(raw, dtype=dt).astype(np.float32)
    if sw == 1:
        data = (data - 128.0) / 128.0
    elif sw == 2:
        data = data / 32768.0
    else:
        data = data / 2147483648.0
    if ch == 2:
        data = data.reshape(-1, 2).T
    else:
        data = data.reshape(1, -1)
    return data, sr


def write_wav(path, data, sr=SR):
    d = np.clip(data, -1.0, 1.0)
    # 有符号 16bit：直接线性缩放，不要加 32768 直流偏置
    inter = np.clip(np.round(d * 32767.0), -32768, 32767).astype(np.int16)
    # WAV 立体声必须按帧交错 (L0,R0,L1,R1,...)：转置后 C-order 即为交错序
    frames = inter.T if inter.ndim == 2 else inter
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2 if inter.ndim == 2 else 1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(frames.tobytes())


# --------------------------------------------------------------------------
# 电钢琴合成
# --------------------------------------------------------------------------
def ep_note(freq, dur, sr=SR, vel=1.0):
    """单音电钢琴：非谐波分音 + 指数衰减，柔和起音"""
    n = int(dur * sr)
    if n <= 0:
        return np.zeros(0, dtype=np.float32)
    t = np.arange(n, dtype=np.float32) / sr
    partials = [(1.0, 1.00, 1.10), (2.0, 0.28, 1.55), (3.0, 0.11, 2.10),
                (4.01, 0.05, 2.90), (5.0, 0.025, 3.70), (6.02, 0.012, 4.60)]
    out = np.zeros(n, dtype=np.float32)
    for mult, amp, dec in partials:
        det = 1.0 + (0.0006 * (mult - 1.0))
        out += (amp * np.sin(2 * np.pi * freq * det * t) * np.exp(-dec * t)).astype(np.float32)
    # 柔和起音 + 尾部释放
    at = int(0.012 * sr)
    env = np.ones(n, dtype=np.float32)
    env[:at] = np.linspace(0.0, 1.0, at) ** 1.6
    rel = int(min(0.28 * sr, n))
    if rel > 1:
        env[-rel:] *= np.linspace(1.0, 0.0, rel) ** 1.4
    return out * env * vel * 0.115


def render_music(duration, sr=SR):
    """克制温润的发布会电钢琴底乐：Am9 - Fmaj7 - Cmaj7 - G，每和弦 11 秒"""
    total = int(duration * sr)
    music = np.zeros(total, dtype=np.float32)
    bass = np.zeros(total, dtype=np.float32)

    chords = [
        [110.00, 164.81, 220.00, 261.63, 329.63, 493.88],   # Am9
        [87.31, 130.81, 174.61, 220.00, 329.63, 440.00],    # Fmaj7
        [130.81, 196.00, 261.63, 329.63, 392.00, 493.88],   # Cmaj7
        [98.00, 146.83, 196.00, 246.94, 293.66, 392.00],    # G
    ]
    chord_len = duration / len(chords)

    for ci, notes in enumerate(chords):
        start = ci * chord_len
        s0 = int(start * sr)
        # 和弦内音符错落进入，模拟琶音触键
        for ni, f in enumerate(notes):
            on = start + ni * 0.085
            o0 = int(on * sr)
            dur = min(chord_len - (on - start) + 1.6, duration - on)
            if dur <= 0:
                continue
            note = ep_note(f, dur, sr, vel=1.0 - ni * 0.055)
            seg = music[o0:o0 + len(note)]
            music[o0:o0 + len(note)] = (seg + note[:len(seg)]).astype(np.float32)

        # 温暖低频根音
        root = notes[0] / 2.0
        bo = int(start * sr)
        bd = min(chord_len + 1.2, duration - start)
        bn = int(bd * sr)
        bt = np.arange(bn, dtype=np.float32) / sr
        bnote = (np.sin(2 * np.pi * root * bt) + 0.22 * np.sin(2 * np.pi * root * 2 * bt)).astype(np.float32)
        bnote *= np.exp(-0.55 * bt)
        bat = int(0.05 * sr)
        benv = np.ones(bn, dtype=np.float32)
        benv[:bat] = np.linspace(0, 1, bat) ** 1.4
        bnote *= benv * 0.11
        bass[bo:bo + bn] += bnote[:min(bn, len(bass) - bo)]

    # 温暖低频脉冲（心跳感，约每 2 秒一次）
    period = 2.0
    npulse = int(duration / period)
    for k in range(npulse):
        o = int((k * period + 0.05) * sr)
        n = int(0.42 * sr)
        if o + n > total:
            break
        pt = np.arange(n, dtype=np.float32) / sr
        f = 58.0 * np.exp(-pt * 1.6)
        pulse = (np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-pt * 8.0)).astype(np.float32)
        bass[o:o + n] += pulse * 0.055

    music = music + bass
    return music


def render_foley(events, sr=SR):
    """UI 点击 / 切换轻拟音：极短噪声爆 + 高频正弦 ping"""
    out = np.zeros(0, dtype=np.float32)
    total = 1
    pieces = []
    for ev in events:
        t0 = ev["t"]
        kind = ev.get("kind", "click")
        if kind == "click":
            dur, f0, noise_amt, amp = 0.055, 2100.0, 0.42, 0.30
        elif kind == "switch":
            dur, f0, noise_amt, amp = 0.085, 1560.0, 0.20, 0.26
        else:  # soft tick
            dur, f0, noise_amt, amp = 0.040, 2650.0, 0.30, 0.17
        n = int(dur * sr)
        t = np.arange(n, dtype=np.float32) / sr
        tone = np.sin(2 * np.pi * f0 * t) * np.exp(-t * 46.0)
        if kind == "switch":
            tone += 0.55 * np.sin(2 * np.pi * f0 * 1.5 * t) * np.exp(-t * 38.0)
        noise = (np.random.default_rng(7).standard_normal(n).astype(np.float32))
        noise = noise * np.exp(-t * 90.0)
        sig = (tone + noise_amt * noise).astype(np.float32) * amp
        pieces.append((t0, sig))
        total = max(total, int((t0 + dur + 1.0) * sr))

    buf = np.zeros(total, dtype=np.float32)
    for t0, sig in pieces:
        o = int(t0 * sr)
        seg = buf[o:o + len(sig)]
        buf[o:o + len(sig)] = (seg + sig[:len(seg)]).astype(np.float32)
    return buf


# --------------------------------------------------------------------------
# 包络闪避
# --------------------------------------------------------------------------
def voice_envelope(vo_mono, sr=SR):
    """平滑包络：Attack 25ms / Release 280ms 单极点"""
    env = np.abs(vo_mono)
    # 轻度去噪门限
    env[env < 0.006] = 0.0
    a_att = math.exp(-1.0 / (ATTACK_S * sr))
    a_rel = math.exp(-1.0 / (RELEASE_S * sr))
    out = np.zeros_like(env)
    prev = 0.0
    for i in range(len(env)):
        x = env[i]
        coef = a_att if x > prev else a_rel
        prev = coef * prev + (1.0 - coef) * x
        out[i] = prev
    peak = float(out.max()) if out.size else 1.0
    if peak > 0:
        out = out / peak
    return np.clip(out, 0.0, 1.0)


def db_gain(env, db):
    """env(0..1) -> 线性增益，1 -> 0dB，1 -> -db dB"""
    g_db = -db * np.clip(env, 0.0, 1.0)
    return np.power(10.0, g_db / 20.0)


# --------------------------------------------------------------------------
# 波形图
# --------------------------------------------------------------------------
def write_waveform_png(audio, path, w=1920, h=360):
    """用 numpy 直接生成 RGB 帧并管道给 ffmpeg 输出 PNG（无 PIL 依赖）"""
    mono = audio.mean(axis=0)
    hop = max(1, len(mono) // w)
    usable = (len(mono) // hop) * hop
    blocks = mono[:usable].reshape(-1, hop)
    env = np.abs(blocks).max(axis=1)
    if len(env) < w:
        env = np.pad(env, (0, w - len(env)))
    env = env[:w]
    peak = float(env.max()) or 1.0
    env = env / peak

    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    # 背景（自上而下的深色渐变）
    for y in range(h):
        k = y / float(h - 1)
        canvas[y, :, 0] = int(9 + 12 * (1 - k))
        canvas[y, :, 1] = int(12 + 16 * (1 - k))
        canvas[y, :, 2] = int(20 + 26 * (1 - k))

    mid = h // 2
    half = int(h * 0.40)
    for x in range(w):
        a = env[x]
        amp = int(a * half)
        if amp <= 0:
            continue
        for y in range(mid - amp, mid + amp + 1):
            if 0 <= y < h:
                k = 1.0 - abs(y - mid) / float(half + 1)
                r = int(90 + 120 * k)
                g = int(200 + 40 * k)
                b = int(190 + 55 * k)
                canvas[y, x] = (min(r, 255), min(g, 255), min(b, 255))

    # 中轴线
    canvas[mid, :, :] = (40, 52, 66)

    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-i", "-",
           "-frames:v", "1", str(path)]
    subprocess.run(cmd, input=canvas.tobytes(), check=True)


# --------------------------------------------------------------------------
def main():
    vo_path = BASE / "voiceover-clean.wav"
    if not vo_path.exists():
        raise SystemExit("!! 缺少 voiceover-clean.wav，请先运行 build-voiceover.py")

    tl = json.loads((BASE / "timeline.json").read_text(encoding="utf-8"))
    vo, vo_sr = read_wav(vo_path)
    duration = vo.shape[1] / float(vo_sr)
    total = int(duration * SR)

    # 重采样到 48k（线性插值，足够）
    if vo_sr != SR:
        idx = np.linspace(0, vo.shape[1] - 1, total)
        chans = [np.interp(idx, np.arange(vo.shape[1]), vo[c]) for c in range(vo.shape[0])]
        vo = np.stack(chans).astype(np.float32)
    vo_mono = vo.mean(axis=0)
    if vo.shape[0] == 1:
        vo = np.repeat(vo, 2, axis=0)

    print(f"[audio] 旁白 {duration:.3f}s，合成底乐 …", flush=True)
    music = render_music(duration)
    music = music[:total] if len(music) >= total else np.pad(music, (0, total - len(music)))

    # 精确对齐交互时刻的拟音
    scene_by_id = {s["id"]: s for s in tl["scenes"]}
    events = []
    if "hero" in scene_by_id:
        events.append({"t": scene_by_id["hero"]["start"] + 0.15, "kind": "soft"})
    if "five" in scene_by_id:
        for i in range(5):
            events.append({"t": scene_by_id["five"]["start"] + 0.5 + i * 0.16, "kind": "soft"})
    if "switch" in scene_by_id:
        events.append({"t": scene_by_id["switch"]["start"] + 3.35, "kind": "click"})
        events.append({"t": scene_by_id["switch"]["start"] + 3.62, "kind": "switch"})
    if "local" in scene_by_id:
        events.append({"t": scene_by_id["local"]["start"] + 0.5, "kind": "soft"})
    foley = render_foley(events)
    if len(foley):
        music[:len(foley)] += foley[:total] if len(foley) >= total else foley

    # ---- 增益分级：人声为绝对主角，底乐压到人声之下 ----
    vo_peak = float(np.abs(vo).max()) or 1.0
    vo = vo * (VO_PEAK / vo_peak)                      # 人声峰值归一
    music_peak = float(np.abs(music).max()) or 1.0
    music = music * (MUSIC_PEAK / music_peak)           # 底乐峰值归一（远低于人声）

    # Sidechain Ducking（底乐随人声压低 7.5dB）
    env = voice_envelope(vo_mono)
    gain = db_gain(env, DUCK_DB)
    music_d = music * gain

    mix = vo + music_d
    peak = float(np.abs(mix).max())
    if peak > 0.97:
        mix = mix * (0.97 / peak)

    raw = TMP / "mix-raw.wav"
    write_wav(raw, mix)

    # 母带标准化
    out = BASE / "audio.wav"
    subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(raw),
         "-af", f"loudnorm=I={TARGET_I}:TP={TARGET_TP}:LRA={TARGET_LRA},aresample={SR}",
         "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", str(out)],
        check=True,
    )

    # 波形图
    final, _ = read_wav(out)
    write_waveform_png(final, BASE / "audio-waveform.png")

    # ebur128 校验
    probe = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", str(out), "-af", "ebur128=peak=true",
         "-f", "null", "-"], capture_output=True, text=True)
    tail = probe.stderr[-1400:]
    integ = tru = 0.0
    for line in tail.splitlines():
        if "I:" in line and "LUFS" in line:
            try:
                integ = float(line.strip().split("I:")[1].split("LUFS")[0].strip())
            except Exception:
                pass
        if "Peak:" in line:
            try:
                tru = float(line.strip().split("Peak:")[1].split("dBFS")[0].strip())
            except Exception:
                pass

    stats = {
        "sampleRate": SR,
        "channels": 2,
        "durationSeconds": round(duration, 3),
        "duckingDepthDb": DUCK_DB,
        "attackMs": int(ATTACK_S * 1000),
        "releaseMs": int(RELEASE_S * 1000),
        "foleyEvents": len(events),
        "integratedLufs": integ,
        "truePeakDbfs": tru,
        "loudnormTarget": {"I": TARGET_I, "TP": TARGET_TP, "LRA": TARGET_LRA},
    }
    (BASE / "audio-stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[audio] ✓ audio.wav  {duration:.3f}s  I={integ:.2f} LUFS  Peak={tru:.2f} dBFS", flush=True)
    print("[audio] ✓ audio-waveform.png (1920x360) + audio-stats.json", flush=True)


if __name__ == "__main__":
    main()
