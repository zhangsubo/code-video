#!/usr/bin/env python3
"""
Zero-scipy deterministic 48kHz stereo audio synthesizer & loudness normalizer.
Generates:
  - audio.wav (48000 Hz, (N, 2) interleaved signed int16, -14 LUFS)
  - audio-waveform.png (1920x360 beat-grid waveform for visual QA)
"""
import os
import subprocess
import tempfile
import wave
from pathlib import Path
import numpy as np

SR = 48000
DURATION = float(os.environ.get("VIDEO_DURATION", "24.0"))
BPM = 120.0
OUT_DIR = Path(os.environ.get("VIDEO_DIR", ".")).resolve()
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")


def synth_stereo_bed(duration: float) -> np.ndarray:
    n = int(round(duration * SR))
    t = np.arange(n, dtype=np.float64) / SR
    beat_sec = 60.0 / BPM
    bar_sec = beat_sec * 4.0

    # Warm harmonic pad progression (4 chords cycling every bar)
    chords = [
        (220.00, 277.18, 329.63, 415.30),
        (196.00, 246.94, 293.66, 369.99),
        (174.61, 220.00, 261.63, 329.63),
        (164.81, 207.65, 246.94, 329.63),
    ]
    left = np.zeros(n, dtype=np.float64)
    right = np.zeros(n, dtype=np.float64)

    bar_idx = np.floor(t / bar_sec).astype(int) % len(chords)
    for idx, freqs in enumerate(chords):
        mask = (bar_idx == idx).astype(np.float64)
        for k, f in enumerate(freqs):
            detune = 1.0015 if k % 2 == 0 else 0.9985
            left += 0.08 * mask * np.sin(2 * np.pi * f * t)
            right += 0.08 * mask * np.sin(2 * np.pi * f * detune * t + 0.35)

    # Soft pulse on every beat (0.5s @ 120 BPM)
    beat_phase = np.mod(t, beat_sec)
    kick_env = np.exp(-beat_phase * 14.0)
    kick = 0.22 * kick_env * np.sin(2 * np.pi * (58.0 + 42.0 * np.exp(-beat_phase * 28.0)) * beat_phase)
    left += kick
    right += kick

    # Fade in / out
    fade = int(0.35 * SR)
    ramp = np.linspace(0.0, 1.0, fade)
    left[:fade] *= ramp
    right[:fade] *= ramp
    left[-fade:] *= ramp[::-1]
    right[-fade:] *= ramp[::-1]

    # Iron Law: strictly (N, 2) C-order interleaved float array
    stereo = np.column_stack([left, right])
    assert stereo.ndim == 2 and stereo.shape == (n, 2)
    return stereo


def add_ui_click(stereo: np.ndarray, event_sec: float, freq: float = 1320.0) -> None:
    """Align transient peak right on event_sec."""
    dur = 0.055
    m = int(dur * SR)
    local_t = np.arange(m, dtype=np.float64) / SR
    burst = 0.26 * np.exp(-local_t * 65.0) * np.sin(2 * np.pi * freq * local_t)
    peak_offset = int(0.003 * SR)
    start = max(0, int(round(event_sec * SR)) - peak_offset)
    end = min(len(stereo), start + m)
    seg = burst[: end - start]
    stereo[start:end, 0] += seg
    stereo[start:end, 1] += seg * 0.92


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stereo = synth_stereo_bed(DURATION)
    for click_t in (1.5, 3.5, 6.0, 9.5, 13.5, 17.5):
        if click_t < DURATION - 0.2:
            add_ui_click(stereo, click_t)

    with tempfile.TemporaryDirectory(prefix="code-video-audio-") as tmp:
        raw_wav = Path(tmp) / "raw.wav"
        pcm = np.round(np.clip(stereo, -0.98, 0.98) * 32767.0).astype("<i2")
        with wave.open(str(raw_wav), "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(SR)
            wf.writeframes(pcm.tobytes(order="C"))

        out_wav = OUT_DIR / "audio.wav"
        # Iron Law: lock aresample=48000 after loudnorm to prevent silent 96kHz upsampling
        subprocess.run([
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(raw_wav),
            "-af", "loudnorm=I=-14:TP=-2.5:LRA=11,aresample=48000",
            "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le",
            str(out_wav),
        ], check=True)

        waveform_png = OUT_DIR / "audio-waveform.png"
        subprocess.run([
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(out_wav),
            "-filter_complex", "showwavespic=s=1920x360:split_channels=1:colors=#38bdf8|#34d399,drawgrid=w=160:h=180:t=1:c=white@0.22",
            "-frames:v", "1",
            str(waveform_png),
        ], check=True)
        print(f"[Audio] Wrote {out_wav} and {waveform_png}")


if __name__ == "__main__":
    main()
