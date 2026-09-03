// Flipwarp's own settings. Small enough not to need the store, and kept in
// the browser under Flipwarp's own key so nothing here is shared with
// TurboWarp's saved settings on the same address.

const STORAGE_KEY = 'flipwarp:settings';

const DEFAULTS = {
    // How far one step of indent goes. Two reads well in a narrow panel.
    indentSize: 2,
    // Offer block names as you type, completed with Tab.
    suggestions: true,
    // Show the @at markers that record where each script sits. Off by
    // default because the positions are kept either way — this only decides
    // whether you have to look at them.
    showPositions: false,
    // The project-wide tools. On by default: a tool nobody can find is the
    // same as a tool that does not exist, and each one is a button that does
    // nothing until pressed.
    searchProject: true,
    findReplace: true,
    copyAsText: true,
    blockSheet: true
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
            indentSize: parsed.indentSize === 4 ? 4 : DEFAULTS.indentSize,
            suggestions: typeof parsed.suggestions === 'boolean' ? parsed.suggestions : DEFAULTS.suggestions,
            showPositions: typeof parsed.showPositions === 'boolean' ? parsed.showPositions : DEFAULTS.showPositions,
            searchProject: bool(parsed.searchProject, DEFAULTS.searchProject),
            findReplace: bool(parsed.findReplace, DEFAULTS.findReplace),
            copyAsText: bool(parsed.copyAsText, DEFAULTS.copyAsText),
            blockSheet: bool(parsed.blockSheet, DEFAULTS.blockSheet)
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
