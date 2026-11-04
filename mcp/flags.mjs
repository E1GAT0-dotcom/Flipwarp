// What chats have flagged: bugs, slowness, missing tools and ideas that matter
// beyond the chat that found them. One file every chat's server shares, kept
// beside the server so it outlives them and shown in the control room. Lines
// are only ever added, so several chats can write at once.
//
// Not in git (see .gitignore): flags can talk about the person's own games.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FLAGS_FILE = process.env.FLIPWARP_FLAGS || path.join(here, 'flags.jsonl');

export const KINDS = ['bug', 'slow', 'missing', 'idea', 'docs'];

const append = entry => fs.appendFileSync(FLAGS_FILE, `${JSON.stringify(entry)}\n`);

/**
 * @returns {Array<object>} every flag, oldest first, each with who else saw it and whether it is resolved
 */
export const readFlags = () => {
    let raw = '';
    try {
        raw = fs.readFileSync(FLAGS_FILE, 'utf8');
    } catch (e) {
        return [];
    }
    const flags = new Map();
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let entry;
        try {
            entry = JSON.parse(line);
        } catch (e) {
            // A line cut short by a crash loses that line, not the list.
            continue;
        }
        if (entry.add) {
            flags.set(entry.add.id, {...entry.add, sightings: [], resolved: null});
        } else if (entry.seen && flags.has(entry.seen)) {
            flags.get(entry.seen).sightings.push({at: entry.at, chat: entry.chat, details: entry.details});
        } else if (entry.resolve && flags.has(entry.resolve)) {
            flags.get(entry.resolve).resolved = {at: entry.at, note: entry.note || ''};
        }
    }
    return [...flags.values()];
};

/**
 * @returns {Array<object>} the flags nobody has resolved yet, most sightings first
 */
export const openFlags = () => readFlags()
    .filter(f => !f.resolved)
    .sort((a, b) => b.sightings.length - a.sightings.length || a.at - b.at);

const wordsOf = text => new Set(String(text).toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(w => w.length > 2));

// Two chats rarely word the same problem the same way, so this compares the
// words of the titles rather than the titles.
const sameProblem = (a, b) => {
    const x = wordsOf(a);
    const y = wordsOf(b);
    if (!x.size || !y.size) return false;
    const shared = [...x].filter(w => y.has(w)).length;
    return shared / (x.size + y.size - shared) >= 0.6;
};

/**
 * Flag something, or add a sighting if an open flag already says it.
 * @param {object} flag kind, title, details, about and chat
 * @returns {{flag: object, alreadyFlagged: boolean}} the flag as it now stands
 */
export const addFlag = ({kind, title, details, about, chat}) => {
    const at = Date.now();
    const existing = openFlags().find(f => sameProblem(f.title, title));
    if (existing) {
        append({seen: existing.id, at, chat, details});
        existing.sightings.push({at, chat, details});
        return {flag: existing, alreadyFlagged: true};
    }
    const id = `f${at.toString(36)}`;
    const flag = {id, at, kind, title, details, about: about || null, chat};
    append({add: flag});
    return {flag: {...flag, sightings: [], resolved: null}, alreadyFlagged: false};
};

/**
 * @param {string} id the flag
 * @param {string} [note] what was done about it
 * @returns {boolean} whether there was an open flag with that id
 */
export const resolveFlag = (id, note) => {
    if (!openFlags().some(f => f.id === id)) return false;
    append({resolve: id, at: Date.now(), note: note || ''});
    return true;
};
