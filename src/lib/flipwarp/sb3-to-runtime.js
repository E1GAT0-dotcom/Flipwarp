// Saved-project block format -> the format the running VM keeps in memory.
//
// A saved project writes an input as a compact array ([1, [4, "10"]]); the VM
// keeps a real shadow block for every one of those slots. Converting here,
// rather than reloading the whole project, means applying text does not
// re-fetch costumes and sounds or stop what the project is doing.

import Comment from 'scratch-vm/src/engine/comment';

const PRIMITIVE_OPCODE = {
    4: ['math_number', 'NUM'],
    5: ['math_positive_number', 'NUM'],
    6: ['math_whole_number', 'NUM'],
    7: ['math_integer', 'NUM'],
    8: ['math_angle', 'NUM'],
    9: ['colour_picker', 'COLOUR'],
    10: ['text', 'TEXT'],
    11: ['event_broadcast_menu', 'BROADCAST_OPTION'],
    12: ['data_variable', 'VARIABLE'],
    13: ['data_listcontents', 'LIST']
};

const VARIABLE_TYPE = {
    VARIABLE: '',
    LIST: 'list',
    BROADCAST_OPTION: 'broadcast_msg'
};

/**
 * Convert one target's saved blocks into runtime blocks.
 * @param {object} savedBlocks blocks in saved-project format
 * @returns {object} blocks in the VM's in-memory format
 */
export const toRuntimeBlocks = savedBlocks => {
    const out = {};
    let n = 0;
    const newId = () => `fwshadow${(n++).toString(36)}`;

    // Every block that was already a real block carries over as-is.
    for (const [id, b] of Object.entries(savedBlocks)) {
        out[id] = {
            id,
            opcode: b.opcode,
            inputs: {},
            fields: {},
            next: b.next || null,
            topLevel: !!b.topLevel,
            parent: b.parent || null,
            shadow: !!b.shadow,
            x: b.x,
            y: b.y
        };
        if (b.mutation) out[id].mutation = normalizeMutation(b.mutation);
        for (const [name, f] of Object.entries(b.fields || {})) {
            const field = {name, value: f[0]};
            if (f.length > 1 && f[1] !== null && f[1] !== undefined) {
                field.id = f[1];
                field.variableType = VARIABLE_TYPE[name] !== undefined ? VARIABLE_TYPE[name] : '';
            }
            out[id].fields[name] = field;
        }
    }

    // Inputs need a second pass, because a primitive slot becomes a new
    // shadow block that has to exist alongside the others.
    for (const [id, b] of Object.entries(savedBlocks)) {
        for (const [name, input] of Object.entries(b.inputs || {})) {
            if (!input) continue;
            const primary = input[1];
            const backing = input[2];

            let blockId = null;
            let shadowId = null;

            if (typeof primary === 'string') {
                blockId = primary;
            } else if (Array.isArray(primary)) {
                shadowId = makePrimitive(primary, out, newId, id);
                blockId = shadowId;
            }

            if (Array.isArray(backing)) {
                shadowId = makePrimitive(backing, out, newId, id);
            } else if (typeof backing === 'string') {
                shadowId = backing;
            } else if (typeof primary === 'string') {
                shadowId = null;
            }

            out[id].inputs[name] = {name, block: blockId, shadow: shadowId};
            if (blockId && out[blockId]) out[blockId].parent = id;
            if (shadowId && out[shadowId] && shadowId !== blockId) out[shadowId].parent = id;
        }
    }

    return out;
};

function makePrimitive (prim, out, newId, parentId) {
    const [type, a, b] = prim;
    const spec = PRIMITIVE_OPCODE[type];
    if (!spec) return null;
    const [opcode, fieldName] = spec;
    const id = newId();
    const field = {name: fieldName, value: a};
    if (type >= 11) {
        field.id = b === undefined ? null : b;
        field.variableType = VARIABLE_TYPE[fieldName] !== undefined ? VARIABLE_TYPE[fieldName] : '';
    }
    out[id] = {
        id,
        opcode,
        inputs: {},
        fields: {[fieldName]: field},
        next: null,
        topLevel: false,
        parent: parentId,
        shadow: true
    };
    return id;
}

function normalizeMutation (m) {
    // The VM keeps mutations as a plain object with a children array.
    return Object.assign({}, m, {children: m.children || []});
}

/**
 * Replace everything in a target's workspace with new blocks.
 * @param {Target} target the VM target to rewrite
 * @param {object} savedBlocks blocks in saved-project format
 */
export const replaceTargetBlocks = (target, savedBlocks, savedComments) => {
    const runtime = toRuntimeBlocks(savedBlocks);
    const blocks = target.blocks;

    // Clear the old workspace without going through deleteBlock, which walks
    // the tree we are about to throw away.
    blocks._blocks = {};
    blocks._scripts = [];
    if (typeof blocks.resetCache === 'function') blocks.resetCache();

    for (const block of Object.values(runtime)) {
        blocks._blocks[block.id] = block;
        if (block.topLevel) blocks._scripts.push(block.id);
    }
    if (typeof blocks.resetCache === 'function') blocks.resetCache();

    // Comments live on the target rather than in its block store, and the
    // runtime keeps them in the same shape a saved project does, so they can
    // go straight across.
    // The runtime holds real Comment objects, not plain records — the editor
    // asks each one to draw itself — so they are rebuilt as the real thing.
    if (savedComments) {
        target.comments = {};
        for (const [id, c] of Object.entries(savedComments)) {
            const comment = new Comment(id, c.text, c.x, c.y, c.width, c.height, !!c.minimized);
            comment.blockId = c.blockId || null;
            target.comments[id] = comment;
            const block = comment.blockId && blocks.getBlock(comment.blockId);
            if (block) block.comment = id;
        }
    }
};
