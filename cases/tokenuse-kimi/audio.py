#!/opt/anaconda3/bin/python3
import math
import subprocess
import wave
from pathlib import Path

import numpy as np
import numpy.fft as fft

ROOT = Path(__file__).resolve().parent
SR = 48_000
DURATION = 24.0
N = int(SR * DURATION)
mix = np.zeros((N, 2), dtype=np.float64)


def timeline(duration):
    return np.arange(int(duration * SR), dtype=np.float64) / SR


def filtered_noise(duration, low, high, seed):
    rng = np.random.default_rng(seed)
    count = int(duration * SR)
    source = rng.standard_normal(count)
    frequencies = fft.rfftfreq(count, 1 / SR)
    spectrum = fft.rfft(source)
    band = np.clip((frequencies - low) / max(1, low * .35), 0, 1)
    band *= np.clip((high - frequencies) / max(1, high * .25), 0, 1)
    result = fft.irfft(spectrum * band, n=count)
    peak = np.max(np.abs(result)) or 1
    return result / peak


def place(signal, at, gain=1.0, pan=0.0):
    start = int(round(at * SR))
    if start >= N:
        return
    signal = np.asarray(signal)
    length = min(len(signal), N - start)
    angle = (np.clip(pan, -1, 1) + 1) * math.pi / 4
    mix[start:start + length, 0] += signal[:length] * gain * math.cos(angle)
    mix[start:start + length, 1] += signal[:length] * gain * math.sin(angle)


def kick(seed=1):
    t = timeline(.46)
    frequency = 45 + 105 * np.exp(-t * 28)
    phase = np.cumsum(frequency) * (2 * np.pi / SR)
    body = np.sin(phase) * np.exp(-t * 9.5)
    click = filtered_noise(.46, 2500, 11000, seed) * np.exp(-t * 150)
    return body + .18 * click


def snare(seed=2):
    t = timeline(.28)
    noise = filtered_noise(.28, 700, 12000, seed)
    tone = np.sin(2 * np.pi * 185 * t)
    return (noise * .72 + tone * .28) * np.exp(-t * 17)


def hat(seed=3, open_hat=False):
    duration = .20 if open_hat else .065
    t = timeline(duration)
    noise = filtered_noise(duration, 6500, 17500, seed)
    return noise * np.exp(-t * (25 if open_hat else 70))


def pluck(frequency, duration=.38):
    t = timeline(duration)
    attack = np.minimum(t / .006, 1)
    envelope = attack * np.exp(-t * 11)
    tone = (
        np.sin(2 * np.pi * frequency * t)
        + .32 * np.sin(2 * np.pi * frequency * 2 * t)
        + .12 * np.sin(2 * np.pi * frequency * 3 * t)
    )
    return tone * envelope


def bass(frequency, duration=.44):
    t = timeline(duration)
    envelope = np.minimum(t / .012, 1) * np.exp(-t * 4.8)
    tone = np.sin(2 * np.pi * frequency * t) + .24 * np.sin(2 * np.pi * frequency * 2 * t)
    return tone * envelope


def pad(chord, duration=2.0):
    t = timeline(duration)
    envelope = np.sin(np.pi * np.minimum(t / duration, 1)) ** .7
    left = np.zeros_like(t)
    right = np.zeros_like(t)
    for i, midi in enumerate(chord):
        frequency = 440 * 2 ** ((midi - 69) / 12)
        left += np.sin(2 * np.pi * frequency * .997 * t + i * .7)
        right += np.sin(2 * np.pi * frequency * 1.003 * t + i * .7)
        left += .16 * np.sin(2 * np.pi * frequency * 2 * t)
        right += .16 * np.sin(2 * np.pi * frequency * 2 * t)
    return np.stack((left, right), axis=1) * envelope[:, None] / len(chord)


def place_stereo(signal, at, gain):
    start = int(round(at * SR))
    length = min(len(signal), N - start)
    mix[start:start + length] += signal[:length] * gain


def ui_click(bright=True):
    t = timeline(.12)
    frequency = 2100 if bright else 920
    signal = np.sin(2 * np.pi * frequency * t) * np.exp(-t * 75)
    signal += .35 * filtered_noise(.12, 3000, 15000, 91) * np.exp(-t * 110)
    return signal


