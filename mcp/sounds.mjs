// Game sound effects, made from nothing: the jumps, coins, lasers and
// explosions every game needs, as WAV files Scratch can load.
//
// A sound is a recipe (a "voice"): a wave shape, a pitch that can slide, an
// envelope that shapes the volume, and optionally a run of notes. The presets
// are recipes for the usual effects; `variation` nudges a preset at random
// (the same number always gives the same sound), and `pitch`, `length` and
// `volume` adjust any of them. A recipe can also be given whole (`custom`).
//
// In the spirit of sfxr, smaller: what matters here is that a game gets a
// recognisable sound for each thing that happens, made in a moment.

export const RATE = 22050;

// --- recipes ----------------------------------------------------------------

// Every field a recipe can have, with what it means. Shown to Claude as the
// shape of `custom`.
export const VOICE_FIELDS = {
    wave: 'square | saw | triangle | sine | noise',
    freq: 'starting pitch in Hz (noise: how fast it changes, so higher is hissier)',
    slide: 'pitch change in octaves per second (+ rises, - falls)',
    slideAccel: 'change in slide per second',
    duty: 'square only: 0.05 thin and buzzy to 0.5 hollow',
    dutySweep: 'change in duty per second',
    vibratoDepth: 'wobble in semitones',
    vibratoSpeed: 'wobbles per second',
    notes: 'a tune instead of one pitch: [[Hz, seconds], ...] played in turn',
    jumpAt: 'seconds in when the pitch jumps once (arpeggio)',
    jumpBy: 'what the pitch is multiplied by at jumpAt (1.5 a fifth up, 2 an octave)',
    attack: 'seconds to fade in',
    sustain: 'seconds held at full volume',
    decay: 'seconds to fade out',
    punch: '0 to 1: extra loudness at the start of the sustain',
    lowpass: 'Hz above which sound is softened (0 for none)',
    highpass: 'Hz below which sound is cut (0 for none)',
    detune: 'cents: a second voice this far off the first, for a thicker, chorused sound (0 for none)',
    echo: 'seconds between echoes (0 for none)',
    echoMix: '0 to 0.8: how loud each echo is against the one before',
    crush: '0 to 1: fewer loudness steps, from clean to crunchy and lo-fi',
    volume: '0 to 1'
};

const BASE = {
    wave: 'square', freq: 440, slide: 0, slideAccel: 0, duty: 0.5, dutySweep: 0,
    vibratoDepth: 0, vibratoSpeed: 0, notes: null, jumpAt: 0, jumpBy: 1,
    attack: 0, sustain: 0.05, decay: 0.15, punch: 0, lowpass: 0, highpass: 0,
    detune: 0, echo: 0, echoMix: 0.35, crush: 0, volume: 0.5
};

