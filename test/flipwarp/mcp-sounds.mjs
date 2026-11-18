// Every sound preset makes a valid, audible, click-free WAV of a sensible
// length; variations differ but stay close; adjustments do what they say;
// mistakes are refused with a reason. SAVE_SOUNDS=<folder> keeps the files
// to listen to.
import fs from 'node:fs';
import path from 'node:path';
import {PRESETS, RATE, STYLES, makeSound, randomStyle, render, voiceFor} from '../../mcp/sounds.mjs';

let failures = 0;
const check = (ok, what, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok && detail) console.log(`       ${detail}`);
};

const keep = process.env.SAVE_SOUNDS;
if (keep) fs.mkdirSync(keep, {recursive: true});

for (const name of Object.keys(PRESETS)) {
    const {wav, about} = makeSound({preset: name});
    const samples = render(voiceFor({preset: name}));
    const seconds = samples.length / RATE;
    let peak = 0;
    for (const s of samples) peak = Math.max(peak, Math.abs(s));
    const valid = wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE' &&
        wav.readUInt32LE(40) === samples.length * 2;
    check(valid && seconds > 0.03 && seconds < 2 && peak > 0.15 && peak < 0.95 && Math.abs(samples[samples.length - 1]) < 0.01,
        `${name}: ${about}`, `valid ${valid}, ${seconds}s, peak ${peak}`);
    if (keep) fs.writeFileSync(path.join(keep, `${name}.wav`), wav);
}

// Every style with every preset: still a clean sound, and not the plain one.
let styleBad = [];
for (const style of Object.keys(STYLES)) {
    for (const name of Object.keys(PRESETS)) {
        const samples = render(voiceFor({preset: name, style}));
        const plainOne = render(voiceFor({preset: name}));
        let peak = 0;
        for (const s of samples) peak = Math.max(peak, Math.abs(s));
        const same = samples.length === plainOne.length && samples.every((s, i) => s === plainOne[i]);
        const seconds = samples.length / RATE;
        if (!(peak > 0.1 && peak <= 1 && seconds < 5 && Math.abs(samples[samples.length - 1]) < 0.01) || same) {
            styleBad.push(`${style} ${name}: ${seconds.toFixed(2)}s peak ${peak.toFixed(2)}${same ? ' same as plain' : ''}`);
        }
        if (keep) fs.writeFileSync(path.join(keep, `${style}-${name}.wav`), makeSound({preset: name, style}).wav);
    }
}
check(!styleBad.length, `${Object.keys(STYLES).length} styles each change all ${Object.keys(PRESETS).length} presets cleanly`,
    styleBad.join('; '));
check(Object.keys(STYLES).includes(randomStyle()), 'a random style is a real one');
const styledCustom = voiceFor({preset: 'coin', style: 'soft', custom: {wave: 'saw'}});
check(styledCustom.wave === 'saw' && styledCustom.lowpass === 2200, 'a custom field wins over the style, the rest stays');
check(/doubled.*echoing|echoing/.test(makeSound({preset: 'laser', style: 'space'}).about), 'the reply says it echoes',
    makeSound({preset: 'laser', style: 'space'}).about);
const echoed = render(voiceFor({preset: 'blip', custom: {echo: 0.1, echoMix: 0.5}}));
check(echoed.length > render(voiceFor({preset: 'blip'})).length + (0.2 * RATE), 'an echo rings on after the sound');

const a = render(voiceFor({preset: 'coin', variation: 1}));
const b = render(voiceFor({preset: 'coin', variation: 2}));
const a2 = render(voiceFor({preset: 'coin', variation: 1}));
check(a.length !== b.length || a.some((s, i) => s !== b[i]), 'variations differ');
check(a.length === a2.length && a.every((s, i) => s === a2[i]), 'the same variation is the same sound');

const plain = voiceFor({preset: 'jump'});
check(Math.abs(voiceFor({preset: 'jump', pitch: 12}).freq - (plain.freq * 2)) < 0.01, 'pitch 12 is an octave up');
const long = render(voiceFor({preset: 'jump', length: 2})).length;
check(Math.abs(long - (2 * render(plain).length)) < 4, 'length 2 is twice as long');
const quiet = render(voiceFor({preset: 'blip', volume: 0.1}));
check(Math.max(...quiet.map(Math.abs)) < 0.1, 'volume turns it down');

const custom = makeSound({custom: {wave: 'sine', freq: 500, sustain: 0.2, decay: 0.1}});
check(/0\.30s, sine, 500 Hz/.test(custom.about), 'a custom sound', custom.about);

const refuses = (request, words, what) => {
    try {
        makeSound(request);
        check(false, what, 'not refused');
    } catch (e) {
        check(e.message.includes(words), what, e.message);
    }
};
refuses({preset: 'boing'}, 'Presets:', 'an unknown preset is refused, with the list');
refuses({custom: {wave: 'kazoo'}}, 'is not a wave', 'an unknown wave is refused');
refuses({}, 'Give a preset', 'nothing at all is refused');
refuses({preset: 'coin', style: 'polka'}, 'Styles:', 'an unknown style is refused, with the list');

if (failures) {
    console.log(`${failures} failure(s)`);
    process.exit(1);
}
console.log('sounds: all passed');
