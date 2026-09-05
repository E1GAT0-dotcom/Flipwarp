// The gameplay settings, in the address bar.
//
// TurboWarp already does this for its own: ?fps=60&clones=Infinity, and so
// on. It is how you send somebody a link to a project that runs the way you
// meant it to rather than a link plus a list of switches to go and find. The
// settings added here were missing from it, so a link to a project that needs
// input buffering or half render scale arrived without them.
//
// Two rules follow from what a link is for.
//
// A setting at its default leaves no mark. An address that lists every
// setting whether or not it differs is unreadable and unshareable, and it is
// also a lie about what matters: ?slow=4 says something, ?slow=1 says
// nothing.
//
// A link changes the page, not what you have saved. Somebody else's link
// arriving and quietly rewriting the settings you chose would be a small
// theft, and you would not find out until the next time you opened a project
// of your own. So the settings a link carries are applied for this page only.

import {getSettings, onSettingsChanged, setSettings} from './settings.js';

// One entry per setting that belongs in an address. `read` turns what the
// address says into a value; `write` says what the address should say, or
// null for "nothing, this is the default".
//
// The names are short and lower case, which is the style of the ones already
// there, and none of them collides with a name TurboWarp uses.
const PARAMETERS = [
    {
        name: 'pauseoffscreen',
        key: 'pauseOffScreen',
        // A switch needs no value: being there is the whole message.
        read: () => true,
        write: value => (value ? '' : null)
    },
    {
        name: 'nopointer',
        key: 'hidePointer',
        read: () => true,
        write: value => (value ? '' : null)
    },
    {
        name: 'slow',
        key: 'slowMotion',
        read: text => {
            const n = Number(text);
            return [1, 2, 4, 8].includes(n) ? n : null;
        },
        write: value => (value > 1 ? String(value) : null)
    },
    {
        name: 'stepbuttons',
        key: 'stepButton',
        read: () => true,
        write: value => (value ? '' : null)
    },
    {
        name: 'fastcollisions',
        key: 'fastCollisions',
        read: () => true,
        write: value => (value ? '' : null)
    },
    {
        name: 'skipframes',
        key: 'skipFrames',
        read: () => true,
        write: value => (value ? '' : null)
    },
    {
        name: 'scale',
        key: 'renderScale',
        read: text => {
            const n = Number(text);
            return [0.5, 1, 2].includes(n) ? n : null;
        },
        write: value => (value === 1 ? null : String(value))
    },
    {
        name: 'buffer',
        key: 'inputBuffering',
        read: () => true,
        write: value => (value ? '' : null)
    }
];

// Fixed randomness is one setting written as two, because a seed with no
// number is useless and a number with no seed is meaningless. ?seed=7 says
// both: repeat the randomness, and repeat this run of it.
const SEED = 'seed';

/**
 * What the address is asking for.
 * @param {string} search the query string, including its "?"
 * @returns {object} settings to apply, which may be empty
 */
export const settingsFromSearch = search => {
    const params = new URLSearchParams(search);
    const changes = {};

    for (const parameter of PARAMETERS) {
        if (!params.has(parameter.name)) continue;
        const value = parameter.read(params.get(parameter.name));
        // A parameter nobody can make sense of is ignored rather than
        // complained about: an address is often typed by hand or trimmed by
        // something that sent it, and refusing to open the project over one
        // bad word would be out of proportion.
        if (value !== null) changes[parameter.key] = value;
    }

    if (params.has(SEED)) {
        const seed = Math.round(Number(params.get(SEED)));
        if (Number.isSafeInteger(seed)) {
            changes.fixedRandom = true;
            changes.randomSeed = seed;
        }
    }

    return changes;
};

/**
 * What the address should say, given the settings.
 * @param {string} search the query string as it is now
 * @param {object} settings the settings
 * @returns {string} the query string it should become, including its "?", or
 *   empty if there is nothing left in it
 */
export const searchFromSettings = (search, settings) => {
    const params = new URLSearchParams(search);

    for (const parameter of PARAMETERS) {
        const value = parameter.write(settings[parameter.key]);
        if (value === null) params.delete(parameter.name);
        else params.set(parameter.name, value);
    }

    if (settings.fixedRandom) params.set(SEED, String(settings.randomSeed));
    else params.delete(SEED);

    // URLSearchParams writes a switch with no value as "name=", which is
    // correct and ugly. The ones already in these addresses are written
    // without the equals sign, so these are too.
    const text = params.toString().replace(/[=](?=&|$)/g, '');
    return text ? `?${text}` : '';
};

/**
 * Read the address, then keep it in step with the settings.
 *
 * Called once, at startup, after the settings are available and before a
 * project has run.
 */
export const watchGameplayUrl = () => {
    const asked = settingsFromSearch(location.search);
    if (Object.keys(asked).length) {
        // For this page only. See the note at the top of this file.
        setSettings(asked, {remember: false});
    }

    onSettingsChanged(settings => {
        const search = searchFromSettings(location.search, settings);
        if (search === location.search) return;
        // Replaced rather than pushed: changing a setting is not somewhere
        // you navigated to, and filling the back button with them would make
        // it useless for going back to where you actually came from.
        history.replaceState(null, null, `${location.pathname}${search}${location.hash}`);
    });

    // The address may already disagree with the settings at startup, when a
    // link left something out that is switched on here.
    const now = searchFromSettings(location.search, getSettings());
    if (now !== location.search) {
        history.replaceState(null, null, `${location.pathname}${now}${location.hash}`);
    }
};
