// Sounds, for flipwarp-mcp: adding the sounds the server makes (or reads from
// a file), and listing, renaming, deleting and playing them. The sound blocks
// then find them by name: startSound("coin").

import {soundUpload} from '../file-uploader.js';

const TYPES = {wav: 'audio/wav', mp3: 'audio/mpeg'};

const fromBase64 = text => {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const upload = (vm, bytes, type) => new Promise((resolve, reject) => {
    soundUpload(bytes.buffer, type, vm.runtime.storage, resolve,
        e => reject(new Error(`The sound could not be read: ${e && e.message ? e.message : e}`)));
});

// A sound by name, or by number counting from 1.
const indexOf = (target, sound) => {
    const sounds = target.getSounds();
    if (typeof sound === 'number' || /^\d+$/.test(String(sound))) {
        const i = Number(sound) - 1;
        if (i >= 0 && i < sounds.length) return i;
    }
    const i = sounds.findIndex(s => s.name === sound);
    if (i >= 0) return i;
    const list = sounds.length ? sounds.map((s, n) => `${n + 1} "${s.name}"`).join(', ') : 'none';
    throw new Error(`${target.getName()} has no sound "${sound}". It has: ${list}.`);
};

const describe = (s, i) => ({
    number: i + 1,
    name: s.name,
    seconds: s.rate && s.sampleCount ? Math.round((s.sampleCount / s.rate) * 100) / 100 : null,
    format: s.dataFormat
});

/**
 * @param {function} targetNamed (vm, name) -> target, from the bridge
 * @returns {object} the sound requests
 */
export const soundMethods = targetNamed => ({
    sounds: (vm, {sprite}) => {
        const target = targetNamed(vm, sprite);
        return {sounds: target.getSounds().map(describe)};
    },

    // {sprite, name, data (base64), format ('wav' | 'mp3')}
    addSound: async (vm, {sprite, name, data, format = 'wav'}) => {
        const target = targetNamed(vm, sprite);
        if (!TYPES[format]) throw new Error(`Sounds can be wav or mp3, not "${format}".`);
        const sound = await upload(vm, fromBase64(data), TYPES[format]);
        sound.name = name || 'sound';
        await vm.addSound(sound, target.id);
        vm.runtime.emitProjectChanged();
        const sounds = target.getSounds();
        const i = sounds.indexOf(sound);
        return {sound: describe(sounds[i], i), sounds: sounds.map(s => s.name)};
    },

    renameSound: (vm, {sprite, sound, name}) => {
        const target = targetNamed(vm, sprite);
        const i = indexOf(target, sound);
        target.renameSound(i, name);
        vm.runtime.emitProjectChanged();
        vm.emitTargetsUpdate();
        return {sound: describe(target.getSounds()[i], i)};
    },

    deleteSound: (vm, {sprite, sound}) => {
        const target = targetNamed(vm, sprite);
        const i = indexOf(target, sound);
        const name = target.getSounds()[i].name;
        target.deleteSound(i);
        vm.runtime.emitProjectChanged();
        vm.emitTargetsUpdate();
        return {deleted: name, left: target.getSounds().map(s => s.name)};
    },

    // Out loud in the editor, for the person watching.
    playSound: (vm, {sprite, sound}) => {
        const target = targetNamed(vm, sprite);
        const s = target.getSounds()[indexOf(target, sound)];
        target.sprite.soundBank.playSound(target, s.soundId);
        return {playing: s.name};
    }
});
