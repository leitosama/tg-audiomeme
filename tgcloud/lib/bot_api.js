// Bot API failures (a blocked bot, an expired query, a deleted chat) are logged, never
// thrown out of a handler: one failed call mustn't fail the update (spec story 41).
// Every handler's default export is wrapped once, here; other errors still propagate.

import { BotApiError } from 'sdk';

/**
 * Whether the error is Telegram refusing an edit that changes nothing, as a double tap
 * re-rendering the same view gets. Nothing is lost; callers treat it as success.
 * @param {unknown} error
 */
export const isNotModified = (error) =>
  error instanceof BotApiError && /message is not modified/i.test(error.description);

/**
 * Wraps a handler so a Bot API failure is logged (with the update's sender) and ends
 * the update quietly.
 * @template {{ from?: { id: number } }} P
 * @template {unknown[]} R
 * @param {string} name the handler module, for the log line
 * @param {(payload: P, ...rest: R) => Promise<void>} handler
 * @returns {(payload: P, ...rest: R) => Promise<void>}
 */
export function loggingBotApiFailures(name, handler) {
  return async (payload, ...rest) => {
    try {
      await handler(payload, ...rest);
    } catch (error) {
      if (!(error instanceof BotApiError)) throw error;
      console.error(
        `${name}: Bot API call failed on an update from user ${payload.from?.id}`,
        error,
      );
    }
  };
}
