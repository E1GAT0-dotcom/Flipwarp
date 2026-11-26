/* eslint-disable no-use-before-define */
// Reading Flipwarp's own exported code back into Flipwarp text, for a script
// that was edited on Code.org (or anywhere). The code uses the export's runtime
// (me.moveSteps(10), G.score, S.join(a, b)...), so each call maps back to the
// block it came from. Three spellings of the same thing are read:
// - Web Lab: ordinary JavaScript with generators (yield where a script waits),
// - Game Lab: older JavaScript, each waiting script a "state machine",
// - Python: the same calls in snake_case (python-parse.js reads it).
// What cannot be read is reported, and the script keeps its old blocks.

export class DecompileError extends Error {}

const fail = (what, node) => {
    throw new DecompileError(node && node.loc ? `${what} (line ${node.loc.start.line})` : what);
};

const camel = name => String(name).replace(/_([a-z0-9])/g, (m, c) => c.toUpperCase());

// Other spellings of the runtime's names, mapped to the one used below.
const ALIAS = {
    mouseXPosition: 'mouseX', mouseYPosition: 'mouseY', currentTime: 'current', mouseIsDown: 'mouseDown',
    repeatCount: 'num', setSoundEffect: 'setSoundEffect'
};

// The text is read by Flipwarp's own parser, which takes JSON-style strings.
const str = value => JSON.stringify(String(value));
// Whether a piece of text is one thing on its own (a number, a string, a name,
// one call, or ! before one of those), so it needs no brackets round it.
const atomic = text => {
    const t = String(text).trim();
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t) || /^[\w.$]+$/.test(t)) return true;
    if (/^"([^"\\]|\\.)*"$/.test(t)) return true;
    if (t.startsWith('!')) return atomic(t.slice(1));
    // A call or a bracketed expression: the first bracket must close at the very end.
    const m = /^[\w.$]*\(/.exec(t);
    if (!m) return false;
    let depth = 0;
    let inStr = false;
    for (let i = m[0].length - 1; i < t.length; i++) {
        const c = t[i];
        if (inStr) {
            if (c === '\\') i++;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '(') depth++;
        else if (c === ')') {
            depth--;
            if (depth === 0) return i === t.length - 1;
        }
    }
    return false;
};
const numText = value => {
    if (!Number.isFinite(value)) return str(value);
    return String(value);
};

/**
 * @param {object} env what the code's names mean:
 *   variable(name, {global, list}) -> the text name of a variable or list (declared if new),
 *   broadcast(name) -> the text name of a message,
 *   proc(fn) -> {ident, argCount} for a custom block's function, or null,
 *   monitor(id) -> {ident, list} for a readout's variable, or null,
 *   lang: 'js' | 'gamelab' | 'py'
 * @returns {object} {hatLine, procLine, body}
 */
