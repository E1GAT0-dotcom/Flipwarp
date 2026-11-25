/* eslint-disable no-use-before-define */
// The Web Lab exporter: the shared description of a project (front.js) written
// out as JavaScript that scratch-runtime.js runs. One generator function per
// script, one per custom block, in the order Scratch has them, with the
// sprite's name, the hat and the custom block's own words in comments, so a
// person can find their way from the blocks to the code.

const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends ' +
    'finally for function if import in instanceof new return super switch this throw try typeof var void while ' +
    'with yield let static enum await implements package protected interface private public null true false ' +
    'undefined NaN Infinity arguments eval').split(' '));
// Names the generated code itself uses.
const TAKEN = new Set(['S', 'G', 'L', 'game', 'stage', 'me', 'warp', 'Math', 'String', 'Number', 'Object', 'Array',
    'JSON', 'console', 'ScratchGame', 'ScratchRules', 'document', 'window', 'location']);

const isIdentifier = name => /^[A-Za-z_$][\w$]*$/.test(name) && !KEYWORDS.has(name);

/** A property access that reads well: obj.name, or obj["two words"]. */
const prop = (object, name) => (isIdentifier(name) ? `${object}.${name}` : `${object}[${JSON.stringify(name)}]`);

const words = text => String(text).replace(/%[snb]/g, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
const camel = text => {
    const parts = words(text);
    if (!parts.length) return '';
    return parts.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) :
        w.charAt(0).toUpperCase() + w.slice(1))).join('');
};

const makeNamer = () => {
    const used = new Set([...KEYWORDS, ...TAKEN]);
    return base => {
        let name = String(base).replace(/[^A-Za-z0-9_$]/g, '_')
            .replace(/^(\d)/, '_$1') || 'thing';
        if (used.has(name)) {
            let n = 2;
            while (used.has(`${name}${n}`)) n++;
            name = `${name}${n}`;
        }
        used.add(name);
        return name;
    };
};

const MENU_TARGETS = {_mouse_: 'the mouse-pointer', _random_: 'a random position', _edge_: 'the edge'};

/**
 * Write game.js.
 * @param {object} project from readProject
 * @param {object} files costume and sound md5ext -> the file name in the export
 * @param {string} title the project's name
 * @returns {{code: string, notes: Array}} the code and what could not be exported
 */
