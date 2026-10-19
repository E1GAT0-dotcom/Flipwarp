// Where scripts sit on the canvas after text is written into a sprite.
//
// The text keeps every script's position, but a script that is new has none,
// and a script that grew can now cover the one below it. Scripts were simply
// stacked 260 apart, which is less than one tall custom block, so a sprite
// written by Claude came out as one pile. Here each script is measured as it
// is actually drawn, and the canvas is put right: new scripts go to the bottom
// of their column (events on the left, custom block definitions on the right),
// and anything that overlaps is pushed down, keeping its place otherwise.

import LazyScratchBlocks from '../tw-lazy-scratch-blocks';

const GAP = 48;
const COLUMN_GAP = 96;

// --- measuring ---------------------------------------------------------------

const workspaceHolding = blockId => {
    if (!LazyScratchBlocks.isLoaded()) return null;
    const Blockly = LazyScratchBlocks.get();
    const db = Blockly.Workspace && Blockly.Workspace.WorkspaceDB_;
    const all = db ? Object.values(db) :
        [Blockly.getMainWorkspace && Blockly.getMainWorkspace()].filter(Boolean);
    for (const workspace of all) {
        try {
            if (workspace.isFlyout) continue;
            if (workspace.getBlockById && workspace.getBlockById(blockId)) return workspace;
        } catch (e) {
            // A workspace being torn down is not the one wanted.
        }
    }
    return null;
};

// A guess at a script's size from its blocks, for when it is not drawn (the
// Costumes tab is open, say). Close to what the editor draws, and on the
// large side, which only means a little more space between scripts.
const STACK_HEIGHT = 48;
const HAT_EXTRA = 24;
const DEFINITION_HEIGHT = 96;
const C_ARM = 40;

const estimateStack = (blocks, id) => {
    let height = 0;
    let width = 0;
    let at = blocks[id];
    while (at) {
        if (at.opcode === 'procedures_definition') {
            height += DEFINITION_HEIGHT;
        } else {
            height += STACK_HEIGHT;
            // A hat block's rounded top makes it taller than a stack block.
            if (at.topLevel) height += HAT_EXTRA;
        }
        width = Math.max(width, 280);
        for (const name of ['SUBSTACK', 'SUBSTACK2']) {
            const input = at.inputs && at.inputs[name];
            if (!input) continue;
            const inner = input.block ? estimateStack(blocks, input.block) : {height: 24, width: 0};
            height += inner.height + C_ARM;
            width = Math.max(width, inner.width + 16);
        }
        at = at.next ? blocks[at.next] : null;
    }
    return {height, width};
};

const isDefinition = block => block.opcode === 'procedures_definition';

/**
 * Every script of a target, with its size as drawn.
 * @param {object} target a target in the running project
 * @returns {Array<object>} {id, x, y, width, height, definition}
 */
// Every block in a script: the stack, what sits in its slots, its bodies.
const blocksOfScript = (blocks, topId) => {
    const found = new Set();
    const collect = id => {
        const b = blocks[id];
        if (!b || found.has(id)) return;
        found.add(id);
        for (const input of Object.values(b.inputs || {})) {
            if (input.block) collect(input.block);
            if (input.shadow) collect(input.shadow);
        }
        if (b.next) collect(b.next);
    };
    collect(topId);
    return found;
};

// The comments hanging off a script's blocks.
const commentsOf = (target, ids) => Object.values(target.comments || {})
    .filter(c => c.blockId && ids.has(c.blockId));

// A script's own size, blocks only, as drawn or else as guessed.
const sizeOf = (blocks, id) => {
    const workspace = workspaceHolding(id);
    const drawn = workspace && workspace.getBlockById(id);
    if (drawn && drawn.getHeightWidth) {
        const size = drawn.getHeightWidth();
        return {width: size.width, height: size.height};
    }
    return estimateStack(blocks, id);
};

// How far down its script a block is drawn, so its comment can sit level
// with it. The top of the script when the block is not drawn.
const offsetInScript = (blocks, topId, blockId) => {
    const workspace = workspaceHolding(topId);
    const top = workspace && workspace.getBlockById(topId);
    const block = workspace && workspace.getBlockById(blockId);
    if (!top || !block) return 0;
    return block.getRelativeToSurfaceXY().y - top.getRelativeToSurfaceXY().y;
};

/**
 * Puts every comment on a block just to the right of its script, level with
 * the block. A write rebuilds the comments and keeps each one's old box,
 * matched by its text, which is right while nothing moves and wrong as soon
 * as a script does: the comment stays behind, over some other script, and a
 * brand-new one starts at 0, 0.
 * @param {object} target a target in the running project
 */
