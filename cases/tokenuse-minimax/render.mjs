#!/usr/bin/env node
/**
 * TokenUse · MiniMax 三模态发布视频 —— 无依赖 Chrome CDP 渲染器
 *
 *   node render.mjs --probe   导出 12 张探针图 + probe-sheet.png
 *   node render.mjs --full    4 并发标签页 → 180fps mjpeg 管道 → tokenuse-minimax-promo.mp4
 *                             + 切点帧 cut-boundaries.png
 *
 * 约束：
 *   · Target.createTarget 不传 width/height，改用 Emulation.setDeviceMetricsOverride(1920x1080, dSF=1)
 *   · 3 子帧严格钳制在各 scene [start, end] 内，杜绝跨镜残影
 *   · tmix=frames=3:weights='1 2 1' + scale=in_range=pc:out_range=tv,format=yuv420p
 *   · 音频混入 -c:a aac -b:a 256k -ar 48000
 */
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const PAGE = 'file://' + path.join(HERE, 'index.html');
const PORT = 9333;
const SUBFRAMES = 3;
const PIPE_FPS = 180;
const SHOTS = 4;                    // 并发标签页
const DUR = 1920, HEI = 1080;

const MODE = process.argv.includes('--full') ? 'full' : 'probe';
const TL = JSON.parse(fs.readFileSync(path.join(HERE, 'timeline.json'), 'utf8'));
const SCENES = TL.scenes;

/* ---------------- 极简 CDP 客户端 ---------------- */
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.sessions = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout ' + method)); } }, 60000);
    });
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function launchChrome(port, tag) {
  const profile = path.join(HERE, '.tmp', `chrome-profile-${tag}`);
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--force-device-scale-factor=1', '--window-size=1920,1080',
    '--allow-file-access-from-files',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      const j = await r.json();
      if (j.webSocketDebuggerUrl) return { proc, wsUrl: j.webSocketDebuggerUrl };
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('Chrome 启动失败 port=' + port);
}

