import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 60;
const DURATION = 24;
const TOTAL = FPS * DURATION;
const INDEX_URL = `${pathToFileURL(join(ROOT, 'index.html')).href}?render=1`;
const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--probe') ? 'probe' : '';
const atArgument = process.argv.find((arg) => arg.startsWith('--at='));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!mode && !atArgument) {
  console.error('Usage: node render.mjs --probe | --full | --at=10.75');
  process.exit(2);
}

class CDP {
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CDP(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chrome CDP closed'));
      this.pending.clear();
    });
  }

  call(method, params = {}, sessionId) {
    const id = ++this.sequence;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message));
    });
  }
}

async function launchChrome(pageCount) {
  const profile = mkdtempSync(join(ROOT, '.chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    'about:blank',
  ], { stdio: 'ignore' });

  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 240; i++) {
    if (existsSync(portFile)) break;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited with ${chrome.exitCode}`);
    await delay(25);
  }
  if (!existsSync(portFile)) throw new Error('Chrome debugging port was not created');
  const [port, socketPath] = readFileSync(portFile, 'utf8').trim().split('\n');
  const socketURL = `ws://127.0.0.1:${port}${socketPath}`;
  const cdp = await CDP.connect(socketURL);
  const pages = [];

  for (let i = 0; i < pageCount; i++) {
    const { targetId } = await cdp.call('Target.createTarget', { url: INDEX_URL });
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId, flatten: true });
    await cdp.call('Page.enable', {}, sessionId);
    await cdp.call('Runtime.enable', {}, sessionId);
    await cdp.call('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    let ready = false;
    for (let attempt = 0; attempt < 240; attempt++) {
      const result = await cdp.call('Runtime.evaluate', {
        expression: "document.readyState === 'complete' && typeof window.seek === 'function'",
        returnByValue: true,
      }, sessionId);
      if (result.result?.value) {
        ready = true;
        break;
      }
      await delay(25);
    }
    if (!ready) throw new Error('TokenUse stage did not become ready');
    await evaluateSeek(cdp, sessionId, 0);
    pages.push({ targetId, sessionId });
  }

  return {
    cdp,
    pages,
    async close() {
      await cdp.call('Browser.close').catch(() => {});
      if (chrome.exitCode === null && chrome.signalCode === null) {
        await Promise.race([once(chrome, 'exit'), delay(2000)]);
      }
      if (chrome.exitCode === null && chrome.signalCode === null) {
        chrome.kill('SIGTERM');
        await once(chrome, 'exit');
      }
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

async function evaluateSeek(cdp, sessionId, time) {
  const result = await cdp.call('Runtime.evaluate', {
    expression: `window.seek(${JSON.stringify(time)})`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
}

async function capture(cdp, page, time) {
  await evaluateSeek(cdp, page.sessionId, time);
  const result = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  }, page.sessionId);
  return Buffer.from(result.data, 'base64');
}

async function captureTriple(cdp, page, frame) {
  const center = frame / FPS;
  const sceneStart = Math.floor(center / 2) * 2;
  const sceneEnd = Math.min(DURATION, sceneStart + 2) - 0.0002;
  const frames = [];
  for (const offset of [-1 / 180, 0, 1 / 180]) {
    const time = Math.min(sceneEnd, Math.max(sceneStart, center + offset));
    frames.push(await capture(cdp, page, time));
  }
  return frames;
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

async function probe(browser) {
  const jobs = [];
  for (let i = 0; i < 12; i++) {
    jobs.push({ index: i, time: i * 2 + 1, page: browser.pages[i % browser.pages.length] });
  }
  for (let base = 0; base < jobs.length; base += browser.pages.length) {
    await Promise.all(jobs.slice(base, base + browser.pages.length).map(async (job) => {
      const image = await capture(browser.cdp, job.page, job.time);
      const name = `probe-${String(job.index).padStart(2, '0')}.png`;
      writeFileSync(join(ROOT, name), image);
      console.log(`${name}  t=${job.time.toFixed(1)}s`);
    }));
  }
  const inputs = [];
  const filters = [];
  const labels = [];
  for (let i = 0; i < 12; i++) {
    inputs.push('-i', join(ROOT, `probe-${String(i).padStart(2, '0')}.png`));
    filters.push(`[${i}:v]scale=640:360:flags=lanczos,setsar=1[p${i}]`);
    labels.push(`[p${i}]`);
  }
  const layout = [
    '0_0', '640_0', '1280_0',
    '0_360', '640_360', '1280_360',
    '0_720', '640_720', '1280_720',
    '0_1080', '640_1080', '1280_1080',
  ].join('|');
  runChecked(FFMPEG, [
    '-hide_banner', '-loglevel', 'warning', '-y', ...inputs,
    '-filter_complex', `${filters.join(',')},${labels.join('')}xstack=inputs=12:layout=${layout}[sheet]`,
    '-map', '[sheet]', '-frames:v', '1', '-update', '1', join(ROOT, 'probe-sheet.png'),
  ]);
  console.log('probe-sheet.png: 3x4 / 1920x1440');
}

async function writeBuffers(stream, buffers) {
  for (const buffer of buffers) {
    if (!stream.write(buffer)) await once(stream, 'drain');
  }
}

async function full(browser) {
  if (!existsSync(join(ROOT, 'audio.wav'))) throw new Error('Run audio.py before --full');
  const output = join(ROOT, 'tokenuse-kimi-promo.mp4');
  const filter = "[0:v]tmix=frames=3:weights='1 2 1',select='not(mod(n+1\\,3))',setpts=N/60/TB,scale=in_range=pc:out_range=tv,format=yuv420p[v];[1:a]loudnorm=I=-13.5:TP=-3:LRA=11[a]";
  const ffmpeg = spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-f', 'image2pipe', '-framerate', '180', '-vcodec', 'png', '-i', 'pipe:0',
    '-i', join(ROOT, 'audio.wav'),
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-bsf:v', 'h264_metadata=video_full_range_flag=0',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    '-t', '24.000', '-r', '60', '-movflags', '+faststart', output,
  ], { stdio: ['pipe', 'ignore', 'inherit'] });
  const completed = new Promise((resolve, reject) => {
    ffmpeg.once('error', reject);
    ffmpeg.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)));
  });

  try {
    for (let base = 0; base < TOTAL; base += browser.pages.length) {
      const group = await Promise.all(browser.pages.map((page, offset) => (
        captureTriple(browser.cdp, page, base + offset)
      )));
      for (const triple of group) await writeBuffers(ffmpeg.stdin, triple);
      const rendered = Math.min(TOTAL, base + browser.pages.length);
      if (rendered % 60 === 0 || rendered === TOTAL) {
        console.log(`render ${String(rendered).padStart(4, '0')} / ${TOTAL} frames`);
      }
    }
    ffmpeg.stdin.end();
    await completed;
  } catch (error) {
    ffmpeg.stdin.destroy();
    if (ffmpeg.exitCode === null) ffmpeg.kill('SIGTERM');
    throw error;
  }

  const probeResult = spawnSync(FFPROBE, [
    '-v', 'error', '-count_frames', '-show_entries',
    'stream=index,codec_type,width,height,pix_fmt,color_range,r_frame_rate,nb_read_frames,sample_rate,channels:format=duration',
    '-of', 'json', output,
  ], { encoding: 'utf8' });
  if (probeResult.status !== 0) throw new Error(probeResult.stderr);
  const metadata = JSON.parse(probeResult.stdout);
  const video = metadata.streams.find((stream) => stream.codec_type === 'video');
  const audio = metadata.streams.find((stream) => stream.codec_type === 'audio');
  if (video.width !== WIDTH || video.height !== HEIGHT) throw new Error('Incorrect video dimensions');
  if (video.r_frame_rate !== '60/1' || Number(video.nb_read_frames) !== TOTAL) throw new Error('Incorrect frame cadence');
  if (video.pix_fmt !== 'yuv420p' || video.color_range !== 'tv') throw new Error('Incorrect pixel format or range');
  if (Math.abs(Number(metadata.format.duration) - DURATION) > .02) throw new Error('Incorrect duration');
  if (audio.sample_rate !== '48000' || audio.channels !== 2) throw new Error('Incorrect audio format');
  console.log(JSON.stringify(metadata, null, 2));
}

const browser = await launchChrome(4);
try {
  if (atArgument) {
    const time = Number(atArgument.slice(5));
    if (!Number.isFinite(time) || time < 0 || time >= DURATION) throw new Error('Invalid --at time');
    const name = `single-${time.toFixed(3)}.png`;
    writeFileSync(join(ROOT, name), await capture(browser.cdp, browser.pages[0], time));
    console.log(`${name}: ${WIDTH}x${HEIGHT}`);
  } else if (mode === 'probe') {
    await probe(browser);
  } else {
    await full(browser);
  }
} finally {
  await browser.close();
}
