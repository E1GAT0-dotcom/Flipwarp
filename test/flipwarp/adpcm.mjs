// Encode with ours, decode with Scratch's own decoder, and compare. If these
// two disagree the sound is silently ruined, so this is checked before
// anything is built on top of it.
import {encodeAdpcm, mixToMono} from '../../src/lib/flipwarp/sound-shrink.js';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const ADPCMSoundDecoder = require('scratch-audio/src/ADPCMSoundDecoder');

// A stand-in for the browser's audio context: the decoder only ever asks it
// for a buffer to write into.
const fakeContext = {
    createBuffer: (channels, length) => {
        const data = new Float32Array(length);
        return {numberOfChannels: channels, length, getChannelData: () => data};
    }
};

const RATE = 22050;
const SECONDS = 2;
const n = RATE * SECONDS;

// Something with quiet parts, loud parts and a sweep, so a wrong step size
// shows up rather than hiding in a steady tone.
const original = new Float32Array(n);
for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = 110 + (t * 400);
    const envelope = 0.15 + (0.85 * Math.abs(Math.sin(t * 1.7)));
    original[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.8;
}

const file = encodeAdpcm(original, RATE);
const decoded = await new ADPCMSoundDecoder(fakeContext).decode(file);
const out = decoded.getChannelData(0);

// How far off each sample is, as a fraction of full scale.
let worst = 0;
let total = 0;
const compared = Math.min(original.length, out.length);
for (let i = 0; i < compared; i++) {
    const off = Math.abs(original[i] - out[i]);
    if (off > worst) worst = off;
    total += off * off;
}
const rms = Math.sqrt(total / compared);
// Signal-to-noise: how much louder the sound is than the error it introduced.
const signal = Math.sqrt(original.reduce((s, v) => s + (v * v), 0) / original.length);
const snr = 20 * Math.log10(signal / rms);

const uncompressed = 44 + (n * 2);
const ratio = uncompressed / file.byteLength;

// A pure silence and a full-scale square, as the two extremes.
const silence = new Float32Array(1000);
const silenceOut = (await new ADPCMSoundDecoder(fakeContext)
    .decode(encodeAdpcm(silence, RATE))).getChannelData(0);
// A hard square is the worst case this format has: it cannot jump the whole
// way in one sample by design, it has to climb. So what is measured is that
// it catches up quickly and tracks the flat parts, not that it turns on a
// sixpence — expecting that would be expecting the wrong thing.
const loud = new Float32Array(1000).fill(0).map((_, i) => (i % 40 < 20 ? 0.99 : -0.99));
const loudOut = (await new ADPCMSoundDecoder(fakeContext)
    .decode(encodeAdpcm(loud, RATE))).getChannelData(0);
// What matters is that it is never the wrong sound — never inverted, never
// clipped into noise. Slew is inherent to four bits a sample.
let agreed = 0;
for (let i = 0; i < 1000; i++) {
    if (Math.sign(loudOut[i]) === Math.sign(loud[i]) || Math.abs(loudOut[i]) < 0.2) agreed++;
}
const loudWorst = 1 - (agreed / 1000);

// And that mixing to mono averages rather than dropping a channel.
const left = Float32Array.from([1, 0, 0.5, -1]);
const right = Float32Array.from([0, 1, -0.5, -1]);
const mono = mixToMono([left, right]);

const checks = [
    ['it decodes at all', out.length > 0, out.length],
    ['the length comes back right', Math.abs(out.length - n) <= 2, `expected ${n}, got ${out.length}`],
    ['it sounds like the original', snr > 20, `${snr.toFixed(1)} dB signal to noise`],
    ['no sample is wildly wrong', worst < 0.25, worst.toFixed(4)],
    ['silence stays silent', silenceOut.every(v => Math.abs(v) < 0.02), 'ok'],
    ['a loud square keeps its shape', loudWorst < 0.2,
        `${(loudWorst * 100).toFixed(1)}% of samples on the wrong side of zero`],
    ['it is about four times smaller', ratio > 3.5 && ratio < 4.2, `${ratio.toFixed(2)}x`],
    ['mono averages both channels rather than dropping one',
        mono[0] === 0.5 && mono[1] === 0.5 && mono[3] === -1, Array.from(mono)]
];

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra !== undefined ? `  (${extra})` : ''}`);
    if (!ok) failed++;
}
console.log(`\n${(uncompressed / 1024).toFixed(0)} KB uncompressed -> ${(file.byteLength / 1024).toFixed(0)} KB`);
console.log(failed === 0 ? 'adpcm working' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
