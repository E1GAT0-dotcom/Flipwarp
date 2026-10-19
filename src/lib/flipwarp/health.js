// The project health check: everything in the project that is probably wrong,
// found by reading the blocks rather than the text.
//
// Reading the blocks matters. The text form is the nicer thing to search, but
// it refuses to write a sprite that uses an extension block, and a health
// check that goes quiet on exactly the projects most likely to have something
// wrong with them is worse than none. The blocks are always there.
//
// Three grades of finding, because they are not the same kind of news:
//
//   problem  something cannot work. A stack with no hat on it never runs; a
//            broadcast nobody listens for does nothing.
//   warning  something probably is not what was meant. A variable nobody ever
//            reads, a custom block nobody calls.
//   tidy     it works, it is just carrying weight. A costume never shown.
//
// Some findings can be acted on and some can only be pointed at. A costume
// nobody uses can be deleted; a sprite with no scripts in it cannot be
// repaired by anything this could do automatically, so it is only reported.
//
// Every check is written to stay quiet when it cannot be sure. The costume
// check gives up on any sprite that ever switches costume by a variable,
// because from here there is no telling which costume that turns out to be,
// and a tidy-up that deletes a costume the project uses is the worst thing
// this could possibly do.

import {BLOCKS} from './phrasebook.js';

// --- reading the project --------------------------------------------------

const blocksOf = target => (target && target.blocks && target.blocks._blocks) || {};

const realBlocks = target => Object.values(blocksOf(target)).filter(b => b && !b.shadow);

// Scripts in the order the rest of Flipwarp counts them, so that a finding can
// say "script 3 of the Cat" and the workspace scrolls to the same script the
// find tool would.
const topBlocksOf = target => Object.values(blocksOf(target))
    .filter(b => b && b.topLevel && !b.shadow)
    .sort((a, b) => ((a.y || 0) - (b.y || 0)) ||
        ((a.x || 0) - (b.x || 0)) ||
        String(a.id).localeCompare(String(b.id)));

// Which script a block sits in. Walking up by parent rather than searching
// every script for it, because a parent chain is short and a project is not.
const scriptIndexOf = (target, blockId, tops) => {
    const all = blocksOf(target);
    let at = all[blockId];
    const seen = new Set();
    while (at && at.parent && !seen.has(at.id)) {
        seen.add(at.id);
        at = all[at.parent];
    }
    if (!at) return -1;
    return tops.findIndex(t => t.id === at.id);
};

const spec = opcode => BLOCKS[opcode] || null;

// Whether the runtime can actually carry out a block. Custom blocks and their
// arguments are made by the project rather than registered anywhere, so they
// are named here instead of being looked up.
const isKnownBlock = (runtime, opcode) => {
    if (/^(procedures_|argument_reporter)/.test(opcode)) return true;
    if (BLOCKS[opcode]) return true;
    try {
        if (runtime._primitives && runtime._primitives[opcode]) return true;
        if (runtime._hats && runtime._hats[opcode]) return true;
        if (runtime._blockInfo && runtime._blockInfo.some &&
            runtime._blockInfo.some(ext => (ext.blocks || []).some(b =>
                b && b.info && `${ext.id}_${b.info.opcode}` === opcode))) return true;
    } catch (e) {
        // A runtime shaped differently from the one expected is not evidence
        // that the block is broken, so say nothing.
        return true;
    }
    return false;
};

const isHat = (runtime, opcode) => {
    if (opcode === 'procedures_definition') return true;
    const known = spec(opcode);
    if (known) return known.kind === 'hat';
    try {
        return Boolean(runtime && runtime.getIsHat && runtime.getIsHat(opcode));
    } catch (e) {
        return false;
    }
};

// A block that ends the script it is in. "stop" is only one of these when it
// is set to stop this script or stop everything; set to stop other scripts it
// carries straight on, which is why the phrasebook marks it separately.
const endsTheScript = block => {
    const known = spec(block.opcode);
    if (!known) return false;
    if (known.terminal) return true;
    if (known.dynamicTerminal) {
        const choice = block.fields && block.fields.STOP_OPTION &&
            block.fields.STOP_OPTION.value;
        return choice === 'all' || choice === 'this script';
    }
    return false;
};

// Everything under a block: the blocks after it and the blocks inside it.
const walkFrom = (target, startId, visit) => {
    const all = blocksOf(target);
    const pending = [startId];
    const seen = new Set();
    while (pending.length) {
        const id = pending.pop();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const block = all[id];
        if (!block) continue;
        visit(block);
        if (block.next) pending.push(block.next);
        for (const input of Object.values(block.inputs || {})) {
            if (input && input.block) pending.push(input.block);
        }
    }
};

