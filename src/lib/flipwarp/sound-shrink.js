// Making a sound smaller, on purpose and with the result audible first.
//
// Three things are going on here, and only one of them is new.
//
// Scratch already mixes your sound to mono the moment you touch any effect —
// but it does it by throwing the right channel away rather than mixing the two
// together. Anything that was panned right gets quieter or vanishes. That has
// been a known bug since 2019 and is fixed here by doing what mixing to mono
// means: adding the channels and halving.
//
// Scratch also turns whatever you imported into uncompressed audio the moment
// you edit it. An MP3 becomes a WAV about five times its size, from pressing
// one button, with nothing said about it. That is a bigger cost than mono and
// sample rate put together.
//
// And ADPCM is the way out of it. It is a compressed form Scratch has read
// since its earliest days — 161 of the sounds in Scratch's own library are
// stored this way — so a sound saved in it plays in Scratch, in TurboWarp, and
// here, while taking about a quarter of the room. Nothing offers it as a
// choice, which is the gap this fills.

import WavEncoder from 'wav-encoder';

// ------------------------------------------------------------ measuring

/**
 * Every channel of an audio buffer, as plain arrays.
 * @param {AudioBuffer} buffer the sound
 * @returns {Array<Float32Array>} one array per channel
 */
export const channelsOf = buffer => {
    const out = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) out.push(buffer.getChannelData(i));
    return out;
};

/**
 * Mix every channel down to one, by averaging them.
 *
 * This is the part Scratch gets wrong. Taking the left channel and calling it
 * mono loses whatever was only on the right — a sound panned hard right can
 * come back silent.
 *
 * @param {Array<Float32Array>} channels the channels to mix
 * @returns {Float32Array} one channel
 */
export const mixToMono = channels => {
    if (channels.length === 1) return channels[0];
    const length = channels[0].length;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
        let total = 0;
        for (const channel of channels) total += channel[i];
        out[i] = total / channels.length;
    }
    return out;
};

/**
 * Change the sample rate, using the browser's own resampler.
 *
 * Doing it by hand — dropping every other sample, which is what Scratch falls
 * back to — folds high notes back down as a whine that was never in the
 * recording. The browser filters first, so it does not.
 *
 * @param {Array<Float32Array>} channels the channels
 * @param {number} from the rate they are at
 * @param {number} to the rate wanted
 * @returns {Promise<Array<Float32Array>>} the resampled channels
 */
export const resample = async (channels, from, to) => {
    if (from === to) return channels;
    const length = Math.max(1, Math.round((channels[0].length * to) / from));
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offline = new OfflineCtx(channels.length, length, to);

    const source = offline.createBufferSource();
    const input = offline.createBuffer(channels.length, channels[0].length, from);
    channels.forEach((channel, i) => input.getChannelData(i).set(channel));
    source.buffer = input;
    source.connect(offline.destination);
    source.start();

    const rendered = await offline.startRendering();
    return channelsOf(rendered);
};

// -------------------------------------------------------------- ADPCM

const STEP_TABLE = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
    50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
    253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963,
    1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327,
    3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
    12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
];

const INDEX_TABLE = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

// How many bytes one block of compressed audio takes. The reader works out
// how many samples that is as (size - 4) * 2 + 1, so this decides the ratio:
// 505 samples in 256 bytes, against 1010 bytes uncompressed.
const BLOCK_BYTES = 256;
const SAMPLES_PER_BLOCK = ((BLOCK_BYTES - 4) * 2) + 1;

const clampSample = value => Math.max(-32768, Math.min(32767, value));

/**
 * One block of IMA ADPCM: a header saying where the sound was, then every
 * following sample as four bits saying how far it moved.
 *
 * @param {Int16Array} samples the samples for this block
 * @param {object} state carried between blocks so they join up
 * @returns {Uint8Array} the block
 */
const encodeBlock = (samples, state) => {
    const out = new Uint8Array(BLOCK_BYTES);
    let predictor = clampSample(samples[0]);
    let index = state.index;

    out[0] = predictor & 0xff;
    out[1] = (predictor >> 8) & 0xff;
    out[2] = index;
    out[3] = 0;

    let at = 4;
    let low = true;
    for (let i = 1; i < samples.length; i++) {
        const step = STEP_TABLE[index];
        let diff = samples[i] - predictor;
        let code = 0;
        if (diff < 0) {
            code = 8;
            diff = -diff;
        }
        // The four bits are a fraction of the current step: 4/4, 2/4, 1/4.
        let delta = step >> 3;
        if (diff >= step) {
            code |= 4;
            diff -= step;
            delta += step;
        }
        if (diff >= (step >> 1)) {
            code |= 2;
            diff -= step >> 1;
            delta += step >> 1;
        }
        if (diff >= (step >> 2)) {
            code |= 1;
            delta += step >> 2;
        }

        predictor = clampSample(predictor + ((code & 8) ? -delta : delta));
        index = Math.max(0, Math.min(STEP_TABLE.length - 1, index + INDEX_TABLE[code]));

        if (low) {
            out[at] = code & 0x0f;
            low = false;
        } else {
            out[at] |= (code & 0x0f) << 4;
            at++;
            low = true;
        }
    }

    state.index = index;
    return out;
};

