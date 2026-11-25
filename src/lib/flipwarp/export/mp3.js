// Sounds as MP3s, for Code.org Game Lab, which plays only MP3 files.
//
// The VM has already decoded every sound (Scratch's compressed WAVs too), so
// each is encoded from that: no second decoder needed. The encoder is lamejs
// (LGPL-3.0), its ready-built browser file loaded as text and run once, which
// keeps it clear of the bundler.

import lameSource from '!raw-loader!lamejs/lame.min.js';

let lame = null;
const encoderLibrary = () => {
    if (!lame) {
        // eslint-disable-next-line no-new-func
        lame = new Function(`${lameSource}\nreturn lamejs;`)();
    }
    return lame;
};

// The sample rates MP3 knows.
const RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

const toInt16 = samples => {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
};

/**
 * Encode a decoded sound as an MP3.
 * @param {AudioBuffer} buffer the sound, decoded
 * @returns {Uint8Array} the MP3 file
 */
export const encodeMp3 = buffer => {
    const rate = buffer.sampleRate;
    if (!RATES.includes(rate)) throw new Error(`MP3 cannot hold a sound at ${rate} samples a second.`);
    const channels = Math.min(2, buffer.numberOfChannels);
    const left = toInt16(buffer.getChannelData(0));
    const right = channels > 1 ? toInt16(buffer.getChannelData(1)) : null;
    const encoder = new (encoderLibrary().Mp3Encoder)(channels, rate, 128);
    const parts = [];
    const block = 1152;
    for (let i = 0; i < left.length; i += block) {
        const l = left.subarray(i, i + block);
        const chunk = right ? encoder.encodeBuffer(l, right.subarray(i, i + block)) : encoder.encodeBuffer(l);
        if (chunk.length) parts.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length));
    }
    const end = encoder.flush();
    if (end.length) parts.push(new Uint8Array(end.buffer, end.byteOffset, end.length));
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
};
