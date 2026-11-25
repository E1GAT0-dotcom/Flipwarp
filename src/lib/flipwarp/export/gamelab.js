/* eslint-disable no-use-before-define */
// The Game Lab exporter: the shared description of a project (front.js)
// written as Code.org Game Lab JavaScript, which is the older JavaScript
// (ES5) with no generators. So each script is lowered into a state machine:
// numbered steps in a switch, where every place the script would yield
// (a loop going round, a wait, a custom block that waits) saves which step
// comes next and returns. Code with no waits in it stays ordinary code.

const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else export extends ' +
    'finally for function if import in instanceof new return super switch this throw try typeof var void while ' +
    'with yield let static enum await implements package protected interface private public null true false ' +
    'undefined NaN Infinity arguments eval').split(' '));
// Names the runtime and the generated code use.
const TAKEN = new Set(['S', 'G', 'L', 'game', 'stage', 'me', 'warp', 'state', 'sub', 'r', 'Math', 'String',
    'Number', 'Object', 'Array', 'JSON', 'console', 'Game', 'Target', 'Thread', 'machine', 'YIELD', 'DONE',
    'NEXT_FRAME', 'World', 'draw', 'setup', 'createSprite', 'drawSprites', 'keyDown', 'playSound', 'text', 'rect',
    'fill', 'line', 'stroke', 'background', 'clamp', 'copyOf']);

const isIdentifier = name => /^[A-Za-z_$][\w$]*$/.test(name) && !KEYWORDS.has(name);
const prop = (object, name) => (isIdentifier(name) ? `${object}.${name}` : `${object}[${JSON.stringify(name)}]`);
const words = text => String(text).replace(/%[snb]/g, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
const camel = text => words(text).map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) :
    w.charAt(0).toUpperCase() + w.slice(1)))
    .join('');

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

const literal = value => {
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return 'NaN';
        if (value === Infinity) return 'Infinity';
        if (value === -Infinity) return '(-Infinity)';
        return value < 0 ? `(${value})` : String(value);
    }
    if (typeof value === 'boolean') return String(value);
    return JSON.stringify(String(value));
};

// Blocks that wait in some way: the script has to pause around them.
const WAITS = new Set(['control_wait', 'motion_glideto', 'motion_glidesecstoxy', 'looks_sayforsecs',
    'looks_thinkforsecs', 'looks_switchbackdroptoandwait', 'sound_playuntildone', 'event_broadcastandwait',
    'sensing_askandwait', 'procedures_call', 'control_wait_until', 'control_repeat', 'control_forever',
    'control_repeat_until', 'control_while', 'control_for_each']);

/**
 * Write the game part of code.js.
 * @param {object} project from readProject
 * @param {object} costumes md5ext -> {animation, width, height, box, resolution} as Game Lab will have it
 * @param {object} sounds md5ext -> the sound's file name in Game Lab
 * @param {string} title the project's name
 * @returns {{code: string, notes: Array}} the code and what could not be exported
 */