const bodyOf = (target, block, name) => {
    const input = block.inputs && block.inputs[name];
    return input && input.block ? input.block : null;
};

// The value actually written into an input, when it is a typed-in number or
// word rather than another block. Null when a block was dropped in, because
// then there is no knowing the value from here.
const literalIn = (target, block, name) => {
    const all = blocksOf(target);
    const input = block.inputs && block.inputs[name];
    if (!input) return null;
    const holder = all[input.shadow] || all[input.block];
    if (!holder || !holder.fields) return null;
    if (input.block && input.block !== input.shadow) return null;
    const field = Object.values(holder.fields)[0];
    return field ? field.value : null;
};

const fieldIn = (block, name) => (block.fields && block.fields[name] ?
    block.fields[name].value : null);

// A menu that sits inside a block as its own little block: "switch costume to
// [costume1]". Reading it means following the input to the menu block.
const menuIn = (target, block, name) => {
    const all = blocksOf(target);
    const input = block.inputs && block.inputs[name];
    if (!input) return null;
    const holder = all[input.block] || all[input.shadow];
    if (!holder) return null;
    // A real block dropped where the menu goes: a variable, usually. The
    // value is not knowable from here, and saying so is the point.
    if (holder.opcode && !/_menu(_|$)/.test(holder.opcode) &&
        !/^(looks|sound|motion|control|sensing|event)_.*menu/.test(holder.opcode)) {
        return {chosen: null, computed: true};
    }
    const field = holder.fields && Object.values(holder.fields)[0];
    return {chosen: field ? field.value : null, computed: false};
};

// --- the checks -----------------------------------------------------------

let counter = 0;
const finding = (grade, kind, title, detail, where, fix) => ({
    id: `h${++counter}`,
    grade,
    kind,
    title,
    detail,
    sprite: where.sprite,
    script: typeof where.script === 'number' ? where.script : -1,
    fix: fix || null
});

/**
 * Everything worth saying about the state of this project.
 * @param {VirtualMachine} vm the running VM
 * @returns {Array<object>} the findings, worst first
 */
