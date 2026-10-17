// The Converter's wiring: reads the picked file's facts, shows the plan, converts it
// with WebCodecs (mediabunny, ADR-0004) and hands the result to the endpoint
// addConvertedMedia, which continues /add in the chat. The decisions live in plan.js.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
} from 'mediabunny';
import { convertWithinBudget, planConversion, sendFailure } from './plan.js';

/** @typedef {import('./plan.js').FileFacts} FileFacts */
/** @typedef {import('./plan.js').Plan} Plan */
/** @typedef {import('../tgcloud/lib/converted_media.js').ConvertedKind} ConvertedKind */

const UNSUPPORTED = 'Этот файл не поддерживается на этом устройстве';

const tg = window.Telegram?.WebApp;
if (tg) {
  document.documentElement.dataset.tg = '';
  tg.ready();
  tg.expand();
}

/** @template {HTMLElement} T @param {string} id */
const $ = (id) => /** @type {T} */ (document.getElementById(id));
const fileInput = /** @type {HTMLInputElement} */ ($('file'));
const preview = /** @type {HTMLVideoElement} */ ($('preview'));
const glyph = $('glyph');
const ring = $('ring');
const caption = $('caption');
const choice = $('choice');
const note = $('note');
const status = $('status');
const action = /** @type {HTMLButtonElement} */ ($('action'));
const repick = $('repick');

/**
 * What the page is working on: the picked file and its facts, and once converted, the
 * output waiting to be handed back (kept so a failed hand-back can be retried).
 * @type {{ file: File, facts: FileFacts, url: string } | null}
 */
let picked = null;
/** @type {{ kind: ConvertedKind, bytes: Uint8Array } | null} */
let converted = null;
let busy = false;
/** The flow's latest status line. */
let message = { text: '', isError: false };

if (!tg?.initDataUnsafe?.user) {
  // Opened outside the bot's inline button: the endpoint would refuse the hand-back.
  fileInput.disabled = true;
  showStatus('Открой конвертер кнопкой «📁 Загрузить файл» в чате с ботом', true);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void pick(file);
});
repick.addEventListener('click', () => fileInput.click());
choice.addEventListener('change', () => {
  converted = null;
  showStatus('');
});
action.addEventListener('click', () => void (converted ? handBack() : convert()));

/** @param {File} file */
async function pick(file) {
  reset();
  if (picked) URL.revokeObjectURL(picked.url);
  picked = null;
  setBusy(true);
  caption.textContent = file.name;
  showStatus('Читаю файл…');
  try {
    const url = URL.createObjectURL(file);
    const facts = await factsOf(file, url);
    picked = { file, facts, url };
    showPreview(facts, url);
    showStatus('');
  } catch (error) {
    console.error('Converter: cannot read the file', error);
    showStatus(UNSUPPORTED, true);
  } finally {
    setBusy(false);
  }
  render();
}

/**
 * Everything planConversion needs to know about the file. The duration comes from a
 * media element (the gallery's notion of length), falling back to mediabunny's.
 * @param {File} file
 * @param {string} url
 * @returns {Promise<FileFacts>}
 */
async function factsOf(file, url) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const videoTrack = await input.getPrimaryVideoTrack();
  const audioTracks = await input.getAudioTracks();
  const duration =
    (await elementDuration(url, Boolean(videoTrack))) ?? (await input.computeDuration());
  return {
    requested: requestedKind(),
    size: file.size,
    duration,
    video: videoTrack && {
      width: videoTrack.displayWidth,
      height: videoTrack.displayHeight,
      decodable: await videoTrack.canDecode(),
    },
    audioDecodable: await Promise.all(audioTracks.map((track) => track.canDecode())),
  };
}

/**
 * The duration a media element reports for the file, or null if it can't play it.
 * @param {string} url
 * @param {boolean} isVideo
 * @returns {Promise<number | null>}
 */
function elementDuration(url, isVideo) {
  return new Promise((resolve) => {
    const element = document.createElement(isVideo ? 'video' : 'audio');
    const done = (/** @type {number | null} */ duration) => {
      clearTimeout(timer);
      element.removeAttribute('src');
      resolve(duration !== null && Number.isFinite(duration) ? duration : null);
    };
    const timer = setTimeout(() => done(null), 5000);
    element.preload = 'metadata';
    element.onloadedmetadata = () => done(element.duration);
    element.onerror = () => done(null);
    element.src = url;
  });
}

/** @returns {ConvertedKind} */
function requestedKind() {
  const checked = /** @type {HTMLInputElement | null} */ (choice.querySelector('input:checked'));
  return checked?.value === 'voice' ? 'voice' : 'videoNote';
}

/** The plan for the picked file and the admin's current choice. */
function currentPlan() {
  return picked && planConversion({ ...picked.facts, requested: requestedKind() });
}

/** Shows what the picked file will become. @param {FileFacts} facts @param {string} url */
function showPreview(facts, url) {
  const seconds = Math.floor(facts.duration);
  const length = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  caption.textContent = facts.video
    ? `${length}, ${facts.video.width}×${facts.video.height}`
    : length;
  if (facts.video?.decodable) {
    preview.src = url;
    preview.hidden = false;
    glyph.hidden = true;
    void preview.play().catch(() => {});
  } else {
    glyph.textContent = '♪';
    glyph.classList.add('is-audio');
  }
}

