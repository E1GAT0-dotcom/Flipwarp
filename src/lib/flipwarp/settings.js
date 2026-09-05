// Flipwarp's own settings. Small enough not to need the store, and kept in
// the browser under Flipwarp's own key so nothing here is shared with
// TurboWarp's saved settings on the same address.

import {STYLES, getStyle} from './styles.js';

const STORAGE_KEY = 'flipwarp:settings';

const DEFAULTS = {
    // How the text is written. The blocks are the same either way — this only
    // decides the spelling.
    textStyle: 'js',
    // How far one step of indent goes. Two reads well in a narrow panel.
    indentSize: 2,
    // Offer block names as you type, completed with Tab.
    suggestions: true,
    // Show the @at markers that record where each script sits. Off by
    // default because the positions are kept either way — this only decides
    // whether you have to look at them.
    showPositions: false,
    // Background radio beside the green flag. Off by default: it reaches out
    // to another website the moment it is opened, which should be something
    // you asked for rather than something that happens.
    musicPlayer: false,
    // What the radio does while a project is running: duck | mute | nothing.
    musicWhileRunning: 'duck',
    // The project-wide tools. On by default: a tool nobody can find is the
    // same as a tool that does not exist, and each one is a button that does
    // nothing until pressed.
    searchProject: true,
    findReplace: true,
    copyAsText: true,
    // The other half of Copy as text: right-click the workspace to turn text
    // back into blocks.
    pasteAsBlocks: true,
    blockSheet: true,

    // --- how a project runs ------------------------------------------------
    // These change the project itself rather than the editor around it, and
    // every one is off by default: a project made on Flipwarp should behave
    // the same as it does anywhere else unless somebody chose otherwise.

    // Stop the project when the tab goes to the background, instead of
    // letting a phone half-run it and hand you a game that moved on without
    // you.
    pauseOffScreen: false,
    // Hide the mouse pointer over the stage, for games that draw their own.
    hidePointer: false,
    // Run at a fraction of speed: 1 is normal, 2 is half, 4 a quarter, 8 an
    // eighth.
    slowMotion: 1,
    // A button beside pause that runs exactly one frame.
    stepButton: false,
    // Make "pick random" repeat itself, so the same run happens twice.
    fixedRandom: false,
    // The seed it repeats from. Any whole number; changing it changes the run.
    randomSeed: 1,
    // Compare boxes rather than pixels for "touching". Much faster, and
    // sprites touch a little sooner than they look like they do.
    fastCollisions: false,
    // When a frame runs long, drop the drawing rather than the simulation.
    skipFrames: false,
    // How many pixels the stage is drawn with: 0.5, 1 or 2 times normal.
    renderScale: 1,
    // Hold a key down for at least one frame, so a tap between frames is not
    // thrown away.
    inputBuffering: false
};

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

const listeners = new Set();
let current = null;

const read = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {...DEFAULTS};
        const parsed = JSON.parse(raw);
        return {
            textStyle: STYLES[parsed.textStyle] ? parsed.textStyle : DEFAULTS.textStyle,
            indentSize: parsed.indentSize === 4 ? 4 : DEFAULTS.indentSize,
            suggestions: typeof parsed.suggestions === 'boolean' ? parsed.suggestions : DEFAULTS.suggestions,
            showPositions: typeof parsed.showPositions === 'boolean' ? parsed.showPositions : DEFAULTS.showPositions,
            musicPlayer: bool(parsed.musicPlayer, DEFAULTS.musicPlayer),
            musicWhileRunning: ['duck', 'mute', 'nothing'].includes(parsed.musicWhileRunning) ?
                parsed.musicWhileRunning : DEFAULTS.musicWhileRunning,
            searchProject: bool(parsed.searchProject, DEFAULTS.searchProject),
            findReplace: bool(parsed.findReplace, DEFAULTS.findReplace),
            copyAsText: bool(parsed.copyAsText, DEFAULTS.copyAsText),
            pasteAsBlocks: bool(parsed.pasteAsBlocks, DEFAULTS.pasteAsBlocks),
            blockSheet: bool(parsed.blockSheet, DEFAULTS.blockSheet),
            pauseOffScreen: bool(parsed.pauseOffScreen, DEFAULTS.pauseOffScreen),
            hidePointer: bool(parsed.hidePointer, DEFAULTS.hidePointer),
            slowMotion: [1, 2, 4, 8].includes(parsed.slowMotion) ?
                parsed.slowMotion : DEFAULTS.slowMotion,
            stepButton: bool(parsed.stepButton, DEFAULTS.stepButton),
            fixedRandom: bool(parsed.fixedRandom, DEFAULTS.fixedRandom),
            // A seed is any whole number. Anything else — a word, a decimal,
            // something that came back from storage mangled — is not an
            // argument for refusing to run, so it becomes the default.
            randomSeed: Number.isSafeInteger(parsed.randomSeed) ?
                parsed.randomSeed : DEFAULTS.randomSeed,
            fastCollisions: bool(parsed.fastCollisions, DEFAULTS.fastCollisions),
            skipFrames: bool(parsed.skipFrames, DEFAULTS.skipFrames),
            renderScale: [0.5, 1, 2].includes(parsed.renderScale) ?
                parsed.renderScale : DEFAULTS.renderScale,
            inputBuffering: bool(parsed.inputBuffering, DEFAULTS.inputBuffering)
        };
    } catch (e) {
        return {...DEFAULTS};
    }
};

/**
 * @returns {object} the current settings
 */
export const getSettings = () => {
    if (!current) current = read();
    return current;
};

/**
 * @param {object} changes settings to change
 */
export const setSettings = changes => {
    current = {...getSettings(), ...changes};
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch (e) {
        // A browser that refuses storage still gets working settings for
        // this session; only the memory of them is lost.
    }
    for (const fn of listeners) fn(current);
};

/**
 * @param {function} fn called whenever a setting changes
 * @returns {function} call to stop listening
 */
export const onSettingsChanged = fn => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};

export const indentString = () => ' '.repeat(getSettings().indentSize);

/**
 * The style the text is currently written in.
 * @returns {object} the style
 */
export const currentStyle = () => getStyle(getSettings().textStyle);

/**
 * Everything the converter needs to know about how to write the text, read
 * once so that changing a setting mid-edit cannot leave half a document in one
 * style and half in the other.
 * @returns {{style: object, indent: string}} the options
 */
export const textOptions = () => ({style: currentStyle(), indent: indentString()});