export const checkProject = vm => {
    counter = 0;
    const runtime = vm && vm.runtime;
    const targets = ((runtime && runtime.targets) || [])
        .filter(t => !t.isSprite || t.isOriginal);
    const stage = targets.find(t => t.isStage);
    const found = [];

    // Gathered across the whole project first, because several checks are
    // about two ends that live in different sprites: a broadcast sent here
    // and listened for over there.
    const broadcastsSent = new Map();
    const broadcastsHeard = new Map();
    const clonesMade = new Map();
    const clonesHandled = new Set();
    const variableUses = new Map();
    const unknownOpcodes = [];

    for (const target of targets) {
        const name = target.getName();
        const tops = topBlocksOf(target);
        for (const block of realBlocks(target)) {
            const at = {sprite: name, script: scriptIndexOf(target, block.id, tops)};

            if (block.opcode === 'event_broadcast' || block.opcode === 'event_broadcastandwait') {
                const menu = menuIn(target, block, 'BROADCAST_INPUT');
                if (menu && menu.chosen) {
                    if (!broadcastsSent.has(menu.chosen)) broadcastsSent.set(menu.chosen, []);
                    broadcastsSent.get(menu.chosen).push(at);
                }
            }
            if (block.opcode === 'event_whenbroadcastreceived') {
                const heard = fieldIn(block, 'BROADCAST_OPTION');
                if (heard) {
                    if (!broadcastsHeard.has(heard)) broadcastsHeard.set(heard, []);
                    broadcastsHeard.get(heard).push(at);
                }
            }
            if (block.opcode === 'control_create_clone_of') {
                const menu = menuIn(target, block, 'CLONE_OPTION');
                if (menu && menu.chosen) {
                    const who = menu.chosen === '_myself_' ? name : menu.chosen;
                    if (!clonesMade.has(who)) clonesMade.set(who, []);
                    clonesMade.get(who).push(at);
                }
            }
            if (block.opcode === 'control_start_as_clone') clonesHandled.add(name);

            for (const field of Object.values(block.fields || {})) {
                if (field && field.id) {
                    if (!variableUses.has(field.id)) variableUses.set(field.id, new Set());
                    variableUses.get(field.id).add(name);
                }
            }

            // A block the runtime has never heard of comes from an extension
            // the project has not loaded. It shows as a grey shape and does
            // nothing. Asked of the runtime rather than of the phrasebook,
            // because the phrasebook only knows the blocks that convert to
            // text and plenty of working blocks do not.
            if (runtime && !isKnownBlock(runtime, block.opcode)) {
                unknownOpcodes.push({opcode: block.opcode, at});
            }
        }
    }

    for (const target of targets) {
        const name = target.getName();
        const tops = topBlocksOf(target);
        const all = blocksOf(target);

        // -- a sprite with nothing in it at all
        if (!target.isStage && !tops.length) {
            found.push(finding('tidy', 'empty-sprite',
                `${name} has no scripts`,
                'It is in the project and it does nothing. Delete it yourself if it is left over.',
                {sprite: name}, null));
        }

        for (let index = 0; index < tops.length; index++) {
            const top = tops[index];
            const at = {sprite: name, script: index};
            const known = spec(top.opcode);

            // -- a stack with no hat on it
            if (!isHat(runtime, top.opcode)) {
                const isStack = Boolean(top.next) ||
                    (known && (known.kind === 'statement' || known.kind === 'c' ||
                        known.kind === 'terminal'));
                if (isStack) {
                    found.push(finding('problem', 'loose-script',
                        `A script in ${name} never runs`,
                        'It has no hat block on top, so nothing ever starts it. ' +
                        'Put a hat on it, or delete it.',
                        at, {type: 'delete-script', target: name, block: top.id}));
                }
            }

            // -- an empty custom block
            if (top.opcode === 'procedures_definition' && !top.next) {
                found.push(finding('warning', 'empty-definition',
                    `A custom block in ${name} is empty`,
                    'It is defined but there is nothing inside it, so calling it does nothing.',
                    at, {type: 'delete-script', target: name, block: top.id}));
            }

            // -- everything after a block that ends the script
            walkFrom(target, top.id, block => {
                if (endsTheScript(block) && block.next) {
                    found.push(finding('problem', 'unreachable',
                        `Blocks in ${name} can never be reached`,
                        `Everything after "${(spec(block.opcode) || {}).name || block.opcode}" ` +
                        'is below a block that ends the script, so it never runs.',
                        at, {type: 'delete-after', target: name, block: block.id}));
                }
                const shape = spec(block.opcode);
                if (shape && shape.substack) {
                    for (const slot of shape.substack) {
                        if (!bodyOf(target, block, slot)) {
                            found.push(finding('warning', 'empty-body',
                                `An empty "${shape.name}" in ${name}`,
                                'There is nothing inside it, so it does nothing at all.',
                                at, {type: 'delete-block', target: name, block: block.id}));
                            break;
                        }
                    }
                }
                if (block.opcode === 'control_repeat') {
                    const times = literalIn(target, block, 'TIMES');
                    if (times !== null && Number(times) === 0) {
                        found.push(finding('warning', 'repeat-zero',
                            `A "repeat 0" in ${name}`,
                            'Repeating nought times means the blocks inside never run.',
                            at, null));
                    }
                }
            });
        }

        // -- a custom block set to run without screen refresh, with a loop
        //    inside it that never ends. This is the one that hangs the editor.
        for (let index = 0; index < tops.length; index++) {
            const top = tops[index];
            if (top.opcode !== 'procedures_definition') continue;
            const prototype = bodyOf(target, top, 'custom_block');
            const mutation = prototype && all[prototype] && all[prototype].mutation;
            const warping = mutation && String(mutation.warp) === 'true';
            if (!warping || !top.next) continue;
            let endless = false;
            walkFrom(target, top.next, block => {
                if (block.opcode === 'control_forever') endless = true;
            });
            if (endless) {
                found.push(finding('problem', 'warp-forever',
                    `A custom block in ${name} will freeze the project`,
                    'It is set to run without screen refresh and it contains a forever loop, ' +
                    'so once it starts nothing else ever gets a turn. Untick ' +
                    '"Run without screen refresh", or take the forever out.',
                    {sprite: name, script: index}, null));
            }
        }

        // -- custom blocks nobody calls
        const called = new Set();
        for (const block of realBlocks(target)) {
            if (block.opcode === 'procedures_call' && block.mutation) {
                called.add(block.mutation.proccode);
            }
        }
        for (let index = 0; index < tops.length; index++) {
            const top = tops[index];
            if (top.opcode !== 'procedures_definition') continue;
            const prototype = bodyOf(target, top, 'custom_block');
            const mutation = prototype && all[prototype] && all[prototype].mutation;
            const proccode = mutation && mutation.proccode;
            if (!proccode || called.has(proccode)) continue;
            found.push(finding('warning', 'unused-definition',
                `"${proccode.replace(/%[sbn]/g, '( )')}" in ${name} is never used`,
                'The block is defined but nothing ever calls it.',
                {sprite: name, script: index},
                {type: 'delete-script', target: name, block: top.id}));
        }

        // -- variables and lists
        for (const variable of Object.values(target.variables || {})) {
            if (variable.type === 'broadcast_msg') continue;
            const users = variableUses.get(variable.id);
            const what = variable.type === 'list' ? 'list' : 'variable';
            const where = target.isStage ? 'for all sprites' : `in ${name}`;
            if (!users || !users.size) {
                found.push(finding('warning', 'unused-variable',
                    `The ${what} "${variable.name}" is never used`,
                    `It is made ${where} and no block ever reads it or changes it.`,
                    {sprite: name},
                    {type: 'delete-variable', target: name, variable: variable.id}));
            } else if (target.isStage && users.size === 1 && !users.has(name) && !variable.isCloud) {
                // A cloud variable has to stay on the Stage: made for one
                // sprite it would stop being shared, so it is never suggested.
                const only = [...users][0];
                found.push(finding('tidy', 'global-used-once',
                    `The ${what} "${variable.name}" could belong to ${only}`,
                    `It is made for all sprites but only ${only} ever touches it. ` +
                    'Making it for this sprite only keeps it out of everybody else\'s way.',
                    {sprite: only}, null));
            }
            // A sprite variable with the same name as one for all sprites is
            // legal and reads as a single thing that it is not.
            if (!target.isStage && stage && Object.values(stage.variables || {})
                .some(v => v.name === variable.name && v.type === variable.type)) {
                found.push(finding('warning', 'shadowed-name',
                    `Two things are called "${variable.name}"`,
                    `${name} has its own ${what} with the same name as one made for all ` +
                    'sprites. Blocks in this sprite use its own, which is easy to misread.',
                    {sprite: name}, null));
            }
        }

        // -- costumes and sounds nobody asks for
        if (!target.isStage) {
            const switching = realBlocks(target).filter(b =>
                b.opcode === 'looks_switchcostumeto');
            const byVariable = switching.some(b => {
                const menu = menuIn(target, b, 'COSTUME');
                return menu && menu.computed;
            });
            // "next costume" reaches every costume eventually, so nothing is
            // unused once it is in the project.
            const cycling = realBlocks(target).some(b => b.opcode === 'looks_nextcostume');
            if (!byVariable && !cycling) {
                const named = new Set(switching
                    .map(b => (menuIn(target, b, 'COSTUME') || {}).chosen)
                    .filter(Boolean));
                (target.getCostumes() || []).forEach((costume, index) => {
                    if (index === target.currentCostume || named.has(costume.name)) return;
                    found.push(finding('tidy', 'unused-costume',
                        `${name} never wears "${costume.name}"`,
                        'No block switches to it and it is not the costume the sprite starts in.',
                        {sprite: name},
                        {type: 'delete-costume', target: name, costume: costume.name}));
                });
            }
        }

        const playing = realBlocks(target).filter(b =>
            b.opcode === 'sound_play' || b.opcode === 'sound_playuntildone');
        const soundByVariable = playing.some(b => {
            const menu = menuIn(target, b, 'SOUND_MENU');
            return menu && menu.computed;
        });
        if (!soundByVariable) {
            const played = new Set(playing
                .map(b => (menuIn(target, b, 'SOUND_MENU') || {}).chosen)
                .filter(Boolean));
            (target.getSounds() || []).forEach(sound => {
                if (played.has(sound.name)) return;
                found.push(finding('tidy', 'unused-sound',
                    `${name} never plays "${sound.name}"`,
                    'The sound is in the project and no block plays it.',
                    {sprite: name},
                    {type: 'delete-sound', target: name, sound: sound.name}));
            });
        }

        // -- costumes heavy enough to be worth knowing about
        for (const costume of target.getCostumes() || []) {
            const size = costume.asset && costume.asset.data && costume.asset.data.length;
            if (size && size > 1024 * 1024) {
                found.push(finding('tidy', 'big-costume',
                    `"${costume.name}" in ${name} is ${Math.round(size / 1024 / 102.4) / 10} MB`,
                    'A costume this size makes the project slow to load. ' +
                    'Shrinking the picture before bringing it in usually costs nothing to look at.',
                    {sprite: name}, null));
            }
        }
    }

    // -- the two ends of a broadcast
    for (const [message, sent] of broadcastsSent) {
        if (broadcastsHeard.has(message)) continue;
        found.push(finding('problem', 'broadcast-unheard',
            `Nothing listens for "${message}"`,
            'The message is sent and no script starts when it arrives, so sending it does nothing.',
            sent[0], null));
    }
    for (const [message, heard] of broadcastsHeard) {
        if (broadcastsSent.has(message)) continue;
        found.push(finding('problem', 'broadcast-unsent',
            `"${message}" is never sent`,
            'A script waits for this message and nothing ever broadcasts it, so it never runs.',
            heard[0], {type: 'delete-script', target: heard[0].sprite, block: null}));
    }

    // -- clones nobody catches
    for (const [who, made] of clonesMade) {
        if (clonesHandled.has(who)) continue;
        found.push(finding('warning', 'clone-unhandled',
            `Clones of ${who} do nothing`,
            `${who} is cloned and has no "when I start as a clone" script, ` +
            'so every clone just sits there.',
            made[0], null));
    }

    // -- blocks from an extension that is not loaded
    const seenUnknown = new Set();
    for (const {opcode, at} of unknownOpcodes) {
        if (seenUnknown.has(opcode)) continue;
        seenUnknown.add(opcode);
        found.push(finding('problem', 'unknown-block',
            `${at.sprite} uses a block this project does not have`,
            `"${opcode}" belongs to an extension that is not loaded. ` +
            'Load the extension, or the block does nothing.',
            at, null));
    }

    const order = {problem: 0, warning: 1, tidy: 2};
    return found.sort((a, b) => (order[a.grade] - order[b.grade]) ||
        a.kind.localeCompare(b.kind) ||
        String(a.sprite).localeCompare(String(b.sprite)));
};