export const writeWebGame = (project, files, title) => {
    const notes = [...project.notes];
    const note = (where, what) => {
        if (!notes.some(n => n.where === where && n.what === what)) notes.push({where, what});
    };
    const name = makeNamer();
    const out = [];
    const emit = line => out.push(line);

    // Constants for each sprite, and for each custom block a function.
    const spriteVar = new Map();
    for (const t of project.targets) spriteVar.set(t, t.isStage ? 'stage' : name(t.name));

    // Variables that have a readout, or are shown and hidden by blocks.
    const monitorIds = new Set(project.monitors.map(m => m.id));
    const needMonitor = new Map();

    const literal = value => {
        if (typeof value === 'number') {
            if (Object.is(value, -0)) return '-0';
            return value < 0 ? `(${value})` : String(value);
        }
        if (typeof value === 'boolean') return String(value);
        return JSON.stringify(String(value));
    };

    const genTarget = target => {
        const where = target.isStage ? 'Stage' : target.name;
        const procs = new Map();
        for (const proc of target.procedures) {
            const base = `${target.isStage ? 'stage' : spriteVar.get(target)}_${camel(proc.proccode) || 'block'}`;
            procs.set(proc.proccode, {...proc, fn: name(base), params: proc.argNames.map(() => null)});
        }

        const varRef = v => {
            if (v.missing) note(where, `the variable "${v.name}" is used but not made anywhere; it starts at 0`);
            if (v.list) return v.global ? prop('L', v.name) : prop('me.lists', v.name);
            return v.global ? prop('G', v.name) : prop('me.vars', v.name);
        };

        // An expression: its code and what kind of value it surely is.
        const expr = (e, args) => {
            if (!e) return {code: '""', type: 'str', lit: ''};
            switch (e.kind) {
            case 'lit':
                return {code: literal(e.value),
                    type: typeof e.value === 'number' ? 'num' :
                        typeof e.value === 'boolean' ? 'bool' : 'str',
                    lit: e.value};
            case 'var':
                return {code: varRef(e), type: 'any'};
            case 'list':
                return {code: varRef(e), type: 'list'};
            case 'listContents':
                return {code: `S.listContents(${varRef({...e, list: true})})`, type: 'str'};
            case 'arg': {
                const param = args && args.get(e.name);
                if (!param) return e.boolean ? {code: 'false', type: 'bool'} : {code: '0', type: 'num'};
                return {code: param, type: e.boolean ? 'any' : 'any'};
            }
            case 'block':
                return reporter(e, args);
            }
            return {code: '0', type: 'num'};
        };
        const num = (e, args) => {
            const x = expr(e, args);
            if (x.type === 'num') return x.code;
            if (x.lit !== undefined) {
                const n = Number(x.lit);
                return literal(Number.isNaN(n) ? 0 : n);
            }
            return `S.num(${x.code})`;
        };
        const bool = (e, args) => {
            if (!e) return 'false';
            const x = expr(e, args);
            if (x.type === 'bool') return x.code;
            if (x.lit !== undefined) {
                const v = x.lit;
                return String(typeof v === 'string' ? !(v === '' || v === '0' || v.toLowerCase() === 'false') : !!v);
            }
            return `S.bool(${x.code})`;
        };
        const raw = (e, args) => expr(e, args).code;
        const field = (node, key) => (node.fields || {})[key];
        const input = (node, key) => (node.inputs || {})[key];

        const reporter = (node, args) => {
            const i = key => input(node, key);
            const n = key => num(i(key), args);
            const r = key => raw(i(key), args);
            const b = key => bool(i(key), args);
            const N = code => ({code, type: 'num'});
            const B = code => ({code, type: 'bool'});
            const T = code => ({code, type: 'str'});
            const A = code => ({code, type: 'any'});
            switch (node.op) {
            // motion
            case 'motion_xposition': return N('me.xPosition');
            case 'motion_yposition': return N('me.yPosition');
            case 'motion_direction': return N('me.direction');
            // looks
            case 'looks_costumenumbername':
                return field(node, 'NUMBER_NAME') === 'name' ? T('me.costumeName') : N('me.costumeNumber');
            case 'looks_backdropnumbername':
                return field(node, 'NUMBER_NAME') === 'name' ? T('game.backdropName') : N('game.backdropNumber');
            case 'looks_size': return N('me.size');
            // sound
            case 'sound_volume': return N('me.volume');
            // sensing
            case 'sensing_touchingobject': return B(`me.touching(${r('TOUCHINGOBJECTMENU')})`);
            case 'sensing_touchingcolor': return B(`me.touchingColor(${r('COLOR')})`);
            case 'sensing_coloristouchingcolor':
                note(where, '"color is touching color" is not exported; it is always false');
                return B('false');
            case 'sensing_distanceto': return N(`me.distanceTo(${r('DISTANCETOMENU')})`);
            case 'sensing_answer': return A('game.answer');
            case 'sensing_keypressed': return B(`game.keyPressed(${r('KEY_OPTION')})`);
            case 'sensing_mousedown': return B('game.mouseDown');
            case 'sensing_mousex': return N('game.mouseX');
            case 'sensing_mousey': return N('game.mouseY');
            case 'sensing_loudness':
                note(where, 'loudness needs a microphone, which the export does not use; it is always -1');
                return N('game.loudness');
            case 'sensing_timer': return N('game.timer');
            case 'sensing_of':
                return A(`game.propertyOf(${literal(field(node, 'PROPERTY'))}, ${r('OBJECT')})`);
            case 'sensing_current': return N(`game.current(${literal(field(node, 'CURRENTMENU'))})`);
            case 'sensing_dayssince2000': return N('game.daysSince2000()');
            case 'sensing_username': return T('game.username');
            // operators
            case 'operator_add': return N(`(${n('NUM1')} + ${n('NUM2')})`);
            case 'operator_subtract': return N(`(${n('NUM1')} - ${n('NUM2')})`);
            case 'operator_multiply': return N(`(${n('NUM1')} * ${n('NUM2')})`);
            case 'operator_divide': return N(`(${n('NUM1')} / ${n('NUM2')})`);
            case 'operator_random': return N(`S.random(${r('FROM')}, ${r('TO')})`);
            case 'operator_gt':
            case 'operator_lt':
            case 'operator_equals': {
                const a = expr(i('OPERAND1'), args);
                const c = expr(i('OPERAND2'), args);
                const op = {operator_gt: '>', operator_lt: '<', operator_equals: '==='}[node.op];
                if (a.type === 'num' && c.type === 'num') return B(`(${a.code} ${op} ${c.code})`);
                const fn = {operator_gt: 'gt', operator_lt: 'lt', operator_equals: 'eq'}[node.op];
                return B(`S.${fn}(${a.code}, ${c.code})`);
            }
            case 'operator_and': return B(`(${b('OPERAND1')} && ${b('OPERAND2')})`);
            case 'operator_or': return B(`(${b('OPERAND1')} || ${b('OPERAND2')})`);
            case 'operator_not': return B(`!${b('OPERAND')}`);
            case 'operator_join': return T(`S.join(${r('STRING1')}, ${r('STRING2')})`);
            case 'operator_letter_of': return T(`S.letterOf(${r('LETTER')}, ${r('STRING')})`);
            case 'operator_length': return N(`S.lengthOf(${r('STRING')})`);
            case 'operator_contains': return B(`S.contains(${r('STRING1')}, ${r('STRING2')})`);
            case 'operator_mod': return N(`S.mod(${n('NUM1')}, ${n('NUM2')})`);
            case 'operator_round': return N(`Math.round(${n('NUM')})`);
            case 'operator_mathop': {
                const op = String(field(node, 'OPERATOR'));
                const simple = {abs: 'Math.abs', floor: 'Math.floor', ceiling: 'Math.ceil', sqrt: 'Math.sqrt'}[op];
                return N(simple ? `${simple}(${n('NUM')})` : `S.mathop(${literal(op)}, ${n('NUM')})`);
            }
            // data
            case 'data_itemoflist': return A(`S.listItem(${varRef(field(node, 'LIST'))}, ${r('INDEX')})`);
            case 'data_itemnumoflist': return N(`S.listIndexOf(${varRef(field(node, 'LIST'))}, ${r('ITEM')})`);
            case 'data_lengthoflist': return N(`${varRef(field(node, 'LIST'))}.length`);
            case 'data_listcontainsitem': return B(`S.listContains(${varRef(field(node, 'LIST'))}, ${r('ITEM')})`);
            // the TurboWarp counter
            case 'control_get_counter': return N('game.counter');
            }
            note(where, `the reporter "${node.op}" is not exported; it gives 0`);
            return {code: `0 /* ${node.op} not exported */`, type: 'num'};
        };

        let loopDepth = 0;
        const block = (list, indent, args) => {
            const lines = [];
            for (const node of list) statement(node, indent, args, lines);
            return lines;
        };
        const statement = (node, indent, args, lines) => {
            const pad = '    '.repeat(indent);
            const push = line => lines.push(pad + line);
            const i = key => input(node, key);
            const n = key => num(i(key), args);
            const r = key => raw(i(key), args);
            const b = key => bool(i(key), args);
            const body = (key, extra) => {
                const inner = block(node.branches[key] || [], indent + 1, args);
                if (extra) inner.push(`${pad}    ${extra}`);
                return inner;
            };
            const loopYield = 'if (!warp) yield;';
            switch (node.op) {
            // motion
            case 'motion_movesteps': push(`me.moveSteps(${n('STEPS')});`); return;
            case 'motion_turnright': push(`me.turnRight(${n('DEGREES')});`); return;
            case 'motion_turnleft': push(`me.turnLeft(${n('DEGREES')});`); return;
            case 'motion_goto': push(`me.goToTarget(${r('TO')});`); return;
            case 'motion_gotoxy': push(`me.goTo(${n('X')}, ${n('Y')});`); return;
            case 'motion_glideto': push(`yield* me.glideToTarget(${n('SECS')}, ${r('TO')});`); return;
            case 'motion_glidesecstoxy': push(`yield* me.glideTo(${n('SECS')}, ${n('X')}, ${n('Y')});`); return;
            case 'motion_pointindirection': push(`me.setDirection(${n('DIRECTION')});`); return;
            case 'motion_pointtowards': push(`me.pointTowards(${r('TOWARDS')});`); return;
            case 'motion_changexby': push(`me.changeX(${n('DX')});`); return;
            case 'motion_setx': push(`me.setX(${n('X')});`); return;
            case 'motion_changeyby': push(`me.changeY(${n('DY')});`); return;
            case 'motion_sety': push(`me.setY(${n('Y')});`); return;
            case 'motion_ifonedgebounce': push('me.bounceOnEdge();'); return;
            case 'motion_setrotationstyle': push(`me.setRotationStyle(${literal(field(node, 'STYLE'))});`); return;
            // looks
            case 'looks_sayforsecs': push(`yield* me.sayFor(${r('MESSAGE')}, ${n('SECS')});`); return;
            case 'looks_say': push(`me.say(${r('MESSAGE')});`); return;
            case 'looks_thinkforsecs': push(`yield* me.thinkFor(${r('MESSAGE')}, ${n('SECS')});`); return;
            case 'looks_think': push(`me.think(${r('MESSAGE')});`); return;
            case 'looks_switchcostumeto': push(`me.switchCostume(${r('COSTUME')});`); return;
            case 'looks_nextcostume': push('me.nextCostume();'); return;
            case 'looks_switchbackdropto': push(`game.switchBackdrop(${r('BACKDROP')});`); return;
            case 'looks_switchbackdroptoandwait': push(`yield* game.switchBackdropAndWait(${r('BACKDROP')});`); return;
            case 'looks_nextbackdrop': push('game.switchBackdrop("next backdrop");'); return;
            case 'looks_changesizeby': push(`me.changeSize(${n('CHANGE')});`); return;
            case 'looks_setsizeto': push(`me.setSize(${n('SIZE')});`); return;
            case 'looks_changeeffectby':
            case 'looks_seteffectto': {
                const effect = String(field(node, 'EFFECT')).toLowerCase();
                if (!['ghost', 'brightness', 'color'].includes(effect)) {
                    note(where, `the ${effect} effect is not drawn in the export (ghost, brightness and color are)`);
                }
                const fn = node.op === 'looks_seteffectto' ? 'setEffect' : 'changeEffect';
                push(`me.${fn}(${literal(effect)}, ${n(node.op === 'looks_seteffectto' ? 'VALUE' : 'CHANGE')});`);
                return;
            }
            case 'looks_cleargraphiceffects': push('me.clearEffects();'); return;
            case 'looks_show': push('me.show();'); return;
            case 'looks_hide': push('me.hide();'); return;
            case 'looks_gotofrontback': push(`me.goToLayer(${literal(field(node, 'FRONT_BACK'))});`); return;
            case 'looks_goforwardbackwardlayers':
                push(`me.changeLayer(${literal(field(node, 'FORWARD_BACKWARD'))}, ${n('NUM')});`);
                return;
            // sound
            case 'sound_play': push(`me.startSound(${r('SOUND_MENU')});`); return;
            case 'sound_playuntildone': push(`yield* me.playSoundUntilDone(${r('SOUND_MENU')});`); return;
            case 'sound_stopallsounds': push('game.stopAllSounds();'); return;
            case 'sound_seteffectto':
                push(`me.setSoundEffect(${literal(String(field(node, 'EFFECT')).toLowerCase())}, ${n('VALUE')});`);
                if (project.options.miscLimits) push('yield game.NEXT_FRAME;  // Scratch waits a frame here');
                return;
            case 'sound_changeeffectby':
                push(`me.changeSoundEffect(${literal(String(field(node, 'EFFECT')).toLowerCase())}, ${n('VALUE')});`);
                if (project.options.miscLimits) push('yield game.NEXT_FRAME;  // Scratch waits a frame here');
                return;
            case 'sound_cleareffects': push('me.clearSoundEffects();'); return;
            case 'sound_changevolumeby':
                push(`me.changeVolume(${n('VOLUME')});`);
                if (project.options.miscLimits) push('yield game.NEXT_FRAME;  // Scratch waits a frame here');
                return;
            case 'sound_setvolumeto':
                push(`me.setVolume(${n('VOLUME')});`);
                if (project.options.miscLimits) push('yield game.NEXT_FRAME;  // Scratch waits a frame here');
                return;
            // events
            case 'event_broadcast': push(`game.broadcast(${r('BROADCAST_INPUT')});`); return;
            case 'event_broadcastandwait': push(`yield* game.broadcastAndWait(${r('BROADCAST_INPUT')});`); return;
            // control
            case 'control_wait': push(`yield* game.wait(${n('DURATION')});`); return;
            case 'control_repeat': {
                loopDepth++;
                const counter = `i${loopDepth}`;
                const count = `n${loopDepth}`;
                push(`for (let ${counter} = 0, ${count} = Math.round(${n('TIMES')}); ${counter} < ${count}; ${counter}++) {`);
                lines.push(...body('SUBSTACK', loopYield));
                push('}');
                loopDepth--;
                return;
            }
            case 'control_forever':
                push('for (;;) {');
                lines.push(...body('SUBSTACK', loopYield));
                push('}');
                return;
            case 'control_if':
                push(`if (${b('CONDITION')}) {`);
                lines.push(...body('SUBSTACK'));
                push('}');
                return;
            case 'control_if_else':
                push(`if (${b('CONDITION')}) {`);
                lines.push(...body('SUBSTACK'));
                push('} else {');
                lines.push(...body('SUBSTACK2'));
                push('}');
                return;
            case 'control_wait_until': push(`while (!${b('CONDITION')}) yield;`); return;
            case 'control_repeat_until':
                push(`while (!${b('CONDITION')}) {`);
                lines.push(...body('SUBSTACK', loopYield));
                push('}');
                return;
            case 'control_while':
                push(`while (${b('CONDITION')}) {`);
                lines.push(...body('SUBSTACK', loopYield));
                push('}');
                return;
            case 'control_for_each': {
                loopDepth++;
                const v = varRef(field(node, 'VARIABLE'));
                const count = `n${loopDepth}`;
                push(`for (let ${count} = ${n('VALUE')}, i${loopDepth} = 1; i${loopDepth} <= ${count}; i${loopDepth}++) {`);
                lines.push(`${pad}    ${v} = i${loopDepth};`);
                lines.push(...body('SUBSTACK', loopYield));
                push('}');
                loopDepth--;
                return;
            }
            case 'control_all_at_once':
                lines.push(...block(node.branches.SUBSTACK || [], indent, args));
                return;
            case 'control_stop': {
                const option = String(field(node, 'STOP_OPTION'));
                if (option === 'all') {
                    push('game.stopAll();');
                    push('return;');
                } else if (option === 'this script') {
                    push('return;');
                } else {
                    push('me.stopOtherScripts();');
                }
                return;
            }
            case 'control_create_clone_of': push(`me.createClone(${r('CLONE_OPTION')});`); return;
            case 'control_delete_this_clone': push('if (me.deleteClone()) return;'); return;
            case 'control_incr_counter': push('game.counter = (game.counter || 0) + 1;'); return;
            case 'control_clear_counter': push('game.counter = 0;'); return;
            // sensing
            case 'sensing_askandwait': push(`yield* game.ask(me, ${r('QUESTION')});`); return;
            case 'sensing_setdragmode': push(`me.setDragMode(${literal(field(node, 'DRAG_MODE'))});`); return;
            case 'sensing_resettimer': push('game.resetTimer();'); return;
            // data
            case 'data_setvariableto': push(`${varRef(field(node, 'VARIABLE'))} = ${r('VALUE')};`); return;
            case 'data_changevariableby': {
                const v = varRef(field(node, 'VARIABLE'));
                push(`${v} = S.num(${v}) + ${n('VALUE')};`);
                return;
            }
            case 'data_showvariable':
            case 'data_hidevariable':
            case 'data_showlist':
            case 'data_hidelist': {
                const v = field(node, node.op.endsWith('list') ? 'LIST' : 'VARIABLE');
                if (!monitorIds.has(v.id)) needMonitor.set(v.id, v);
                push(`game.showMonitor(${literal(v.id)}, ${node.op.startsWith('data_show')});`);
                return;
            }
            case 'data_addtolist': push(`S.listAdd(${varRef(field(node, 'LIST'))}, ${r('ITEM')});`); return;
            case 'data_deleteoflist': push(`S.listDelete(${varRef(field(node, 'LIST'))}, ${r('INDEX')});`); return;
            case 'data_deletealloflist': push(`S.listDeleteAll(${varRef(field(node, 'LIST'))});`); return;
            case 'data_insertatlist':
                push(`S.listInsert(${varRef(field(node, 'LIST'))}, ${r('INDEX')}, ${r('ITEM')});`);
                return;
            case 'data_replaceitemoflist':
                push(`S.listReplace(${varRef(field(node, 'LIST'))}, ${r('INDEX')}, ${r('ITEM')});`);
                return;
            // pen
            case 'pen_clear': push('game.penClear();'); return;
            case 'pen_stamp': push('me.stamp();'); return;
            case 'pen_penDown': push('me.penDown();'); return;
            case 'pen_penUp': push('me.penUp();'); return;
            case 'pen_setPenColorToColor': push(`me.setPenColor(${r('COLOR')});`); return;
            case 'pen_changePenColorParamBy': push(`me.changePenParam(${r('COLOR_PARAM')}, ${n('VALUE')});`); return;
            case 'pen_setPenColorParamTo': push(`me.setPenParam(${r('COLOR_PARAM')}, ${n('VALUE')});`); return;
            case 'pen_changePenSizeBy': push(`me.changePenSize(${n('SIZE')});`); return;
            case 'pen_setPenSizeTo': push(`me.setPenSize(${n('SIZE')});`); return;
            // custom blocks
            case 'procedures_call': {
                const proccode = node.mutation && node.mutation.proccode;
                const proc = procs.get(proccode);
                if (!proc) {
                    note(where, `the custom block "${proccode}" is used but not defined; it does nothing`);
                    return;
                }
                const values = proc.argIds.map((id, k) => {
                    const given = (node.inputs || {})[id];
                    if (proc.argKinds[k] === 'boolean') return given ? bool(given, args) : 'false';
                    return given ? raw(given, args) : '""';
                });
                push(`yield* ${proc.fn}(${['me', 'warp', ...values].join(', ')});`);
                return;
            }
            }
            if (node.op.startsWith('pen_')) note(where, `the old pen block "${node.op}" is not exported`);
            else note(where, `the block "${node.op}" is not exported; it does nothing`);
            push(`// not exported: ${node.op}`);
        };

        const hatCode = script => {
            const hat = script.hat;
            const lines = block(script.body, 1, null);
            const fn = ['function* (me, warp = false) {', ...lines, '}'];
            const v = spriteVar.get(target);
            const head = (call, comment) => {
                emit(`// ${comment}`);
                emit(`${v}.${call}${fn[0]}`);
                for (const l of fn.slice(1, -1)) emit(l);
                emit('});');
                emit('');
            };
            switch (hat.op) {
            case 'event_whenflagclicked': head('whenFlagClicked(', 'when green flag clicked'); break;
            case 'event_whenkeypressed': {
                const key = hat.fields.KEY_OPTION;
                head(`whenKeyPressed(${literal(key)}, `, `when ${key} key pressed`);
                break;
            }
            case 'event_whenthisspriteclicked': head('whenThisSpriteClicked(', 'when this sprite clicked'); break;
            case 'event_whenstageclicked': head('whenStageClicked(', 'when stage clicked'); break;
            case 'event_whenbroadcastreceived': {
                const message = hat.fields.BROADCAST_OPTION;
                head(`whenIReceive(${literal(message)}, `, `when I receive ${message}`);
                break;
            }
            case 'event_whenbackdropswitchesto': {
                const backdrop = hat.fields.BACKDROP;
                head(`whenBackdropSwitchesTo(${literal(backdrop)}, `, `when backdrop switches to ${backdrop}`);
                break;
            }
            case 'event_whengreaterthan': {
                const menu = String(hat.fields.WHENGREATERTHANMENU || 'TIMER').toUpperCase();
                if (menu !== 'TIMER') note(where, 'a "when loudness >" script never starts: the export has no microphone');
                const value = num(hat.inputs.VALUE, null);
                head(`whenGreaterThan(${literal(menu)}, me => ${value}, `, `when ${menu.toLowerCase()} > ...`);
                break;
            }
            case 'control_start_as_clone': head('whenIStartAsAClone(', 'when I start as a clone'); break;
            }
        };

        const procCode = proc => {
            const params = new Map();
            const paramName = makeNamer();
            ['me', 'warp'].forEach(p => paramName(p));
            proc.argNames.forEach(argName => params.set(argName, paramName(camel(argName) || 'value')));
            emit(`// define ${proc.proccode.replace(/%[snb]/g, '( )')}${proc.warp ? ' (run without screen refresh)' : ''}`);
            emit(`function* ${proc.fn}(${['me', 'warp', ...params.values()].join(', ')}) {`);
            if (proc.warp) emit('    warp = true;');
            for (const l of block(proc.body, 1, params)) emit(l);
            emit('}');
            emit('');
        };

        return {procs, hatCode, procCode};
    };

    // --- the file ---
    const opts = project.options;
    emit(`// game.js: "${String(title).replace(/[\r\n]/g, ' ')}", made in Flipwarp (Scratch) and exported as code.`);
    emit('// Each script is a function. Where Scratch lets other scripts have a turn (each time round');
    emit('// a loop, a wait), the script says "yield". scratch-runtime.js runs them the way Scratch');
    emit('// does: me is the sprite (or clone) running the script, G its global variables, L the lists.');
    emit('');
    emit('(function () {');
    emit('\'use strict\';');
    emit('const S = ScratchRules;');
    emit(`const game = new ScratchGame({width: ${opts.width}, height: ${opts.height}, ` +
        `framerate: ${opts.framerate}, fencing: ${opts.fencing}, ` +
        `maxClones: ${Number.isFinite(opts.maxClones) ? opts.maxClones : 'Infinity'}});`);
    emit('');

    const costumeSpec = c => `{name: ${literal(c.name)}, file: ${literal(files[c.md5ext] || c.md5ext)}, ` +
        `centerX: ${c.rotationCenterX}, centerY: ${c.rotationCenterY}, resolution: ${c.bitmapResolution}}`;
    const soundSpec = s => `{name: ${literal(s.name)}, file: ${literal(files[s.md5ext] || s.md5ext)}, ` +
        `rate: ${s.rate || 0}, sampleCount: ${s.sampleCount || 0}}`;
    const valuesSpec = list => `{${list.map(v => `${isIdentifier(v.name) ? v.name : JSON.stringify(v.name)}: ` +
        `${JSON.stringify(v.value === undefined ? 0 : v.value)}`).join(', ')}}`;

    // Missing variables are made on the stage, as Scratch does.
    const missing = new Map();
    for (const t of project.targets) {
        const scan = e => {
            if (!e || typeof e !== 'object') return;
            if ((e.kind === 'var' || e.kind === 'list' || e.kind === 'listContents') && e.missing) missing.set(e.id, e);
            if (e.missing && e.id && e.name) missing.set(e.id, e);
            for (const value of Object.values(e)) if (value && typeof value === 'object') scan(value);
        };
        scan(t.scripts);
        scan(t.procedures);
    }
    const stageVars = project.stage.variables.concat([...missing.values()].filter(v => !v.list)
        .map(v => ({name: v.name, value: 0})));
    const stageLists = project.stage.lists.concat([...missing.values()].filter(v => v.list)
        .map(v => ({name: v.name, value: []})));

    const generated = project.targets.map(t => ({t, gen: genTarget(t)}));

    for (const {t} of generated) {
        const v = spriteVar.get(t);
        emit(t.isStage ? '// ===== The Stage =====' : `// ===== Sprite: ${t.name} =====`);
        const spec = [
            `name: ${literal(t.name)}`,
            ...(t.isStage ? [] : [`x: ${t.x}`, `y: ${t.y}`, `direction: ${t.direction}`, `size: ${t.size}`,
                `visible: ${t.visible}`, `rotationStyle: ${literal(t.rotationStyle)}`, `draggable: ${t.draggable}`]),
            `volume: ${t.volume}`,
            `costume: ${t.currentCostume}`,
            `costumes: [${t.costumes.map(costumeSpec).join(', ')}]`,
            `sounds: [${t.sounds.map(soundSpec).join(', ')}]`,
            `variables: ${valuesSpec(t.isStage ? stageVars : t.variables)}`,
            `lists: ${valuesSpec(t.isStage ? stageLists : t.lists)}`
        ];
        emit(`const ${v} = game.${t.isStage ? 'addStage' : 'addSprite'}({`);
        spec.forEach((line, k) => emit(`    ${line}${k < spec.length - 1 ? ',' : ''}`));
        emit('});');
        if (t.isStage) {
            emit('const G = stage.vars;   // variables for all sprites');
            emit('const L = stage.lists;  // lists for all sprites');
        }
        emit('');
    }

    for (const {t, gen} of generated) {
        if (!t.scripts.length && !t.procedures.length) continue;
        emit(t.isStage ? '// ===== The Stage\'s scripts =====' : `// ===== ${t.name}'s scripts =====`);
        emit('');
        for (const proc of gen.procs.values()) gen.procCode(proc);
        for (const script of t.scripts) gen.hatCode(script);
    }

    // Readouts on the stage.
    const owner = v => (v.global ? 'stage' : spriteVar.get(project.sprites.find(s => s.name === v.owner)));
    const monitorLines = [];
    const addMonitor = (m, v) => {
        const target = owner(v);
        if (!target) return;
        const read = v.list ? `() => ${prop(`${target}.lists`, v.name)}` : `() => ${prop(`${target}.vars`, v.name)}`;
        const write = v.list ? 'null' : `value => { ${prop(`${target}.vars`, v.name)} = value; }`;
        const label = v.global ? v.name : `${v.owner}: ${v.name}`;
        monitorLines.push(`game.monitors.push({id: ${literal(m.id)}, mode: ${literal(m.mode || 'default')}, ` +
            `label: ${literal(label)}, x: ${m.x || 0}, y: ${m.y || 0}, width: ${m.width || 0}, ` +
            `height: ${m.height || 0}, visible: ${!!m.visible}, sliderMin: ${m.sliderMin || 0}, ` +
            `sliderMax: ${m.sliderMax === undefined ? 100 : m.sliderMax}, isDiscrete: ${m.isDiscrete !== false}, ` +
            `read: ${read}, write: ${write}});`);
    };
    const allVariables = new Map();
    for (const t of project.targets) {
        for (const v of t.variables) allVariables.set(v.id, {...v, list: false, global: t.isStage, owner: t.name});
        for (const l of t.lists) allVariables.set(l.id, {...l, list: true, global: t.isStage, owner: t.name});
    }
    const BUILTIN = {
        sensing_timer: ['timer', 'game.timer'],
        sensing_answer: ['answer', 'game.answer'],
        sensing_loudness: ['loudness', 'game.loudness'],
        sensing_username: ['username', 'game.username']
    };
    for (const m of project.monitors) {
        if (m.opcode === 'data_variable' || m.opcode === 'data_listcontents') {
            const v = allVariables.get(m.id);
            if (v) addMonitor(m, v);
            continue;
        }
        if (BUILTIN[m.opcode]) {
            const [label, code] = BUILTIN[m.opcode];
            monitorLines.push(`game.monitors.push({id: ${literal(m.id)}, mode: ${literal(m.mode || 'default')}, ` +
                `label: ${literal(label)}, x: ${m.x}, y: ${m.y}, visible: ${!!m.visible}, read: () => ${code}});`);
            continue;
        }
        if (m.visible) note('Stage', `the readout for "${m.opcode}" is not shown in the export`);
    }
    let spare = 0;
    for (const [id, v] of needMonitor) {
        const known = allVariables.get(id);
        if (!known) continue;
        addMonitor({id, mode: v.list ? 'list' : 'default', x: 5, y: 5 + (spare++ * 27), visible: false}, known);
    }
    if (monitorLines.length) {
        emit('// ===== Variable and list readouts =====');
        monitorLines.forEach(l => emit(l));
        emit('');
    }

    emit('game.run(document.getElementById(\'game\'), {test: /[?&]test\\b/.test(location.search)});');
    emit('})();');
    emit('');

    // Blocks the export knows about but draws differently.
    if (project.extensions.some(e => e !== 'pen')) {
        for (const ext of project.extensions.filter(e => e !== 'pen')) {
            note('Project', `the "${ext}" extension is not exported; its blocks do nothing`);
        }
    }
    for (const t of project.targets) {
        if (t.variables.some(v => v.cloud)) note(t.name, 'cloud variables are ordinary variables in the export');
    }
    return {code: out.join('\n'), notes};
};

export {MENU_TARGETS};
