#!/usr/bin/env node
/**
 * Zero-dependency Chrome CDP deterministic video renderer for Gemini / TokenUse.
 * Usage:
 *   node render.mjs --probe   # Gate 2: Render 12 keyframes + 3x4 contact sheet (probe-sheet.png)
 *   node render.mjs --full    # Gate 3: Parallel 4-tab 180fps -> 60fps shutter-blurred H.264 MP4
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HTML_URL = `${pathToFileURL(path.join(__dirname, "index.html")).href}?render=1`;
const DURATION = 24.0;
const FPS = 60;
const SUBFRAMES = 3; // 3 subframes per 60fps frame -> real shutter motion blur
const TOTAL_FRAMES = Math.round(DURATION * FPS); // 1440 frames
const SCENE_CUTS = [0, 2.0, 4.0, 8.0, 12.0, 16.0, 19.95, 24.0];

function sceneBounds(t) {
  for (let i = 0; i < SCENE_CUTS.length - 1; i++) {
    if (t >= SCENE_CUTS[i] && t < SCENE_CUTS[i + 1]) {
      return [SCENE_CUTS[i], SCENE_CUTS[i + 1] - 0.0002];
    }
  }
  return [0, DURATION];
}

class CDPConnection {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  async send(method, params = {}, sessionId = undefined) {
    await this.ready;
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function launchChrome() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenuse-video-cdp-"));
  const proc = spawn(CHROME_BIN, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--window-size=1920,1080",
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
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Chrome launch timeout:\n${stderr}`)), 12000);
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early (${code}):\n${stderr}`));
    });
  });

  const cdp = new CDPConnection(wsUrl);
  return {
    cdp,
    cleanup: () => {
      cdp.close();
      proc.kill("SIGKILL");
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

async function createWorkerTab(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: HTML_URL });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);

  // Wait until window.seek is ready and all <img> data URIs are decoded
  for (let attempt = 0; attempt < 60; attempt++) {
    const res = await cdp.send("Runtime.evaluate", {
      expression: `Boolean(window.seek) && Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)`,
      returnByValue: true,
    }, sessionId);
    if (res?.result?.value === true) break;
    await new Promise((r) => setTimeout(r, 80));
  }

  return {
    async captureAt(t, format = "jpeg", quality = 94) {
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
  };
}

async function runProbe() {
  const probeDir = path.join(__dirname, "probes");
  fs.mkdirSync(probeDir, { recursive: true });
  const probeTimes = [0.65, 1.35, 2.75, 3.60, 5.20, 7.25, 8.80, 10.60, 12.80, 14.90, 18.60, 21.80];

  console.log(`Launching Chrome for ${probeTimes.length} keyframe probes...`);
  const { cdp, cleanup } = await launchChrome();
  try {
    const tab = await createWorkerTab(cdp);
    const files = [];
    for (let i = 0; i < probeTimes.length; i++) {
      const t = probeTimes[i];
      const buf = await tab.captureAt(t, "png");
      const outPath = path.join(probeDir, `probe-${String(i + 1).padStart(2, "0")}-${t.toFixed(2)}s.png`);
      fs.writeFileSync(outPath, buf);
      files.push(outPath);
      console.log(`  [${i + 1}/${probeTimes.length}] t=${t.toFixed(2)}s -> ${path.basename(outPath)}`);
    }

    // Build 3x4 contact sheet (1920x1440) via ffmpeg
    const sheetPath = path.join(__dirname, "probe-sheet.png");
    await new Promise((resolve, reject) => {
      const args = ["-y", "-hide_banner", "-loglevel", "error"];
      for (const f of files) args.push("-i", f);
      const scaleFilters = files.map((f, idx) => {
        const t = probeTimes[idx].toFixed(2);
        return `[${idx}:v]scale=640:360,drawbox=x=12:y=12:w=150:h=34:color=black@0.72:t=fill,drawtext=text='t=${t}s':x=22:y=20:fontsize=20:fontcolor=white[v${idx}]`;
      });
      const inputs = files.map((_, idx) => `[v${idx}]`).join("");
      // Use xstack cleanly without drawtext fallback issues if libfreetype isn't compiled
      const simpleFilters = files.map((_, idx) => `[${idx}:v]scale=640:360[v${idx}]`).join(";");
      const layout = [
        "0_0", "640_0", "1280_0",
        "0_360", "640_360", "1280_360",
        "0_720", "640_720", "1280_720",
        "0_1080", "640_1080", "1280_1080",
      ].join("|");
      args.push(
        "-filter_complex",
        `${simpleFilters};${inputs}xstack=inputs=12:layout=${layout}[out]`,
        "-map", "[out]",
        sheetPath
      );
      const ff = spawn("ffmpeg", args, { stdio: "inherit" });
      ff.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`))));
    });
    console.log(`Saved contact sheet -> ${sheetPath}`);
  } finally {
    cleanup();
  }
}

async function runFullRender() {
  const outMp4 = path.join(__dirname, "tokenuse-promo.mp4");
  const audioWav = path.join(__dirname, "audio.wav");
  if (!fs.existsSync(audioWav)) {
    throw new Error("Missing audio.wav — run audio.py + loudnorm first.");
  }

  const WORKERS = 4;
  console.log(`Rendering ${TOTAL_FRAMES} frames (${DURATION}s @ ${FPS}fps × ${SUBFRAMES} subframes = ${TOTAL_FRAMES * SUBFRAMES} renders) across ${WORKERS} parallel Chrome tabs...`);
  const tStart = Date.now();
  const { cdp, cleanup } = await launchChrome();

  try {
    const tabs = await Promise.all(Array.from({ length: WORKERS }, () => createWorkerTab(cdp)));

    // Spawn FFmpeg blending 3 subframes (weights 1 2 1) per output frame with zero cross-cut bleed
    const ffArgs = [
      "-y",
      "-hide_banner",
      "-loglevel", "warning",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "-framerate", String(FPS * SUBFRAMES),
      "-i", "-",
      "-i", audioWav,
      "-vf", "tmix=frames=3:weights='1 2 1',select='not(mod(n+1\\,3))',setpts=N/60/TB,scale=in_range=pc:out_range=tv,format=yuv420p",
      "-r", String(FPS),
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "16",
      "-pix_fmt", "yuv420p",
      "-color_range", "tv",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      "-movflags", "+faststart",
      outMp4,
    ];
    const ff = spawn("ffmpeg", ffArgs, { stdio: ["pipe", "inherit", "inherit"] });
    const ffDone = new Promise((resolve, reject) => {
      ff.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`FFmpeg exited with code ${code}`))));
    });

    const writeBuf = (buf) =>
      new Promise((resolve) => {
        if (ff.stdin.write(buf)) resolve();
        else ff.stdin.once("drain", resolve);
      });

    // Render in ordered batches of WORKERS frames so memory stays tiny while all 4 tabs stay 100% saturated
    const dtSub = 1.0 / 210.0; // ~170-degree cinema shutter angle at 60fps
    for (let baseFrame = 0; baseFrame < TOTAL_FRAMES; baseFrame += WORKERS) {
      const batchCount = Math.min(WORKERS, TOTAL_FRAMES - baseFrame);
      const batchBuffers = await Promise.all(
        Array.from({ length: batchCount }, async (_, wIdx) => {
          const f = baseFrame + wIdx;
          const centerT = f / FPS;
          const [sMin, sMax] = sceneBounds(centerT);
          const tab = tabs[wIdx];
          const subs = [];
          for (const offset of [-dtSub, 0, dtSub]) {
            const subT = Math.max(sMin, Math.min(sMax, centerT + offset));
            subs.push(await tab.captureAt(subT, "jpeg", 95));
          }
          return subs;
        })
      );

      for (const subs of batchBuffers) {
        for (const jpg of subs) {
          await writeBuf(jpg);
        }
      }

      if ((baseFrame + batchCount) % 120 === 0 || baseFrame + batchCount === TOTAL_FRAMES) {
        const pct = (((baseFrame + batchCount) / TOTAL_FRAMES) * 100).toFixed(0);
        const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
        console.log(`  Progress: ${baseFrame + batchCount}/${TOTAL_FRAMES} frames (${pct}%) — ${elapsed}s`);
      }
    }

    ff.stdin.end();
    await ffDone;
    const totalSec = ((Date.now() - tStart) / 1000).toFixed(1);
    console.log(`Master MP4 complete in ${totalSec}s -> ${outMp4}`);
  } finally {
    cleanup();
  }
}

const mode = process.argv.includes("--probe") ? "probe" : "full";
if (mode === "probe") {
  await runProbe();
} else {
  await runFullRender();
}
