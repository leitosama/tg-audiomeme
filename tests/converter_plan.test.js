import { describe, expect, test } from 'vitest';
import {
  convertWithinBudget,
  planConversion,
  sendFailure,
  sizeRefusal,
} from '../converter/plan.js';

/** @typedef {import('../converter/plan.js').FileFacts} FileFacts */

/**
 * Facts for a decodable 10 s, 1 MB video with one decodable audio track.
 * @param {Partial<FileFacts>} [overrides]
 * @returns {FileFacts}
 */
const video = (overrides) => ({
  requested: 'videoNote',
  size: 1_000_000,
  duration: 10,
  video: { width: 1080, height: 1080, decodable: true },
  audioDecodable: [true],
  ...overrides,
});

/**
 * Facts for a decodable 10 s MP3.
 * @param {Partial<FileFacts>} [overrides]
 * @returns {FileFacts}
 */
const audio = (overrides) => ({ ...video({ video: null }), ...overrides });

describe('a video', () => {
  test('becomes a 640px video note by default, without a crop warning when square', () => {
    expect(planConversion(video())).toEqual({
      kind: 'videoNote',
      side: 640,
      videoBitrate: 650_000,
      audioBitrate: 48_000,
      cropWarning: false,
    });
  });

  test.each([
    [3840, 2160, 640],
    [2160, 3840, 640],
    [480, 360, 360],
    [361, 1000, 360],
  ])('%ix%i is center-cropped to a %ipx square, with a warning', (width, height, side) => {
    expect(planConversion(video({ video: { width, height, decodable: true } }))).toMatchObject({
      kind: 'videoNote',
      side,
      cropWarning: true,
    });
  });

  test('smaller than 640px and square keeps its size (rounded down to even)', () => {
    expect(
      planConversion(video({ video: { width: 301, height: 301, decodable: true } })),
    ).toMatchObject({ side: 300, cropWarning: false });
  });

  test('with «Только звук» becomes a mono 64k voice message, never with a crop warning', () => {
    const facts = video({
      requested: 'voice',
      video: { width: 1920, height: 1080, decodable: true },
    });
    expect(planConversion(facts)).toEqual({ kind: 'voice', audioBitrate: 64_000 });
  });
});

describe('refuses up front, rounding durations down to whole seconds,', () => {
  const NOTE_TOO_LONG = 'Кружок может быть не длиннее 15 секунд — выбери клип покороче';
  const VOICE_TOO_LONG = 'Голосовое может быть не длиннее 20 секунд — выбери клип покороче';

  test.each([
    ['a video note', video, 'videoNote', 15.9, 16, NOTE_TOO_LONG],
    ['a voice message', audio, 'voice', 20.9, 21, VOICE_TOO_LONG],
    ['«Только звук»', video, 'voice', 20.9, 21, VOICE_TOO_LONG],
  ])('%s over its limit', (_, facts, requested, longest, tooLong, refusal) => {
    const req = /** @type {import('../converter/plan.js').FileFacts['requested']} */ (requested);
    expect(planConversion(facts({ requested: req, duration: longest }))).not.toHaveProperty(
      'refusal',
    );
    expect(planConversion(facts({ requested: req, duration: tooLong }))).toEqual({ refusal });
  });

  test('a file over 100 MB, however short', () => {
    expect(planConversion(video({ size: 100_000_000 }))).not.toHaveProperty('refusal');
    expect(planConversion(video({ size: 100_000_001, duration: 1 }))).toEqual({
      refusal: 'Файл больше 100 МБ — выбери файл поменьше',
    });
  });

  test('a file over 100 MB before it is even read', () => {
    expect(sizeRefusal(100_000_000)).toBeNull();
    expect(sizeRefusal(120_000_000)).toEqual({
      refusal: 'Файл больше 100 МБ — выбери файл поменьше',
    });
  });

  test('no resolution limit: a 4K video is fine', () => {
    const facts = video({ video: { width: 3840, height: 2160, decodable: true } });
    expect(planConversion(facts)).not.toHaveProperty('refusal');
  });
});

