// The PenguinMod tab in the extension picker.
//
// These extensions are not fetched from PenguinMod. They are read from a
// folder sitting beside editor.html in whatever site this editor was uploaded
// to, put there by unzipping what the checker page downloads. That means
// PenguinMod's server is not asked for anything when someone opens this
// editor, and it means the extensions keep working even if their site is
// down or moves.
//
// If the folder is not there, this returns an empty list and the tab says how
// to add it, rather than showing a broken tab or a spinner that never stops.

const FOLDER = 'penguinmod/';

/**
 * Where the bundled folder lives, worked out from the page the editor is on
 * so that hosting the site in a subfolder still works.
 * @returns {string} an address ending in a slash
 */
export const penguinModBase = () => {
    try {
        return new URL(FOLDER, document.baseURI).href;
    } catch (e) {
        return `${process.env.ROOT || '/'}${FOLDER}`;
    }
};

let cached = null;
let pending = null;

const read = async () => {
    const base = penguinModBase();
    let entries;
    try {
        const res = await fetch(`${base}extensions.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        entries = await res.json();
    } catch (e) {
        // Not an error worth shouting about: a site without the folder is a
        // perfectly good site, it just has no PenguinMod tab.
        return [];
    }

    if (!Array.isArray(entries)) {
        return [];
    }

    return entries
        .filter(entry => entry && entry.name && entry.code)
        .map(entry => ({
            name: entry.name,
            description: entry.description || '',
            // The file's own address is the id, which is what the picker uses
            // to tell one entry from another and to remember the last choice.
            extensionId: `${base}${entry.code}`,
            extensionURL: `${base}${entry.code}`,
            iconURL: entry.image ? `${base}${entry.image}` : null,
            tags: ['pm'],
            credits: entry.creator ? [entry.creator] : [],
            // Flipwarp has no text form for these blocks, the same as with
            // TurboWarp's. The banner on the tab says so; this is what makes
            // the picker mark the entry itself.
            incompatibleWithScratch: true,
            featured: true
        }));
};

/**
 * Read the bundled extension list.
 * @returns {Promise<Array>} the extensions, or an empty array if the folder
 *   has not been added to this site.
 */
export const loadPenguinModLibrary = () => {
    if (cached) return Promise.resolve(cached);
    if (!pending) {
        pending = read().then(list => {
            cached = list;
            return list;
        });
    }
    return pending;
};