/** Syncs the controls with the picked file, its plan and the conversion state. */
function render() {
  const plan = currentPlan();
  choice.hidden = !picked?.facts.video;
  note.hidden = !(plan && 'kind' in plan && plan.kind === 'videoNote' && plan.cropWarning);
  repick.hidden = !picked || busy;
  // A refused plan explains itself; otherwise the flow's latest message stays.
  const shown =
    plan && 'refusal' in plan && !busy ? { text: plan.refusal, isError: true } : message;
  status.textContent = shown.text;
  status.classList.toggle('is-error', shown.isError);
  action.hidden = !plan || 'refusal' in plan;
  action.disabled = busy;
  if (!action.hidden && !busy)
    action.textContent = converted ? 'Отправить ещё раз' : 'Конвертировать';
}

async function convert() {
  const plan = currentPlan();
  if (!picked || !plan || 'refusal' in plan) return;
  const { file } = picked;
  setBusy(true);
  let attempt = 0;
  try {
    const result = await convertWithinBudget(plan, (p) => {
      attempt += 1;
      showStatus(attempt === 1 ? 'Конвертирую…' : 'Получилось тяжеловато, сжимаю сильнее…');
      return encode(file, p);
    });
    if ('refusal' in result) {
      showStatus(result.refusal, true);
      return;
    }
    converted = { kind: plan.kind, bytes: result.bytes };
  } catch (error) {
    console.error('Converter: conversion failed', error);
    showStatus(UNSUPPORTED, true);
    return;
  } finally {
    setProgress(0);
    setBusy(false);
  }
  await handBack();
}

/**
 * Converts the file as planned. The video note is center-cropped to a square; only the
 * first audio track the device can decode is kept (iPhone videos also carry a spatial
 * audio track that can't be decoded).
 * @param {File} file
 * @param {Plan} plan
 * @returns {Promise<Uint8Array>}
 */
async function encode(file, plan) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const videoTrack = await input.getPrimaryVideoTrack();
  let audioTrack = null;
  for (const track of await input.getAudioTracks()) {
    if (await track.canDecode()) {
      audioTrack = track;
      break;
    }
  }
  const target = new BufferTarget();
  const output = new Output({
    format:
      plan.kind === 'voice'
        ? new OggOutputFormat()
        : new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  });
  const conversion = await Conversion.init({
    input,
    output,
    video: (track) =>
      plan.kind === 'videoNote' && track === videoTrack
        ? {
            width: plan.side,
            height: plan.side,
            fit: 'cover',
            codec: 'avc',
            quality: new Quality(plan.videoBitrate),
          }
        : { discard: true },
    audio: (track) =>
      track !== audioTrack
        ? { discard: true }
        : plan.kind === 'voice'
          ? { codec: 'opus', quality: new Quality(plan.audioBitrate), numberOfChannels: 1 }
          : { codec: 'aac', quality: new Quality(plan.audioBitrate) },
  });
  if (!conversion.isValid) {
    throw new Error(
      `Conversion invalid: ${JSON.stringify(conversion.discardedTracks.map((d) => d.reason))}`,
    );
  }
  conversion.onProgress = (progress) => setProgress(progress);
  await conversion.execute();
  if (!target.buffer) throw new Error('Conversion produced no output');
  return new Uint8Array(target.buffer);
}

/** Hands the converted file to the endpoint; on success, back to the chat. */
async function handBack() {
  if (!converted || !tg) return;
  setBusy(true);
  showStatus('Отправляю в чат…');
  try {
    const { kind, bytes } = converted;
    await new Promise((resolve, reject) => {
      tg.Serverless.call('addConvertedMedia', { kind, data: toBase64(bytes) }, (error, result) =>
        error ? reject(error) : resolve(result),
      );
    });
    showStatus('Готово! Теперь придумай название в чате');
    tg.close();
  } catch (error) {
    console.error('Converter: hand-back failed', error);
    const failure = sendFailure(error);
    showStatus(failure.text, true);
    // A refusal retrying can't fix (a stale button, not the admin, too large) ends here.
    if (!failure.retry) {
      converted = null;
      picked = null;
      reset();
    }
  } finally {
    setBusy(false);
  }
}

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** @param {boolean} on */
function setBusy(on) {
  busy = on;
  fileInput.disabled = on || !tg?.initDataUnsafe?.user;
  for (const radio of choice.querySelectorAll('input')) radio.disabled = on;
  render();
}

/** @param {number} progress 0…1 */
function setProgress(progress) {
  ring.style.strokeDasharray = `${Math.round(progress * 100)} 100`;
}

/** @param {string} text @param {boolean} [isError] */
function showStatus(text, isError = false) {
  message = { text, isError };
  render();
}

/** Clears what the previous file left on screen. */
function reset() {
  converted = null;
  preview.pause();
  preview.removeAttribute('src');
  preview.hidden = true;
  glyph.hidden = false;
  glyph.textContent = '+';
  glyph.classList.remove('is-audio');
  setProgress(0);
}
