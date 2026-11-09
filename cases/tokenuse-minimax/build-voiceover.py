#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TokenUse · MiniMax 三模态发布视频 —— Voice-First 主时钟构建器

流程：
  1. 并发调用 https://api.minimaxi.com/v1/t2a_v2  (model=speech-2.8-hd, subtitle_enable=true)
  2. hex 解码 -> 48000Hz 双声道 WAV，逐幕测量真实采样帧数
  3. 解析 subtitle_file 的毫秒级分句时间戳 (time_begin / time_end)
  4. 每幕留自然前导 0.38s / 尾韵 0.45s (末幕 1.35s)，总时长对齐到 1/60s 整数帧
  5. 产出 voiceover-clean.wav + timeline.js (window.TIMELINE) + timeline.json + voiceover-stats.json

密钥仅在运行时从环境变量或 ~/.local/share/opencode/auth.json 读取，绝不打印、绝不落盘。
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = Path(__file__).resolve().parent
TMP = BASE / ".tmp"
TMP.mkdir(parents=True, exist_ok=True)
FFMPEG = "/opt/homebrew/bin/ffmpeg"
T2A_URL = "https://api.minimaxi.com/v1/t2a_v2"

FPS = 60
SR = 48000
LEAD = 0.38          # 每幕自然前导气口
TAIL = 0.45          # 每幕自然尾韵
TAIL_LAST = 1.35     # 末幕品牌余韵

SCENES = [
    {
        "id": "pain",
        "text": "同时驾驭五款 AI 编程助手，最怕写到一半，配额突然见底。",
        "backdrop": "obsidian-wave",
        "accent": "#5fa8f5",
    },
    {
        "id": "hero",
        "text": "认识一下 TokenUse，常驻 macOS 桌面的多平台配额与用量中枢。",
        "backdrop": "warm-studio",
        "accent": "#ffb04a",
    },
    {
        "id": "five",
        "text": "Codex、Antigravity、MiMo、Kimi 与 MiniMax，剩余窗口与重置倒计时，一眼掌握。",
        "backdrop": "aurora-prism",
        "accent": "#57d6a3",
    },
    {
        "id": "switch",
        "text": "主力账号告急？点一下原子切换，自动备份凭证，编码心流零中断。",
        "backdrop": "obsidian-wave",
        "accent": "#f56fa8",
    },
    {
        "id": "local",
        "text": "支持多显示器边缘磁吸停靠；全部日志零门槛本地直读，每一枚缓存与输出都算得清楚。",
        "backdrop": "warm-studio",
        "accent": "#5fa8f5",
    },
    {
        "id": "outro",
        "text": "TokenUse，让每一次模型调用，尽在掌控。",
        "backdrop": "aurora-prism",
        "accent": "#57d6a3",
    },
]


def load_key() -> str:
    for var in ("MINIMAX_API_KEY", "MINIMAX_CODING_API_KEY"):
        val = os.environ.get(var)
        if val and val.strip():
            return val.strip()
    auth = Path(os.path.expanduser("~/.local/share/opencode/auth.json"))
    if auth.exists():
        data = json.loads(auth.read_text(encoding="utf-8"))
        node = data.get("minimax-cn-coding-plan") or {}
        key = node.get("key")
        if key and str(key).strip():
            return str(key).strip()
    raise SystemExit("!! 未找到 MiniMax API 凭证（环境变量或 opencode auth.json）")


