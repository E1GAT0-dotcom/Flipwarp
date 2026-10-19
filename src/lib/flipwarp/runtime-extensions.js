// Text for the blocks of extensions that are not Scratch's or Flipwarp's own:
// the TurboWarp gallery, PenguinMod's, anything loaded from a URL.
//
// Scratch's extensions and Flipwarp's are read once, ahead of time, by
// scripts/flipwarp-extract-extensions.js, and their text never changes. These
// cannot be: nobody knows which ones a project will load until it loads them.
// So their text is made here, from the block definitions the extension hands
// the VM, by the same rules the script uses, and only while the setting that
// allows it is on. It is off by default because a text form made on the fly is
// only as steady as the extension behind it: an extension that renames a block
// in its next version changes the text too, where Scratch's never will.

import {EXTENSION_BLOCKS} from './extension-blocks.js';
import {addBlocks, removeBlocks, addedOpcodes} from './phrasebook.js';
import {INPUT_SHADOWS} from './input-shadows.js';
import {getSettings, onSettingsChanged} from './settings.js';

// Every extension that already has a fixed text form. Its blocks are written
// <extension>_<opcode>, and extension ids cannot hold an underscore.
const FIXED = new Set(Object.keys(EXTENSION_BLOCKS).map(op => op.slice(0, op.indexOf('_'))));

// The slot behind each kind of argument. The same table as the script's.
const ARG_SHADOW = {
    number: 'math_number',
    angle: 'math_angle',
    color: 'colour_picker',
    string: 'text',
    Boolean: null,
    matrix: 'matrix',
    note: 'note'
};

const camel = label => {
    const words = String(label)
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[^A-Za-z0-9 ]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!words.length) return null;
    const joined = words
        .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)))
        .join('');
    // A name cannot start with a digit ("3d sprite" would be read as a number).
    return /^[0-9]/.test(joined) ? `n${joined}` : joined;
};

const kindOf = info => {
    switch (info.blockType) {
    case 'reporter': return 'reporter';
    case 'Boolean': return 'boolean';
    case 'hat':
    case 'event': return 'hat';
    case 'conditional':
    case 'loop': return 'c';
    default: return info.isTerminal ? 'terminal' : 'statement';
    }
};

/**
 * Text forms for one extension's blocks.
 * @param {object} category one entry of runtime._blockInfo
 * @param {Set<string>} taken names already used, added to as names are given
 * @returns {{defs: object, shadows: object, skipped: string[]}} the blocks, the
 *   slot behind each of their inputs, and the opcodes that have no text form
 */
export const defsForCategory = (category, taken) => {
    const id = category.id;
    const defs = {};
    const shadows = {};
    const skipped = [];
    const menuInfo = category.menuInfo || {};

    for (const block of category.blocks || []) {
        const info = block && block.info;
        if (!info || !info.opcode) continue; // separators
        if (['label', 'button', 'xml'].includes(info.blockType)) continue;

        const opcode = `${id}_${info.opcode}`;
        const kind = kindOf(info);
        // The text has one body per block. A block with two or more, other
        // than if-else, has no way to be written.
        if (kind === 'c' && (info.branchCount || 1) > 1) {
            skipped.push(opcode);
            continue;
        }

        const argDefs = info.arguments || {};
        const text = Array.isArray(info.text) ? info.text.join(' ') : String(info.text || '');
        // Pictures inside a block are decoration, not slots.
        const realArgs = Object.keys(argDefs).filter(a => argDefs[a] && argDefs[a].type !== 'image');
        const order = [];
        const re = /\[([A-Za-z0-9_]+)\]/g;
        let m;
        while ((m = re.exec(text))) if (realArgs.includes(m[1]) && !order.includes(m[1])) order.push(m[1]);
        for (const a of realArgs) if (!order.includes(a)) order.push(a);

        const fields = [];
        const menu = {};
        const shadowMap = {};
        for (const argName of order) {
            const arg = argDefs[argName];
            if (arg.menu) {
                const def = menuInfo[arg.menu];
                if (def && typeof def === 'object' && !Array.isArray(def) && def.acceptReporters) {
                    menu[argName] = `${id}_menu_${arg.menu}`;
                } else {
                    fields.push(argName);
                }
                continue;
            }
            shadowMap[argName] = arg.type in ARG_SHADOW ? ARG_SHADOW[arg.type] : 'text';
        }

        let name = `${id}.${camel(text) || camel(info.opcode) || info.opcode}`;
        if (taken.has(name)) name = `${id}.${camel(info.opcode) || info.opcode}`;
        let n = 2;
        while (taken.has(name)) name = `${id}.${camel(info.opcode) || info.opcode}${n++}`;
        taken.add(name);

        const def = {kind, name, args: order, extension: true, runtime: true};
        if (fields.length) def.fields = fields;
        if (Object.keys(menu).length) def.menu = menu;
        if (kind === 'c') def.substack = ['SUBSTACK'];
        if (kind === 'c' && info.isTerminal) def.terminal = true;
        defs[opcode] = def;
        if (Object.keys(shadowMap).length) shadows[opcode] = shadowMap;
    }
    return {defs, shadows, skipped};
};

const addedShadows = new Set();

/**
 * Bring the phrasebook in line with the extensions loaded right now and the
 * setting. Cheap enough to run on every change: it starts from nothing each
 * time, so a removed extension or a renamed block can never leave a stale
 * text form behind.
 * @param {object} vm the VM
 * @returns {string[]} opcodes that now have a text form from here
 */
export const syncExtensionText = vm => {
    removeBlocks();
    for (const op of addedShadows) delete INPUT_SHADOWS[op];
    addedShadows.clear();
    if (!getSettings().otherExtensionText) return [];

    const taken = new Set();
    for (const category of vm.runtime._blockInfo || []) {
        if (!category || !category.id || FIXED.has(category.id)) continue;
        const {defs, shadows} = defsForCategory(category, taken);
        const added = addBlocks(defs);
        for (const op of added) {
            if (shadows[op] && !INPUT_SHADOWS[op]) {
                INPUT_SHADOWS[op] = shadows[op];
                addedShadows.add(op);
            }
        }
    }
    return addedOpcodes();
};

/**
 * Whether an extension's blocks are left out of the text only because the
 * setting is off, so the message about them can say how to turn it on.
 * @param {string} extensionId the extension
 * @returns {boolean} true when turning the setting on would help
 */
export const blockedBySetting = extensionId =>
    !FIXED.has(extensionId) && !getSettings().otherExtensionText;

export const installExtensionText = vm => {
    const sync = () => syncExtensionText(vm);
    vm.runtime.on('EXTENSION_ADDED', sync);
    vm.runtime.on('BLOCKSINFO_UPDATE', sync);
    let last = getSettings().otherExtensionText;
    onSettingsChanged(settings => {
        if (settings.otherExtensionText === last) return;
        last = settings.otherExtensionText;
        sync();
    });
    sync();
};
