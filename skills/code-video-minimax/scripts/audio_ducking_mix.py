#!/usr/bin/env python3
"""
Sidechain envelope ducking mixer (-7.5 dB under voice) + envelope correlation self-check.
Reads voiceover-clean.wav and outputs broadcast-normalized 48kHz audio.wav (-14 LUFS).
"""
import os
import subprocess
import tempfile
import wave
from pathlib import Path
import numpy as np

SR = 48000
OUT_DIR = Path(os.environ.get("VIDEO_DIR", ".")).resolve()
FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")


def read_stereo_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wf:
        ch = wf.getnchannels()
        assert wf.getframerate() == SR and wf.getsampwidth() == 2
        raw = wf.readframes(wf.getnframes())
    arr = np.frombuffer(raw, dtype="<i2").astype(np.float64).reshape(-1, ch) / 32768.0
    return np.repeat(arr, 2, axis=1) if ch == 1 else arr


def compute_envelope(mono: np.ndarray, win_ms: float = 35.0) -> np.ndarray:
    win = max(1, int(SR * (win_ms / 1000.0)))
    kernel = np.ones(win, dtype=np.float64) / win
    return np.sqrt(np.convolve(mono * mono, kernel, mode="same") + 1e-12)


def main() -> None:
    vo_path = OUT_DIR / "voiceover-clean.wav"
    if not vo_path.exists():
        raise FileNotFoundError(f"Missing {vo_path}. Run build_voiceover_template.py first.")

    vo = read_stereo_wav(vo_path)
    n = len(vo)
    t = np.arange(n, dtype=np.float64) / SR

    # Warm ambient pad bed
    bed_l = 0.07 * (np.sin(2 * np.pi * 220.0 * t) + 0.7 * np.sin(2 * np.pi * 277.18 * t) + 0.6 * np.sin(2 * np.pi * 329.63 * t))
    bed_r = 0.07 * (np.sin(2 * np.pi * 220.3 * t + 0.3) + 0.7 * np.sin(2 * np.pi * 276.9 * t) + 0.6 * np.sin(2 * np.pi * 330.0 * t))
    bed = np.column_stack([bed_l, bed_r])

    # Smooth sidechain ducking (-7.5 dB -> linear gain ~0.42 when voice is active)
    vo_mono = 0.5 * (vo[:, 0] + vo[:, 1])
    env = compute_envelope(vo_mono, win_ms=45.0)
    gate = np.clip((env - 0.008) / 0.035, 0.0, 1.0)
    duck_gain = 1.0 - 0.58 * gate[:, None]

    mixed = vo + bed * duck_gain
    # Iron Law: verify (N, 2) interleaved shape & correlation with dry voiceover before writing!
    assert mixed.ndim == 2 and mixed.shape == (n, 2)
    mix_env = compute_envelope(0.5 * (mixed[:, 0] + mixed[:, 1]), win_ms=50.0)
    vo_env = compute_envelope(vo_mono, win_ms=50.0)
    corr = float(np.corrcoef(mix_env, vo_env)[0, 1])
    if corr < 0.60:
        raise RuntimeError(f"Audio self-check failed: envelope correlation too low ({corr:.3f})")

    with tempfile.TemporaryDirectory(prefix="code-video-mix-") as tmp:
        raw_mix = Path(tmp) / "raw_mix.wav"
        pcm = np.round(np.clip(mixed, -0.98, 0.98) * 32767.0).astype("<i2")
        with wave.open(str(raw_mix), "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(SR)
            wf.writeframes(pcm.tobytes(order="C"))

        out_wav = OUT_DIR / "audio.wav"
        subprocess.run([
            FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(raw_mix),
            "-af", "loudnorm=I=-14:TP=-2.5:LRA=11,aresample=48000",
            "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le",
            str(out_wav),
        ], check=True)
        print(f"[MixGate] Wrote {out_wav} (voiceover envelope correlation = {corr:.4f})")


if __name__ == "__main__":
    main()