async function makeTab(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: PAGE });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: DUR, height: HEI, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send('Page.bringToFront', {}, sessionId).catch(() => { /* noop */ });

  // 等待字体与所有图片（含 CSS 背景图）就绪
  for (let i = 0; i < 200; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        if (!window.Engine || !window.seek || !window.ASSETS || !window.TIMELINE) return false;
        if (document.readyState !== 'complete') return false;
        const bgs = Array.from(document.querySelectorAll('.bd'))
          .map(el => getComputedStyle(el).backgroundImage)
          .map(s => s.replace(/^url\\("?|"?\\)$/g, '')).filter(Boolean);
        const imgs = Array.from(document.images).filter(i => i.getAttribute('src')).map(i => i.src);
        const all = bgs.concat(imgs);
        await Promise.all(all.map(u => new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = u; })));
        return true;
      })()`,
      returnByValue: true,
      awaitPromise: true,
    }, sessionId);
    if (r.result && r.result.value === true) break;
    await sleep(100);
  }
  return sessionId;
}

async function seek(cdp, sid, t) {
  await cdp.send('Runtime.evaluate', { expression: `window.seek(${t})`, returnByValue: true }, sid);
}

async function shot(cdp, sid, type = 'jpeg', quality = 95) {
  const r = await cdp.send('Page.captureScreenshot',
    { format: type, quality: type === 'jpeg' ? quality : undefined, captureBeyondViewport: false }, sid);
  return Buffer.from(r.data, 'base64');
}

/* ---------------- 场景边界钳制 ---------------- */
function clampToScene(t) {
  let sc = SCENES[0];
  for (const s of SCENES) { if (t >= s.start) sc = s; else break; }
  const lo = sc.start + 0.0001, hi = sc.end - 0.0001;
  return Math.min(Math.max(t, lo), hi);
}

/** 输出帧 k (60fps) 的 3 个子帧时刻，严格落在同一 scene 内 */
function subframeTimes(k) {
  const t = k / TL.fps;
  const d = 1 / PIPE_FPS;
  return [t - d, t, t + d].map(clampToScene);
}

/* ---------------- 探针模式 ---------------- */
async function runProbe(cdp) {
  const sid = await makeTab(cdp);
  const outDir = path.join(HERE, 'probe');
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  let n = 0;
  for (const sc of SCENES) {
    const span = sc.end - sc.start;
    const picks = [
      { tag: 'entry',  t: sc.start + Math.min(0.42, span * 0.12) },
      { tag: 'stable', t: sc.start + span * 0.74 },
    ];
    for (const p of picks) {
      n++;
      await seek(cdp, sid, clampToScene(p.t));
      const buf = await shot(cdp, sid, 'png');
      const f = path.join(outDir, `probe-${String(n).padStart(2, '0')}-${sc.id}-${p.tag}.png`);
      fs.writeFileSync(f, buf);
      files.push(f);
      process.stdout.write(`  probe ${String(n).padStart(2, '0')} ${sc.id}/${p.tag} @ ${p.t.toFixed(2)}s\n`);
    }
  }
  // 联络表 4x3
  const listFile = path.join(HERE, '.tmp', 'probe-list.txt');
  fs.writeFileSync(listFile, files.map(f => `file '${f}'`).join('\n'), 'utf8');
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', 'scale=480:270:force_original_aspect_ratio=increase,crop=480:270,tile=4x3',
    '-frames:v', '1', path.join(HERE, 'probe-sheet.png')], { stdio: 'inherit' });
  console.log('✓ probe-sheet.png 已生成');
}

/* ---------------- 全片模式 ---------------- */
async function runFull(cdp) {
  const totalFrames = TL.totalFrames;
  const perTab = Math.ceil(totalFrames / SHOTS);
  const segs = [];

  const tabs = [];
  const owners = [];
  for (let i = 0; i < SHOTS; i++) {
    const b = await launchChrome(PORT + 10 + i, `w${i}`);
    owners.push(b);
    const wsc = new WebSocket(b.wsUrl);
    await new Promise((res, rej) => {
      wsc.addEventListener('open', res);
      wsc.addEventListener('error', rej);
    });
    const c = new CDP(wsc);
    tabs.push({ cdp: c, sid: await makeTab(c), ws: wsc });
    await sleep(700);
  }

  console.log(`✓ ${SHOTS} 个独立 Chrome 实例就绪，开始渲染 ${totalFrames} 帧 (${SUBFRAMES}x${PIPE_FPS}fps 管道)`);

  const workers = tabs.map(async (tab, ti) => {
    const sid = tab.sid, cdp = tab.cdp;
    const k0 = ti * perTab;
    const k1 = Math.min(totalFrames, k0 + perTab);
    if (k0 >= k1) return;

    const seg = path.join(HERE, '.tmp', `seg-${ti}.mp4`);
    const ff = spawn(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(PIPE_FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
      '-vf', `tmix=frames=3:weights='1 2 1',select='not(mod(n+1,3))',setpts=N/(${TL.fps}*TB),scale=in_range=pc:out_range=tv,format=yuv420p`,
      '-r', String(TL.fps),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(TL.fps),
      seg,
    ], { stdio: ['pipe', 'ignore', 'inherit'] });

    const write = (buf) => new Promise((resolve, reject) => {
      if (ff.stdin.write(buf)) resolve(); else ff.stdin.once('drain', resolve);
      ff.stdin.once('error', reject);
    });

    // mjpeg 探测会吞掉管道首帧 -> 预热 1 帧，保证 select 后每段输出帧数精确 == 帧区间长度
    {
      const tWarm = subframeTimes(k0)[0];
      await seek(cdp, sid, tWarm);
      const wb = await shot(cdp, sid, 'jpeg', 95);
      if (!ff.stdin.write(wb)) await new Promise(r => ff.stdin.once('drain', r));
    }

    for (let k = k0; k < k1; k++) {
      const times = subframeTimes(k);
      for (const t of times) {
        await seek(cdp, sid, t);
        const buf = await shot(cdp, sid, 'jpeg', 95);
        if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      }
      if ((k - k0) % 120 === 0) {
        console.log(`  tab${ti}: ${k - k0 + 1}/${k1 - k0} frames`);
      }
    }
    await new Promise(r => ff.stdin.end(r));
    await new Promise(r => ff.on('close', r));
    segs.push(seg);
    console.log(`✓ tab${ti} 段落完成 (${k1 - k0} frames)`);
  });

  await Promise.all(workers);

  // 拼接分段
  segs.sort();
  const listFile = path.join(HERE, '.tmp', 'segs.txt');
  fs.writeFileSync(listFile, segs.map(s => `file '${s}'`).join('\n'), 'utf8');
  const videoOnly = path.join(HERE, '.tmp', 'video-only.mp4');
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', videoOnly], { stdio: 'inherit' });

  // 混入音轨
  const out = path.join(HERE, 'tokenuse-minimax-promo.mp4');
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-i', videoOnly, '-i', path.join(HERE, 'audio.wav'),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('✓ tokenuse-minimax-promo.mp4 已生成');

  // 切点前后帧
  const cutDir = path.join(HERE, '.tmp', 'cuts');
  fs.mkdirSync(cutDir, { recursive: true });
  const cutSid = tabs[0].sid, cutCdp = tabs[0].cdp;
  const cutFiles = [];
  let ci = 0;
  for (let i = 1; i < SCENES.length; i++) {
    const boundary = SCENES[i].start;
    for (const [tag, t] of [['pre', boundary - 0.0167], ['post', boundary + 0.0167]]) {
      await seek(cutCdp, cutSid, clampToScene(t));
      const buf = await shot(cutCdp, cutSid, 'png');
      const f = path.join(cutDir, `cut-${String(ci).padStart(2, '0')}-${tag}.png`);
      fs.writeFileSync(f, buf);
      cutFiles.push(f);
      ci++;
    }
  }
  const cutList = path.join(HERE, '.tmp', 'cut-list.txt');
  fs.writeFileSync(cutList, cutFiles.map(f => `file '${f}'`).join('\n'), 'utf8');
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', cutList,
    '-vf', 'scale=384:216:force_original_aspect_ratio=increase,crop=384:216,tile=5x2',
    '-frames:v', '1', path.join(HERE, 'cut-boundaries.png')], { stdio: 'inherit' });
  console.log('✓ cut-boundaries.png 已生成');
  for (const o of owners) { try { o.proc.kill('SIGKILL'); } catch { /* noop */ } }
}

/* ---------------- 切点帧（可独立运行） ---------------- */
async function runCuts() {
  const { proc, wsUrl } = await launchChrome(PORT + 30, 'cuts');
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);
  const sid = await makeTab(cdp);
  const cutDir = path.join(HERE, '.tmp', 'cuts');
  fs.mkdirSync(cutDir, { recursive: true });
  const cutFiles = [];
  let ci = 0;
  for (let i = 1; i < SCENES.length; i++) {
    const boundary = SCENES[i].start;
    for (const [tag, t] of [['pre', boundary - 0.0167], ['post', boundary + 0.0167]]) {
      await seek(cdp, sid, clampToScene(t));
      const buf = await shot(cdp, sid, 'png');
      const f = path.join(cutDir, `cut-${String(ci).padStart(2, '0')}-${tag}.png`);
      fs.writeFileSync(f, buf);
      cutFiles.push(f);
      ci++;
    }
  }
  const cutList = path.join(HERE, '.tmp', 'cut-list.txt');
  fs.writeFileSync(cutList, cutFiles.map(f => `file '${f}'`).join('\n'), 'utf8');
  execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', cutList,
    '-vf', 'scale=384:216:force_original_aspect_ratio=increase,crop=384:216,tile=5x2',
    '-frames:v', '1', path.join(HERE, 'cut-boundaries.png')], { stdio: 'inherit' });
  console.log('✓ cut-boundaries.png 已生成');
  try { ws.close(); } catch { /* noop */ }
  try { proc.kill('SIGKILL'); } catch { /* noop */ }
}

/* ---------------- 校验 ---------------- */
function verify() {
  const mp4 = path.join(HERE, 'tokenuse-minimax-promo.mp4');
  const probe = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json',
    '-show_streams', '-show_format', mp4], { encoding: 'utf8' }));
  const v = probe.streams.find(s => s.codec_type === 'video');
  const a = probe.streams.find(s => s.codec_type === 'audio');
  const eb = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', mp4, '-af', 'ebur128=peak=true',
    '-f', 'null', '-'], { encoding: 'utf8' });
  const out = (eb.stderr || '') + (eb.stdout || '');
  let I = null, peak = null;
  for (const line of out.split('\n')) {
    const mi = line.match(/I:\s*(-?[\d.]+)\s*LUFS/);
    if (mi) I = parseFloat(mi[1]);
    const mp = line.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);
    if (mp) peak = parseFloat(mp[1]);
  }
  const report = {
    file: 'tokenuse-minimax-promo.mp4',
    sizeBytes: fs.statSync(mp4).size,
    durationSeconds: parseFloat(probe.format.duration),
    video: {
      codec: v.codec_name, profile: v.profile, pixFmt: v.pix_fmt,
      colorRange: v.color_range, colorSpace: v.color_space,
      width: v.width, height: v.height, nbFrames: v.nb_frames,
      avgFrameRate: v.avg_frame_rate, bitrate: v.bit_rate,
    },
    audio: {
      codec: a.codec_name, sampleRate: a.sample_rate, channels: a.channels,
      bitrate: a.bit_rate,
    },
    integratedLufs: I, truePeakDbfs: peak,
  };
  fs.writeFileSync(path.join(HERE, 'verify-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log('\n===== 成片校验 =====');
  console.log(JSON.stringify(report, null, 2));

  const expected = TL.totalFrames;
  const got = parseInt(v.nb_frames, 10);
  const checks = [
    ['帧数 == timeline.totalFrames', got === expected, `${got} / ${expected}`],
    ['yuv420p', v.pix_fmt === 'yuv420p', v.pix_fmt],
    ['tv 色域标记', v.color_range === 'tv', v.color_range],
    ['1920x1080', v.width === 1920 && v.height === 1080, `${v.width}x${v.height}`],
    ['音频 48000Hz', a.sample_rate === '48000', a.sample_rate],
    ['真峰值 <= -1.5 dBFS', peak !== null && peak <= -1.5, peak],
    ['积分响度 -14±1 LUFS', I !== null && Math.abs(I + 14) <= 1.0, I],
  ];
  let ok = true;
  console.log('\n===== 门禁断言 =====');
  for (const [name, pass, val] of checks) {
    console.log(`${pass ? '✓' : '✗'} ${name}: ${val}`);
    if (!pass) ok = false;
  }
  if (!ok) process.exitCode = 1;
}

/* ---------------- main ---------------- */
(async () => {
  const arg = process.argv[2] || '';
  if (arg === '--cuts') { await runCuts(); process.exit(0); }
  if (arg === '--verify') { verify(); process.exit(process.exitCode || 0); }
  if (MODE === 'probe') {
    const { proc, wsUrl } = await launchChrome(PORT, 'probe');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res);
      ws.addEventListener('error', rej);
    });
    const cdp = new CDP(ws);
    try { await runProbe(cdp); }
    finally {
      try { ws.close(); } catch { /* noop */ }
      try { proc.kill('SIGKILL'); } catch { /* noop */ }
    }
  } else {
    await runFull();
    verify();
  }
  process.exit(process.exitCode || 0);
})();
