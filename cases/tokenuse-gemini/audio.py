#!/usr/bin/env python3
"""
Deterministic 120 BPM soundtrack & peak-aligned UI foley synthesizer for TokenUse Promo Video.
Duration: 24.0s (12 bars @ 120 BPM, 1 beat = 0.5s, 1 bar = 2.0s), 48kHz Stereo WAV.
"""
import pathlib
import wave
import numpy as np

SR = 48000
DURATION = 24.0
BPM = 120.0
BEAT = 60.0 / BPM  # 0.5s
BAR = BEAT * 4     # 2.0s
N = int(SR * DURATION)


def lowpass(sig: np.ndarray, cutoff: float, order: int = 3) -> np.ndarray:
    freqs = np.fft.rfftfreq(len(sig), d=1.0 / SR)
    gain = 1.0 / np.sqrt(1.0 + (freqs / max(cutoff, 20.0)) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(sig) * gain, n=len(sig))


def highpass(sig: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    freqs = np.fft.rfftfreq(len(sig), d=1.0 / SR)
    gain = 1.0 / np.sqrt(1.0 + (max(cutoff, 20.0) / np.maximum(freqs, 1e-3)) ** (2 * order))
    gain[0] = 0.0
    return np.fft.irfft(np.fft.rfft(sig) * gain, n=len(sig))


def place(buf: np.ndarray, t_sec: float, clip: np.ndarray, pan: float = 0.0, peak_offset: int = 0) -> None:
    """Place mono clip into stereo buffer so its peak_offset lands exactly at t_sec."""
    start = int(round(t_sec * SR)) - peak_offset
    end = start + len(clip)
    s0 = max(0, start)
    e0 = min(N, end)
    if s0 >= e0:
        return
    c_slice = clip[s0 - start : e0 - start]
    l_gain = np.sqrt(0.5 * (1.0 - np.clip(pan, -0.9, 0.9)))
    r_gain = np.sqrt(0.5 * (1.0 + np.clip(pan, -0.9, 0.9)))
    buf[s0:e0, 0] += c_slice * l_gain
    buf[s0:e0, 1] += c_slice * r_gain


def synth_kick(punch: float = 1.0) -> tuple[np.ndarray, int]:
    dur = 0.28
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    freq = 48.0 + 118.0 * np.exp(-t * 36.0)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-t * 11.5)
    click = np.sin(2 * np.pi * 1400 * t) * np.exp(-t * 160.0) * 0.18
    sig = np.tanh((body + click) * 1.35 * punch) * 0.52
    return sig, int(0.004 * SR)


def synth_hat(open_hat: bool = False) -> tuple[np.ndarray, int]:
    rng = np.random.default_rng(42 if not open_hat else 99)
    dur = 0.16 if open_hat else 0.055
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    noise = highpass(rng.standard_normal(len(t)), 7600.0)
    env = np.exp(-t * (18.0 if open_hat else 68.0))
    sig = noise * env * (0.085 if open_hat else 0.065)
    return sig, int(0.002 * SR)


def synth_clap_rim() -> tuple[np.ndarray, int]:
    rng = np.random.default_rng(7)
    dur = 0.09
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    tone = np.sin(2 * np.pi * 880 * t * np.exp(-t * 18)) * np.exp(-t * 55)
    snap = highpass(rng.standard_normal(len(t)), 2400) * np.exp(-t * 62) * 0.35
    sig = lowpass(tone * 0.5 + snap, 6200) * 0.19
    return sig, int(0.003 * SR)


def synth_warm_chord(freqs: list[float], dur: float, brightness: float = 1800.0) -> np.ndarray:
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    attack = np.clip(t / 0.08, 0, 1)
    release = np.clip((dur - t) / 0.25, 0, 1)
    env = attack * release * (0.72 + 0.28 * np.exp(-t * 1.4))
    left = np.zeros_like(t)
    right = np.zeros_like(t)
    for idx, f in enumerate(freqs):
        detune = 1.0022 if idx % 2 == 0 else 0.9978
        # Warm electric piano + soft analog saw blend
        ep_l = np.sin(2 * np.pi * f * t) + 0.28 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t * 2.5)
        ep_r = np.sin(2 * np.pi * f * detune * t + 0.35) + 0.28 * np.sin(2 * np.pi * f * detune * 2.0 * t) * np.exp(-t * 2.5)
        left += ep_l / len(freqs)
        right += ep_r / len(freqs)
    stereo = np.stack([lowpass(left * env, brightness), lowpass(right * env, brightness)], axis=1)
    return stereo * 0.22


def synth_sub_bass(freq: float, dur: float) -> np.ndarray:
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    env = np.clip(t / 0.025, 0, 1) * np.clip((dur - t) / 0.09, 0, 1)
    # Subtle sidechain ducking on every beat (0.5s)
    beat_phase = (t % BEAT) / BEAT
    duck = 0.38 + 0.62 * (1.0 - np.exp(-beat_phase * 5.5))
    wave = (np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)) * env * duck * 0.24
    return np.stack([wave, wave], axis=1)