// A game's sound style: one for the whole game, so its sounds belong
// together and sound unlike other games'. Each changes a preset's voice.
const tonal = v => v.wave !== 'noise';
const notesBy = (v, k) => {
    if (v.notes) v.notes = v.notes.map(([f, d]) => [f * k, d]);
};
export const STYLES = {
    chiptune: {about: 'bright 8-bit console beeps', apply: v => {
        if (tonal(v)) {
            v.wave = 'square';
            v.duty = v.duty > 0.3 ? 0.5 : 0.125;
        }
        v.lowpass = 0;
        v.crush = 0.35;
    }},
    soft: {about: 'gentle and round, for calm or cute games', apply: v => {
        if (tonal(v)) v.wave = v.freq > 600 ? 'sine' : 'triangle';
        v.lowpass = v.lowpass ? Math.min(v.lowpass, 2200) : 2200;
        v.attack = Math.max(v.attack, 0.008);
        v.decay *= 1.4;
        v.punch *= 0.3;
    }},
    arcade: {about: 'buzzy, punchy coin-op sounds', apply: v => {
        if (tonal(v)) v.wave = 'saw';
        v.punch = Math.min(1, v.punch + 0.3);
        v.highpass = Math.max(v.highpass, 150);
        v.slide *= 1.3;
    }},
    space: {about: 'wide sci-fi synth with echoes', apply: v => {
        if (tonal(v)) {
            v.wave = 'saw';
            v.detune = 14;
            v.vibratoDepth = v.vibratoDepth || 0.3;
            v.vibratoSpeed = v.vibratoSpeed || 5;
        }
        v.lowpass = v.lowpass ? Math.min(v.lowpass, 3500) : 3500;
        v.echo = 0.11;
        v.echoMix = 0.4;
    }},
    cartoon: {about: 'bouncy, slidey and silly', apply: v => {
        if (tonal(v)) v.wave = 'triangle';
        v.slide = v.slide ? v.slide * 1.8 : 1.2;
        v.vibratoDepth = Math.max(v.vibratoDepth, 0.8);
        v.vibratoSpeed = v.vibratoSpeed || 9;
        v.decay *= 1.2;
    }},
    toy: {about: 'small, high, music-box plinks', apply: v => {
        if (tonal(v)) v.wave = 'sine';
        v.freq *= 1.6;
        notesBy(v, 2);
        v.sustain *= 0.6;
        v.decay *= 1.5;
        v.echo = 0.07;
        v.echoMix = 0.25;
    }},
    heavy: {about: 'low, thick and loud, for action and monsters', apply: v => {
        v.freq *= 0.6;
        notesBy(v, 0.5);
        if (tonal(v)) {
            v.wave = 'saw';
            v.detune = 22;
        }
        v.lowpass = v.lowpass ? Math.min(v.lowpass, 1800) : 1800;
        v.punch = Math.min(1, v.punch + 0.4);
        v.decay *= 1.4;
    }},
    lofi: {about: 'crunchy, muffled and old', apply: v => {
        v.crush = 0.75;
        v.lowpass = v.lowpass ? Math.min(v.lowpass, 2600) : 2600;
        v.highpass = Math.max(v.highpass, 200);
        v.freq *= 0.85;
        notesBy(v, 0.85);
    }},
    eerie: {about: 'wobbly and hollow, for spooky or dark games', apply: v => {
        if (tonal(v)) v.wave = 'sine';
        v.vibratoDepth = Math.max(v.vibratoDepth, 1.2);
        v.vibratoSpeed = 4;
        v.detune = 35;
        v.attack = Math.max(v.attack, 0.02);
        v.decay *= 1.8;
        v.echo = 0.18;
        v.echoMix = 0.45;
        v.freq *= 0.8;
        notesBy(v, 0.94);
    }}
};

/** @returns {string} a style picked at random, so a game nobody chose a style for still sounds its own */
export const randomStyle = () => {
    const names = Object.keys(STYLES);
    return names[Math.floor(Math.random() * names.length)];
};

const note = (name, octave) => {
    const steps = {C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2}[name];
    return 440 * Math.pow(2, (steps + ((octave - 4) * 12)) / 12);
};