def http_json(url: str, payload: dict, headers: dict, timeout: int = 180):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def fetch_text(url: str, timeout: int = 60) -> str:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def synthesize(scene: dict, key: str, index: int):
    """合成单幕旁白，返回 (wav_path, subtitles_ms, elapsed_sec, raw_meta)"""
    t0 = time.time()
    payload = {
        "model": "speech-2.8-hd",
        "text": scene["text"],
        "stream": False,
        "voice_setting": {
            "voice_id": "Chinese (Mandarin)_Gentleman",
            "speed": 1.05,
            "vol": 1.0,
            "pitch": 0,
            "emotion": "happy",
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
        "subtitle_enable": True,
    }
    headers = {"Authorization": f"Bearer {key}"}

    last_err = None
    for attempt in range(4):
        try:
            resp = http_json(T2A_URL, payload, headers)
            break
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last_err = exc
            time.sleep(1.6 * (attempt + 1))
    else:
        raise RuntimeError(f"scene {scene['id']} TTS 失败: {last_err}")

    base = resp.get("base_resp") or {}
    if base.get("status_code", 0) not in (0, None):
        raise RuntimeError(f"scene {scene['id']} API 错误: {base.get('status_msg')}")

    data = resp.get("data") or {}
    hex_audio = data.get("audio")
    if not hex_audio:
        raise RuntimeError(f"scene {scene['id']} 未返回音频")

    mp3_path = TMP / f"scene-{index}-{scene['id']}.mp3"
    mp3_path.write_bytes(bytes.fromhex(hex_audio))

    wav_path = TMP / f"scene-{index}-{scene['id']}.wav"
    subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(mp3_path),
         "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", str(wav_path)],
        check=True,
    )

    # 解析字幕文件（可能是 URL，也可能是内联 JSON）
    subs = []
    sub_field = data.get("subtitle_file")
    if isinstance(sub_field, str) and sub_field.strip():
        raw = sub_field.strip()
        blob = None
        if raw.startswith("http"):
            try:
                blob = fetch_text(raw)
            except Exception:
                blob = None
        else:
            blob = raw
        if blob:
            try:
                parsed = json.loads(blob)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, dict):
                items = parsed.get("subtitle") or parsed.get("subtitles") or []
            elif isinstance(parsed, list):
                items = parsed
            else:
                items = []
            for it in items:
                if not isinstance(it, dict):
                    continue
                tb = it.get("time_begin")
                te = it.get("time_end")
                if tb is None or te is None:
                    continue
                subs.append({
                    "text": str(it.get("text", "")).strip(),
                    "beginMs": int(tb),
                    "endMs": int(te),
                })
    if not subs:
        # 兜底：单句字幕，铺满整幕音频
        with wave.open(str(wav_path), "rb") as w:
            dur = w.getnframes() / float(w.getframerate())
        subs = [{"text": scene["text"], "beginMs": 0, "endMs": int(dur * 1000)}]

    with wave.open(str(wav_path), "rb") as w:
        nframes = w.getnframes()
        rate = w.getframerate()
        channels = w.getnchannels()
        sampwidth = w.getsampwidth()

    meta = {
        "index": index,
        "id": scene["id"],
        "chars": len(scene["text"]),
        "wavPath": str(wav_path),
        "nframes": nframes,
        "rate": rate,
        "channels": channels,
        "sampwidth": sampwidth,
        "duration": nframes / float(rate),
        "subtitles": subs,
        "elapsed": round(time.time() - t0, 3),
        "traceId": resp.get("trace_id", ""),
    }
    return meta


