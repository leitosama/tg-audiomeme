# Accept only voice messages and video notes as memes

The platform's runtime cannot run ffmpeg, so `/add` no longer converts uploaded audio
or video files; it accepts voice messages and video notes only and asks the admin to
re-send anything else in one of those forms. An external transcoding service called
via `fetch` is the intended later step to bring back conversion of arbitrary files.

Amended by ADR-0004: arbitrary files are accepted again through the Converter, which
converts them in the admin's browser; the chat path still takes only voice messages and
video notes.