// --- doing something about it ---------------------------------------------

const targetNamed = (vm, name) => vm.runtime.targets.find(t =>
    t.getName() === name && (!t.isSprite || t.isOriginal));

// Everything joined below a block, so that deleting a script deletes the whole
// script and not only the block on top of it.
const chainFrom = (target, startId) => {
    const all = blocksOf(target);
    const ids = [];
    let at = all[startId];
    while (at) {
        ids.push(at.id);
        at = at.next ? all[at.next] : null;
    }
    return ids;
};

/**
 * Carry out the fixes that were ticked.
 * @param {VirtualMachine} vm the running VM
 * @param {Array<object>} findings the ones to act on
 * @returns {{done: number, skipped: number}} what happened
 */
export const applyFixes = (vm, findings) => {
    let done = 0;
    let skipped = 0;
    for (const item of findings) {
        const fix = item && item.fix;
        if (!fix) {
            skipped++;
            continue;
        }
        const target = targetNamed(vm, fix.target);
        if (!target) {
            skipped++;
            continue;
        }
        try {
            if (fix.type === 'delete-variable') {
                target.deleteVariable(fix.variable);
            } else if (fix.type === 'delete-costume') {
                const index = (target.getCostumes() || [])
                    .findIndex(c => c.name === fix.costume);
                // A sprite must keep a costume; Scratch's own delete refuses
                // the last one, and so does this rather than leaving a sprite
                // that cannot be drawn.
                if (index < 0 || target.getCostumes().length < 2) skipped++;
                else {
                    target.deleteCostume(index);
                    done++;
                    continue;
                }
            } else if (fix.type === 'delete-sound') {
                const index = (target.getSounds() || []).findIndex(s => s.name === fix.sound);
                if (index < 0) skipped++;
                else {
                    target.deleteSound(index);
                    done++;
                    continue;
                }
            } else if (fix.type === 'delete-script' && fix.block) {
                for (const id of chainFrom(target, fix.block)) target.blocks.deleteBlock(id);
            } else if (fix.type === 'delete-after' && fix.block) {
                const block = blocksOf(target)[fix.block];
                if (!block || !block.next) skipped++;
                else {
                    const after = chainFrom(target, block.next);
                    block.next = null;
                    for (const id of after) target.blocks.deleteBlock(id);
                    done++;
                    continue;
                }
            } else if (fix.type === 'delete-block' && fix.block) {
                target.blocks.deleteBlock(fix.block);
            } else {
                skipped++;
                continue;
            }
            if (fix.type === 'delete-variable' || fix.type === 'delete-script' ||
                fix.type === 'delete-block') done++;
        } catch (e) {
            skipped++;
        }
    }
    if (done) {
        vm.emitWorkspaceUpdate();
        vm.runtime.emitProjectChanged();
        vm.runtime.requestToolboxExtensionsUpdate();
    }
    return {done, skipped};
};

export const GRADE_LABEL = {
    problem: 'Problems',
    warning: 'Worth a look',
    tidy: 'Tidying'
};
