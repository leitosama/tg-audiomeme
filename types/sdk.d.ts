// Type declarations for the tgcloud runtime SDK, which exists only on the platform
// (see docs/tgcloud-sdk.md). Loose where the platform's API is dynamic; the Bot API
// is typed from @grammyjs/types so calls are checked against real method params.

declare module 'sdk' {
  import type { ApiMethods } from '@grammyjs/types';

  export class InputFile {
    constructor(bytes: Uint8Array | ArrayBuffer, filename: string, options?: { type?: string });
  }

  type Methods = ApiMethods<InputFile>;

  /** The Bot API with the `{ ok, result }` envelope unwrapped; failures throw `BotApiError`. */
  export const api: {
    [M in keyof Methods]: (
      ...args: Parameters<Methods[M]>
    ) => Promise<Awaited<ReturnType<Methods[M]>>>;
  };

  export class BotApiError extends Error {
    code: number;
    description: string;
    method: string;
    parameters?: { retry_after?: number; migrate_to_chat_id?: number };
  }

  export class EndpointError extends Error {
    constructor(description: string, parameters?: Record<string, unknown>);
  }

  export const db: import('sdk/db').Db;
  export const fetch: (url: string, init?: Record<string, unknown>) => Promise<unknown>;
}

declare module 'sdk/db' {
  /** A chainable column or table builder; the DSL is too dynamic to type precisely. */
  // biome-ignore lint/suspicious/noExplicitAny: dynamic platform DSL
  type Builder = any;

  export type Db = Builder;
  export const table: (
    name: string,
    columns: Record<string, Builder>,
    extras?: (t: Record<string, Builder>) => Record<string, Builder>,
  ) => Builder;
  export const integer: (name?: string, opts?: { mode?: string }) => Builder;
  export const text: (name?: string, opts?: { mode?: string }) => Builder;
  export const boolean: (name?: string) => Builder;
  export const json: (name?: string) => Builder;
  export const index: (name: string) => Builder;
  export const check: (name: string, expr: Builder) => Builder;
  export const sql: ((strings: TemplateStringsArray, ...values: unknown[]) => Builder) & {
    raw: (s: string) => Builder;
  };
  export const eq: (a: Builder, b: unknown) => Builder;
  export const gt: (a: Builder, b: unknown) => Builder;
  export const and: (...conds: Builder[]) => Builder;
  export const desc: (col: Builder) => Builder;
  export const asc: (col: Builder) => Builder;
  const db: Db;
  export default db;
}
