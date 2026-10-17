# Convert arbitrary audio and video files in the admin's browser

`/add` can again take an arbitrary audio or video file, through the Converter: a Mini
App that transcodes it on the admin's device with WebCodecs (via the mediabunny
library) and hands the result to an endpoint. The endpoint sends it as a voice message
or video note and continues the chat conversation at the name step. The runtime can't
do the conversion itself. Probing it (issue #25) showed:
- each call gets about 3 s of CPU;
- async `WebAssembly.compile`/`instantiate` crash the call;
- a `fetch` response is capped at about 16 MiB, so the 32 MB ffmpeg core takes several
  ranged requests on every call.

## Considered Options

- **ffmpeg.wasm inside a handler**: technically runs with synchronous wasm, but
  compiling the core plus an encode won't fit in 3 s of CPU.
- **An external transcoding service via `fetch`** (ADR-0002's planned follow-up): a
  third party to run, pay for and trust with the library's media, for one admin's
  occasional uploads.
- **ffmpeg.wasm in the Converter**: works everywhere wasm runs, but on an iPhone (iOS 18,
  Telegram 9.6) a 20 s 4K clip took 54 s to become a video note, against 22 s with
  WebCodecs. Voice took 0.2 s with WebCodecs. It would also make the admin download a
  32 MB core. WebCodecs could encode H.264, HEVC, Opus and AAC in that client. A file
  the device can't decode is refused rather than falling back to wasm.
