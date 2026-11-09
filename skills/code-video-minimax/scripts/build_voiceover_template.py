#!/usr/bin/env python3
"""
Voice-First Master Clock template using MiniMax speech-2.8-hd.
Reads MINIMAX_API_KEY from environment variable ONLY (zero hardcoded credentials).
Outputs voiceover-clean.wav, timeline.json, and timeline.js.
"""
import json
import os
import subprocess
import tempfile
import urllib.request
import wave
from pathlib import Path
import numpy as np

SR = 48000
API_URL = "https://api.minimaxi.com/v1/t2a_v2"
OUT_DIR = Path(os.environ.get("VIDEO_DIR", ".")).resolve()
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")

SCENES = [
    {"id": "hook", "text": "写代码最怕切窗口查配额，现在一屏看清所有主力模型余量。"},
    {"id": "feature", "text": "毫秒级状态栏实时同步，主力账号见底前一键无感切换。"},
    {"id": "outro", "text": "开源免费，原生轻量，让每一次模型调用尽在掌控。"},
]


def call_tts(api_key: str, text: str) -> dict:
    payload = {
        "model": "speech-2.8-hd",
        "text": text,
        "stream": False,
        "subtitle_enable": True,
        "voice_setting": {
            "voice_id": "Chinese (Mandarin)_Gentleman",
            "speed": 1.05,
            "vol": 1.0,
            "pitch": 0,
        },
        "audio_setting": {
            "sample_rate": 32000,
            "bitrate": 128000,
            "format": "mp3",
            "channel": 1,
        },
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    if body.get("base_resp", {}).get("status_code", 0) != 0:
        raise RuntimeError(f"TTS API error: {body.get('base_resp')}")
    return body["data"]


def main() -> None:
    api_key = os.environ.get("MINIMAX_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Please export MINIMAX_API_KEY in your shell environment before running.")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    chunks = []
    timeline_scenes = []
    cursor_samples = 0

    with tempfile.TemporaryDirectory(prefix="code-video-tts-") as tmp:
        for idx, sc in enumerate(SCENES):
            data = call_tts(api_key, sc["text"])
            mp3_path = Path(tmp) / f"sc_{idx}.mp3"
            wav_path = Path(tmp) / f"sc_{idx}.wav"
            mp3_path.write_bytes(bytes.fromhex(data["audio"]))
            subprocess.run([
                FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(mp3_path), "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", str(wav_path),
            ], check=True)

            with wave.open(str(wav_path), "rb") as wf:
                raw = wf.readframes(wf.getnframes())
            arr = np.frombuffer(raw, dtype="<i2").astype(np.float64).reshape(-1, 2) / 32768.0

            lead_n = int(0.38 * SR)
            tail_n = int((1.35 if idx == len(SCENES) - 1 else 0.45) * SR)
            padded = np.vstack([
                np.zeros((lead_n, 2), dtype=np.float64),
                arr,
                np.zeros((tail_n, 2), dtype=np.float64),
            ])
            # Align scene boundary to exact 1/60s video frame (800 samples @ 48kHz)
            rem = len(padded) % 800
            if rem != 0:
                padded = np.vstack([padded, np.zeros((800 - rem, 2), dtype=np.float64)])

            start_sec = cursor_samples / SR
            voice_start = (cursor_samples + lead_n) / SR
            voice_end = (cursor_samples + lead_n + len(arr)) / SR
            cursor_samples += len(padded)
            end_sec = cursor_samples / SR

            timeline_scenes.append({
                "id": sc["id"],
                "index": idx,
                "start": round(start_sec, 4),
                "end": round(end_sec, 4),
                "voiceStart": round(voice_start, 4),
                "voiceEnd": round(voice_end, 4),
                "caption": sc["text"],
            })
            chunks.append(padded)

    full_vo = np.vstack(chunks)
    assert full_vo.ndim == 2 and full_vo.shape[1] == 2
    vo_wav = OUT_DIR / "voiceover-clean.wav"
    pcm = np.round(np.clip(full_vo, -0.98, 0.98) * 32767.0).astype("<i2")
    with wave.open(str(vo_wav), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm.tobytes(order="C"))

    duration = cursor_samples / SR
    tl = {
        "fps": 60,
        "duration": round(duration, 4),
        "totalFrames": int(round(duration * 60)),
        "sceneCuts": [0.0] + [s["end"] for s in timeline_scenes],
        "scenes": timeline_scenes,
    }
    (OUT_DIR / "timeline.json").write_text(json.dumps(tl, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "timeline.js").write_text(f"window.TIMELINE = {json.dumps(tl, ensure_ascii=False, indent=2)};\n", encoding="utf-8")
    print(f"[VoiceClock] Wrote {vo_wav} ({duration:.2f}s, {tl['totalFrames']} frames) and timeline.js")


if __name__ == "__main__":
    main()