describe('a file this device cannot decode', () => {
  const UNSUPPORTED = { refusal: 'Этот файл не поддерживается на этом устройстве' };
  const undecodableVideo = { width: 640, height: 640, decodable: false };

  test.each([
    ['a video note whose video track is undecodable', video({ video: undecodableVideo })],
    ['a video note whose only audio track is undecodable', video({ audioDecodable: [false] })],
    ['an audio file whose audio is undecodable', audio({ audioDecodable: [false] })],
    ['an audio file with no audio track', audio({ audioDecodable: [] })],
    ['«Только звук» on a silent video', video({ requested: 'voice', audioDecodable: [] })],
  ])('is refused: %s', (_, facts) => {
    expect(planConversion(facts)).toEqual(UNSUPPORTED);
  });

  test('«Только звук» ignores an undecodable video track', () => {
    const facts = video({ requested: 'voice', video: undecodableVideo });
    expect(planConversion(facts)).toEqual({ kind: 'voice', audioBitrate: 64_000 });
  });

  test('a silent video still becomes a video note', () => {
    expect(planConversion(video({ audioDecodable: [] }))).toMatchObject({ kind: 'videoNote' });
  });

  test.each([[[true, false]], [[false, true]]])(
    'an extra undecodable audio track (iPhone spatial audio) is ignored: %j',
    (tracks) => {
      expect(planConversion(video({ audioDecodable: tracks }))).toMatchObject({
        kind: 'videoNote',
      });
      expect(planConversion(audio({ audioDecodable: tracks }))).toMatchObject({ kind: 'voice' });
    },
  );
});

describe('an audio file', () => {
  test.each(['voice', 'videoNote'])('becomes a voice message (requested %s)', (requested) => {
    expect(planConversion(audio({ requested: /** @type {any} */ (requested) }))).toEqual({
      kind: 'voice',
      audioBitrate: 64_000,
    });
  });
});

describe('a conversion over 1.5 MB', () => {
  /** @type {import('../converter/plan.js').VideoNotePlan} */
  const notePlan = {
    kind: 'videoNote',
    side: 640,
    videoBitrate: 650_000,
    audioBitrate: 48_000,
    cropWarning: false,
  };

  /**
   * A fake encoder returning outputs of the given sizes in turn; records each plan.
   * @param {number[]} sizes
   */
  function encoder(sizes) {
    /** @type {import('../converter/plan.js').Plan[]} */
    const plans = [];
    /** @param {import('../converter/plan.js').Plan} plan */
    const encode = async (plan) => {
      plans.push(plan);
      return new Uint8Array(sizes[plans.length - 1]);
    };
    return { encode, plans };
  }

  test('is not retried when the first output fits, even at exactly 1.5 MB', async () => {
    const { encode, plans } = encoder([1_500_000]);

    const result = await convertWithinBudget(notePlan, encode);

    expect(result).toEqual({ bytes: new Uint8Array(1_500_000) });
    expect(plans).toEqual([notePlan]);
  });

  test('is retried once at 500k video', async () => {
    const { encode, plans } = encoder([1_500_001, 1_200_000]);

    const result = await convertWithinBudget(notePlan, encode);

    expect(result).toEqual({ bytes: new Uint8Array(1_200_000) });
    expect(plans.map((p) => p.kind === 'videoNote' && p.videoBitrate)).toEqual([650_000, 500_000]);
  });

  test('is refused when the retry is still too large', async () => {
    const { encode, plans } = encoder([2_000_000, 1_600_000]);

    expect(await convertWithinBudget(notePlan, encode)).toEqual({
      refusal: 'Видео слишком «тяжёлое», попробуй короче',
    });
    expect(plans).toHaveLength(2);
  });
});

describe('a failed hand-back tells the admin', () => {
  /** @param {string} code */
  const refused = (code) => ({ message: 'x', type: 'ENDPOINT_ERROR', parameters: { code } });
  const RETRY = { text: 'Не удалось отправить, попробуй ещё раз', retry: true };

  test.each([
    [
      'how to allow voice messages from the bot',
      refused('VOICE_FORBIDDEN'),
      {
        text: 'Разреши боту голосовые сообщения: Настройки → Конфиденциальность → Голосовые сообщения, и попробуй ещё раз',
        retry: true,
      },
    ],
    [
      'that an old button needs a fresh /add',
      refused('NO_PENDING_ADD'),
      { text: 'Эта кнопка устарела — начни /add заново', retry: false },
    ],
    [
      'that only the admin adds memes',
      refused('NOT_ADMIN'),
      { text: 'Добавлять мемы может только администратор', retry: false },
    ],
    [
      'that the video is too heavy',
      refused('TOO_LARGE'),
      { text: 'Видео слишком «тяжёлое», попробуй короче', retry: false },
    ],
    ['to retry after a send failure', refused('SEND_FAILED'), RETRY],
    ['to retry after a server error', { message: 'Internal', type: 'SERVER_ERROR' }, RETRY],
    ['to retry after a network error', new TypeError('Failed to fetch'), RETRY],
  ])('%s', (_, error, expected) => {
    expect(sendFailure(error)).toEqual(expected);
  });
});
