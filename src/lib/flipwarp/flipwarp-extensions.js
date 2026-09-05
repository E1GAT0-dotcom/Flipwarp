// Flipwarp's own extensions.
//
// They are served from this site rather than fetched from anywhere, so they
// keep working with no connection and nobody else's server is asked for them.
// Their addresses are worked out from the page the editor is on, so hosting
// the site in a subfolder still finds them.
//
// The thing that makes them worth having rather than pointing people at
// TurboWarp's: these convert to text. scripts/flipwarp-extract-extensions.js
// reads their block definitions and writes the phrasebook, the same way it
// does for Scratch's own extensions, so the Text button works on a sprite
// that uses one.

const FOLDER = 'flipwarp-extensions/';

/**
 * @returns {string} where the extensions live, ending in a slash
 */
export const flipwarpBase = () => {
    try {
        return new URL(FOLDER, document.baseURI).href;
    } catch (e) {
        return `${process.env.ROOT || '/'}${FOLDER}`;
    }
};

const EXTENSIONS = [
    {
        id: 'flipwarpSaveSlots',
        file: 'save-slots.js',
        icon: 'save-slots.svg',
        name: 'Save Slots',
        description: 'Remember things after the tab is closed — scores, progress, whole lists.'
    },
    {
        id: 'flipwarpRecordReplay',
        file: 'record-replay.js',
        icon: 'record-replay.svg',
        name: 'Record & Replay',
        description: 'Record what was pressed and play it back. For testing, and for demos that ' +
            'play themselves.'
    },
    {
        id: 'flipwarpDialogue',
        file: 'dialogue.js',
        icon: 'dialogue.svg',
        name: 'Dialogue',
        description: 'Write a branching conversation as text and walk through it, instead of a ' +
            'hundred nested ifs.'
    },
    {
        id: 'flipwarpNear',
        file: 'near.js',
        icon: 'near.svg',
        name: 'Near',
        description: 'Ask what is close by without checking every sprite against every other. ' +
            'For projects with hundreds of clones.'
    },
    {
        id: 'flipwarpPathfinding',
        file: 'pathfinding.js',
        icon: 'pathfinding.svg',
        name: 'Pathfinding',
        description: 'Find a way round the walls instead of walking into them, and step along it.'
    }
];

/**
 * The Flipwarp extensions, ready for the picker.
 * @returns {Array<object>} one entry per extension
 */
export const flipwarpLibrary = () => {
    const base = flipwarpBase();
    return EXTENSIONS.map(extension => ({
        name: extension.name,
        extensionId: extension.id,
        extensionURL: `${base}${extension.file}`,
        iconURL: `${base}icons/${extension.icon}`,
        description: extension.description,
        tags: ['flipwarp'],
        featured: true,
        // These are ours and they do convert to text, so none of the warnings
        // the other tabs carry apply.
        incompatibleWithScratch: true,
        credits: ['E1GAT0_']
    }));
};

export default EXTENSIONS;
