#!/usr/bin/env node
/**
 * Zero-npm-dependency Chrome CDP 4-worker deterministic video renderer.
 * Requires Node.js v22+ (built-in global WebSocket), Google Chrome, and FFmpeg.
 *
 * Usage:
 *   node render.js --dir ./promo-video --probe   # Gate 2: 12 keyframes + 3x4 probe-sheet.png
 *   node render.js --dir ./promo-video --full    # Gate 3: 4-worker 180fps->60fps tmix MP4
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function argVal(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const WORK_DIR = path.resolve(argVal("--dir", process.cwd()));
const WIDTH = Number(argVal("--width", "1920"));
const HEIGHT = Number(argVal("--height", "1080"));
const FPS = Number(argVal("--fps", "60"));
const WORKERS = Number(argVal("--workers", "4"));

function detectChromeBin() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
  ].filter(Boolean);
  for (const c of candidates) {
    if (!c.startsWith("/") || fs.existsSync(c)) return c;
  }
  throw new Error("Chrome binary not found. Set CHROME_BIN environment variable.");
}

const CHROME_BIN = detectChromeBin();
const FFMPEG_BIN = process.env.FFMPEG_BIN || "ffmpeg";

// Optional timeline.json support (falls back to 24.0s / 12 bars @ 120 BPM)
const timelineJsonPath = path.join(WORK_DIR, "timeline.json");
const TIMELINE = fs.existsSync(timelineJsonPath)
  ? JSON.parse(fs.readFileSync(timelineJsonPath, "utf8"))
  : { duration: 24.0, sceneCuts: [0, 4.0, 8.0, 12.0, 16.0, 20.0, 24.0] };

const DURATION = Number(TIMELINE.totalDuration || TIMELINE.duration || 24.0);
const TOTAL_FRAMES = Number(TIMELINE.totalFrames || Math.round(DURATION * FPS));
const SCENE_CUTS = Array.isArray(TIMELINE.sceneCuts) && TIMELINE.sceneCuts.length >= 2
  ? TIMELINE.sceneCuts
  : [0, DURATION];

function clampSceneBounds(t) {
  for (let i = 0; i < SCENE_CUTS.length - 1; i++) {
    if (t >= SCENE_CUTS[i] && t < SCENE_CUTS[i + 1]) {
      return [SCENE_CUTS[i] + 0.0001, Math.max(SCENE_CUTS[i] + 0.0001, SCENE_CUTS[i + 1] - 0.0002)];
    }
  }
  return [0.0001, Math.max(0.0001, DURATION - 0.0002)];
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    });
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = this.seq++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

async function launchWorkerProcess(tmpRoot, idx, htmlUrl) {
  const userDataDir = path.join(tmpRoot, `chrome-worker-${idx}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(CHROME_BIN, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--force-color-profile=srgb",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`Chrome launch timeout:\n${buf}`)), 15000);
    proc.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });

  const cdp = new CDPClient(wsUrl);
  // Iron Law: never pass width/height to createTarget; override via Emulation
  const { targetId } = await cdp.send("Target.createTarget", { url: htmlUrl });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);

  for (let k = 0; k < 80; k++) {
    const res = await cdp.send("Runtime.evaluate", {
      expression: "Boolean(window.seek) && Array.from(document.images).every(i => i.complete)",
      returnByValue: true,
    }, sessionId);
    if (res?.result?.value === true) break;
    await new Promise((r) => setTimeout(r, 80));
  }

  return {
    async captureAt(t, format = "jpeg", quality = 95) {
      await cdp.send("Runtime.evaluate", {
        expression: `window.seek(${t.toFixed(6)})`,
        awaitPromise: true,
      }, sessionId);
      const shot = await cdp.send("Page.captureScreenshot", {
        format,
        ...(format === "jpeg" ? { quality } : {}),
        optimizeForSpeed: true,
      }, sessionId);
      return Buffer.from(shot.data, "base64");
    },
    dispose() {
      cdp.close();
      try { proc.kill("SIGKILL"); } catch {}
    },
  };
}

async function runProbe(tmpRoot, htmlUrl) {
  const probeDir = path.join(WORK_DIR, "probes");
  fs.mkdirSync(probeDir, { recursive: true });
  const worker = await launchWorkerProcess(tmpRoot, 0, htmlUrl);
  try {
    const files = [];
    for (let i = 0; i < 12; i++) {
      const t = ((i + 0.5) / 12) * DURATION;
      const png = await worker.captureAt(t, "png");
      const out = path.join(probeDir, `probe-${String(i + 1).padStart(2, "0")}-${t.toFixed(2)}s.png`);
      fs.writeFileSync(out, png);
      files.push(out);
    }
    const cellW = WIDTH >= HEIGHT ? 640 : 360;
    const cellH = WIDTH >= HEIGHT ? 360 : 640;
    const cols = WIDTH >= HEIGHT ? 3 : 4;
    const rows = Math.ceil(12 / cols);
    const inputs = files.flatMap((f) => ["-i", f]);
    const scales = files.map((_, i) => `[${i}:v]scale=${cellW}:${cellH}[v${i}]`).join(";");
    const refs = files.map((_, i) => `[v${i}]`).join("");
    const layout = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        layout.push(`${c * cellW}_${r * cellH}`);
      }
    }
    const sheetPath = path.join(WORK_DIR, "probe-sheet.png");
    execFileSync(FFMPEG_BIN, [
      "-y", ...inputs,
      "-filter_complex", `${scales};${refs}xstack=inputs=12:layout=${layout.join("|")}[out]`,
      "-map", "[out]", "-frames:v", "1", sheetPath,
    ], { stdio: "ignore" });
    console.log(`[Probe] Wrote 12-frame contact sheet -> ${sheetPath}`);
  } finally {
    worker.dispose();
  }
}

async function renderChunk(wIdx, startFrame, endFrame, tmpRoot, htmlUrl) {
  const chunkPath = path.join(tmpRoot, `chunk-${wIdx}.mp4`);
  const worker = await launchWorkerProcess(tmpRoot, wIdx, htmlUrl);
  const ff = spawn(FFMPEG_BIN, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", String(FPS * 3), "-i", "-",
    "-vf", `tmix=frames=3:weights='1 2 1',select='not(mod(n+1\\,3))',setpts=N/${FPS}/TB,scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p`,
    "-r", String(FPS), "-c:v", "libx264", "-preset", "fast", "-crf", "15",
    "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    chunkPath,
  ], { stdio: ["pipe", "ignore", "inherit"] });
  const done = new Promise((res, rej) => ff.on("exit", (c) => (c === 0 ? res() : rej(new Error(`FFmpeg chunk ${wIdx} failed: ${c}`)))));
  const writeChunk = (b) => new Promise((r) => (ff.stdin.write(b) ? r() : ff.stdin.once("drain", r)));
  const dt = 0.5 / 120.0;

  try {
    for (let f = startFrame; f < endFrame; f++) {
      const centerT = (f + 0.5) / FPS;
      const [minT, maxT] = clampSceneBounds(centerT);
      for (const off of [-dt, 0, dt]) {
        const subT = Math.max(minT, Math.min(maxT, centerT + off));
        await writeChunk(await worker.captureAt(subT, "jpeg", 95));
      }
    }
    ff.stdin.end();
    await done;
    return chunkPath;
  } finally {
    worker.dispose();
  }
}

async function runFull(tmpRoot, htmlUrl) {
  const audioWav = path.join(WORK_DIR, "audio.wav");
  if (!fs.existsSync(audioWav)) {
    throw new Error(`Missing ${audioWav}. Run audio_synth.py first.`);
  }
  const chunks = await Promise.all(
    Array.from({ length: WORKERS }, (_, w) => {
      const s = Math.floor((w * TOTAL_FRAMES) / WORKERS);
      const e = Math.floor(((w + 1) * TOTAL_FRAMES) / WORKERS);
      return renderChunk(w, s, e, tmpRoot, htmlUrl);
    })
  );
  const listFile = path.join(tmpRoot, "concat.txt");
  fs.writeFileSync(listFile, chunks.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const outMp4 = path.join(WORK_DIR, "output.mp4");
  // Iron Law: NO -shortest, lock -ar 48000 & BT.709 tv
  execFileSync(FFMPEG_BIN, [
    "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-i", audioWav,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart",
    outMp4,
  ], { stdio: "inherit" });
  console.log(`[Full] Master video ready -> ${outMp4}`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "code-video-cdp-"));
try {
  const htmlUrl = `${pathToFileURL(path.join(WORK_DIR, "index.html")).href}?render=1`;
  if (process.argv.includes("--probe")) await runProbe(tmpRoot, htmlUrl);
  else await runFull(tmpRoot, htmlUrl);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