def main():
    key = load_key()
    total_chars = sum(len(s["text"]) for s in SCENES)
    wall0 = time.time()

    print(f"[voiceover] 合成 {len(SCENES)} 幕旁白，共 {total_chars} 字 …", flush=True)
    results = [None] * len(SCENES)
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(synthesize, sc, key, i): i for i, sc in enumerate(SCENES)}
        for fut, idx in futures.items():
            pass
        for fut, idx in futures.items():
            results[idx] = fut.result()
            print(f"[voiceover] ✓ 幕 {idx+1} ({SCENES[idx]['id']}) "
                  f"{results[idx]['duration']:.3f}s / {results[idx]['elapsed']}s", flush=True)

    # ---- 排布时间轴 ----
    scenes = []
    cursor = 0.0
    for i, (sc, meta) in enumerate(zip(SCENES, results)):
        lead = LEAD
        tail = TAIL_LAST if i == len(SCENES) - 1 else TAIL
        start = cursor
        voice_start = start + lead
        voice_end = voice_start + meta["duration"]
        end = voice_end + tail
        subs = [{
            "text": s["text"],
            "begin": round(voice_start + s["beginMs"] / 1000.0, 3),
            "end": round(voice_start + s["endMs"] / 1000.0, 3),
        } for s in meta["subtitles"]]
        scenes.append({
            "id": sc["id"],
            "index": i,
            "start": round(start, 6),
            "end": round(end, 6),
            "voiceStart": round(voice_start, 6),
            "voiceEnd": round(voice_end, 6),
            "backdrop": sc["backdrop"],
            "accent": sc["accent"],
            "caption": sc["text"],
            "text": sc["text"],
            "subtitles": subs,
        })
        cursor = end

    # 总时长对齐到 1/60s 整数帧
    total_frames = int(round(cursor * FPS))
    if abs(total_frames / FPS - cursor) > 1e-6:
        delta = total_frames / FPS - cursor
        scenes[-1]["end"] = round(scenes[-1]["end"] + delta, 6)
        cursor = total_frames / FPS

    # ---- 拼接干声 ----
    out_wav = BASE / "voiceover-clean.wav"
    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error"]
    for meta in results:
        cmd += ["-i", meta["wavPath"]]
    # 每幕前插入静音前导，尾部静音并入末幕
    filters = []
    for meta in results:
        filters.append(f"[{results.index(meta)}:a]aresample={SR},aformat=sample_fmts=s16:channel_layouts=stereo,"
                       f"adelay={int(LEAD*1000)}|{int(LEAD*1000)},"
                       f"apad=whole_dur={meta['duration']+LEAD+(TAIL_LAST if meta is results[-1] else TAIL)}[a{results.index(meta)}]")
    # 精确拼接：使用 adelay 后按绝对起点补静音
    parts = []
    for i, meta in enumerate(results):
        lead_ms = int(LEAD * 1000)
        tail_ms = int((TAIL_LAST if i == len(results) - 1 else TAIL) * 1000)
        dur = meta["duration"]
        parts.append(f"[{i}:a]aresample={SR},aformat=sample_fmts=s16:channel_layouts=stereo,"
                     f"adelay={lead_ms}|{lead_ms},apad=whole_dur={dur+lead_ms/1000+tail_ms/1000}[p{i}]")
    concat = "".join(f"[p{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1[out]"
    cmd += ["-filter_complex", ";".join(parts) + ";" + concat, "-map", "[out]",
            "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", str(out_wav)]
    subprocess.run(cmd, check=True)

    timeline = {
        "fps": FPS,
        "sampleRate": SR,
        "duration": round(total_frames / FPS, 6),
        "totalFrames": total_frames,
        "voiceover": "voiceover-clean.wav",
        "scenes": scenes,
    }

    (BASE / "timeline.json").write_text(
        json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    js = "window.TIMELINE = " + json.dumps(timeline, ensure_ascii=False, indent=2) + ";\n"
    (BASE / "timeline.js").write_text(js, encoding="utf-8")

    stats = {
        "model": "speech-2.8-hd",
        "voice_id": "Chinese (Mandarin)_Gentleman",
        "speed": 1.05,
        "sample_rate": 32000,
        "scenes": len(SCENES),
        "totalChars": total_chars,
        "totalAudioSeconds": round(sum(m["duration"] for m in results), 3),
        "timelineDurationSeconds": timeline["duration"],
        "totalFrames": total_frames,
        "wallClockSeconds": round(time.time() - wall0, 3),
        "perScene": [{
            "index": m["index"], "id": m["id"], "chars": m["chars"],
            "audioSeconds": round(m["duration"], 3), "apiSeconds": m["elapsed"],
            "subtitleSegments": len(m["subtitles"]),
        } for m in results],
    }
    (BASE / "voiceover-stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[voiceover] ✓ voiceover-clean.wav  {timeline['duration']}s / {total_frames} frames", flush=True)
    print(f"[voiceover] ✓ timeline.js + timeline.json + voiceover-stats.json", flush=True)


if __name__ == "__main__":
    main()
