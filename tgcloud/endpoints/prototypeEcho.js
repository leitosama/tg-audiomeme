// @ts-nocheck
// PROTOTYPE, wipe me: throwaway endpoint for the Converter measurements (branch
// prototype/converter). Never merge. See ~/.claude/plans/mini-app-convert-media.md.
import { api, InputFile } from 'sdk';

export default async function (input, ctx) {
  const r = {
    user: ctx?.initData?.user?.id ?? null,
    b64len: input.data ? input.data.length : 0,
    fromBase64: typeof Uint8Array.fromBase64,
    atob: typeof atob,
  };
  let bytes = null;
  if (input.data) {
    if (typeof Uint8Array.fromBase64 === 'function') {
      bytes = Uint8Array.fromBase64(input.data);
    } else if (typeof atob === 'function') {
      const s = atob(input.data);
      bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    }
    r.decoded = bytes ? bytes.length : 'no decoder';
  }
  if (input.send && bytes && r.user) {
    // Report Bot API failures instead of letting them become an opaque 500.
    r.head = Array.from(bytes.subarray(0, 64), (b) => b.toString(16).padStart(2, '0')).join('');
    try {
      const msg =
        input.send === 'voice'
          ? await api.sendVoice({
              chat_id: r.user,
              voice: new InputFile(bytes, 'meme.ogg', { type: 'audio/ogg' }),
            })
          : await api.sendVideoNote({
              chat_id: r.user,
              video_note: new InputFile(bytes, 'meme.mp4', { type: 'video/mp4' }),
            });
      r.sent = msg.voice ?? msg.video_note ?? null;
    } catch (e) {
      r.sendError = `${e?.code ?? ''} ${e?.description ?? e?.message ?? e}`;
    }
  }
  if (input.text && r.user) {
    await api.sendMessage({ chat_id: r.user, text: String(input.text).slice(0, 4000) });
    r.texted = true;
  }
  if (input.menu) {
    await api.setChatMenuButton({
      menu_button:
        input.menu === 'reset'
          ? { type: 'default' }
          : { type: 'web_app', text: '🧪 Prototype', web_app: { url: input.menu } },
    });
    r.menu = input.menu;
  }
  return r;
}