def synth_ui_tick(freq: float = 1650.0) -> tuple[np.ndarray, int]:
    dur = 0.038
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    sig = (np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2.4 * t)) * np.exp(-t * 130.0) * 0.14
    return sig, int(0.001 * SR)


def synth_whoosh(dur: float = 0.36, up: bool = True) -> tuple[np.ndarray, int]:
    rng = np.random.default_rng(123)
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    env = np.sin(np.pi * (t / dur)) ** 1.8
    raw = rng.standard_normal(len(t))
    f0, f1 = (500.0, 3200.0) if up else (2800.0, 480.0)
    sweep_tone = np.sin(2 * np.pi * np.cumsum(np.linspace(f0 * 0.25, f1 * 0.25, len(t))) / SR) * 0.25
    filtered = lowpass(highpass(raw, 420.0), 3400.0) * 0.16
    sig = (filtered + sweep_tone * 0.12) * env * 0.32
    return sig, len(t) // 2


def synth_glass_chime(notes: list[float]) -> tuple[np.ndarray, int]:
    dur = 0.55
    t = np.linspace(0, dur, int(SR * dur), endpoint=False)
    sig = np.zeros_like(t)
    for i, f in enumerate(notes):
        delay = int(i * 0.065 * SR)
        tt = np.maximum(0.0, t - i * 0.065)
        mask = (t >= i * 0.065).astype(float)
        tone = (np.sin(2 * np.pi * f * tt) + 0.32 * np.sin(2 * np.pi * f * 2.0 * tt)) * np.exp(-tt * 9.5) * mask
        sig += tone * 0.13
    return sig, int(0.068 * SR)