export const writeGameLabGame = (project, costumes, sounds, title) => {
    const notes = [...project.notes];
    const note = (where, what) => {
        if (!notes.some(n => n.where === where && n.what === what)) notes.push({where, what});
    };
    const name = makeNamer();
    const out = [];
    const emit = line => out.push(line);
    const spriteVar = new Map();
    for (const t of project.targets) spriteVar.set(t, t.isStage ? 'stage' : name(t.name));
    const monitorIds = new Set(project.monitors.map(m => m.id));
    const needMonitor = new Map();
    const misc = project.options.miscLimits;

    const genTarget = target => {
        const where = target.isStage ? 'Stage' : target.name;
        const procs = new Map();
        for (const proc of target.procedures) {
            const base = `${target.isStage ? 'stage' : spriteVar.get(target)}_${camel(proc.proccode) || 'block'}`;
            procs.set(proc.proccode, {...proc, fn: name(base)});
        }
        const varRef = v => {
            if (v.missing) note(where, `the variable "${v.name}" is used but not made anywhere; it starts at 0`);
            if (v.list) return v.global ? prop('L', v.name) : prop('me.lists', v.name);
            return v.global ? prop('G', v.name) : prop('me.vars', v.name);
        };

        // --- expressions (they never wait) ---
        const expr = (e, args) => {
            if (!e) return {code: '""', type: 'str', lit: ''};
            switch (e.kind) {
            case 'lit':
                return {code: literal(e.value), type: typeof e.value === 'number' ? 'num' :
                    typeof e.value === 'boolean' ? 'bool' : 'str', lit: e.value};
            case 'var': return {code: varRef(e), type: 'any'};
            case 'list': return {code: varRef(e), type: 'list'};
            case 'listContents': return {code: `S.listContents(${varRef({...e, list: true})})`, type: 'str'};
            case 'arg': {
                const param = args && args.get(e.name);
                if (!param) return e.boolean ? {code: 'false', type: 'bool'} : {code: '0', type: 'num'};
                return {code: param, type: 'any'};
            }
            case 'block': return reporter(e, args);
            }
            return {code: '0', type: 'num'};
        };
        const num = (e, args) => {
            const x = expr(e, args);
            if (x.type === 'num') return x.code;
            if (typeof x.lit !== 'undefined') {
                const n = Number(x.lit);
                return literal(Number.isNaN(n) ? 0 : n);
            }
            return `S.num(${x.code})`;
        };
        const bool = (e, args) => {
            if (!e) return 'false';
            const x = expr(e, args);
            if (x.type === 'bool') return x.code;
            if (typeof x.lit !== 'undefined') {
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
            case 'motion_xposition': return N('me.xPosition()');
            case 'motion_yposition': return N('me.yPosition()');
            case 'motion_direction': return N('me.direction');
            case 'looks_costumenumbername':
                return field(node, 'NUMBER_NAME') === 'name' ? T('me.costumeName()') : N('me.costumeNumber()');
            case 'looks_backdropnumbername':
                return field(node, 'NUMBER_NAME') === 'name' ? T('game.backdropName()') : N('game.backdropNumber()');
            case 'looks_size': return N('me.size');
            case 'sound_volume': return N('me.volume');
            case 'sensing_touchingobject': return B(`me.touching(${r('TOUCHINGOBJECTMENU')})`);
            case 'sensing_touchingcolor':
                note(where, '"touching color" is not exported to Game Lab; it is always false');
                return B(`me.touchingColor(${r('COLOR')})`);
            case 'sensing_coloristouchingcolor':
                note(where, '"color is touching color" is not exported; it is always false');
                return B('false');
            case 'sensing_distanceto': return N(`me.distanceTo(${r('DISTANCETOMENU')})`);
            case 'sensing_answer': return A('game.answer');
            case 'sensing_keypressed': return B(`game.keyPressed(${r('KEY_OPTION')})`);
            case 'sensing_mousedown': return B('game.mouseIsDown()');
            case 'sensing_mousex': return N('game.mouseX()');
            case 'sensing_mousey': return N('game.mouseY()');
            case 'sensing_loudness':
                note(where, 'loudness needs a microphone, which Game Lab does not have; it is always -1');
                return N('game.loudness()');
            case 'sensing_timer': return N('game.timer()');
            case 'sensing_of': return A(`game.propertyOf(${literal(field(node, 'PROPERTY'))}, ${r('OBJECT')})`);
            case 'sensing_current': return N(`game.current(${literal(field(node, 'CURRENTMENU'))})`);
            case 'sensing_dayssince2000': return N('game.daysSince2000()');
            case 'sensing_username': return T('game.username');
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
            case 'data_itemoflist': return A(`S.listItem(${varRef(field(node, 'LIST'))}, ${r('INDEX')})`);
            case 'data_itemnumoflist': return N(`S.listIndexOf(${varRef(field(node, 'LIST'))}, ${r('ITEM')})`);
            case 'data_lengthoflist': return N(`${varRef(field(node, 'LIST'))}.length`);
            case 'data_listcontainsitem': return B(`S.listContains(${varRef(field(node, 'LIST'))}, ${r('ITEM')})`);
            case 'control_get_counter': return N('game.counter');
            }
            note(where, `the reporter "${node.op}" is not exported; it gives 0`);
            return {code: '0', type: 'num'};
        };

        // --- statements, lowered into the steps of a state machine ---
        // A body is written as a list of "cases": code under a step number.
        // A pause ends a case: it stores the next step and returns.
        const lower = (body, args) => {
            const cases = [{id: 0, lines: []}];
            let nextId = 1;
            let loopDepth = 0;
            let maxLoop = 0;
            const newId = () => nextId++;
            const here = () => cases[cases.length - 1];
            const emitLine = (line, indent) => here().lines.push(`${'    '.repeat(indent)}${line}`);
            const startCase = id => cases.push({id, lines: []});

            const waits = node => WAITS.has(node.op) ||
                (node.op === 'control_if' || node.op === 'control_if_else' || node.op === 'control_all_at_once') &&
                Object.values(node.branches || {}).some(list => list.some(waits)) ||
                (misc && ['sound_setvolumeto', 'sound_changevolumeby', 'sound_seteffectto',
                    'sound_changeeffectby'].includes(node.op));

            // A statement with no pause in it: ordinary code, at this indent.
            const plain = (node, indent) => {
                const push = line => emitLine(line, indent);
                const i = key => input(node, key);
                const n = key => num(i(key), args);
                const r = key => raw(i(key), args);
                const b = key => bool(i(key), args);
                const inner = key => {
                    for (const child of node.branches[key] || []) plain(child, indent + 1);
                };
                switch (node.op) {
                case 'motion_movesteps': push(`me.moveSteps(${n('STEPS')});`); return;
                case 'motion_turnright': push(`me.turnRight(${n('DEGREES')});`); return;
                case 'motion_turnleft': push(`me.turnLeft(${n('DEGREES')});`); return;
                case 'motion_goto': push(`me.goToTarget(${r('TO')});`); return;
                case 'motion_gotoxy': push(`me.goTo(${n('X')}, ${n('Y')});`); return;
                case 'motion_pointindirection': push(`me.setDirection(${n('DIRECTION')});`); return;
                case 'motion_pointtowards': push(`me.pointTowards(${r('TOWARDS')});`); return;
                case 'motion_changexby': push(`me.changeX(${n('DX')});`); return;
                case 'motion_setx': push(`me.setX(${n('X')});`); return;
                case 'motion_changeyby': push(`me.changeY(${n('DY')});`); return;
                case 'motion_sety': push(`me.setY(${n('Y')});`); return;
                case 'motion_ifonedgebounce': push('me.bounceOnEdge();'); return;
                case 'motion_setrotationstyle': push(`me.setRotationStyle(${literal(field(node, 'STYLE'))});`); return;
                case 'looks_say': push(`me.say(${r('MESSAGE')});`); return;
                case 'looks_think': push(`me.think(${r('MESSAGE')});`); return;
                case 'looks_switchcostumeto': push(`me.switchCostume(${r('COSTUME')});`); return;
                case 'looks_nextcostume': push('me.nextCostume();'); return;
                case 'looks_switchbackdropto': push(`game.switchBackdrop(${r('BACKDROP')});`); return;
                case 'looks_nextbackdrop': push('game.switchBackdrop("next backdrop");'); return;
                case 'looks_changesizeby': push(`me.changeSize(${n('CHANGE')});`); return;
                case 'looks_setsizeto': push(`me.setSize(${n('SIZE')});`); return;
                case 'looks_changeeffectby':
                case 'looks_seteffectto': {
                    const effect = String(field(node, 'EFFECT')).toLowerCase();
                    if (effect !== 'ghost') note(where, `the ${effect} effect is not drawn in Game Lab (ghost is)`);
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
                case 'sound_play': push(`me.startSound(${r('SOUND_MENU')});`); return;
                case 'sound_stopallsounds': push('game.stopAllSounds();'); return;
                case 'sound_seteffectto':
                case 'sound_changeeffectby':
                    note(where, 'sound effects (pitch, pan) do nothing in Game Lab');
                    return;
                case 'sound_cleareffects': return;
                case 'sound_changevolumeby': push(`me.changeVolume(${n('VOLUME')});`); return;
                case 'sound_setvolumeto': push(`me.setVolume(${n('VOLUME')});`); return;
                case 'event_broadcast': push(`game.broadcast(${r('BROADCAST_INPUT')});`); return;
                case 'control_if':
                    push(`if (${b('CONDITION')}) {`);
                    inner('SUBSTACK');
                    push('}');
                    return;
                case 'control_if_else':
                    push(`if (${b('CONDITION')}) {`);
                    inner('SUBSTACK');
                    push('} else {');
                    inner('SUBSTACK2');
                    push('}');
                    return;
                case 'control_all_at_once':
                    for (const child of node.branches.SUBSTACK || []) plain(child, indent);
                    return;
                case 'control_stop': {
                    const option = String(field(node, 'STOP_OPTION'));
                    if (option === 'all') {
                        push('game.stopAll();');
                        push('state = -1;');
                        push('return DONE;');
                    } else if (option === 'this script') {
                        push('state = -1;');
                        push('return DONE;');
                    } else {
                        push('me.stopOtherScripts();');
                    }
                    return;
                }
                case 'control_create_clone_of': push(`me.createClone(${r('CLONE_OPTION')});`); return;
                case 'control_delete_this_clone':
                    push('if (me.deleteClone()) {');
                    push('    state = -1;');
                    push('    return DONE;');
                    push('}');
                    return;
                case 'control_incr_counter': push('game.counter++;'); return;
                case 'control_clear_counter': push('game.counter = 0;'); return;
                case 'sensing_setdragmode': return;
                case 'sensing_resettimer': push('game.resetTimer();'); return;
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
                case 'pen_clear': push('game.penClear();'); return;
                case 'pen_stamp': push('me.stamp();'); return;
                case 'pen_penDown': push('me.penDown();'); return;
                case 'pen_penUp': push('me.penUp();'); return;
                case 'pen_setPenColorToColor': push(`me.setPenColor(${r('COLOR')});`); return;
                case 'pen_changePenColorParamBy': push(`me.changePenParam(${r('COLOR_PARAM')}, ${n('VALUE')});`); return;
                case 'pen_setPenColorParamTo': push(`me.setPenParam(${r('COLOR_PARAM')}, ${n('VALUE')});`); return;
                case 'pen_changePenSizeBy': push(`me.changePenSize(${n('SIZE')});`); return;
                case 'pen_setPenSizeTo': push(`me.setPenSize(${n('SIZE')});`); return;
                }
                if (node.op.startsWith('pen_')) note(where, `the old pen block "${node.op}" is not exported`);
                else note(where, `the block "${node.op}" is not exported; it does nothing`);
                push(`// not exported: ${node.op}`);
            };

            // A pause: save the next step, return, and start that step.
            const pause = (value, indent) => {
                const id = newId();
                emitLine(`state = ${id};`, indent);
                emitLine(`return ${value};`, indent);
                startCase(id);
            };
            // Run another machine (a wait, a glide, a custom block) until it finishes.
            const delegate = (machineCode, indent) => {
                const id = newId();
                emitLine(`sub = ${machineCode};`, indent);
                emitLine(`state = ${id};`, indent);
                startCase(id);
                emitLine('r = sub.next();', 3);
                emitLine('if (!r.done) return r;', 3);
            };
            const loopBack = (id, indent) => {
                emitLine(`state = ${id};`, indent);
                emitLine('if (!warp) return YIELD;', indent);
                emitLine('continue;', indent);
            };

            const statement = node => {
                if (!waits(node)) {
                    plain(node, 3);
                    return;
                }
                const i = key => input(node, key);
                const n = key => num(i(key), args);
                const r = key => raw(i(key), args);
                const b = key => bool(i(key), args);
                const seq = list => list.forEach(statement);
                switch (node.op) {
                case 'control_wait': delegate(`game.wait(${n('DURATION')})`, 3); return;
                case 'motion_glideto': delegate(`me.glideToTarget(${n('SECS')}, ${r('TO')})`, 3); return;
                case 'motion_glidesecstoxy': delegate(`me.glideTo(${n('SECS')}, ${n('X')}, ${n('Y')})`, 3); return;
                case 'looks_sayforsecs': delegate(`me.sayFor(${r('MESSAGE')}, ${n('SECS')})`, 3); return;
                case 'looks_thinkforsecs': delegate(`me.thinkFor(${r('MESSAGE')}, ${n('SECS')})`, 3); return;
                case 'looks_switchbackdroptoandwait': delegate(`game.switchBackdropAndWait(${r('BACKDROP')})`, 3); return;
                case 'sound_playuntildone': delegate(`me.playSoundUntilDone(${r('SOUND_MENU')})`, 3); return;
                case 'event_broadcastandwait': delegate(`game.broadcastAndWait(${r('BROADCAST_INPUT')})`, 3); return;
                case 'sensing_askandwait':
                    note(where, 'Game Lab has no way to type an answer: "ask" shows the question and the answer ' +
                        'stays empty');
                    delegate(`game.ask(me, ${r('QUESTION')})`, 3);
                    return;
                case 'sound_setvolumeto':
                case 'sound_changevolumeby':
                case 'sound_seteffectto':
                case 'sound_changeeffectby':
                    plain(node, 3);
                    pause('NEXT_FRAME', 3);
                    return;
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
                    delegate(`${proc.fn}(${['me', 'warp', ...values].join(', ')})`, 3);
                    return;
                }
                case 'control_wait_until': {
                    const id = newId();
                    emitLine(`state = ${id};`, 3);
                    startCase(id);
                    emitLine(`if (!${b('CONDITION')}) return YIELD;`, 3);
                    return;
                }
                case 'control_forever': {
                    const top = newId();
                    emitLine(`state = ${top};`, 3);
                    startCase(top);
                    seq(node.branches.SUBSTACK || []);
                    loopBack(top, 3);
                    startCase(newId());
                    return;
                }
                case 'control_repeat':
                case 'control_for_each': {
                    loopDepth++;
                    maxLoop = Math.max(maxLoop, loopDepth);
                    const counter = `i${loopDepth}`;
                    const count = `n${loopDepth}`;
                    const top = newId();
                    const end = newId();
                    emitLine(`${counter} = 0;`, 3);
                    emitLine(node.op === 'control_repeat' ? `${count} = Math.round(${n('TIMES')});` :
                        `${count} = ${n('VALUE')};`, 3);
                    startCase(top);
                    emitLine(`if (${counter} >= ${count}) {`, 3);
                    emitLine(`state = ${end};`, 4);
                    emitLine('continue;', 4);
                    emitLine('}', 3);
                    emitLine(`${counter}++;`, 3);
                    if (node.op === 'control_for_each') emitLine(`${varRef(node.fields.VARIABLE)} = ${counter};`, 3);
                    seq(node.branches.SUBSTACK || []);
                    loopBack(top, 3);
                    startCase(end);
                    loopDepth--;
                    return;
                }
                case 'control_repeat_until':
                case 'control_while': {
                    const top = newId();
                    const end = newId();
                    emitLine(`state = ${top};`, 3);
                    startCase(top);
                    const stop = node.op === 'control_while' ? `!${b('CONDITION')}` : b('CONDITION');
                    emitLine(`if (${stop}) {`, 3);
                    emitLine(`state = ${end};`, 4);
                    emitLine('continue;', 4);
                    emitLine('}', 3);
                    seq(node.branches.SUBSTACK || []);
                    loopBack(top, 3);
                    startCase(end);
                    return;
                }
                case 'control_if':
                case 'control_if_else': {
                    const otherwise = newId();
                    const end = node.op === 'control_if_else' ? newId() : otherwise;
                    emitLine(`if (!${b('CONDITION')}) {`, 3);
                    emitLine(`state = ${otherwise};`, 4);
                    emitLine('continue;', 4);
                    emitLine('}', 3);
                    seq(node.branches.SUBSTACK || []);
                    if (node.op === 'control_if_else') {
                        emitLine(`state = ${end};`, 3);
                        emitLine('continue;', 3);
                        startCase(otherwise);
                        seq(node.branches.SUBSTACK2 || []);
                    }
                    startCase(end);
                    return;
                }
                case 'control_all_at_once':
                    seq(node.branches.SUBSTACK || []);
                    return;
                }
                plain(node, 3);
            };

            body.forEach(statement);
            const counters = [];
            for (let k = 1; k <= maxLoop; k++) counters.push(`i${k}`, `n${k}`);
            const lines = [];
            lines.push(`    var state = 0, sub, r${counters.length ? `, ${counters.join(', ')}` : ''};`);
            lines.push('    return machine(function () {');
            lines.push('        for (;;) {');
            lines.push('            switch (state) {');
            for (const c of cases) {
                lines.push(`            case ${c.id}:`);
                lines.push(...c.lines.map(l => `    ${l}`));
            }
            lines.push('            }');
            lines.push('            state = -1;');
            lines.push('            return DONE;');
            lines.push('        }');
            lines.push('    });');
            return lines;
        };

        const hatCode = script => {
            const hat = script.hat;
            const v = spriteVar.get(target);
            const head = (call, comment) => {
                emit(`// ${comment}`);
                emit(`${v}.${call}function (me, warp) {`);
                lower(script.body, null).forEach(l => emit(l));
                emit('});');
                emit('');
            };
            switch (hat.op) {
            case 'event_whenflagclicked': head('whenFlagClicked(', 'when green flag clicked'); break;
            case 'event_whenkeypressed':
                head(`whenKeyPressed(${literal(hat.fields.KEY_OPTION)}, `, `when ${hat.fields.KEY_OPTION} key pressed`);
                break;
            case 'event_whenthisspriteclicked': head('whenThisSpriteClicked(', 'when this sprite clicked'); break;
            case 'event_whenstageclicked': head('whenStageClicked(', 'when stage clicked'); break;
            case 'event_whenbroadcastreceived':
                head(`whenIReceive(${literal(hat.fields.BROADCAST_OPTION)}, `,
                    `when I receive ${hat.fields.BROADCAST_OPTION}`);
                break;
            case 'event_whenbackdropswitchesto':
                head(`whenBackdropSwitchesTo(${literal(hat.fields.BACKDROP)}, `,
                    `when backdrop switches to ${hat.fields.BACKDROP}`);
                break;
            case 'event_whengreaterthan': {
                const menu = String(hat.fields.WHENGREATERTHANMENU || 'TIMER').toUpperCase();
                if (menu !== 'TIMER') note(where, 'a "when loudness >" script never starts in Game Lab');
                head(`whenGreaterThan(${literal(menu)}, function (me) { return ${num(hat.inputs.VALUE, null)}; }, `,
                    `when ${menu.toLowerCase()} > ...`);
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
            emit(`function ${proc.fn}(${['me', 'warp', ...params.values()].join(', ')}) {`);
            if (proc.warp) emit('    warp = true;');
            lower(proc.body, params).forEach(l => emit(l));
            emit('}');
            emit('');
        };
        return {procs, hatCode, procCode};
    };

    // --- the game ---
    const opts = project.options;
    emit(`// "${String(title).replace(/[\r\n]/g, ' ')}", made in Flipwarp (Scratch) and exported for Code.org Game Lab.`);
    emit('// me is the sprite (or clone) running a script, G its variables for all sprites, L the lists.');
    emit('');
    emit(`var game = new Game({width: ${opts.width}, height: ${opts.height}, framerate: ${Math.min(60, opts.framerate)}, ` +
        `fencing: ${opts.fencing}, maxClones: ${Number.isFinite(opts.maxClones) ? opts.maxClones : 100000}});`);
    emit('');

    const costumeSpec = c => {
        const m = costumes[c.md5ext] || {animation: c.name, width: 100, height: 100, box: [0.5, 0.5, 99.5, 99.5],
            resolution: 1};
        return `{name: ${literal(c.name)}, animation: ${literal(m.animation)}, width: ${m.width}, ` +
            `height: ${m.height}, centerX: ${c.rotationCenterX / c.bitmapResolution}, ` +
            `centerY: ${c.rotationCenterY / c.bitmapResolution}, resolution: ${m.resolution}, ` +
            `box: [${m.box.map(x => Math.round(x * 1000) / 1000).join(', ')}]}`;
    };
    const soundSpec = s => `{name: ${literal(s.name)}, file: ${literal(sounds[s.md5ext] || s.md5ext)}, ` +
        `duration: ${s.rate && s.sampleCount ? Math.round(s.sampleCount / s.rate * 1000) / 1000 : 0}}`;
    const valuesSpec = list => `{${list.map(v => `${isIdentifier(v.name) ? v.name : JSON.stringify(v.name)}: ` +
        `${JSON.stringify(typeof v.value === 'undefined' ? 0 : v.value)}`).join(', ')}}`;

    const missing = new Map();
    for (const t of project.targets) {
        const scan = e => {
            if (!e || typeof e !== 'object') return;
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
                `visible: ${t.visible}`, `rotationStyle: ${literal(t.rotationStyle)}`]),
            `volume: ${t.volume}`,
            `costume: ${t.currentCostume}`,
            `costumes: [${t.costumes.map(costumeSpec).join(',\n        ')}]`,
            `sounds: [${t.sounds.map(soundSpec).join(', ')}]`,
            `variables: ${valuesSpec(t.isStage ? stageVars : t.variables)}`,
            `lists: ${valuesSpec(t.isStage ? stageLists : t.lists)}`
        ];
        emit(`var ${v} = game.${t.isStage ? 'addStage' : 'addSprite'}({`);
        spec.forEach((line, k) => emit(`    ${line}${k < spec.length - 1 ? ',' : ''}`));
        emit('});');
        if (t.isStage) {
            emit('var G = stage.vars;   // variables for all sprites');
            emit('var L = stage.lists;  // lists for all sprites');
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

    // Readouts.
    const owner = v => (v.global ? 'stage' : spriteVar.get(project.sprites.find(s => s.name === v.owner)));
    const monitorLines = [];
    const addMonitor = (m, v) => {
        const target = owner(v);
        if (!target) return;
        const read = `function () { return ${prop(`${target}.${v.list ? 'lists' : 'vars'}`, v.name)}; }`;
        const label = v.global ? v.name : `${v.owner}: ${v.name}`;
        monitorLines.push(`game.monitors.push({id: ${literal(m.id)}, mode: ${literal(m.mode || 'default')}, ` +
            `label: ${literal(label)}, x: ${m.x || 0}, y: ${m.y || 0}, visible: ${!!m.visible}, read: ${read}});`);
    };
    const allVariables = new Map();
    for (const t of project.targets) {
        for (const v of t.variables) allVariables.set(v.id, {...v, list: false, global: t.isStage, owner: t.name});
        for (const l of t.lists) allVariables.set(l.id, {...l, list: true, global: t.isStage, owner: t.name});
    }
    for (const m of project.monitors) {
        if (m.opcode === 'data_variable' || m.opcode === 'data_listcontents') {
            const v = allVariables.get(m.id);
            if (v) addMonitor(m, v);
        } else if (m.opcode === 'sensing_timer') {
            monitorLines.push(`game.monitors.push({id: ${literal(m.id)}, mode: ${literal(m.mode || 'default')}, ` +
                `label: "timer", x: ${m.x}, y: ${m.y}, visible: ${!!m.visible}, ` +
                'read: function () { return game.timer(); }});');
        } else if (m.visible) {
            note('Stage', `the readout for "${m.opcode}" is not shown in the export`);
        }
    }
    let spare = 0;
    for (const [id, v] of needMonitor) {
        const known = allVariables.get(id);
        if (known) addMonitor({id, mode: v.list ? 'list' : 'default', x: 5, y: 5 + (spare++ * 27)}, known);
    }
    if (monitorLines.length) {
        emit('// ===== Variable and list readouts =====');
        monitorLines.forEach(l => emit(l));
        emit('');
    }

    emit('// ===== Start =====');
    emit('game.load(typeof FLIPWARP_TEST !== "undefined");');
    emit('');
    emit('function draw() {');
    emit('    game.frame();');
    emit('}');
    emit('');

    for (const ext of project.extensions.filter(e => e !== 'pen')) {
        note('Project', `the "${ext}" extension is not exported; its blocks do nothing`);
    }
    for (const t of project.targets) {
        if (t.variables.some(v => v.cloud)) note(t.name, 'cloud variables are ordinary variables in the export');
        if (t.sounds.some(s => s.dataFormat !== 'mp3')) {
            note(t.name, 'Game Lab plays MP3 sounds: convert the .wav sounds to .mp3 (same names) before uploading');
        }
    }
    return {code: out.join('\n'), notes};
};