export const makeDecompiler = env => {
    const py = env.lang === 'py';
    const nameOf = name => {
        const n = py ? camel(name) : name;
        return ALIAS[n] || n;
    };
    // Function parameters of the custom block being read: code name -> text name.
    let params = new Map();

    // --- names -------------------------------------------------------------
    const keyOf = node => {
        if (!node) return null;
        if (!node.computed && node.property && node.property.type === 'Identifier') return node.property.name;
        if (node.computed && node.property && node.property.type === 'Literal') return String(node.property.value);
        return null;
    };
    const isId = (node, name) => node && node.type === 'Identifier' && node.name === name;
    const isMember = (node, objectName, prop) => node && node.type === 'MemberExpression' &&
        isId(node.object, objectName) && (prop === undefined || nameOf(keyOf(node)) === prop);
    // G.x, me.vars.x, L.x, me.lists.x: a variable or list, or null.
    const varOf = node => {
        if (!node || node.type !== 'MemberExpression') return null;
        const key = keyOf(node);
        if (key === null) return null;
        if (isId(node.object, 'G')) return {name: key, global: true, list: false};
        if (isId(node.object, 'L')) return {name: key, global: true, list: true};
        if (isMember(node.object, 'me', 'vars')) return {name: key, global: false, list: false};
        if (isMember(node.object, 'me', 'lists')) return {name: key, global: false, list: true};
        return null;
    };
    const varText = v => env.variable(v.name, v);
    const listText = node => {
        const v = varOf(node);
        if (!v || !v.list) fail('a list was expected', node);
        return varText(v);
    };

    // --- expressions --------------------------------------------------------
    // Each gives {t: text, b: whether it is a true/false block}.
    const V = t => ({t, b: false});
    const B = t => ({t, b: true});
    const wrap = e => (atomic(e.t) ? e.t : `(${e.t})`);
    // A value slot: true and false become the words Scratch would show.
    const value = node => {
        const e = expr(node);
        return e.t;
    };
    // A true/false slot: a value is compared, as the text asks.
    const cond = node => {
        if (!node) return '(1 == 0)';
        if (node.type === 'Literal' && typeof node.value === 'boolean') return node.value ? '(1 == 1)' : '(1 == 0)';
        const e = expr(node);
        if (e.b) return e.t;
        return `(${wrap(e)} == "true")`;
    };
    const call = (name, args) => `${name}(${args.join(', ')})`;
    // A dropdown's value, which the text writes as a string.
    const menu = node => {
        if (node && node.type === 'Literal') return str(node.value);
        return value(node);
    };

    const runtimeCall = node => {
        // {object, name, args} for me.x(...), game.x(...), S.x(...), or a getter read as a property.
        let callee = node;
        let args = [];
        if (node.type === 'CallExpression') {
            callee = node.callee;
            args = node.arguments;
        }
        if (!callee || callee.type !== 'MemberExpression' || callee.object.type !== 'Identifier') return null;
        const key = keyOf(callee);
        if (key === null) return null;
        return {object: callee.object.name, name: nameOf(key), args};
    };

    const BIN = {'+': '+', '-': '-', '*': '*', '/': '/', '%': '%'};

    const expr = node => {
        if (!node) return V('""');
        switch (node.type) {
        case 'Literal':
            if (typeof node.value === 'number') return V(numText(node.value));
            if (typeof node.value === 'boolean') return V(str(node.value));
            if (node.value === null) return V('""');
            return V(str(node.value));
        case 'TemplateLiteral':
            if (node.expressions.length === 0) return V(str(node.quasis.map(q => q.value.cooked).join('')));
            break;
        case 'Identifier':
            if (params.has(node.name)) return V(params.get(node.name));
            if (node.name === 'NaN') return V('"NaN"');
            if (node.name === 'Infinity') return V('"Infinity"');
            if (node.name === 'undefined') return V('""');
            fail(`"${node.name}" is not something this export knows`, node);
            break;
        case 'UnaryExpression':
            if (node.operator === '!' || node.operator === 'not') return B(`!${wrapB(node.argument)}`);
            if (node.operator === '-') {
                if (node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
                    return V(numText(-node.argument.value));
                }
                return V(`0 - ${wrap(expr(node.argument))}`);
            }
            if (node.operator === '+') return expr(node.argument);
            break;
        case 'BinaryExpression': {
            const op = node.operator;
            const l = () => wrap(expr(node.left));
            const r = () => wrap(expr(node.right));
            if (BIN[op]) {
                // "+" with text on either side joins, as JavaScript would.
                if (op === '+' && (isText(node.left) || isText(node.right))) return V(call('join', [value(node.left), value(node.right)]));
                return V(`${l()} ${BIN[op]} ${r()}`);
            }
            if (op === '//') return V(call('mathOp', ['"floor"', `${l()} / ${r()}`]));
            if (op === '===' || op === '==') return B(`${l()} == ${r()}`);
            if (op === '!==' || op === '!=') return B(`!(${l()} == ${r()})`);
            if (op === '<' || op === '>') return B(`${l()} ${op} ${r()}`);
            if (op === '<=') return B(`!(${l()} > ${r()})`);
            if (op === '>=') return B(`!(${l()} < ${r()})`);
            break;
        }
        case 'LogicalExpression':
            if (node.operator === '&&' || node.operator === 'and') return B(`${wrapB(node.left)} && ${wrapB(node.right)}`);
            if (node.operator === '||' || node.operator === 'or') return B(`${wrapB(node.left)} || ${wrapB(node.right)}`);
            break;
        case 'MemberExpression': {
            const v = varOf(node);
            if (v) return V(varText(v));
            // L.x.length, a list's length.
            if (!node.computed && keyOf(node) === 'length' && varOf(node.object)) {
                return V(call('lengthOfList', [listText(node.object)]));
            }
            if (isId(node.object, 'Math') && keyOf(node) === 'PI') return V('3.141592653589793');
            return reporter(node);
        }
        case 'CallExpression': {
            if (node.callee.type === 'Identifier') {
                const fn = node.callee.name;
                if ((fn === 'int' || fn === 'float' || fn === 'str' || fn === 'Number' || fn === 'String') &&
                    node.arguments.length === 1) return expr(node.arguments[0]);
                if (fn === 'len' && node.arguments.length === 1 && varOf(node.arguments[0])) {
                    return V(call('lengthOfList', [listText(node.arguments[0])]));
                }
                if (fn === 'round' && node.arguments.length === 1) return V(call('round', [value(node.arguments[0])]));
                if (fn === 'abs' && node.arguments.length === 1) return V(call('mathOp', ['"abs"', value(node.arguments[0])]));
            }
            return reporter(node);
        }
        case 'ConditionalExpression':
            fail('"? :" has no block; use if and a variable', node);
            break;
        }
        fail(`this kind of code (${node.type}) has no block`, node);
        return V('0');
    };
    const wrapB = node => {
        const t = cond(node);
        return atomic(t) ? t : `(${t})`;
    };
    // Whether a value is surely text, so "+" means join.
    const isText = node => (node.type === 'Literal' && typeof node.value === 'string' &&
            Number.isNaN(Number(node.value))) ||
        (node.type === 'CallExpression' && runtimeCall(node) && ['join', 'letterOf'].includes(runtimeCall(node).name));

    const reporter = node => {
        const rc = runtimeCall(node);
        if (!rc) fail('this call has no block', node);
        const {object, name, args} = rc;
        const a = k => args[k];
        const v = k => value(a(k));
        if (object === 'Math') {
            const simple = {round: 'round'};
            if (simple[name]) return V(call('round', [v(0)]));
            const ops = {abs: 'abs', floor: 'floor', ceil: 'ceiling', sqrt: 'sqrt', sin: null, cos: null};
            if (name in ops && ops[name]) return V(call('mathOp', [str(ops[name]), v(0)]));
            if (name === 'random' && !args.length) return V('pickRandom(0, 0.9999999)');
            fail(`Math.${name} has no block`, node);
        }
        if (object === 'S') {
            switch (name) {
            case 'num': case 'bool': case 'str': return expr(a(0));
            case 'random': return V(call('pickRandom', [v(0), v(1)]));
            case 'eq': return B(`${wrap(expr(a(0)))} == ${wrap(expr(a(1)))}`);
            case 'gt': return B(`${wrap(expr(a(0)))} > ${wrap(expr(a(1)))}`);
            case 'lt': return B(`${wrap(expr(a(0)))} < ${wrap(expr(a(1)))}`);
            case 'join': return V(call('join', [v(0), v(1)]));
            case 'letterOf': return V(call('letterOf', [v(0), v(1)]));
            case 'lengthOf': return V(call('lengthOf', [v(0)]));
            case 'contains': return B(call('contains', [v(0), v(1)]));
            case 'mod': return V(`${wrap(expr(a(0)))} % ${wrap(expr(a(1)))}`);
            case 'div': return V(`${wrap(expr(a(0)))} / ${wrap(expr(a(1)))}`);
            case 'round': return V(call('round', [v(0)]));
            case 'mathop': return V(call('mathOp', [menu(a(0)), v(1)]));
            case 'listItem': return V(call('itemOfList', [listText(a(0)), v(1)]));
            case 'listIndexOf': return V(call('itemNumberInList', [listText(a(0)), v(1)]));
            case 'listContains': return B(call('listContains', [listText(a(0)), v(1)]));
            case 'listContents': return V(listText(a(0)));
            }
        }
        if (object === 'me') {
            switch (name) {
            case 'xPosition': return V('xPosition()');
            case 'yPosition': return V('yPosition()');
            case 'direction': return V('direction()');
            case 'size': return V('size()');
            case 'volume': return V('volume()');
            case 'costumeNumber': return V('costume("number")');
            case 'costumeName': return V('costume("name")');
            case 'touching': return B(call('touching', [menu(a(0))]));
            case 'touchingColor': return B(call('touchingColor', [v(0)]));
            case 'distanceTo': return V(call('distanceTo', [menu(a(0))]));
            }
        }
        if (object === 'game') {
            switch (name) {
            case 'answer': return V('answer()');
            case 'keyPressed': return B(call('keyPressed', [menu(a(0))]));
            case 'mouseDown': return B('mouseDown()');
            case 'mouseX': return V('mouseX()');
            case 'mouseY': return V('mouseY()');
            case 'loudness': return V('loudness()');
            case 'timer': return V('timer()');
            case 'propertyOf': return V(call('propertyOf', [menu(a(0)), menu(a(1))]));
            case 'current': return V(call('current', [menu(a(0))]));
            case 'daysSince2000': return V('daysSince2000()');
            case 'username': return V('username()');
            case 'counter': return V('counter()');
            case 'backdropNumber': return V('backdrop("number")');
            case 'backdropName': return V('backdrop("name")');
            }
        }
        fail(`${object}.${name} has no block`, node);
        return V('0');
    };

    // --- statements ---------------------------------------------------------
    const IND = '  ';
    const indent = lines => lines.map(l => IND + l);
    const block = (head, body) => [`${head} {`, ...indent(body), '}'];

    // A statement that waits gives way here: "yield", "if (!warp) yield",
    // Game Lab's "return YIELD": none is a block of its own.
    const isPause = st => {
        if (!st) return false;
        if (st.type === 'ExpressionStatement' && st.expression.type === 'YieldExpression' &&
            !st.expression.delegate) return true;
        if (st.type === 'IfStatement' && !st.alternate && st.test.type === 'UnaryExpression' &&
            (st.test.operator === '!' || st.test.operator === 'not') && isId(st.test.argument, 'warp')) {
            const body = bodyOf(st.consequent);
            return body.length === 1 && isPause(body[0]);
        }
        return false;
    };
    const bodyOf = st => (!st ? [] : st.type === 'BlockStatement' ? st.body : [st]);
    // A loop body ends with "if (!warp) yield;", which the loop block brings with it.
    const loopBody = st => {
        const list = bodyOf(st).slice();
        while (list.length && isPause(list[list.length - 1])) list.pop();
        return list;
    };

    // The statement that a call is (me.moveSteps(10)...), or null.
    const callStatement = (node, delegate) => {
        const rc = runtimeCall(node);
        if (!rc || node.type !== 'CallExpression') return null;
        const {object, name, args} = rc;
        const v = k => value(args[k]);
        const m = k => menu(args[k]);
        const s = (n, list) => `${call(n, list)};`;
        if (object === 'me') {
            const plain = {
                moveSteps: () => s('move', [v(0)]),
                turnRight: () => s('turnRight', [v(0)]),
                turnLeft: () => s('turnLeft', [v(0)]),
                goToTarget: () => s('goTo', [m(0)]),
                goTo: () => s('goToXY', [v(0), v(1)]),
                setDirection: () => s('pointInDirection', [v(0)]),
                pointTowards: () => s('pointTowards', [m(0)]),
                changeX: () => s('changeX', [v(0)]),
                setX: () => s('setX', [v(0)]),
                changeY: () => s('changeY', [v(0)]),
                setY: () => s('setY', [v(0)]),
                bounceOnEdge: () => s('ifOnEdgeBounce', []),
                setRotationStyle: () => s('setRotationStyle', [m(0)]),
                say: () => s('say', [v(0)]),
                think: () => s('think', [v(0)]),
                switchCostume: () => s('switchCostume', [m(0)]),
                nextCostume: () => s('nextCostume', []),
                changeSize: () => s('changeSize', [v(0)]),
                setSize: () => s('setSize', [v(0)]),
                setEffect: () => s('setEffect', [effect(args[0]), v(1)]),
                changeEffect: () => s('changeEffect', [effect(args[0]), v(1)]),
                clearEffects: () => s('clearGraphicEffects', []),
                show: () => s('show', []),
                hide: () => s('hide', []),
                goToLayer: () => s('goToLayer', [m(0)]),
                changeLayer: () => s('changeLayer', [m(0), v(1)]),
                startSound: () => s('startSound', [m(0)]),
                changeVolume: () => s('changeVolume', [v(0)]),
                setVolume: () => s('setVolume', [v(0)]),
                setSoundEffect: () => s('setSoundEffect', [soundEffect(args[0]), v(1)]),
                changeSoundEffect: () => s('changeSoundEffect', [soundEffect(args[0]), v(1)]),
                clearSoundEffects: () => s('clearSoundEffects', []),
                createClone: () => s('createCloneOf', [m(0)]),
                stopOtherScripts: () => s('stop', ['"other scripts in sprite"']),
                setDragMode: () => s('setDragMode', [m(0)]),
                stamp: () => s('pen.stamp', []),
                penDown: () => s('pen.penDown', []),
                penUp: () => s('pen.penUp', []),
                setPenColor: () => s('pen.setPenColorTo', [v(0)]),
                changePenParam: () => s('pen.changePenBy', [m(0), v(1)]),
                setPenParam: () => s('pen.setPenTo', [m(0), v(1)]),
                changePenSize: () => s('pen.changePenSizeBy', [v(0)]),
                setPenSize: () => s('pen.setPenSizeTo', [v(0)]),
                // These wait, so Web Lab writes "yield*" before them and Game Lab runs them as a machine.
                glideToTarget: () => s('glideTo', [v(0), m(1)]),
                glideTo: () => s('glideToXY', [v(0), v(1), v(2)]),
                sayFor: () => s('sayFor', [v(0), v(1)]),
                thinkFor: () => s('thinkFor', [v(0), v(1)]),
                playSoundUntilDone: () => s('playSoundUntilDone', [m(0)])
            };
            if (plain[name]) return plain[name]();
        }
        if (object === 'game') {
            const plain = {
                switchBackdrop: () => (args[0] && args[0].type === 'Literal' && args[0].value === 'next backdrop' ?
                    s('nextBackdrop', []) : s('switchBackdrop', [m(0)])),
                stopAllSounds: () => s('stopAllSounds', []),
                broadcast: () => s('broadcast', [message(args[0])]),
                resetTimer: () => s('resetTimer', []),
                penClear: () => s('pen.eraseAll', []),
                showMonitor: () => {
                    const shown = args[1] && args[1].type === 'Literal' ? !!args[1].value : true;
                    const found = args[0] && args[0].type === 'Literal' ? env.monitor(String(args[0].value)) : null;
                    if (!found) fail('a readout this project does not have', node);
                    return s(found.list ? (shown ? 'showList' : 'hideList') : (shown ? 'showVariable' : 'hideVariable'),
                        [found.ident]);
                },
                wait: () => s('wait', [v(0)]),
                switchBackdropAndWait: () => s('switchBackdropAndWait', [m(0)]),
                broadcastAndWait: () => s('broadcastAndWait', [message(args[0])]),
                ask: () => s('askAndWait', [v(1)])
            };
            if (plain[name]) return plain[name]();
        }
        if (object === 'S') {
            const plain = {
                listAdd: () => s('addToList', [listText(args[0]), v(1)]),
                listDelete: () => s('deleteOfList', [listText(args[0]), v(1)]),
                listDeleteAll: () => s('deleteAllOfList', [listText(args[0])]),
                listInsert: () => s('insertInList', [listText(args[0]), v(1), v(2)]),
                listReplace: () => s('replaceInList', [listText(args[0]), v(1), v(2)])
            };
            if (plain[name]) return plain[name]();
        }
        if (delegate === undefined) return null;
        return null;
    };
    const effect = node => menu(node).toUpperCase();
    const soundEffect = node => menu(node).toUpperCase();
    const message = node => {
        if (node && node.type === 'Literal') return env.broadcast(String(node.value));
        fail('a message whose name is worked out as the game runs has no block here', node);
        return '';
    };
    // A custom block called: fn(me, warp, ...values).
    const procCall = node => {
        if (!node || node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return null;
        const proc = env.proc(node.callee.name);
        if (!proc) return null;
        const values = node.arguments.slice(2);
        const parts = [];
        for (let k = 0; k < proc.argKinds.length; k++) {
            const given = values[k];
            parts.push(proc.argKinds[k] === 'boolean' ? (given ? cond(given) : '(1 == 0)') : (given ? value(given) : '""'));
        }
        return `${call(proc.ident, parts)};`;
    };

    // An assignment: "x = 5" or "x = S.num(x) + 1" (change by), or the counter.
    const assignment = (node, st) => {
        const target = node.left;
        if (isMember(target, 'game', 'counter')) {
            if (node.operator === '=' && node.right.type === 'Literal' && node.right.value === 0) return 'clearCounter();';
            return 'incrementCounter();';
        }
        if (isId(target, 'warp')) return null;
        const v = varOf(target);
        if (!v || v.list) fail('only variables can be set here', st);
        const name = varText(v);
        if (node.operator === '+=') return `${name} += ${value(node.right)};`;
        if (node.operator === '-=') return `${name} += ${wrap(expr({type: 'UnaryExpression', operator: '-',
            argument: node.right}))};`;
        if (node.operator !== '=') fail(`"${node.operator}" has no block`, st);
        const r = node.right;
        // x = S.num(x) + n  (and x = x + n) is "change x by n".
        if (r.type === 'BinaryExpression' && r.operator === '+') {
            const left = r.left.type === 'CallExpression' && runtimeCall(r.left) && runtimeCall(r.left).name === 'num' ?
                r.left.arguments[0] : r.left;
            const same = varOf(left);
            if (same && same.name === v.name && same.global === v.global) return `${name} += ${value(r.right)};`;
        }
        return `${name} = ${value(r)};`;
    };

    // Structured code: Web Lab and Python (and Game Lab's code with no waits in it).
    const statements = list => {
        const out = [];
        for (let k = 0; k < list.length; k++) {
            const st = list[k];
            // "game.stopAll(); return;" is one block: stop all.
            if (st.type === 'ExpressionStatement' && isStopAll(st.expression) && list[k + 1] &&
                list[k + 1].type === 'ReturnStatement') {
                out.push('stop("all");');
                k++;
                continue;
            }
            out.push(...statement(st));
        }
        return out;
    };
    const isStopAll = node => node && node.type === 'CallExpression' && runtimeCall(node) &&
        runtimeCall(node).object === 'game' && runtimeCall(node).name === 'stopAll';
    const isDeleteClone = node => node && node.type === 'CallExpression' && runtimeCall(node) &&
        runtimeCall(node).object === 'me' && runtimeCall(node).name === 'deleteClone';

    const statement = st => {
        switch (st.type) {
        case 'EmptyStatement':
            return [];
        case 'BlockStatement':
            return statements(st.body);
        case 'ExpressionStatement': {
            let e = st.expression;
            if (isPause(st)) return [];
            if (e.type === 'YieldExpression') {
                if (!e.argument) return [];
                // yield game.NEXT_FRAME, after a volume change: part of that block.
                if (e.argument.type === 'MemberExpression') return [];
                e = e.argument;
            }
            if (e.type === 'AssignmentExpression') {
                const line = assignment(e, st);
                return line ? [line] : [];
            }
            if (e.type === 'UpdateExpression' && isMember(e.argument, 'game', 'counter')) return ['incrementCounter();'];
            if (e.type === 'UpdateExpression' && varOf(e.argument)) {
                return [`${varText(varOf(e.argument))} += ${e.operator === '++' ? 1 : -1};`];
            }
            if (isStopAll(e)) return ['stop("all");'];
            const line = callStatement(e) || procCall(e);
            if (line) return [line];
            fail('this line has no block', st);
            break;
        }
        case 'IfStatement': {
            // if (me.deleteClone()) return;  is "delete this clone".
            if (isDeleteClone(st.test)) return ['deleteThisClone();'];
            const then = statements(bodyOf(st.consequent));
            if (!st.alternate) return block(`if (${cond(st.test)})`, then);
            return [`if (${cond(st.test)}) {`, ...indent(then), '} else {',
                ...indent(statements(bodyOf(st.alternate))), '}'];
        }
        case 'ReturnStatement':
            return ['stop("this script");'];
        case 'ForStatement': {
            // for (;;) {...}  forever
            if (!st.init && !st.test && !st.update) return block('forever', statements(loopBody(st.body)));
            // for (let i1 = 0, n1 = Math.round(T); i1 < n1; i1++)  repeat T
            const decls = st.init && st.init.type === 'VariableDeclaration' ? st.init.declarations : [];
            if (decls.length === 2 && st.test && st.test.type === 'BinaryExpression') {
                if (st.test.operator === '<') {
                    let times = decls[1].init;
                    if (times && times.type === 'CallExpression' && runtimeCall(times) &&
                        runtimeCall(times).name === 'round') times = times.arguments[0];
                    return block(`repeat (${value(times)})`, statements(loopBody(st.body)));
                }
                if (st.test.operator === '<=') {
                    // for (let n1 = V, i1 = 1; i1 <= n1; i1++) { X = i1; ... }  for each X in V
                    const body = loopBody(st.body);
                    const first = body.shift();
                    const v = first && first.type === 'ExpressionStatement' && varOf(first.expression.left);
                    if (!v) fail('a "for each" loop without its variable', st);
                    return block(`forEach(${varText(v)}, ${value(decls[0].init)})`, statements(body));
                }
            }
            // Any other for loop written by hand: repeat it, counting with a variable.
            fail('this kind of "for" loop has no block: use repeat', st);
            break;
        }
        case 'PyFor': {
            // for _ in range(S.repeat_count(T)):  repeat T
            const it = st.iter;
            if (it.type === 'CallExpression' && isId(it.callee, 'range')) {
                if (it.arguments.length === 1) {
                    return block(`repeat (${value(it.arguments[0])})`, statements(loopBody(st.body)));
                }
                if (it.arguments.length === 2) {
                    const body = loopBody(st.body);
                    const first = body.shift();
                    const v = first && first.type === 'ExpressionStatement' && varOf(first.expression.left);
                    if (!v) fail('a "for each" loop without its variable', st);
                    // range(1, int(S.num(V)) + 1)
                    let top = it.arguments[1];
                    if (top.type === 'BinaryExpression' && top.operator === '+') top = top.left;
                    return block(`forEach(${varText(v)}, ${value(top)})`, statements(body));
                }
            }
            fail('this kind of "for" loop has no block: use repeat', st);
            break;
        }
        case 'WhileStatement': {
            const test = st.test;
            if (test.type === 'Literal' && test.value === true) return block('forever', statements(loopBody(st.body)));
            const body = bodyOf(st.body);
            const negated = test.type === 'UnaryExpression' && (test.operator === '!' || test.operator === 'not');
            // while (!c) yield;  wait until c
            if (negated && body.length && body.every(isPause)) return [`waitUntil(${cond(test.argument)});`];
            if (negated) return block(`repeatUntil (${cond(test.argument)})`, statements(loopBody(st.body)));
            return block(`while (${cond(test)})`, statements(loopBody(st.body)));
        }
        }
        fail(`this kind of code (${st.type}) has no block`, st);
        return [];
    };

    // --- Game Lab: a state machine back into blocks --------------------------
    // The writer (export/gamelab.js) lowers each script into numbered steps in a
    // switch. This reads the steps in order and undoes each lowering it uses.
    const machine = fnBody => {
        const sw = findSwitch(fnBody);
        if (!sw) return statements(fnBody.filter(st => st.type !== 'VariableDeclaration'));
        const items = [];
        for (const c of sw.cases) {
            items.push({label: c.test ? Number(c.test.value) : -2});
            for (const st of c.consequent) items.push({st});
        }
        let i = 0;
        const peek = (k = 0) => items[i + k];
        const stAt = k => (peek(k) && peek(k).st) || null;
        const labelAt = k => (peek(k) && 'label' in peek(k) ? peek(k).label : null);
        const isState = (st, id) => st && st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' &&
            isId(st.expression.left, 'state') && st.expression.right.type === 'Literal' &&
            (id === undefined || st.expression.right.value === id) ? st.expression.right.value : null;
        const stateOf = st => {
            if (!st || st.type !== 'ExpressionStatement' || st.expression.type !== 'AssignmentExpression' ||
                !isId(st.expression.left, 'state')) return null;
            const r = st.expression.right;
            if (r.type === 'Literal') return r.value;
            if (r.type === 'UnaryExpression' && r.operator === '-' && r.argument.type === 'Literal') return -r.argument.value;
            return null;
        };
        const isContinue = st => st && st.type === 'ContinueStatement';
        const isReturnOf = (st, name) => st && st.type === 'ReturnStatement' && st.argument && isId(st.argument, name);
        // if (!warp) return YIELD;
        const isWarpYield = st => st && st.type === 'IfStatement' && !st.alternate && st.test.type === 'UnaryExpression' &&
            isId(st.test.argument, 'warp') && bodyOf(st.consequent).length === 1 &&
            isReturnOf(bodyOf(st.consequent)[0], 'YIELD');
        // if (X) { state = E; continue; }   -> {test: X, exit: E}
        const exitTest = st => {
            if (!st || st.type !== 'IfStatement' || st.alternate) return null;
            const body = bodyOf(st.consequent);
            if (body.length !== 2 || stateOf(body[0]) === null || !isContinue(body[1])) return null;
            return {test: st.test, exit: stateOf(body[0])};
        };
        // state = -1; return DONE;
        const isDone = k => stateOf(stAt(k)) === -1 && isReturnOf(stAt(k + 1), 'DONE');

        // The plain statements inside a machine can still say "state = -1; return DONE;".
        const plainList = list => {
            const out = [];
            for (let k = 0; k < list.length; k++) {
                const st = list[k];
                if (stateOf(st) === -1 && isReturnOf(list[k + 1], 'DONE')) {
                    out.push('stop("this script");');
                    k++;
                    continue;
                }
                if (st.type === 'ExpressionStatement' && isStopAll(st.expression) && stateOf(list[k + 1]) === -1) {
                    out.push('stop("all");');
                    k += 2;
                    continue;
                }
                if (st.type === 'IfStatement') {
                    if (isDeleteClone(st.test)) {
                        out.push('deleteThisClone();');
                        continue;
                    }
                    const then = plainList(bodyOf(st.consequent));
                    if (!st.alternate) out.push(...block(`if (${cond(st.test)})`, then));
                    else {
                        out.push(`if (${cond(st.test)}) {`, ...indent(then), '} else {',
                            ...indent(plainList(bodyOf(st.alternate))), '}');
                    }
                    continue;
                }
                out.push(...statement(st));
            }
            return out;
        };

        // Read steps until the stop the caller is waiting for.
        //   loopTop: the loop being read ends at "state = top; if (!warp) return YIELD; continue;"
        //   until: a step number that ends this part (an if's "otherwise", a loop's end)
        const seq = (loopTop, until) => {
            const out = [];
            for (;;) {
                const item = peek();
                if (!item) return {out, end: 'eof'};
                if ('label' in item) {
                    if (item.label === until) return {out, end: 'label'};
                    i++;
                    continue;
                }
                const st = item.st;
                const s = stateOf(st);
                // The end of the loop being read.
                if (loopTop !== null && s === loopTop && isWarpYield(stAt(1)) && isContinue(stAt(2))) {
                    i += 3;
                    return {out, end: 'loop'};
                }
                // An if with waits in it ends its first part with "state = end; continue;".
                if (until !== null && s !== null && s !== -1 && isContinue(stAt(1)) && labelAt(2) === until) {
                    i += 2;
                    return {out, end: 'jump', to: s};
                }
                // Stop: "state = -1; return DONE;" (after game.stopAll(); for stop all).
                if (isDone(0)) {
                    i += 2;
                    out.push('stop("this script");');
                    continue;
                }
                if (st.type === 'ExpressionStatement' && isStopAll(st.expression) && isDone(1)) {
                    i += 3;
                    out.push('stop("all");');
                    continue;
                }
                // sub = X; state = k; case k: r = sub.next(); if (!r.done) return r;  -> X, which waits.
                if (st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' &&
                    isId(st.expression.left, 'sub')) {
                    const k = stateOf(stAt(1));
                    if (k === null || labelAt(2) !== k) fail('a wait that is not in the usual form', st);
                    i += 5;
                    const x = st.expression.right;
                    out.push(callStatement(x) || procCall(x) || fail('a wait with no block', st));
                    continue;
                }
                if (s !== null && s >= 0 && labelAt(1) === s) {
                    const after = stAt(2);
                    // state = k; case k: if (!C) return YIELD;   -> wait until C
                    if (after && after.type === 'IfStatement' && !after.alternate &&
                        bodyOf(after.consequent).length === 1 && isReturnOf(bodyOf(after.consequent)[0], 'YIELD') &&
                        !isId(after.test.argument, 'warp')) {
                        i += 3;
                        const t = after.test;
                        out.push(`waitUntil(${t.type === 'UnaryExpression' && t.operator === '!' ?
                            cond(t.argument) : `!${wrapB(t)}`});`);
                        continue;
                    }
                    const exit = exitTest(after);
                    // A while loop's exit step comes straight after its loop back; a forever
                    // whose first block is an if that waits has the if's end before it.
                    const exitAt = exit ? items.findIndex((it, k) => k > i + 2 && it.label === exit.exit) : -1;
                    const isLoopExit = exitAt > 2 && stateOf(items[exitAt - 3].st) === s &&
                        isWarpYield(items[exitAt - 2].st) && isContinue(items[exitAt - 1].st);
                    if (exit && isLoopExit) {
                        // state = top; case top: if (STOP) { state = end; continue; } body... loop back; case end:
                        i += 3;
                        const body = seq(s, null);
                        if (body.end !== 'loop') fail('a loop that does not go round', st);
                        const t = exit.test;
                        if (t.type === 'UnaryExpression' && t.operator === '!') {
                            out.push(...block(`while (${cond(t.argument)})`, body.out));
                        } else {
                            out.push(...block(`repeatUntil (${cond(t)})`, body.out));
                        }
                        continue;
                    }
                    // state = top; case top: body... loop back  -> forever
                    i += 2;
                    const body = seq(s, null);
                    if (body.end === 'loop') {
                        out.push(...block('forever', body.out));
                        continue;
                    }
                    // Just the next step: carry on.
                    out.push(...body.out);
                    return {out, end: body.end};
                }
                // state = k; return NEXT_FRAME; case k:  (after a volume change)
                if (s !== null && isReturnOf(stAt(1), 'NEXT_FRAME')) {
                    i += 2;
                    continue;
                }
                // i1 = 0; n1 = Math.round(T); case top: if (i1 >= n1) { state = end; continue; } i1++; ...
                if (st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' &&
                    st.expression.left.type === 'Identifier' && /^i\d+$/.test(st.expression.left.name)) {
                    const counter = st.expression.left.name;
                    const countSt = stAt(1);
                    const top = labelAt(2);
                    const exit = exitTest(stAt(3));
                    if (!countSt || top === null || !exit) fail('a repeat that is not in the usual form', st);
                    i += 5; // i = 0; n = ...; case top; if (...) {...}; i++;
                    const countExpr = countSt.expression.right;
                    let forEachVar = null;
                    const maybe = stAt(0);
                    if (maybe && maybe.type === 'ExpressionStatement' && maybe.expression.type === 'AssignmentExpression' &&
                        varOf(maybe.expression.left) && isId(maybe.expression.right, counter)) {
                        forEachVar = varOf(maybe.expression.left);
                        i++;
                    }
                    const body = seq(top, null);
                    if (body.end !== 'loop') fail('a repeat that does not go round', st);
                    if (forEachVar) {
                        out.push(...block(`forEach(${varText(forEachVar)}, ${value(countExpr)})`, body.out));
                    } else {
                        let times = countExpr;
                        if (times.type === 'CallExpression' && runtimeCall(times) && runtimeCall(times).name === 'round') {
                            times = times.arguments[0];
                        }
                        out.push(...block(`repeat (${value(times)})`, body.out));
                    }
                    continue;
                }
                // if (!C) { state = otherwise; continue; } then... [state = end; continue; case otherwise: else...] case end:
                const branch = exitTest(st);
                if (branch) {
                    i++;
                    const t = branch.test;
                    const c = t.type === 'UnaryExpression' && t.operator === '!' ? cond(t.argument) : `!${wrapB(t)}`;
                    const then = seq(loopTop, branch.exit);
                    if (then.end === 'jump') {
                        // case otherwise:
                        i++;
                        const otherwise = seq(loopTop, then.to);
                        if (otherwise.end === 'label') i++;
                        out.push(`if (${c}) {`, ...indent(then.out), '} else {', ...indent(otherwise.out), '}');
                    } else {
                        if (then.end === 'label') i++;
                        out.push(...block(`if (${c})`, then.out));
                    }
                    continue;
                }
                i++;
                out.push(...plainList([st]));
            }
        };
        const result = seq(null, null);
        return result.out;
    };
    const findSwitch = body => {
        // ... return machine(function () { for (;;) { switch (state) {...} ... } });
        for (const st of body) {
            if (st.type !== 'ReturnStatement' || !st.argument || st.argument.type !== 'CallExpression') continue;
            const fn = st.argument.arguments[0];
            if (!fn || !fn.body) continue;
            for (const inner of fn.body.body) {
                if (inner.type !== 'ForStatement') continue;
                const sw = bodyOf(inner.body).find(s => s.type === 'SwitchStatement');
                if (sw) return sw;
            }
        }
        return null;
    };

    // --- whole scripts --------------------------------------------------------
    const scriptBody = fnBody => {
        const list = fnBody.filter(st => !(st.type === 'ExpressionStatement' &&
            st.expression.type === 'AssignmentExpression' && isId(st.expression.left, 'warp')));
        if (env.lang === 'gamelab') return machine(list);
        return statements(list);
    };

    const HATS = {
        whenFlagClicked: () => 'whenGreenFlagClicked',
        whenKeyPressed: a => `whenKeyPressed(${menu(a[0])})`,
        whenThisSpriteClicked: () => 'whenThisSpriteClicked',
        whenStageClicked: () => 'whenStageClicked',
        whenIReceive: a => `whenIReceive(${message(a[0])})`,
        whenBackdropSwitchesTo: a => `whenBackdropSwitchesTo(${menu(a[0])})`,
        whenGreaterThan: a => {
            const fn = a[1];
            let body = fn && fn.body;
            if (body && body.type === 'BlockStatement') {
                const ret = body.body.find(st => st.type === 'ReturnStatement');
                body = ret && ret.argument;
            }
            return `whenGreaterThan(${menu(a[0])}, ${value(body)})`;
        },
        whenIStartAsAClone: () => 'whenIStartAsAClone'
    };

    /**
     * A script: sprite.whenSomething(..., function (me, warp) {...}) or, in
     * Python, the decorator and the def.
     * @param {string} hat the hat's name in the code
     * @param {Array} args the hat's other arguments
     * @param {Array} fnBody the function's statements
     * @returns {string} the script as text
     */
    const hatScript = (hat, args, fnBody) => {
        params = new Map();
        const head = HATS[nameOf(hat)];
        if (!head) fail(`"${hat}" is not a hat this export writes`);
        return block(head(args), scriptBody(fnBody)).join('\n');
    };

    /**
     * A custom block's definition.
     * @param {string} header the "define ..." line, as the old text had it
     * @param {Array<string>} codeParams the function's parameters after me and warp
     * @param {Array<string>} paramTexts the text names those parameters have
     * @param {Array} fnBody the function's statements
     * @returns {string} the definition as text
     */
    const procScript = (header, codeParams, paramTexts, fnBody) => {
        params = new Map(codeParams.map((p, k) => [p, paramTexts[k]]));
        try {
            return block(header, scriptBody(fnBody)).join('\n');
        } finally {
            params = new Map();
        }
    };

    return {hatScript, procScript};
};