const writeString = (view, at, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
};

/**
 * A sound as an ADPCM wav file, shaped exactly the way Scratch's own reader
 * expects it — one channel, four bits a sample, blocks of a fixed size.
 *
 * @param {Float32Array} samples one channel of audio
 * @param {number} sampleRate its rate
 * @returns {ArrayBuffer} the file
 */
export const encodeAdpcm = (samples, sampleRate) => {
    // Scratch's reader works out how long a sound is with a sum that counts
    // one sample fewer per block than a block actually holds, after the first.
    // Nothing can be written that makes that sum come out right, so the
    // shortfall is made up in silence instead — otherwise the last few
    // thousandths of a second are cut off.
    const blockCount = Math.max(1, Math.ceil(samples.length / SAMPLES_PER_BLOCK));
    const shortfall = blockCount - 1;

    const asInt = new Int16Array(samples.length + shortfall);
    for (let i = 0; i < samples.length; i++) {
        asInt[i] = clampSample(Math.round(samples[i] * 32767));
    }

    const blocks = [];
    const state = {index: 0};
    for (let at = 0; at < asInt.length; at += SAMPLES_PER_BLOCK) {
        const slice = asInt.subarray(at, at + SAMPLES_PER_BLOCK);
        const block = encodeBlock(slice, state);
        // The last block is written only as long as it needs to be. Padding it
        // out to a full one would leave the reader counting the padding as
        // audio, and the sound would come back a fraction of a second longer
        // than it went in.
        const used = slice.length === SAMPLES_PER_BLOCK ?
            BLOCK_BYTES :
            4 + Math.ceil((slice.length - 1) / 2);
        blocks.push(block.subarray(0, used));
    }

    const dataBytes = blocks.reduce((total, block) => total + block.length, 0);
    // 12 for the RIFF header, 28 for a fmt chunk carrying the two extra
    // fields ADPCM needs, 12 for the fact chunk, 8 for the data chunk's own
    // header. The reader trusts these sizes to find its way about, so they
    // have to be right to the byte.
    const size = 12 + 28 + 12 + 8 + dataBytes;
    const file = new ArrayBuffer(size);
    const view = new DataView(file);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, size - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt: IMA ADPCM (17), one channel, four bits a sample, and how many
    // samples each block holds — which is how the reader knows the size.
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 20, true);
    view.setUint16(20, 17, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, Math.round((sampleRate * BLOCK_BYTES) / SAMPLES_PER_BLOCK), true);
    view.setUint16(32, BLOCK_BYTES, true);
    view.setUint16(34, 4, true);
    view.setUint16(36, 2, true);
    view.setUint16(38, SAMPLES_PER_BLOCK, true);

    writeString(view, 40, 'fact');
    view.setUint32(44, 4, true);
    view.setUint32(48, asInt.length, true);

    writeString(view, 52, 'data');
    view.setUint32(56, dataBytes, true);
    let at = 60;
    for (const block of blocks) {
        new Uint8Array(file, at, block.length).set(block);
        at += block.length;
    }
    return file;
};

// ------------------------------------------------------------- the job

/**
 * How big a sound would be, without doing the work of making it.
 *
 * @param {object} options what would be done
 * @param {number} options.sampleCount how many samples the sound has now
 * @param {number} options.sampleRate the rate it is at now
 * @param {number} options.channels how many channels it has now
 * @param {object} options.plan the choices: rate, mono, format
 * @returns {number} bytes
 */
export const estimateSize = ({sampleCount, sampleRate, channels, plan}) => {
    const rate = plan.sampleRate || sampleRate;
    const samples = Math.round((sampleCount * rate) / sampleRate);
    const lanes = plan.mono ? 1 : channels;
    if (plan.format === 'adpcm') {
        return 60 + (Math.ceil(samples / SAMPLES_PER_BLOCK) * BLOCK_BYTES);
    }
    return 44 + (samples * lanes * 2);
};

/**
 * Carry out a plan and hand back both the sound and the file.
 *
 * @param {AudioBuffer} buffer the sound as it is
 * @param {object} plan sampleRate, mono, format
 * @returns {Promise<{channels: Array, sampleRate: number, data: ArrayBuffer}>} the result
 */
export const shrink = async (buffer, plan) => {
    const rate = plan.sampleRate || buffer.sampleRate;
    let channels = channelsOf(buffer);

    // Mixed down before resampling: half the work, and the same answer.
    if (plan.mono || plan.format === 'adpcm') channels = [mixToMono(channels)];
    channels = await resample(channels, buffer.sampleRate, rate);

    if (plan.format === 'adpcm') {
        return {channels, sampleRate: rate, data: encodeAdpcm(channels[0], rate)};
    }
    const wav = await WavEncoder.encode({
        sampleRate: rate,
        channelData: channels.map(c => Float32Array.from(c))
    });
    return {channels, sampleRate: rate, data: wav};
};

export const ADPCM_ONLY_MONO = true;
export const SAMPLES_IN_A_BLOCK = SAMPLES_PER_BLOCK;
