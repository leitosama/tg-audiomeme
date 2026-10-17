// @ts-nocheck
// PROTOTYPE, wipe me: measures what the Converter depends on, inside Telegram.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $ = (id) => document.getElementById(id);
const results = { env: {}, limit: [], conversions: [] };
const show = () => {
  $('out').textContent = JSON.stringify(results, null, 1);
};

const call = (name, input) =>
  new Promise((resolve, reject) => {
    if (!tg?.Serverless?.call) return reject(new Error('no Telegram.WebApp.Serverless.call'));
    tg.Serverless.call(name, input, (err, res) => (err ? reject(err) : resolve(res)));
  });

const toBase64 = (bytes) => {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

results.env = {
  ua: navigator.userAgent,
  platform: tg?.platform,
  version: tg?.version,
  user: tg?.initDataUnsafe?.user?.id ?? null,
  serverless: typeof tg?.Serverless?.call,
  crossOriginIsolated: self.crossOriginIsolated,
  sab: typeof SharedArrayBuffer,
  wasm: typeof WebAssembly,
  audioEncoder: typeof AudioEncoder,
  videoEncoder: typeof VideoEncoder,
  cores: navigator.hardwareConcurrency,
  memoryGB: navigator.deviceMemory ?? null,
};
$('env').textContent = JSON.stringify(results.env, null, 1);
show();

$('limit').onclick = async () => {
  for (const mb of [1, 2, 4, 8, 16, 32]) {
    const bytes = new Uint8Array(mb * 1048576);
    for (let i = 0; i < bytes.length; i += 65536) {
      crypto.getRandomValues(bytes.subarray(i, i + 65536));
    }
    const data = toBase64(bytes);
    const t0 = performance.now();
    try {
      const res = await call('prototypeEcho', { data });
      results.limit.push({ mb, ok: true, ms: Math.round(performance.now() - t0), res });
    } catch (e) {
      results.limit.push({
        mb,
        ok: false,
        ms: Math.round(performance.now() - t0),
        err: String(e?.message ?? e),
        type: e?.type,
      });
      show();
      break;
    }
    show();
  }
};

let ffmpeg = null;
let lastOut = null;

async function loadFFmpeg(entry) {
  if (ffmpeg) return;
  const t0 = performance.now();
  ffmpeg = new FFmpeg();
  ffmpeg.on('progress', ({ progress }) => {
    $('progress').textContent = `${Math.round(progress * 100)}%`;
  });
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  entry.loadMs = Math.round(performance.now() - t0);
}

function probe(file) {
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith('audio') ? 'audio' : 'video');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      resolve({
        duration: el.duration,
        width: el.videoWidth ?? null,
        height: el.videoHeight ?? null,
      });
      URL.revokeObjectURL(el.src);
    };
    el.onerror = () => resolve({ error: 'browser cannot read metadata' });
    el.src = URL.createObjectURL(file);
  });
}

$('convert').onclick = async () => {
  const file = $('file').files[0];
  if (!file) return;
  const kind = $('kind').value;
  const preset = $('preset').value;
  const entry = {
    name: file.name,
    type: file.type,
    inMB: +(file.size / 1048576).toFixed(2),
    kind,
    preset,
  };
  results.conversions.push(entry);
  $('convert').disabled = true;
  try {
    const t0 = performance.now();
    entry.meta = await probe(file);
    entry.probeMs = Math.round(performance.now() - t0);
    show();
    await loadFFmpeg(entry);
    const inName = `in${file.name.slice(file.name.lastIndexOf('.'))}`;
    await ffmpeg.writeFile(inName, await fetchFile(file));
    const outName = kind === 'voice' ? 'out.ogg' : 'out.mp4';
    const side = "'trunc(min(iw,ih)/2)*2'";
    const args =
      kind === 'voice'
        ? ['-i', inName, '-vn', '-c:a', 'libopus', '-ac', '1', '-b:a', '64k', outName]
        : [
            '-i',
            inName,
            '-vf',
            `crop=${side}:${side},scale='min(640,iw)':-2`,
            '-c:v',
            'libx264',
            '-preset',
            preset,
            '-c:a',
            'aac',
            '-b:a',
            '64k',
            '-movflags',
            '+faststart',
            outName,
          ];
    const t1 = performance.now();
    entry.exitCode = await ffmpeg.exec(args);
    entry.execMs = Math.round(performance.now() - t1);
    lastOut = { kind, bytes: await ffmpeg.readFile(outName) };
    entry.outMB = +(lastOut.bytes.length / 1048576).toFixed(2);
    await ffmpeg.deleteFile(inName);
    $('send').disabled = false;
  } catch (e) {
    entry.err = String(e?.message ?? e);
  }
  $('convert').disabled = false;
  show();
};

$('send').onclick = async () => {
  if (!lastOut) return;
  const entry = results.conversions.at(-1);
  const t0 = performance.now();
  try {
    const res = await call('prototypeEcho', {
      data: toBase64(lastOut.bytes),
      send: lastOut.kind === 'voice' ? 'voice' : 'videonote',
    });
    entry.sendMs = Math.round(performance.now() - t0);
    entry.sent = res.sent;
  } catch (e) {
    entry.sendErr = String(e?.message ?? e);
  }
  show();
};

$('report').onclick = async () => {
  try {
    await call('prototypeEcho', { text: JSON.stringify(results) });
  } catch (e) {
    $('out').textContent = `report failed: ${e?.message ?? e}\n\n${$('out').textContent}`;
  }
};