def build_mix() -> np.ndarray:
    mix = np.zeros((N, 2), dtype=np.float64)

    # Chord progression across 12 bars (2.0s each):
    # Fmaj9 -> G6 -> Am9 -> Em7 (uplifting modern Apple-keynote tech progression)
    prog = [
        ([174.61, 220.00, 261.63, 329.63, 392.00], 87.31),   # Fmaj9
        ([196.00, 246.94, 293.66, 329.63, 392.00], 98.00),   # G6
        ([220.00, 261.63, 329.63, 392.00, 493.88], 110.00),  # Am9
        ([164.81, 196.00, 246.94, 293.66, 392.00], 82.41),   # Em7
    ]

    for bar in range(12):
        t0 = bar * BAR
        chord_freqs, bass_freq = prog[bar % 4]
        if bar == 11:
            # Resolve warmly on Fmaj9 in final bar
            chord_freqs, bass_freq = ([174.61, 220.00, 261.63, 329.63, 392.00, 523.25], 87.31)

        bright = 1350.0 if bar < 2 else (2600.0 if bar < 10 else 1700.0)
        chord_clip = synth_warm_chord(chord_freqs, BAR + 0.18, brightness=bright)
        s = int(t0 * SR)
        e = min(N, s + len(chord_clip))
        mix[s:e] += chord_clip[: e - s] * (0.72 if bar < 2 else 1.0)

        # Sub-bass enters strongly on Bar 3 Drop (4.0s) through Bar 11
        if 2 <= bar <= 10:
            bass_clip = synth_sub_bass(bass_freq, BAR)
            mix[s : min(N, s + len(bass_clip))] += bass_clip[: min(N, s + len(bass_clip)) - s]
        elif bar == 11:
            bass_clip = synth_sub_bass(bass_freq, BAR) * np.linspace(0.85, 0.0, int(BAR * SR))[:, None]
            mix[s : min(N, s + len(bass_clip))] += bass_clip[: min(N, s + len(bass_clip)) - s]

    # Drums & Groove
    kick, kick_pk = synth_kick(1.0)
    soft_kick, soft_pk = synth_kick(0.65)
    hat_c, hat_pk = synth_hat(False)
    hat_o, hato_pk = synth_hat(True)
    rim, rim_pk = synth_clap_rim()

    for bar in range(12):
        b_start = bar * BAR
        if bar < 2:
            # Intro pulse: subtle heartbeat on downbeats + riser into Bar 3 drop
            place(mix, b_start, soft_kick, 0.0, soft_pk)
            place(mix, b_start + 2 * BEAT, soft_kick * 0.75, 0.0, soft_pk)
            for sub in range(4):
                place(mix, b_start + sub * BEAT, hat_c * 0.55, (-0.15 if sub % 2 == 0 else 0.15), hat_pk)
        elif bar < 10:
            # Main 120 BPM precision tech groove (Bars 3..10: 4.0s -> 20.0s)
            for beat in range(4):
                bt = b_start + beat * BEAT
                place(mix, bt, kick, 0.0, kick_pk)
                if beat in (1, 3):
                    place(mix, bt, rim, 0.05, rim_pk)
                place(mix, bt, hat_c, -0.18, hat_pk)
                place(mix, bt + 0.5 * BEAT, hat_o if beat == 3 else hat_c * 0.85, 0.18, hato_pk if beat == 3 else hat_pk)
        elif bar == 10:
            # Bar 11 (20.0s): Hero lockup gentle pulse
            place(mix, b_start, soft_kick, 0.0, soft_pk)
            place(mix, b_start + 2 * BEAT, soft_kick * 0.7, 0.0, soft_pk)

    # Riser into THE DROP at t = 4.0s
    riser, riser_pk = synth_whoosh(0.65, up=True)
    place(mix, 3.88, riser * 1.25, 0.0, riser_pk)

    # Peak-aligned UI Foley SFX synced to exact visual keyframes
    tick_hi, tick_pk = synth_ui_tick(1820.0)
    tick_lo, tick_lo_pk = synth_ui_tick(1320.0)
    whoosh_in, wh_pk = synth_whoosh(0.30, up=True)
    whoosh_pan, whp_pk = synth_whoosh(0.26, up=False)
    chime_ok, chime_pk = synth_glass_chime([783.99, 1046.50])         # G5 -> C6 (Codex switch)
    chime_notif, notif_pk = synth_glass_chime([659.25, 987.77, 1318.5]) # E5 -> B5 -> E6 (48h alert)
    chime_hero, hero_pk = synth_glass_chime([523.25, 659.25, 783.99, 1046.50])

    # Bar 1: Kinetic hook words + collapse
    for t_ev in (0.05, 0.50, 1.00):
        place(mix, t_ev, tick_hi, 0.0, tick_pk)
    place(mix, 1.55, whoosh_pan, 0.25, whp_pk)

    # Bar 2: Edge Dock snap + hover
    place(mix, 2.00, tick_lo * 1.2, 0.35, tick_lo_pk)
    place(mix, 3.50, tick_hi * 0.9, 0.30, tick_pk)

    # Bar 3: THE DROP (4.0s) HUD slide-out
    place(mix, 4.00, whoosh_in * 1.15, 0.1, wh_pk)

    # Bar 4: Codex 1-click atomic account switch at 7.0s
    place(mix, 7.00, tick_lo * 1.3, -0.1, tick_lo_pk)
    place(mix, 7.08, chime_ok * 0.85, -0.05, chime_pk)

    # Bar 5-6: Cloud billing expand at 9.5s + staggered model ticks
    place(mix, 9.50, tick_hi * 1.2, 0.0, tick_pk)
    for idx in range(4):
        place(mix, 9.65 + idx * 0.12, tick_lo * 0.55, -0.15 + idx * 0.1, tick_lo_pk)

    # Bar 7-8: Magnetic drag (12.0s -> 12.8s), privacy mask (13.2s), 48h notification (14.5s)
    place(mix, 12.00, tick_lo, 0.30, tick_lo_pk)
    place(mix, 12.55, whoosh_pan * 0.9, -0.25, whp_pk)
    place(mix, 13.20, tick_hi * 1.1, 0.0, tick_pk)
    place(mix, 14.50, chime_notif * 0.95, 0.25, notif_pk)

    # Bar 9: 4 Spec proof cards on beats (16.0, 16.5, 17.0, 17.5)
    for b_idx in range(4):
        place(mix, 16.0 + b_idx * 0.5, tick_hi * 0.85, (-0.2 if b_idx % 2 == 0 else 0.2), tick_pk)

    # Bar 10-11: Constellation merge (18.0s) -> Hero reveal (20.0s)
    place(mix, 18.00, whoosh_in * 0.85, 0.0, wh_pk)
    place(mix, 20.00, chime_hero * 0.9, 0.0, hero_pk)

    # Master fade-in (first 30ms) & smooth fade-out (22.6s -> 24.0s)
    fade_in = np.clip(np.linspace(0, DURATION, N) / 0.03, 0, 1)[:, None]
    fade_out = np.clip((DURATION - np.linspace(0, DURATION, N)) / 1.35, 0, 1)[:, None]
    mix = mix * fade_in * fade_out

    # Soft limiter so peaks sit cleanly around -1.5 dBFS before ffmpeg loudnorm
    peak = np.max(np.abs(mix))
    assert np.isfinite(mix).all() and peak > 0.05, "Audio synthesis sanity check failed"
    mix = np.tanh(mix / peak * 1.15) * 0.84
    return mix


if __name__ == "__main__":
    out_dir = pathlib.Path(__file__).resolve().parent
    raw_wav = out_dir / "audio_raw.wav"
    stereo = build_mix()
    pcm16 = np.int16(np.clip(stereo, -1.0, 1.0) * 32767)
    assert pcm16.shape == (N, 2), f"Expected {(N, 2)}, got {pcm16.shape}"
    with wave.open(str(raw_wav), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm16.tobytes())
    rms_db = 20 * np.log10(np.sqrt(np.mean(stereo**2)) + 1e-9)
    print(f"Generated {raw_wav.name}: {DURATION}s, {SR}Hz stereo, RMS={rms_db:.1f} dBFS")
