// Globals the tgcloud runtime has beyond the `es2023` lib tsconfig.json targets.

interface Uint8ArrayConstructor {
  /** Decodes base64 (the runtime has no `atob`); throws a SyntaxError on invalid input. */
  fromBase64(
    string: string,
    options?: { alphabet?: 'base64' | 'base64url'; lastChunkHandling?: string },
  ): Uint8Array;
}
