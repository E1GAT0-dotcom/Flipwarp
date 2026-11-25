/* eslint-disable no-use-before-define */
// The Python exporter: the shared description of a project (front.js) written
// out as a pygame program that scratch_runtime.py runs. One generator
// function per script, decorated with its hat, one per custom block, with the
// sprite's name, the hat and the custom block's own words in comments.

const KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else ' +
    'except finally for from global if import in is lambda nonlocal not or pass raise return try while with ' +
    'yield match case print len range list dict str int float bool type id object input open sum min max abs')
    .split(' '));
const TAKEN = new Set(['S', 'G', 'L', 'game', 'stage', 'me', 'warp', 'math', 'Game', 'custom_block', 'pygame',
    'os', 'sys']);

const snake = text => String(text).replace(/%[snb]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase())
    .join('_');

const makeNamer = () => {
    const used = new Set([...KEYWORDS, ...TAKEN]);
    return base => {
        let name = String(base).replace(/[^A-Za-z0-9_]/g, '_')
            .replace(/^(\d)/, '_$1') || 'thing';
        if (used.has(name)) {
            let n = 2;
            while (used.has(`${name}_${n}`)) n++;
            name = `${name}_${n}`;
        }
        used.add(name);
        return name;
    };
};

/** A value written as Python. */
const py = value => {
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return 'math.nan';
        if (value === Infinity) return 'math.inf';
        if (value === -Infinity) return '(-math.inf)';
        return value < 0 ? `(${value})` : String(value);
    }
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (value === null || typeof value === 'undefined') return '0';
    if (Array.isArray(value)) return `[${value.map(py).join(', ')}]`;
    if (typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${py(k)}: ${py(v)}`).join(', ')}}`;
    return JSON.stringify(String(value));
};

const item = (object, name) => `${object}[${JSON.stringify(String(name))}]`;

/**
 * Write main.py.
 * @param {object} project from readProject
 * @param {object} files costume and sound md5ext -> {file, scale}: its file in the export, and for an SVG
 *     drawn as a PNG, how many times bigger it was drawn
 * @param {string} title the project's name
 * @returns {{code: string, notes: Array}} the code and what could not be exported
 */