export const placeComments = target => {
    const blocks = target.blocks._blocks;
    for (const top of Object.values(blocks)) {
        if (!top || !top.topLevel || top.shadow) continue;
        const ids = blocksOfScript(blocks, top.id);
        const notes = commentsOf(target, ids);
        if (!notes.length) continue;
        const right = (top.x || 0) + sizeOf(blocks, top.id).width + 32;
        let below = -Infinity;
        for (const note of notes.sort((a, b) => offsetInScript(blocks, top.id, a.blockId) -
            offsetInScript(blocks, top.id, b.blockId))) {
            note.x = Math.round(right);
            // Level with its block, but never on top of the comment above.
            note.y = Math.round(Math.max((top.y || 0) + offsetInScript(blocks, top.id, note.blockId), below));
            below = note.y + (note.minimized ? 32 : (note.height || 200)) + 16;
        }
    }
};

export const measureScripts = target => {
    const blocks = target.blocks._blocks;
    return Object.values(blocks)
        .filter(b => b && b.topLevel && !b.shadow)
        .map(b => {
            let {width, height} = sizeOf(blocks, b.id);
            const x = b.x || 0;
            const y = b.y || 0;
            // A comment can hang below a short script and over the next
            // one, so the space a script takes includes its comments.
            for (const c of commentsOf(target, blocksOfScript(blocks, b.id))) {
                width = Math.max(width, (c.x + (c.width || 200)) - x);
                height = Math.max(height, (c.y + (c.minimized ? 32 : (c.height || 200))) - y);
            }
            return {id: b.id, x, y, width, height, definition: isDefinition(b)};
        });
};

// --- what changed ------------------------------------------------------------

// A script's content with its ids left out, so the same script built again
// (with new ids, as every write builds them) is recognised as the same.
const describeBlock = (blocks, id) => {
    const b = blocks[id];
    if (!b) return null;
    const out = [b.opcode];
    for (const name of Object.keys(b.fields || {}).sort()) out.push(name, b.fields[name].value);
    for (const name of Object.keys(b.inputs || {}).sort()) {
        const input = b.inputs[name];
        // Only what is in the slot. A dropdown or number hidden under a block
        // dropped into the slot is left out, as canon.js leaves it out: a
        // project saved by Scratch and the same project rebuilt from text
        // keep different values there, and nobody can see them.
        out.push(name, input.block ? describeBlock(blocks, input.block) : null);
    }
    if (b.mutation) out.push(b.mutation.proccode || '', b.mutation.warp || '');
    if (b.next) out.push('>', describeBlock(blocks, b.next));
    return out;
};

/**
 * One fingerprint per script, for telling afterwards which scripts changed.
 * @param {object} target a target in the running project
 * @returns {Map<string, number>} fingerprint -> how many scripts have it
 */
