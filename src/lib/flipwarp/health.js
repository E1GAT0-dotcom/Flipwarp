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

// --- built the Scratch way ------------------------------------------------

// The habits that make a project lag and that a person opening it in the
// editor cannot work with: menus and text redrawn with the pen every frame,
// one sprite holding the whole game, custom blocks pages long, names nobody
// can read, thousands of costumes. Found by comparing games Claude made with
// games people made, and set so that the people's games pass: each threshold
// is above anything in those.

// A loop that goes round once a frame, more or less: what a game loop is.
const LOOPS = new Set(['control_forever', 'control_repeat_until', 'control_while']);

// Blocks that wait for time to pass, which a fast custom block does not.
const WAITS = new Set(['control_wait', 'control_wait_until', 'sensing_askandwait', 'motion_glidesecstoxy',
    'motion_glideto', 'looks_sayforsecs', 'looks_thinkforsecs', 'sound_playuntildone', 'event_broadcastandwait',
    'text2speech_speakAndWait']);

// Short names that are words in their own right, or what everybody calls
// them: never worth pointing at.
const FINE_SHORT = new Set(['x', 'y', 'z', 'i', 'j', 'k', 'n', 'dx', 'dy', 'dz', 'vx', 'vy', 'vz', 'id', 'hp',
    'xp', 'fps', 'map', 'key', 'dir', 'top', 'row', 'col', 'end', 'max', 'min', 'sum', 'cam', 'gun', 'run', 'hit',
    'won', 'win', 'ui', 'job', 'day', 'age', 'ok', 'on', 'off', 'yes', 'no', 'mx', 'my', 'lvl', 'pos', 'gap',
    'ammo', 'tmp', 'idx', 'len', 'out', 'set', 'add', 'all', 'one', 'two', 'old', 'new', 'now', 'bg', 'sfx',
    'tile', 'tiles', 'score', 'speed', 'level', 'lives', 'time', 'size', 'jump', 'name']);

// Sprites and custom blocks whose names say they are the interface, not the
// world.
const LOOKS_LIKE_UI = /menu|title|button|btn|\bui\b|hud|text|label|font|glyph|intro|logo|screen|popup/i;

const procCodeOf = (target, definition) => {
    const all = blocksOf(target);
    const prototype = bodyOf(target, definition, 'custom_block');
    const mutation = prototype && all[prototype] && all[prototype].mutation;
    return mutation ? {
        code: mutation.proccode,
        warp: String(mutation.warp) === 'true',
        args: (() => {
            try {
                return JSON.parse(mutation.argumentnames || '[]');
            } catch (e) {
                return [];
            }
        })()
    } : null;
};

const shortCode = code => String(code || '').replace(/\s*%[sbn]/g, '')
    .trim();

