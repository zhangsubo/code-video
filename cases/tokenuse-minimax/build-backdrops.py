#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TokenUse · MiniMax 三模态发布视频 —— image-01 摄影级光学底板构建器

并发调用 https://api.minimaxi.com/v1/image_generation (model=image-01, aspect_ratio=16:9)
生成 3 张严禁含任何文字 / UI 的抽象光学摄影底板，统一用 ffmpeg 缩放到 1920x1080。

密钥仅在运行时从环境变量或 ~/.local/share/opencode/auth.json 读取，绝不打印、绝不落盘。
"""

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUT = BASE / "backdrops"
OUT.mkdir(parents=True, exist_ok=True)
TMP = BASE / ".tmp"
TMP.mkdir(parents=True, exist_ok=True)
FFMPEG = "/opt/homebrew/bin/ffmpeg"
IMAGE_URL = "https://api.minimaxi.com/v1/image_generation"

NEGATIVE = ("no text, no letters, no words, no numbers, no logo, no watermark, no ui, "
            "no interface, no window, no buttons, no panels, no screen, no chart, "
            "no typography, pure abstract optical photography, cinematic, ultra detailed")

BACKDROPS = [
    {
        "file": "obsidian-wave.jpg",
        "prompt": (
            "Ultra-detailed macro photograph of dark obsidian volcanic glass surface with "
            "subtle internal light refraction, deep charcoal and midnight blue tones, a single "
            "soft caustic light sweep grazing across polished black stone, fine dust particles "
            "catching a cool rim light, shallow depth of field, studio softbox reflections, "
            "moody premium product photography, no subject, pure texture and light, " + NEGATIVE
        ),
    },
    {
        "file": "warm-studio.jpg",
        "prompt": (
            "Nordic warm sunlight falling across a honed travertine stone desktop slab, soft "
            "honey and sand tones with cream highlights, large window light creating gentle "
            "geometric shadow edges, faint dust in the light beam, matte porous surface detail, "
            "minimal scandinavian interior photography, warm airy premium editorial, no subject, "
            "pure light and material, " + NEGATIVE
        ),
    },
    {
        "file": "aurora-prism.jpg",
        "prompt": (
            "Deep sapphire blue optical prism scattering aurora-like spectral light across a "
            "polished glass volume, teal and indigo and faint magenta dispersion rays, volumetric "
            "haze catching a cold beam, delicate micro-scratches on optical glass, cinematic "
            "dark studio laboratory look, high fidelity product photography, no subject, "
            "pure abstract light field, " + NEGATIVE
        ),
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


def http_json(url: str, payload: dict, headers: dict, timeout: int = 120):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download(url: str, dest: Path, timeout: int = 120):
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        dest.write_bytes(resp.read())


def generate(spec: dict, key: str):
    t0 = time.time()
    payload = {
        "model": "image-01",
        "prompt": spec["prompt"],
        "aspect_ratio": "16:9",
        "response_format": "url",
        "n": 1,
        "prompt_optimizer": True,
    }
    headers = {"Authorization": f"Bearer {key}"}

    last_err = None
    for attempt in range(3):
        try:
            resp = http_json(IMAGE_URL, payload, headers, timeout=120)
            break
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            last_err = exc
            time.sleep(2.0 * (attempt + 1))
    else:
        raise RuntimeError(f"{spec['file']} 生成失败: {last_err}")

    base = resp.get("base_resp") or {}
    if base.get("status_code", 0) not in (0, None):
        raise RuntimeError(f"{spec['file']} API 错误: {base.get('status_msg')}")

    data = resp.get("data") or {}
    urls = data.get("image_urls") or []
    if not urls:
        raise RuntimeError(f"{spec['file']} 未返回图片 URL")
    src = TMP / f"raw-{spec['file']}"
    download(urls[0], src)

    dest = OUT / spec["file"]
    subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
         "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
         "-q:v", "3", "-pix_fmt", "yuvj420p", str(dest)],
        check=True,
    )
    return {
        "file": spec["file"],
        "bytes": dest.stat().st_size,
        "width": 1920,
        "height": 1080,
        "elapsed": round(time.time() - t0, 3),
        "traceId": resp.get("trace_id", ""),
    }


def main():
    key = load_key()
    wall0 = time.time()
    print(f"[backdrops] 生成 {len(BACKDROPS)} 张 image-01 光学底板 …", flush=True)
    results = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(generate, spec, key): spec for spec in BACKDROPS}
        for fut, spec in futures.items():
            r = fut.result()
            results.append(r)
            print(f"[backdrops] ✓ {r['file']}  {r['bytes']}B  {r['elapsed']}s", flush=True)

    stats = {
        "model": "image-01",
        "aspectRatio": "16:9",
        "responseFormat": "url",
        "count": len(results),
        "resolution": "1920x1080",
        "wallClockSeconds": round(time.time() - wall0, 3),
        "images": sorted(results, key=lambda r: r["file"]),
    }
    (BASE / "image-stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[backdrops] ✓ backdrops/*.jpg + image-stats.json", flush=True)


if __name__ == "__main__":
    main()