export const fingerprintScripts = target => {
    const blocks = target.blocks._blocks;
    const counts = new Map();
    for (const b of Object.values(blocks)) {
        if (!b || !b.topLevel || b.shadow) continue;
        const key = JSON.stringify(describeBlock(blocks, b.id));
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
};

/**
 * The scripts that are not among the ones fingerprinted before.
 * @param {object} target a target in the running project
 * @param {Map<string, number>} before from fingerprintScripts
 * @returns {string[]} the ids of new or changed scripts
 */
export const changedScripts = (target, before) => {
    const left = new Map(before);
    const blocks = target.blocks._blocks;
    const changed = [];
    for (const b of Object.values(blocks)) {
        if (!b || !b.topLevel || b.shadow) continue;
        const key = JSON.stringify(describeBlock(blocks, b.id));
        if (left.get(key) > 0) {
            left.set(key, left.get(key) - 1);
        } else {
            changed.push(b.id);
        }
    }
    return changed;
};

// --- moving ------------------------------------------------------------------

// A script and the comments on its blocks move together.
const moveScript = (target, script, toX, toY) => {
    // Whole numbers, as the text writes positions: a fraction here would
    // make the next comparison with the text see a move that is not there.
    const x = Math.round(toX);
    const y = Math.round(toY);
    const dx = x - script.x;
    const dy = y - script.y;
    if (!dx && !dy) return false;
    const blocks = target.blocks._blocks;
    const top = blocks[script.id];
    top.x = x;
    top.y = y;
    for (const comment of commentsOf(target, blocksOfScript(blocks, script.id))) {
        comment.x += dx;
        comment.y += dy;
    }
    script.x = x;
    script.y = y;
    return true;
};

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP;

// Pushes scripts down, in order from the top, until none covers another.
const separate = (target, scripts) => {
    let moved = 0;
    const placed = [];
    for (const script of [...scripts].sort((a, b) => (a.y - b.y) || (a.x - b.x))) {
        let clash = placed.find(p => overlaps(script, p));
        while (clash) {
            if (moveScript(target, script, script.x, clash.y + clash.height + GAP)) moved++;
            clash = placed.find(p => overlaps(script, p));
        }
        placed.push(script);
    }
    return moved;
};

/**
 * After text has been written: new scripts to the bottom of their column,
 * then nothing left covering anything else.
 * @param {object} vm the VM
 * @param {object} target the target written to
 * @param {Set<string>} freshPositions "x,y" of the placeholder positions
 *   new scripts were given, which no existing script had
 * @returns {{moved: number}} how many scripts moved
 */
export const settleScripts = (vm, target, freshPositions) => {
    placeComments(target);
    const scripts = measureScripts(target);
    const fresh = scripts.filter(s => freshPositions.has(`${s.x},${s.y}`));
    const kept = scripts.filter(s => !fresh.includes(s));
    let moved = 0;

    const events = kept.filter(s => !s.definition);
    const definitions = kept.filter(s => s.definition);
    const left = events.length ? Math.min(...events.map(s => s.x)) : 0;
    let eventsBottom = events.length ? Math.max(...events.map(s => s.y + s.height)) + GAP : 0;
    const widest = Math.max(0, ...events.map(s => s.x + s.width), ...fresh.filter(s => !s.definition)
        .map(s => left + s.width));
    const right = definitions.length ? Math.min(...definitions.map(s => s.x)) :
        (widest ? widest + COLUMN_GAP : 0);
    let definitionsBottom = definitions.length ? Math.max(...definitions.map(s => s.y + s.height)) + GAP : 0;

    // In the order they were written, which is the order the text gave them.
    const order = target.blocks._scripts;
    fresh.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    for (const script of fresh) {
        if (script.definition) {
            if (moveScript(target, script, right, definitionsBottom)) moved++;
            definitionsBottom += script.height + GAP;
        } else {
            if (moveScript(target, script, left, eventsBottom)) moved++;
            eventsBottom += script.height + GAP;
        }
    }
    moved += separate(target, scripts);
    // Always redrawn: even with no script moved, the comments may have.
    vm.emitWorkspaceUpdate();
    return {moved};
};

/**
 * Lays every script out again: events down the left in the order they sit
 * now, custom block definitions down the right.
 * @param {object} vm the VM
 * @param {object} target the target to tidy
 * @returns {Array<object>} where each script ended up
 */
export const tidyScripts = (vm, target) => {
    placeComments(target);
    const scripts = measureScripts(target).sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const events = scripts.filter(s => !s.definition);
    const definitions = scripts.filter(s => s.definition);
    let y = 0;
    for (const script of events) {
        moveScript(target, script, 0, y);
        y += script.height + GAP;
    }
    const right = events.length ? Math.max(...events.map(s => s.width)) + COLUMN_GAP : 0;
    y = 0;
    for (const script of definitions) {
        moveScript(target, script, right, y);
        y += script.height + GAP;
    }
    vm.emitWorkspaceUpdate();
    return scripts.map(s => ({id: s.id,
        x: s.x,
        y: s.y,
        width: Math.round(s.width),
        height: Math.round(s.height),
        definition: s.definition}));
};

// --- showing it ----------------------------------------------------------------

const glowTimers = new Map();

/**
 * Scrolls the canvas to the first of these scripts and makes them all glow
 * for a moment, so whoever is watching sees what just changed.
 * @param {string[]} ids top block ids
 * @param {number} [ms] how long to glow
 */
export const showScripts = (ids, ms = 2500) => {
    if (!ids.length) return;
    const attempt = (n = 0) => {
        const workspace = workspaceHolding(ids[0]);
        if (!workspace) {
            if (n < 20) setTimeout(() => attempt(n + 1), 80);
            return;
        }
        try {
            if (workspace.centerOnBlock) workspace.centerOnBlock(ids[0]);
            for (const id of ids) {
                if (!workspace.getBlockById(id)) continue;
                workspace.glowStack(id, true);
                clearTimeout(glowTimers.get(id));
                glowTimers.set(id, setTimeout(() => {
                    try {
                        const still = workspaceHolding(id);
                        if (still) still.glowStack(id, false);
                    } catch (e) {
                        // Gone already: nothing to unglow.
                    }
                }, ms));
            }
        } catch (e) {
            // Showing is a courtesy; never let it break a write.
        }
    };
    attempt();
};
