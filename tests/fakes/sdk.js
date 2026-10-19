// Stands in for the platform's `sdk` module in tests (wired in vitest.config.js).
// `api` records every Bot API call; tests assert on `apiCalls`.

/** @typedef {{ method: string, params: Record<string, any> }} ApiCall */

/** Every Bot API call made since the last reset, in order. @type {ApiCall[]} */
export const apiCalls = [];

/** Canned results by method name; a method without one resolves to `true`. @type {Record<string, unknown>} */
const results = {};

/**
 * Makes `method` resolve to `result` (or reject, if it's an Error) until the next reset.
 * A function `result` is called with each call's params and gives that call's result.
 * @param {string} method
 * @param {unknown} result
 */
export function stubApi(method, result) {
  results[method] = result;
}

export function resetApi() {
  apiCalls.length = 0;
  for (const key of Object.keys(results)) delete results[key];
}

/**
 * The calls made to one method, as their params.
 * @param {string} method
 */
export function callsTo(method) {
  return apiCalls.filter((c) => c.method === method).map((c) => c.params);
}

export class BotApiError extends Error {
  /**
   * @param {string} method
   * @param {number} code
   * @param {string} description
   */
  constructor(method, code, description) {
    super(`${method}: ${description}`);
    this.method = method;
    this.code = code;
    this.description = description;
  }
}

export class EndpointError extends Error {
  /**
   * @param {string} description
   * @param {Record<string, unknown>} [parameters]
   */
  constructor(description, parameters) {
    super(description);
    this.parameters = parameters;
  }
}

export class InputFile {
  /**
   * @param {Uint8Array | ArrayBuffer} bytes
   * @param {string} filename
   * @param {{ type?: string }} [options]
   */
  constructor(bytes, filename, options = {}) {
    this.bytes = bytes;
    this.filename = filename;
    this.type = options.type;
  }
}

export const api = new Proxy(
  {},
  {
    /** @param {object} _ @param {string | symbol} method */
    get(_, method) {
      if (typeof method !== 'string' || method === 'then') return undefined;
      /** @param {Record<string, any>} [params] */
      return async (params = {}) => {
        apiCalls.push({ method, params });
        const stub = results[method] ?? true;
        const result = typeof stub === 'function' ? stub(params) : stub;
        if (result instanceof Error) throw result;
        return result;
      };
    },
  },
);

const unavailable = () => {
  throw new Error('Tests must not reach the platform: use the store fake / stub fetch');
};
export const db = new Proxy({}, { get: unavailable });
export const fetch = unavailable;