export const writePythonGame = (project, files, title) => {
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

    const genTarget = target => {
        const where = target.isStage ? 'Stage' : target.name;
        const prefix = target.isStage ? 'stage' : snake(target.name) || 'sprite';
        const procs = new Map();
        for (const proc of target.procedures) {
            procs.set(proc.proccode, {...proc, fn: name(`${prefix}_${snake(proc.proccode) || 'block'}`)});
        }

        const varRef = v => {
            if (v.missing) note(where, `the variable "${v.name}" is used but not made anywhere; it starts at 0`);
            if (v.list) return v.global ? item('L', v.name) : item('me.lists', v.name);
            return v.global ? item('G', v.name) : item('me.vars', v.name);
        };

        const expr = (e, args) => {
            if (!e) return {code: '""', type: 'str', lit: ''};
            switch (e.kind) {
            case 'lit':
                return {code: py(e.value), type: typeof e.value === 'number' ? 'num' :
                    typeof e.value === 'boolean' ? 'bool' : 'str', lit: e.value};
            case 'var':
                return {code: varRef(e), type: 'any'};
            case 'list':
                return {code: varRef(e), type: 'list'};
            case 'listContents':
                return {code: `S.list_contents(${varRef({...e, list: true})})`, type: 'str'};
            case 'arg': {
                const param = args && args.get(e.name);
                if (!param) return e.boolean ? {code: 'False', type: 'bool'} : {code: '0', type: 'num'};
                return {code: param, type: 'any'};
            }
            case 'block':
                return reporter(e, args);
            }
            return {code: '0', type: 'num'};
        };
        const num = (e, args) => {
            const x = expr(e, args);
            if (x.type === 'num') return x.code;
            if (typeof x.lit !== 'undefined') {
                const n = Number(x.lit);
                return py(Number.isNaN(n) ? 0 : n);
            }
            return `S.num(${x.code})`;
        };
        const bool = (e, args) => {
            if (!e) return 'False';
            const x = expr(e, args);
            if (x.type === 'bool') return x.code;
            if (typeof x.lit !== 'undefined') {
                const v = x.lit;
                return py(typeof v === 'string' ? !(v === '' || v === '0' || v.toLowerCase() === 'false') : !!v);
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
            case 'motion_xposition': return N('me.x_position');
            case 'motion_yposition': return N('me.y_position');
            case 'motion_direction': return N('me.direction');
            case 'looks_costumenumbername':
                return field(node, 'NUMBER_NAME') === 'name' ? T('me.costume_name') : N('me.costume_number');
            case 'looks_backdropnumbername':
                return field(node, 'NUMBER_NAME') === 'name' ? T('game.backdrop_name') : N('game.backdrop_number');
            case 'looks_size': return N('me.size');
            case 'sound_volume': return N('me.volume');
            case 'sensing_touchingobject': return B(`me.touching(${r('TOUCHINGOBJECTMENU')})`);
            case 'sensing_touchingcolor':
                note(where, '"touching color" is not exported to Python; it is always false');
                return B(`me.touching_color(${r('COLOR')})`);
            case 'sensing_coloristouchingcolor':
                note(where, '"color is touching color" is not exported; it is always false');
                return B('False');
            case 'sensing_distanceto': return N(`me.distance_to(${r('DISTANCETOMENU')})`);
            case 'sensing_answer': return A('game.answer');
            case 'sensing_keypressed': return B(`game.key_pressed(${r('KEY_OPTION')})`);
            case 'sensing_mousedown': return B('game.mouse_down');
            case 'sensing_mousex': return N('game.mouse_x_position');
            case 'sensing_mousey': return N('game.mouse_y_position');
            case 'sensing_loudness':
                note(where, 'loudness needs a microphone, which the export does not use; it is always -1');
                return N('game.loudness');
            case 'sensing_timer': return N('game.timer');
            case 'sensing_of': return A(`game.property_of(${py(field(node, 'PROPERTY'))}, ${r('OBJECT')})`);
            case 'sensing_current': return N(`game.current_time(${py(field(node, 'CURRENTMENU'))})`);
            case 'sensing_dayssince2000': return N('game.days_since_2000()');
            case 'sensing_username': return T('game.username');
            case 'operator_add': return N(`(${n('NUM1')} + ${n('NUM2')})`);
            case 'operator_subtract': return N(`(${n('NUM1')} - ${n('NUM2')})`);
            case 'operator_multiply': return N(`(${n('NUM1')} * ${n('NUM2')})`);
            case 'operator_divide': return N(`S.div(${n('NUM1')}, ${n('NUM2')})`);
            case 'operator_random': return N(`S.random(${r('FROM')}, ${r('TO')})`);
            case 'operator_gt':
            case 'operator_lt':
            case 'operator_equals': {
                const a = expr(i('OPERAND1'), args);
                const c = expr(i('OPERAND2'), args);
                const op = {operator_gt: '>', operator_lt: '<', operator_equals: '=='}[node.op];
                if (a.type === 'num' && c.type === 'num') return B(`(${a.code} ${op} ${c.code})`);
                const fn = {operator_gt: 'gt', operator_lt: 'lt', operator_equals: 'eq'}[node.op];
                return B(`S.${fn}(${a.code}, ${c.code})`);
            }
            case 'operator_and': return B(`(${b('OPERAND1')} and ${b('OPERAND2')})`);
            case 'operator_or': return B(`(${b('OPERAND1')} or ${b('OPERAND2')})`);
            case 'operator_not': return B(`(not ${b('OPERAND')})`);
            case 'operator_join': return T(`S.join(${r('STRING1')}, ${r('STRING2')})`);
            case 'operator_letter_of': return T(`S.letter_of(${r('LETTER')}, ${r('STRING')})`);
            case 'operator_length': return N(`S.length_of(${r('STRING')})`);
            case 'operator_contains': return B(`S.contains(${r('STRING1')}, ${r('STRING2')})`);
            case 'operator_mod': return N(`S.mod(${n('NUM1')}, ${n('NUM2')})`);
            case 'operator_round': return N(`S.round(${n('NUM')})`);
            case 'operator_mathop': return N(`S.mathop(${py(String(field(node, 'OPERATOR')))}, ${n('NUM')})`);
            case 'data_itemoflist': return A(`S.list_item(${varRef(field(node, 'LIST'))}, ${r('INDEX')})`);
            case 'data_itemnumoflist': return N(`S.list_index_of(${varRef(field(node, 'LIST'))}, ${r('ITEM')})`);
            case 'data_lengthoflist': return N(`float(len(${varRef(field(node, 'LIST'))}))`);
            case 'data_listcontainsitem':
                return B(`S.list_contains(${varRef(field(node, 'LIST'))}, ${r('ITEM')})`);
            case 'control_get_counter': return N('game.counter');
            }
            note(where, `the reporter "${node.op}" is not exported; it gives 0`);
            return {code: '0', type: 'num'};
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
                if (!inner.length) inner.push(`${pad}    pass`);
                return inner;
            };
            const loopYield = 'if not warp: yield';
            const nextFrame = () => {
                if (project.options.miscLimits) push('yield game.NEXT_FRAME  # Scratch waits a frame here');
            };
            switch (node.op) {
            case 'motion_movesteps': push(`me.move_steps(${n('STEPS')})`); return;
            case 'motion_turnright': push(`me.turn_right(${n('DEGREES')})`); return;
            case 'motion_turnleft': push(`me.turn_left(${n('DEGREES')})`); return;
            case 'motion_goto': push(`me.go_to_target(${r('TO')})`); return;
            case 'motion_gotoxy': push(`me.go_to(${n('X')}, ${n('Y')})`); return;
            case 'motion_glideto': push(`yield from me.glide_to_target(${n('SECS')}, ${r('TO')})`); return;
            case 'motion_glidesecstoxy': push(`yield from me.glide_to(${n('SECS')}, ${n('X')}, ${n('Y')})`); return;
            case 'motion_pointindirection': push(`me.set_direction(${n('DIRECTION')})`); return;
            case 'motion_pointtowards': push(`me.point_towards(${r('TOWARDS')})`); return;
            case 'motion_changexby': push(`me.change_x(${n('DX')})`); return;
            case 'motion_setx': push(`me.set_x(${n('X')})`); return;
            case 'motion_changeyby': push(`me.change_y(${n('DY')})`); return;
            case 'motion_sety': push(`me.set_y(${n('Y')})`); return;
            case 'motion_ifonedgebounce': push('me.bounce_on_edge()'); return;
            case 'motion_setrotationstyle': push(`me.set_rotation_style(${py(field(node, 'STYLE'))})`); return;
            case 'looks_sayforsecs': push(`yield from me.say_for(${r('MESSAGE')}, ${n('SECS')})`); return;
            case 'looks_say': push(`me.say(${r('MESSAGE')})`); return;
            case 'looks_thinkforsecs': push(`yield from me.think_for(${r('MESSAGE')}, ${n('SECS')})`); return;
            case 'looks_think': push(`me.think(${r('MESSAGE')})`); return;
            case 'looks_switchcostumeto': push(`me.switch_costume(${r('COSTUME')})`); return;
            case 'looks_nextcostume': push('me.next_costume()'); return;
            case 'looks_switchbackdropto': push(`game.switch_backdrop(${r('BACKDROP')})`); return;
            case 'looks_switchbackdroptoandwait':
                push(`yield from game.switch_backdrop_and_wait(${r('BACKDROP')})`);
                return;
            case 'looks_nextbackdrop': push('game.switch_backdrop("next backdrop")'); return;
            case 'looks_changesizeby': push(`me.change_size(${n('CHANGE')})`); return;
            case 'looks_setsizeto': push(`me.set_size(${n('SIZE')})`); return;
            case 'looks_changeeffectby':
            case 'looks_seteffectto': {
                const effect = String(field(node, 'EFFECT')).toLowerCase();
                if (!['ghost', 'brightness'].includes(effect)) {
                    note(where, `the ${effect} effect is not drawn in the Python export (ghost and brightness are)`);
                }
                const fn = node.op === 'looks_seteffectto' ? 'set_effect' : 'change_effect';
                push(`me.${fn}(${py(effect)}, ${n(node.op === 'looks_seteffectto' ? 'VALUE' : 'CHANGE')})`);
                return;
            }
            case 'looks_cleargraphiceffects': push('me.clear_effects()'); return;
            case 'looks_show': push('me.show()'); return;
            case 'looks_hide': push('me.hide()'); return;
            case 'looks_gotofrontback': push(`me.go_to_layer(${py(field(node, 'FRONT_BACK'))})`); return;
            case 'looks_goforwardbackwardlayers':
                push(`me.change_layer(${py(field(node, 'FORWARD_BACKWARD'))}, ${n('NUM')})`);
                return;
            case 'sound_play': push(`me.start_sound(${r('SOUND_MENU')})`); return;
            case 'sound_playuntildone': push(`yield from me.play_sound_until_done(${r('SOUND_MENU')})`); return;
            case 'sound_stopallsounds': push('game.stop_all_sounds()'); return;
            case 'sound_seteffectto':
            case 'sound_changeeffectby': {
                const effect = String(field(node, 'EFFECT')).toLowerCase();
                if (effect === 'pitch') note(where, 'the pitch sound effect does not change pitch in pygame');
                const fn = node.op === 'sound_seteffectto' ? 'set_sound_effect' : 'change_sound_effect';
                push(`me.${fn}(${py(effect)}, ${n('VALUE')})`);
                nextFrame();
                return;
            }
            case 'sound_cleareffects': push('me.clear_sound_effects()'); return;
            case 'sound_changevolumeby': push(`me.change_volume(${n('VOLUME')})`); nextFrame(); return;
            case 'sound_setvolumeto': push(`me.set_volume(${n('VOLUME')})`); nextFrame(); return;
            case 'event_broadcast': push(`game.broadcast(${r('BROADCAST_INPUT')})`); return;
            case 'event_broadcastandwait': push(`yield from game.broadcast_and_wait(${r('BROADCAST_INPUT')})`); return;
            case 'control_wait': push(`yield from game.wait(${n('DURATION')})`); return;
            case 'control_repeat':
                push(`for _ in range(S.repeat_count(${n('TIMES')})):`);
                lines.push(...body('SUBSTACK', loopYield));
                return;
            case 'control_forever':
                push('while True:');
                lines.push(...body('SUBSTACK', loopYield));
                return;
            case 'control_if':
                push(`if ${b('CONDITION')}:`);
                lines.push(...body('SUBSTACK'));
                return;
            case 'control_if_else':
                push(`if ${b('CONDITION')}:`);
                lines.push(...body('SUBSTACK'));
                push('else:');
                lines.push(...body('SUBSTACK2'));
                return;
            case 'control_wait_until':
                push(`while not ${b('CONDITION')}:`);
                push('    yield');
                return;
            case 'control_repeat_until':
                push(`while not ${b('CONDITION')}:`);
                lines.push(...body('SUBSTACK', loopYield));
                return;
            case 'control_while':
                push(`while ${b('CONDITION')}:`);
                lines.push(...body('SUBSTACK', loopYield));
                return;
            case 'control_for_each': {
                loopDepth++;
                const counter = `i${loopDepth}`;
                push(`for ${counter} in range(1, int(S.num(${raw(i('VALUE'), args)})) + 1):`);
                lines.push(`${pad}    ${varRef(field(node, 'VARIABLE'))} = ${counter}`);
                lines.push(...body('SUBSTACK', loopYield));
                loopDepth--;
                return;
            }
            case 'control_all_at_once':
                lines.push(...block(node.branches.SUBSTACK || [], indent, args));
                return;
            case 'control_stop': {
                const option = String(field(node, 'STOP_OPTION'));
                if (option === 'all') {
                    push('game.stop_all()');
                    push('return');
                } else if (option === 'this script') {
                    push('return');
                } else {
                    push('me.stop_other_scripts()');
                }
                return;
            }
            case 'control_create_clone_of': push(`me.create_clone(${r('CLONE_OPTION')})`); return;
            case 'control_delete_this_clone':
                push('if me.delete_clone():');
                push('    return');
                return;
            case 'control_incr_counter': push('game.counter += 1'); return;
            case 'control_clear_counter': push('game.counter = 0'); return;
            case 'sensing_askandwait': push(`yield from game.ask(me, ${r('QUESTION')})`); return;
            case 'sensing_setdragmode': push(`me.set_drag_mode(${py(field(node, 'DRAG_MODE'))})`); return;
            case 'sensing_resettimer': push('game.reset_timer()'); return;
            case 'data_setvariableto': push(`${varRef(field(node, 'VARIABLE'))} = ${r('VALUE')}`); return;
            case 'data_changevariableby': {
                const v = varRef(field(node, 'VARIABLE'));
                push(`${v} = S.num(${v}) + ${n('VALUE')}`);
                return;
            }
            case 'data_showvariable':
            case 'data_hidevariable':
            case 'data_showlist':
            case 'data_hidelist': {
                const v = field(node, node.op.endsWith('list') ? 'LIST' : 'VARIABLE');
                if (!monitorIds.has(v.id)) needMonitor.set(v.id, v);
                push(`game.show_monitor(${py(v.id)}, ${node.op.startsWith('data_show') ? 'True' : 'False'})`);
                return;
            }
            case 'data_addtolist': push(`S.list_add(${varRef(field(node, 'LIST'))}, ${r('ITEM')})`); return;
            case 'data_deleteoflist': push(`S.list_delete(${varRef(field(node, 'LIST'))}, ${r('INDEX')})`); return;
            case 'data_deletealloflist': push(`S.list_delete_all(${varRef(field(node, 'LIST'))})`); return;
            case 'data_insertatlist':
                push(`S.list_insert(${varRef(field(node, 'LIST'))}, ${r('INDEX')}, ${r('ITEM')})`);
                return;
            case 'data_replaceitemoflist':
                push(`S.list_replace(${varRef(field(node, 'LIST'))}, ${r('INDEX')}, ${r('ITEM')})`);
                return;
            case 'pen_clear': push('game.pen_clear()'); return;
            case 'pen_stamp': push('me.stamp()'); return;
            case 'pen_penDown': push('me.pen_down()'); return;
            case 'pen_penUp': push('me.pen_up()'); return;
            case 'pen_setPenColorToColor': push(`me.set_pen_color(${r('COLOR')})`); return;
            case 'pen_changePenColorParamBy': push(`me.change_pen_param(${r('COLOR_PARAM')}, ${n('VALUE')})`); return;
            case 'pen_setPenColorParamTo': push(`me.set_pen_param(${r('COLOR_PARAM')}, ${n('VALUE')})`); return;
            case 'pen_changePenSizeBy': push(`me.change_pen_size(${n('SIZE')})`); return;
            case 'pen_setPenSizeTo': push(`me.set_pen_size(${n('SIZE')})`); return;
            case 'procedures_call': {
                const proccode = node.mutation && node.mutation.proccode;
                const proc = procs.get(proccode);
                if (!proc) {
                    note(where, `the custom block "${proccode}" is used but not defined; it does nothing`);
                    return;
                }
                const values = proc.argIds.map((id, k) => {
                    const given = (node.inputs || {})[id];
                    if (proc.argKinds[k] === 'boolean') return given ? bool(given, args) : 'False';
                    return given ? raw(given, args) : '""';
                });
                push(`yield from ${proc.fn}(${['me', 'warp', ...values].join(', ')})`);
                return;
            }
            }
            if (node.op.startsWith('pen_')) note(where, `the old pen block "${node.op}" is not exported`);
            else note(where, `the block "${node.op}" is not exported; it does nothing`);
            push(`pass  # not exported: ${node.op}`);
        };

        const hatCode = script => {
            const hat = script.hat;
            const v = spriteVar.get(target);
            let decorator;
            let comment;
            let base;
            switch (hat.op) {
            case 'event_whenflagclicked':
                decorator = `${v}.when_flag_clicked`;
                comment = 'when green flag clicked';
                base = 'on_green_flag';
                break;
            case 'event_whenkeypressed':
                decorator = `${v}.when_key_pressed(${py(hat.fields.KEY_OPTION)})`;
                comment = `when ${hat.fields.KEY_OPTION} key pressed`;
                base = `on_${snake(hat.fields.KEY_OPTION) || 'key'}_key`;
                break;
            case 'event_whenthisspriteclicked':
                decorator = `${v}.when_this_sprite_clicked`;
                comment = 'when this sprite clicked';
                base = 'on_click';
                break;
            case 'event_whenstageclicked':
                decorator = `${v}.when_stage_clicked`;
                comment = 'when stage clicked';
                base = 'on_stage_click';
                break;
            case 'event_whenbroadcastreceived':
                decorator = `${v}.when_i_receive(${py(hat.fields.BROADCAST_OPTION)})`;
                comment = `when I receive ${hat.fields.BROADCAST_OPTION}`;
                base = `on_${snake(hat.fields.BROADCAST_OPTION) || 'message'}`;
                break;
            case 'event_whenbackdropswitchesto':
                decorator = `${v}.when_backdrop_switches_to(${py(hat.fields.BACKDROP)})`;
                comment = `when backdrop switches to ${hat.fields.BACKDROP}`;
                base = `on_backdrop_${snake(hat.fields.BACKDROP) || 'change'}`;
                break;
            case 'event_whengreaterthan': {
                const menu = String(hat.fields.WHENGREATERTHANMENU || 'TIMER').toUpperCase();
                if (menu !== 'TIMER') note(where, 'a "when loudness >" script never starts: the export has no microphone');
                decorator = `${v}.when_greater_than(${py(menu)}, lambda me: ${num(hat.inputs.VALUE, null)})`;
                comment = `when ${menu.toLowerCase()} > ...`;
                base = `on_${menu.toLowerCase()}`;
                break;
            }
            case 'control_start_as_clone':
                decorator = `${v}.when_i_start_as_a_clone`;
                comment = 'when I start as a clone';
                base = 'on_clone_start';
                break;
            default:
                return;
            }
            const lines = block(script.body, 1, null);
            emit(`# ${comment}`);
            emit(`@${decorator}`);
            emit(`def ${name(`${prefix}_${base}`)}(me, warp=False):`);
            if (!lines.length) emit('    pass');
            for (const l of lines) emit(l);
            emit('');
            emit('');
        };

        const procCode = proc => {
            const params = new Map();
            const paramName = makeNamer();
            ['me', 'warp'].forEach(p => paramName(p));
            proc.argNames.forEach(argName => params.set(argName, paramName(snake(argName) || 'value')));
            emit(`# define ${proc.proccode.replace(/%[snb]/g, '( )')}${proc.warp ? ' (run without screen refresh)' : ''}`);
            emit('@custom_block');
            emit(`def ${proc.fn}(${['me', 'warp', ...params.values()].join(', ')}):`);
            const lines = block(proc.body, 1, params);
            if (proc.warp) emit('    warp = True');
            if (!lines.length && !proc.warp) emit('    pass');
            for (const l of lines) emit(l);
            emit('');
            emit('');
        };

        return {procs, hatCode, procCode};
    };

    // --- the file ---
    const opts = project.options;
    emit(`"""${String(title).replace(/"""/g, '')}: made in Flipwarp (Scratch) and exported as Python.`);
    emit('');
    emit('Each script is a function. Where Scratch lets other scripts have a turn (each time');
    emit('round a loop, a wait), the script says "yield". scratch_runtime.py runs them the way');
    emit('Scratch does: me is the sprite (or clone) running the script, G its variables for all');
    emit('sprites, L the lists. Run it with:  python main.py   (needs:  pip install pygame)');
    emit('"""');
    emit('');
    emit('import math');
    emit('');
    emit('from scratch_runtime import Game, S, custom_block');
    emit('');
    emit(`game = Game(width=${opts.width}, height=${opts.height}, framerate=${opts.framerate}, ` +
        `fencing=${opts.fencing ? 'True' : 'False'}, ` +
        `max_clones=${Number.isFinite(opts.maxClones) ? opts.maxClones : 'math.inf'}, title=${py(title)})`);
    emit('');

    // A costume whose SVG became a PNG drawn at twice its size (scale 2) keeps its
    // turning point in the PNG's pixels and is shown at half its pixel size.
    const costumeSpec = c => {
        const f = files[c.md5ext] || {file: c.md5ext};
        const k = f.scale || 1;
        const resolution = f.scale ? f.scale : c.bitmapResolution;
        return `{'name': ${py(c.name)}, 'file': ${py(f.file)}, 'center_x': ${c.rotationCenterX * k}, ` +
            `'center_y': ${c.rotationCenterY * k}, 'resolution': ${resolution}}`;
    };
    const soundSpec = s => `{'name': ${py(s.name)}, 'file': ${py((files[s.md5ext] || {}).file || s.md5ext)}, ` +
        `'rate': ${s.rate || 0}, 'sample_count': ${s.sampleCount || 0}}`;
    const valuesSpec = list => `{${list.map(v => `${py(v.name)}: ${py(typeof v.value === 'undefined' ? 0 : v.value)}`)
        .join(', ')}}`;

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
        emit(t.isStage ? '# ===== The Stage =====' : `# ===== Sprite: ${t.name} =====`);
        const spec = [
            `name=${py(t.name)}`,
            ...(t.isStage ? [] : [`x=${py(t.x)}`, `y=${py(t.y)}`, `direction=${py(t.direction)}`,
                `size=${py(t.size)}`, `visible=${py(t.visible)}`, `rotation_style=${py(t.rotationStyle)}`,
                `draggable=${py(t.draggable)}`]),
            `volume=${py(t.volume)}`,
            `costume=${t.currentCostume}`,
            `costumes=[${t.costumes.map(costumeSpec).join(',\n        ')}]`,
            `sounds=[${t.sounds.map(soundSpec).join(',\n        ')}]`,
            `variables=${valuesSpec(t.isStage ? stageVars : t.variables)}`,
            `lists=${valuesSpec(t.isStage ? stageLists : t.lists)}`
        ];
        emit(`${v} = game.${t.isStage ? 'add_stage' : 'add_sprite'}(`);
        spec.forEach((line, k) => emit(`    ${line}${k < spec.length - 1 ? ',' : ''}`));
        emit(')');
        if (t.isStage) {
            emit('G = stage.vars   # variables for all sprites');
            emit('L = stage.lists  # lists for all sprites');
        }
        emit('');
    }
    emit('');

    for (const {t, gen} of generated) {
        if (!t.scripts.length && !t.procedures.length) continue;
        emit(t.isStage ? '# ===== The Stage\'s scripts =====' : `# ===== ${t.name}'s scripts =====`);
        emit('');
        for (const proc of gen.procs.values()) gen.procCode(proc);
        for (const script of t.scripts) gen.hatCode(script);
    }

    const owner = v => (v.global ? 'stage' : spriteVar.get(project.sprites.find(s => s.name === v.owner)));
    const monitorLines = [];
    const addMonitor = (m, v) => {
        const target = owner(v);
        if (!target) return;
        const read = `lambda: ${item(`${target}.${v.list ? 'lists' : 'vars'}`, v.name)}`;
        const label = v.global ? v.name : `${v.owner}: ${v.name}`;
        monitorLines.push(`game.add_monitor(id=${py(m.id)}, mode=${py(m.mode || 'default')}, label=${py(label)}, ` +
            `x=${Math.round(m.x || 0)}, y=${Math.round(m.y || 0)}, width=${Math.round(m.width || 0)}, ` +
            `height=${Math.round(m.height || 0)}, visible=${py(!!m.visible)}, read=${read})`);
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
            monitorLines.push(`game.add_monitor(id=${py(m.id)}, mode=${py(m.mode || 'default')}, label=${py(label)}, ` +
                `x=${Math.round(m.x)}, y=${Math.round(m.y)}, visible=${py(!!m.visible)}, read=lambda: ${code})`);
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
        emit('# ===== Variable and list readouts =====');
        monitorLines.forEach(l => emit(l));
        emit('');
        emit('');
    }

    emit('if __name__ == \'__main__\':');
    emit('    game.run()');
    emit('');

    for (const ext of project.extensions.filter(e => e !== 'pen')) {
        note('Project', `the "${ext}" extension is not exported; its blocks do nothing`);
    }
    for (const t of project.targets) {
        if (t.variables.some(v => v.cloud)) note(t.name, 'cloud variables are ordinary variables in the export');
    }
    return {code: out.join('\n'), notes};
};
