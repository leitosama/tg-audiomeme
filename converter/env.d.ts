// The parts of telegram-web-app.js (loaded by index.html) the Converter uses, and
// browser APIs newer than TypeScript's DOM lib.

interface TelegramWebApp {
  initDataUnsafe: { user?: { id: number } };
  ready(): void;
  expand(): void;
  close(): void;
  Serverless: {
    /** Calls `tgcloud/endpoints/<name>.js` with the Mini App's init data. */
    call(
      name: string,
      input: Record<string, unknown>,
      callback: (
        error: { message: string; type: string; parameters?: Record<string, unknown> } | null,
        result: unknown,
      ) => void,
    ): void;
  };
}

interface Window {
  Telegram?: { WebApp: TelegramWebApp };
}

interface Uint8Array {
  /** Safari 18.2+, Chrome 140+; main.js falls back to `btoa`. */
  toBase64?(): string;
}
