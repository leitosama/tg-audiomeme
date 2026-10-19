// How a meme is labelled in the bot's messages, buttons and inline results.

/** @typedef {import('./store.js').Meme} Meme */

/** The media icon: 🎵 for a voice meme, 🎬 for a video note. @param {Meme['mediaType']} mediaType */
export const iconOf = (mediaType) => (mediaType === 'audio' ? '🎵' : '🎬');

/** The meme name, after the emoji if it has one. @param {Pick<Meme, 'name' | 'emoji'>} meme */
export const titleOf = (meme) => (meme.emoji ? `${meme.emoji} ${meme.name}` : meme.name);

/** Icon and title, as the library lists a meme. @param {Pick<Meme, 'name' | 'emoji' | 'mediaType'>} meme */
export const labelOf = (meme) => `${iconOf(meme.mediaType)} ${titleOf(meme)}`;