def chime(root=880):
    t = timeline(.65)
    envelope = np.minimum(t / .008, 1) * np.exp(-t * 6)
    return (
        np.sin(2 * np.pi * root * t)
        + .45 * np.sin(2 * np.pi * root * 1.5 * t)
        + .20 * np.sin(2 * np.pi * root * 2 * t)
    ) * envelope


chords = [
    [50, 57, 62, 65], [50, 57, 62, 65],
    [53, 60, 65, 69], [53, 60, 65, 69],
    [48, 55, 60, 64], [48, 55, 60, 64],
    [55, 62, 67, 71], [55, 62, 67, 71],
    [50, 57, 62, 65], [48, 55, 60, 64],
    [53, 60, 65, 69], [50, 57, 62, 65],
]
roots = [73.42, 73.42, 87.31, 87.31, 65.41, 65.41, 98.00, 98.00, 73.42, 65.41, 87.31, 73.42]

for bar in range(12):
    at = bar * 2.0
    place_stereo(pad(chords[bar]), at, .105 if bar not in (0, 11) else .085)
    for step in range(8):
        note = chords[bar][step % 4] + 24
        frequency = 440 * 2 ** ((note - 69) / 12)
        place(pluck(frequency), at + step * .25, .040, -.45 + (step % 4) * .30)

for beat in range(48):
    at = beat * .5
    bar = int(at // 2)
    strength = .29 if bar in (0, 11) else .38
    place(kick(beat + 10), at, strength)
    place(bass(roots[bar]), at, .115 if beat % 2 == 0 else .075)
    if beat % 2 == 1:
        place(snare(beat + 100), at, .13, .08)

for step in range(96):
    at = step * .25
    if step % 2 or step % 8 in (2, 6):
        place(hat(step + 200, step % 8 == 6), at, .035, -.35 if step % 2 else .35)

for at in [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]:
    t = timeline(.34)
    impact = filtered_noise(.34, 45, 1400, int(at * 17)) * np.exp(-t * 15)
    place(impact, at, .16)

for i, at in enumerate([2.0, 4.0, 6.0, 8.0, 10.75, 12.0, 14.0, 16.0, 18.0, 20.0, 22.0]):
    place(ui_click(i % 2 == 0), at, .12, -.12 if i % 2 else .12)

place(chime(740), 10.75, .085, .15)
place(chime(990), 10.87, .060, -.15)
place(chime(880), 18.0, .085, -.18)
place(chime(1320), 18.16, .065, .18)
place(chime(659), 22.0, .070, -.2)
place(chime(988), 22.16, .055, .2)

mix[: int(.012 * SR)] *= np.linspace(0, 1, int(.012 * SR))[:, None]
mix[-int(.18 * SR):] *= np.linspace(1, 0, int(.18 * SR))[:, None]
mix = np.tanh(mix * 1.12)
mix *= .89 / max(.89, float(np.max(np.abs(mix))))

raw = ROOT / 'audio-raw.wav'
out = ROOT / 'audio.wav'
pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2')
with wave.open(str(raw), 'wb') as wav:
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(SR)
    wav.writeframes(pcm.tobytes())

subprocess.run([
    '/opt/homebrew/bin/ffmpeg', '-hide_banner', '-y', '-i', str(raw),
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '2',
    '-c:a', 'pcm_s16le', str(out),
], check=True)
subprocess.run([
    '/opt/homebrew/bin/ffmpeg', '-hide_banner', '-y', '-i', str(out),
    '-filter_complex', 'showwavespic=s=1920x360:split_channels=1,drawgrid=w=160:h=180:t=1:c=white@0.25',
    '-frames:v', '1', '-update', '1', str(ROOT / 'audio-waveform.png'),
], check=True)
raw.unlink(missing_ok=True)

with wave.open(str(out), 'rb') as wav:
    assert wav.getnchannels() == 2
    assert wav.getframerate() == SR
    assert wav.getnframes() == N
print(f'audio.wav: {DURATION:.1f}s / {SR} Hz / stereo')
print('audio-waveform.png: 1920x360 / 160px per bar')