export const PRESETS = {
    coin: {about: 'picking up a coin or gem', voice: {
        wave: 'square', duty: 0.4, freq: 988, jumpAt: 0.06, jumpBy: 1.335, sustain: 0.06, decay: 0.25, punch: 0.4
    }},
    jump: {about: 'a jump', voice: {
        wave: 'square', duty: 0.3, freq: 300, slide: 1.8, sustain: 0.08, decay: 0.16, lowpass: 5000
    }},
    laser: {about: 'shooting a laser or bullet', voice: {
        wave: 'saw', freq: 1400, slide: -5, slideAccel: 4, sustain: 0.05, decay: 0.15, punch: 0.3
    }},
    explosion: {about: 'something blowing up', voice: {
        wave: 'noise', freq: 900, slide: -1.6, sustain: 0.12, decay: 0.55, punch: 0.6, lowpass: 3000
    }},
    hit: {about: 'getting hurt or hitting something', voice: {
        wave: 'noise', freq: 2200, slide: -3, sustain: 0.03, decay: 0.15, punch: 0.5, lowpass: 4000
    }},
    powerup: {about: 'a power-up or level up', voice: {
        wave: 'square', duty: 0.35, freq: 330, slide: 2.2, vibratoDepth: 0.6, vibratoSpeed: 14,
        sustain: 0.25, decay: 0.25
    }},
    blip: {about: 'a menu move, a text letter, a tiny tick', voice: {
        wave: 'square', duty: 0.5, freq: 880, sustain: 0.03, decay: 0.04, volume: 0.35
    }},
    select: {about: 'choosing something in a menu', voice: {
        wave: 'square', duty: 0.25, freq: 660, jumpAt: 0.05, jumpBy: 1.5, sustain: 0.07, decay: 0.08, volume: 0.4
    }},
    bounce: {about: 'a spring, a ball bouncing, stomping an enemy', voice: {
        wave: 'triangle', freq: 180, slide: 3, sustain: 0.06, decay: 0.12, volume: 0.7
    }},
    whoosh: {about: 'a dash, a swing, something flying past', voice: {
        wave: 'noise', freq: 400, slide: 2.5, attack: 0.06, sustain: 0.05, decay: 0.2, lowpass: 2500, highpass: 300,
        volume: 0.45
    }},
    step: {about: 'a footstep', voice: {
        wave: 'noise', freq: 600, slide: -2, sustain: 0.01, decay: 0.05, lowpass: 1800, volume: 0.35
    }},
    door: {about: 'a door, a switch, a lever', voice: {
        wave: 'square', duty: 0.15, freq: 120, slide: -0.8, sustain: 0.05, decay: 0.12, lowpass: 1600, punch: 0.4
    }},
    alarm: {about: 'a warning, time running out', voice: {
        wave: 'square', duty: 0.5, freq: 880, vibratoDepth: 5, vibratoSpeed: 8, sustain: 0.6, decay: 0.05,
        volume: 0.35
    }},
    win: {about: 'winning a level', voice: {
        wave: 'square', duty: 0.4, sustain: 0, decay: 0.25, punch: 0.2,
        notes: [[note('C', 5), 0.1], [note('E', 5), 0.1], [note('G', 5), 0.1], [note('C', 6), 0.3]]
    }},
    lose: {about: 'losing, game over', voice: {
        wave: 'triangle', sustain: 0, decay: 0.3, volume: 0.6,
        notes: [[note('G', 4), 0.18], [note('E', 4), 0.18], [note('C', 4), 0.18], [note('C', 3), 0.45]]
    }}
};

// --- making a recipe ------------------------------------------------------