const scratchWay = (targets, stage) => {
    const found = [];

    // -- the pen redrawn every frame. Followed from every game loop into the
    //    custom blocks it calls and the messages it sends, to the clear.
    const clearsPerFrame = new Map(); // target -> {count, ui, via}
    const definitions = new Map(); // `${target.id} ${proccode}` -> {target, top}
    const handlers = new Map(); // message -> [{target, top}]
    for (const target of targets) {
        for (const top of topBlocksOf(target)) {
            if (top.opcode === 'procedures_definition') {
                const proc = procCodeOf(target, top);
                if (proc) definitions.set(`${target.id} ${proc.code}`, {target, top, proc});
            }
            if (top.opcode === 'event_whenbroadcastreceived') {
                const message = fieldIn(top, 'BROADCAST_OPTION');
                if (message) {
                    if (!handlers.has(message)) handlers.set(message, []);
                    handlers.get(message).push({target, top});
                }
            }
        }
    }
    // Whether a block only runs sometimes (inside an if): a redraw behind
    // "if the camera moved" is not a redraw every frame. Interface drawing is
    // pointed out either way, since a menu is only ever drawn in the menu.
    const pending = [];
    // key -> whether it has only been reached behind an if so far
    const reached = new Map();
    const reach = (key, onlySometimes, visit) => {
        if (reached.has(key) && (onlySometimes || !reached.get(key))) return;
        reached.set(key, onlySometimes);
        pending.push(visit);
    };
    const note = (target, via, clear, onlySometimes) => {
        const ui = LOOKS_LIKE_UI.test(target.getName()) || Boolean(via && LOOKS_LIKE_UI.test(via));
        if (!clear && !ui) return;
        const entry = clearsPerFrame.get(target) || {count: 0, ui: false, via: new Set()};
        if (clear && !onlySometimes) entry.count++;
        if (ui) entry.ui = true;
        if (via) entry.via.add(via);
        clearsPerFrame.set(target, entry);
    };
    const visitFrame = (target, startId, via, onlySometimes) => {
        const all = blocksOf(target);
        const stack = [[startId, onlySometimes]];
        const seen = new Set();
        while (stack.length) {
            const [id, sometimes] = stack.pop();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const block = all[id];
            if (!block) continue;
            if (block.opcode === 'pen_clear') note(target, via, true, sometimes);
            if (block.opcode === 'pen_stamp') note(target, via, false, sometimes);
            if (block.opcode === 'procedures_call' && block.mutation) {
                const key = `${target.id} ${block.mutation.proccode}`;
                const definition = definitions.get(key);
                if (definition) {
                    const name = shortCode(block.mutation.proccode);
                    reach(`p ${key}`, sometimes, () => visitFrame(target, definition.top.next, name, sometimes));
                }
            }
            if (block.opcode === 'event_broadcast' || block.opcode === 'event_broadcastandwait') {
                const menu = menuIn(target, block, 'BROADCAST_INPUT');
                const message = menu && menu.chosen;
                if (message) {
                    reach(`m ${message}`, sometimes, () => {
                        for (const h of handlers.get(message) || []) {
                            visitFrame(h.target, h.top.next, message, sometimes);
                        }
                    });
                }
            }
            if (block.next) stack.push([block.next, sometimes]);
            const branches = block.opcode === 'control_if' || block.opcode === 'control_if_else';
            for (const [slot, input] of Object.entries(block.inputs || {})) {
                if (!input || !input.block) continue;
                stack.push([input.block, sometimes || (branches && /^SUBSTACK/.test(slot))]);
            }
        }
    };
    for (const target of targets) {
        for (const block of realBlocks(target)) {
            if (LOOPS.has(block.opcode)) {
                const body = bodyOf(target, block, 'SUBSTACK');
                if (body) visitFrame(target, body, null, false);
            }
        }
    }
    while (pending.length) pending.shift()();
    for (const [target, entry] of clearsPerFrame) {
        // Interface drawing is only worth pointing at when the pen is erased
        // and drawn again: one stamp of a logo is fine.
        const erased = entry.count || [...clearsPerFrame.values()].some(e => e.count);
        if (!entry.count && !(entry.ui && erased)) continue;
        const name = target.getName();
        const via = [...entry.via].slice(0, 3).map(v => `"${v}"`)
            .join(', ');
        if (entry.ui) {
            found.push(finding('warning', 'pen-ui',
                `${name} redraws menus or text with the pen every frame`,
                `The pen is erased and drawn again every frame${via ? ` (in ${via})` : ''}, and what it draws ` +
                'looks like the interface. Menus, buttons, titles and text are sprites with costumes that are ' +
                'shown and hidden, with "when this sprite clicked" for buttons: nothing is redrawn while the ' +
                'screen stands still, and the person can see and change them in the editor.',
                {sprite: name}, null));
        } else {
            found.push(finding('tidy', 'pen-every-frame',
                `${name} erases and redraws the pen every frame`,
                `${via ? `In ${via}. ` : ''}That is right for a 3D view, trails or a scrolling tile map, ` +
                'and then best only when something moved. If it draws things in the game, a sprite or clone ' +
                'for each is drawn by Scratch itself and costs much less.',
                {sprite: name}, null));
        }
    }

    // -- one sprite holding the game
    const counts = targets.map(t => ({target: t, n: realBlocks(t).length}));
    const total = counts.reduce((sum, c) => sum + c.n, 0);
    for (const {target, n} of counts) {
        if ((total >= 2000 && n / total >= 0.6) || n >= 8000) {
            found.push(finding('warning', 'one-big-sprite',
                `${target.isStage ? 'The Stage' : target.getName()} holds ${Math.round((n / total) * 100)}% ` +
                    `of the project (${n} blocks)`,
                'One sprite doing everything is hard to find your way round in the editor and hard to remix. ' +
                'Give each thing in the game its own sprite with the scripts for that thing.',
                {sprite: target.getName()}, null));
        }
    }

    for (const target of targets) {
        const name = target.getName();
        const tops = topBlocksOf(target);

        // -- custom blocks pages long, and fast ones that wait
        const long = [];
        const waiting = [];
        tops.forEach((top, index) => {
            if (top.opcode !== 'procedures_definition') return;
            const proc = procCodeOf(target, top);
            let size = 0;
            let waits = null;
            walkFrom(target, top.next, block => {
                if (!block.shadow) size++;
                if (!waits && WAITS.has(block.opcode)) waits = (spec(block.opcode) || {}).name || block.opcode;
            });
            if (size > 300) long.push({code: shortCode(proc && proc.code), size, index});
            if (proc && proc.warp && waits) waiting.push({code: shortCode(proc.code), waits, index, id: top.id});
        });
        if (long.length) {
            long.sort((a, b) => b.size - a.size);
            found.push(finding('warning', 'giant-block',
                long.length === 1 ? `"${long[0].code}" in ${name} is ${long[0].size} blocks long` :
                    `${long.length} custom blocks in ${name} are over 300 blocks long`,
                `${long.slice(0, 4).map(l => `"${l.code}" (${l.size})`)
                    .join(', ')}. A custom block longer than ` +
                'a screen is hard to read and to change; split it into smaller ones with names that say what ' +
                'each part does.',
                {sprite: name, script: long[0].index}, null));
        }
        for (const w of waiting.slice(0, 3)) {
            found.push(finding('warning', 'fast-waits',
                `"${w.code}" in ${name} runs without screen refresh and waits`,
                `It has "${w.waits}" in it. A block that runs without screen refresh does not stop for the ` +
                'screen, so waiting inside it freezes the game until it is done. Untick "Run without screen ' +
                'refresh", or do the waiting outside it.',
                {sprite: name, script: w.index}, {type: 'not-fast', target: name, block: w.id}));
        }

        // -- thousands of costumes
        const costumes = (target.getCostumes && target.getCostumes()) || [];
        if (costumes.length > 500) {
            found.push(finding('warning', 'many-costumes',
                `${name} has ${costumes.length} costumes`,
                'Every costume loads with the project and the costume tab becomes impossible to use. Draw ' +
                'what changes (rotations, frames) with fewer costumes and effects, or keep levels as backdrops.',
                {sprite: name}, null));
        }

        // -- lists stored with huge amounts in them
        for (const variable of Object.values(target.variables || {})) {
            if (variable.type !== 'list' || !Array.isArray(variable.value)) continue;
            if (variable.value.length > 200000) {
                found.push(finding('warning', 'huge-list',
                    `The list "${variable.name}" is saved with ${variable.value.length} items`,
                    'It is stored in the project file, which makes it slow to load and can take it over ' +
                    'Scratch\'s size limit. Work it out when the game starts, or keep much less.',
                    {sprite: name}, null));
            }
        }
    }

    // -- names nobody can read: variables, lists and custom block inputs.
    //    Pointed at when there are many and they are a good share of all the
    //    names: a big project always has a few.
    const cryptic = new Set();
    const named = new Set();
    for (const target of targets) {
        for (const variable of Object.values(target.variables || {})) {
            if (variable.type === 'broadcast_msg') continue;
            const n = String(variable.name).replace(/^☁\s*/, '');
            named.add(n);
            if (n.length <= 3 && !FINE_SHORT.has(n.toLowerCase())) cryptic.add(n);
        }
        for (const {proc} of [...definitions.values()].filter(d => d.target === target)) {
            for (const arg of proc.args) {
                named.add(String(arg));
                if (String(arg).length <= 2 && !FINE_SHORT.has(String(arg).toLowerCase())) cryptic.add(arg);
            }
        }
    }
    if (cryptic.size >= 10 && cryptic.size / Math.max(1, named.size) >= 0.2) {
        found.push(finding('tidy', 'short-names',
            `${cryptic.size} names are too short to read`,
            `${[...cryptic].slice(0, 12).map(n => `"${n}"`)
                .join(', ')}${cryptic.size > 12 ? '...' : ''}. ` +
            'A person opening the project cannot tell what these are. Name them for what they hold ' +
            '(playerSpeed, jumpPower), custom block inputs too.',
            {sprite: stage ? stage.getName() : ''}, null));
    }

    return found;
};

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

    // -- built the Scratch way
    found.push(...scratchWay(targets, stage));

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
            } else if (fix.type === 'not-fast' && fix.block) {
                // Untick "run without screen refresh": on the definition and
                // on every call of it, which carry a copy of the setting.
                const all = blocksOf(target);
                const definition = all[fix.block];
                const prototype = definition && all[bodyOf(target, definition, 'custom_block')];
                if (!prototype || !prototype.mutation) {
                    skipped++;
                    continue;
                }
                prototype.mutation.warp = 'false';
                for (const block of Object.values(all)) {
                    if (block && block.opcode === 'procedures_call' && block.mutation &&
                        block.mutation.proccode === prototype.mutation.proccode) block.mutation.warp = 'false';
                }
                target.blocks.resetCache();
                done++;
                continue;
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
