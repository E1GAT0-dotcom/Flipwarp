/**
 * Which keys a project asks about.
 *
 * Read off the blocks rather than watched at runtime: on-screen controls are
 * only any use if they are there before the project starts, and the runtime
 * only learns a key is wanted the first time something asks whether it is
 * being held.
 *
 * Two blocks ask. "when [key] pressed" keeps its answer in a field on the
 * block itself; "key [key] pressed?" keeps it in a shadow block plugged into
 * an input, which is the same dropdown wearing a different hat, and is the
 * reason this looks in two places for one thing.
 */

const HAT = 'event_whenkeypressed';
const SENSING = 'sensing_keypressed';

const keyOf = block => {
    const field = block.fields && block.fields.KEY_OPTION;
    return field ? field.value : null;
};

/**
 * @param {object} vm The running virtual machine.
 * @return {Array<string>} Scratch key names, e.g. 'up arrow', 'space', 'a'.
 */
const keysUsed = vm => {
    const found = new Set();
    if (!vm || !vm.runtime) return [];
    for (const target of vm.runtime.targets) {
        if (target.isSprite && target.isSprite() && !target.isOriginal) continue;
        const blocks = target.blocks && target.blocks._blocks;
        if (!blocks) continue;
        for (const id of Object.keys(blocks)) {
            const block = blocks[id];
            if (!block) continue;
            if (block.opcode === HAT) {
                const key = keyOf(block);
                if (key) found.add(key);
                continue;
            }
            if (block.opcode !== SENSING) continue;
            const input = block.inputs && block.inputs.KEY_OPTION;
            if (!input) continue;
            // The dropdown is a block of its own, plugged in. Whichever of the
            // two slots it is in — a filled input keeps the shadow in one and
            // whatever replaced it in the other.
            for (const slot of [input.shadow, input.block]) {
                const dropdown = slot && blocks[slot];
                if (!dropdown || dropdown.opcode !== 'sensing_keyoptions') continue;
                const key = keyOf(dropdown);
                if (key) found.add(key);
            }
        }
    }
    return [...found];
};

// What to send when one is pressed. The runtime is given the same thing a real
// keyboard would give it, so nothing downstream has to know the difference.
const AS_EVENT = {
    'up arrow': {key: 'ArrowUp', keyCode: 38},
    'down arrow': {key: 'ArrowDown', keyCode: 40},
    'left arrow': {key: 'ArrowLeft', keyCode: 37},
    'right arrow': {key: 'ArrowRight', keyCode: 39},
    'space': {key: ' ', keyCode: 32},
    'enter': {key: 'Enter', keyCode: 13},
    // "any key" is a real choice in the dropdown, and the project means it, so
    // any key at all will do. Space is the one a thumb can find.
    'any': {key: ' ', keyCode: 32}
};

/**
 * @param {string} scratchKey A Scratch key name.
 * @return {?object} What to post to the runtime for it, or null if unknown.
 */
const asEvent = scratchKey => {
    if (AS_EVENT[scratchKey]) return AS_EVENT[scratchKey];
    if (typeof scratchKey === 'string' && scratchKey.length === 1) {
        const upper = scratchKey.toUpperCase();
        return {key: scratchKey, keyCode: upper.charCodeAt(0)};
    }
    return null;
};

/** The four arrows, in the order a direction pad wants them. */
const ARROWS = ['up arrow', 'left arrow', 'down arrow', 'right arrow'];

/**
 * @param {string} scratchKey A Scratch key name.
 * @return {string} What to write on the button.
 */
const labelFor = scratchKey => {
    switch (scratchKey) {
    case 'up arrow': return '▲';
    case 'down arrow': return '▼';
    case 'left arrow': return '◀';
    case 'right arrow': return '▶';
    case 'space': return 'space';
    case 'enter': return 'enter';
    case 'any': return 'any key';
    default: return scratchKey.toUpperCase();
    }
};

export {
    keysUsed,
    asEvent,
    labelFor,
    ARROWS
};