const seeded = seed => {
    let state = (seed * 2654435761) >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * The recipe for a request: a preset or a custom voice, with its adjustments.
 * @param {object} request {preset, custom, variation, pitch, length, volume}
 * @returns {object} a complete voice
 */
export const voiceFor = ({preset, custom, style, variation = 0, pitch = 0, length = 1, volume}) => {
    if (!preset && !custom) throw new Error('Give a preset or a custom sound.');
    if (preset && !PRESETS[preset]) {
        throw new Error(`There is no sound preset "${preset}". Presets: ${Object.keys(PRESETS).join(', ')}.`);
    }
    if (style && !STYLES[style]) {
        throw new Error(`There is no sound style "${style}". Styles: ${Object.keys(STYLES).join(', ')}.`);
    }
    const voice = {...BASE, ...(preset ? PRESETS[preset].voice : {})};
    // The game's style changes the preset; the recipe's own fields still win.
    if (style) STYLES[style].apply(voice);
    Object.assign(voice, custom || {});
    if (!['square', 'saw', 'triangle', 'sine', 'noise'].includes(voice.wave)) {
        throw new Error(`"${voice.wave}" is not a wave. Use square, saw, triangle, sine or noise.`);
    }
    if (variation) {
        // Small enough that a coin is still a coin.
        const random = seeded(variation);
        const around = amount => 1 + (((random() * 2) - 1) * amount);
        voice.freq *= around(0.18);
        voice.slide *= around(0.25);
        voice.sustain *= around(0.25);
        voice.decay *= around(0.25);
        voice.duty = Math.min(0.5, Math.max(0.05, voice.duty * around(0.3)));
        if (voice.notes) voice.notes = voice.notes.map(([f, d]) => [f * around(0.04), d]);
    }
    const shift = Math.pow(2, pitch / 12);
    voice.freq *= shift;
    if (voice.notes) voice.notes = voice.notes.map(([f, d]) => [f * shift, d * length]);
    voice.attack *= length;
    voice.sustain *= length;
    voice.decay *= length;
    voice.slide /= length;
    voice.slideAccel /= length * length;
    if (typeof volume === 'number') voice.volume = volume;
    voice.volume = Math.min(1, Math.max(0, voice.volume));
    return voice;
};

// --- making the sound -----------------------------------------------------

const envelopeLength = v => v.attack + v.sustain + v.decay;

// One cycle of a tonal wave, at p from 0 to 1.
const oscillator = (v, p, t) => {
    switch (v.wave) {
    case 'square': {
        const duty = Math.min(0.5, Math.max(0.05, v.duty + (v.dutySweep * t)));
        return p < duty ? 1 : -1;
    }
    case 'saw':
        return (2 * p) - 1;
    case 'triangle':
        return p < 0.5 ? (4 * p) - 1 : 3 - (4 * p);
    default:
        return Math.sin(2 * Math.PI * p);
    }
};

/**
 * Render a voice to samples between -1 and 1.
 * @param {object} v a voice from voiceFor
 * @returns {Float32Array} the samples at RATE
 */
export const render = v => {
    // A tune is its notes in turn, each with the envelope's attack and
    // decay; a single sound is its envelope.
    const parts = v.notes ? v.notes.map(([freq, seconds]) => ({freq, seconds})) :
        [{freq: v.freq, seconds: envelopeLength(v)}];
    const echoes = v.echo > 0 && v.echoMix > 0;
    const total = parts.reduce((sum, p) => sum + p.seconds, 0) + (v.notes ? v.decay : 0) +
        (echoes ? v.echo * Math.ceil(Math.log(0.02) / Math.log(Math.min(0.8, v.echoMix))) : 0);
    const length = Math.max(1, Math.min(RATE * 10, Math.round(total * RATE)));
    const out = new Float32Array(length);
    const random = seeded(7);

    let at = 0;
    for (const [n, part] of parts.entries()) {
        const start = Math.round(at * RATE);
        // A note's fade-out stops where the next note starts, apart from a
        // moment to avoid a click; only the last one rings on.
        const last = n === parts.length - 1;
        const tail = v.notes ? (last ? v.decay : Math.min(v.decay, 0.02)) : 0;
        const partLength = Math.round((part.seconds + tail) * RATE);
        let phase = 0;
        let phase2 = 0;
        let noiseValue = 0;
        let lastNoisePhase = 0;
        let low = 0;
        let high = 0;
        let lastIn = 0;
        for (let i = 0; i < partLength && start + i < length; i++) {
            const t = i / RATE;
            // The volume: fade in, hold (with punch), fade out.
            let env;
            if (v.notes) {
                env = t < part.seconds ? 1 : Math.max(0, 1 - ((t - part.seconds) / Math.max(0.001, tail)));
                if (t < 0.005) env *= t / 0.005;
            } else if (t < v.attack) {
                env = t / v.attack;
            } else if (t < v.attack + v.sustain) {
                env = 1 + (v.punch * (1 - ((t - v.attack) / Math.max(0.001, v.sustain))));
            } else {
                env = Math.max(0, 1 - ((t - v.attack - v.sustain) / Math.max(0.001, v.decay)));
            }
            if (env <= 0 && t > 0.01) continue;

            // The pitch at this moment.
            let freq = part.freq * Math.pow(2, (v.slide * t) + (0.5 * v.slideAccel * t * t));
            if (!v.notes && v.jumpAt && t >= v.jumpAt) freq *= v.jumpBy;
            if (v.vibratoDepth) {
                freq *= Math.pow(2, (v.vibratoDepth / 12) * Math.sin(2 * Math.PI * v.vibratoSpeed * t));
            }
            freq = Math.min(RATE / 2.2, Math.max(20, freq));
            phase += freq / RATE;

            let s;
            if (v.wave === 'noise') {
                // Noise: a new random level twice a cycle, so its "pitch"
                // still means something.
                if (phase - lastNoisePhase >= 0.5) {
                    noiseValue = (random() * 2) - 1;
                    lastNoisePhase = phase;
                }
                s = noiseValue;
            } else {
                s = oscillator(v, phase % 1, t);
                if (v.detune) {
                    // A second voice slightly off the first: the two beat
                    // against each other, which sounds wider.
                    phase2 += freq * Math.pow(2, v.detune / 1200) / RATE;
                    s = (s + oscillator(v, phase2 % 1, t)) * 0.6;
                }
            }

            if (v.lowpass > 0) {
                const k = 1 - Math.exp(-2 * Math.PI * v.lowpass / RATE);
                low += k * (s - low);
                s = low;
            }
            if (v.highpass > 0) {
                const k = Math.exp(-2 * Math.PI * v.highpass / RATE);
                high = k * (high + s - lastIn);
                lastIn = s;
                s = high;
            }
            let level = s * env * v.volume * 0.8;
            if (v.crush > 0) {
                // Few loudness steps, so the fade-out goes in stairs.
                const levels = Math.round(Math.pow(2, 7 - (5 * Math.min(1, v.crush))));
                level = Math.round(level * levels) / levels;
            }
            out[start + i] += level;
        }
        at += part.seconds;
    }
    if (echoes) {
        const gap = Math.max(1, Math.round(v.echo * RATE));
        const mix = Math.min(0.8, v.echoMix);
        for (let i = gap; i < length; i++) out[i] += out[i - gap] * mix;
    }
    // No clicks at the very end.
    const tail = Math.min(length, Math.round(RATE * 0.005));
    for (let i = 0; i < tail; i++) out[length - 1 - i] *= i / tail;
    for (let i = 0; i < length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
    return out;
};

/**
 * 16-bit mono WAV bytes.
 * @param {Float32Array} samples between -1 and 1
 * @returns {Buffer} the file
 */
export const toWav = samples => {
    const data = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(samples[i] * 32767), i * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    return Buffer.concat([header, data]);
};

/**
 * What a sound is like, for Claude, who cannot hear it.
 * @param {object} v the voice
 * @param {Float32Array} samples what it rendered to
 * @returns {string} one line
 */
export const describeSound = (v, samples) => {
    const seconds = samples.length / RATE;
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    let pitch;
    if (v.wave === 'noise') {
        pitch = 'noise';
    } else if (v.notes) {
        pitch = `${v.notes.length} notes, ${v.notes.map(([f]) => Math.round(f)).join(', ')} Hz`;
    } else {
        const end = envelopeLength(v);
        let to = v.freq * Math.pow(2, (v.slide * end) + (0.5 * v.slideAccel * end * end));
        if (v.jumpAt && v.jumpAt < end) to *= v.jumpBy;
        to = Math.min(RATE / 2.2, Math.max(20, to));
        pitch = Math.abs(Math.log2(to / v.freq)) < 0.05 ? `${Math.round(v.freq)} Hz` :
            `${Math.round(v.freq)} Hz ${to > v.freq ? 'rising' : 'falling'} to ${Math.round(to)} Hz`;
    }
    const extras = [v.detune && 'doubled', v.echo > 0 && v.echoMix > 0 && 'echoing', v.crush > 0 && 'crunchy',
        v.vibratoDepth && 'wobbling'].filter(Boolean);
    return `${seconds.toFixed(2)}s, ${v.wave}${extras.length ? ` (${extras.join(', ')})` : ''}, ${pitch}, ` +
        `peak ${Math.round(peak * 100)}%`;
};

/**
 * Make a sound for a request.
 * @param {object} request see voiceFor
 * @returns {{wav: Buffer, about: string}} the file and a description
 */
export const makeSound = request => {
    const voice = voiceFor(request);
    const samples = render(voice);
    return {wav: toWav(samples), about: describeSound(voice, samples)};
};
