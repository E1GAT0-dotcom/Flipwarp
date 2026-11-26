/* eslint-disable no-use-before-define */
// A Game Lab program (one written on Code.org, not exported from Flipwarp)
// translated into a Scratch project. The whole program becomes one sprite,
// "Game", which draws everything on the pen layer in the order Game Lab draws
// it: background, shapes, sprites (stamped from their animations), text.
// Game Lab's sprites are numbers that index lists (x, y, velocity...), so
// createSprite, groups, collisions and destroy work as they do in Game Lab.
// Each function is a custom block run without screen refresh; draw() runs
// once a frame, 30 times a second, as in Game Lab.

import {Parser} from 'acorn';
import md5 from 'js-md5';
import {parse} from '../parse.js';
import {buildTarget} from '../build.js';
import {SPRITE_LISTS, OTHER_LISTS, RUNTIME_VARS, RUNTIME_TEXT, COLOR_NAMES, COSTUME_BY_VARIABLE} from './gamelab-runtime-text.js';
import {CHARS, glyphRows} from './gamelab-font.js';

class Unsupported extends Error {}

const str = v => JSON.stringify(String(v));
const num = v => (Number.isFinite(v) ? String(v) : '0');
const IND = '  ';
const indent = lines => lines.map(l => IND + l);
const block = (head, body) => [`${head} {`, ...indent(body), '}'];
const safe = name => String(name).replace(/[^A-Za-z0-9_]/g, c => `_${c.charCodeAt(0).toString(16)}`);

// Whether a piece of text is one thing on its own, needing no brackets.
const atomic = text => {
    const t = String(text).trim();
    if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t) || /^[\w.$]+$/.test(t) || /^"([^"\\]|\\.)*"$/.test(t)) return true;
    if (t.startsWith('!')) return atomic(t.slice(1));
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
const w = t => (atomic(t) ? t : `(${t})`);

// Game Lab's key names, as Scratch's.
const KEY = name => {
    const k = String(name).toLowerCase();
    const map = {left: 'left arrow', right: 'right arrow', up: 'up arrow', down: 'down arrow', left_arrow: 'left arrow',
        right_arrow: 'right arrow', up_arrow: 'up arrow', down_arrow: 'down arrow', ' ': 'space', return: 'enter'};
    return map[k] || k;
};

// Sprite properties: Game Lab's name -> {list, kind}.
const PROPS = {
    x: {list: 'sx'}, y: {list: 'sy'}, velocityX: {list: 'svx'}, velocityY: {list: 'svy'},
    rotation: {list: 'srot'}, rotationSpeed: {list: 'srs'}, scale: {list: 'sscale'},
    visible: {list: 'svis', bool: true}, width: {list: 'sw'}, height: {list: 'sh'}, depth: {list: 'sdepth'},
    lifetime: {list: 'slife'}, rotateToDirection: {list: 'srtd', bool: true}, shapeColor: {list: 'scolor', color: true},
    bounciness: {list: 'sbounce'}
};

const parseJs = code => Parser.parse(code, {ecmaVersion: 'latest', sourceType: 'script', locations: true,
    allowReturnOutsideFunction: true, allowHashBang: true});

// Pictures' sizes, read from their files.
const pictureSize = (data, ext) => {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (ext === 'png' && data.length > 24) return [v.getUint32(16), v.getUint32(20)];
    if (ext === 'gif' && data.length > 10) return [v.getUint16(6, true), v.getUint16(8, true)];
    if ((ext === 'jpg' || ext === 'jpeg') && data.length > 4) {
        let i = 2;
        while (i + 9 < data.length) {
            if (data[i] !== 0xff) break;
            const marker = data[i + 1];
            const len = v.getUint16(i + 2);
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                return [v.getUint16(i + 7), v.getUint16(i + 5)];
            }
            i += 2 + len;
        }
    }
    if (ext === 'svg') {
        const text = new TextDecoder().decode(data);
        const wm = /<svg[^>]*\bwidth="([\d.]+)/.exec(text);
        const hm = /<svg[^>]*\bheight="([\d.]+)/.exec(text);
        if (wm && hm) return [Number(wm[1]), Number(hm[1])];
        const vb = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(text);
        if (vb) return [Number(vb[1]), Number(vb[2])];
    }
    return [100, 100];
};

const BLANK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2" viewBox="0 0 2 2"></svg>';
const WHITE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">' +
    '<rect width="400" height="400" fill="#ffffff"/></svg>';

/**
 * Translate a Game Lab program.
 * @param {object} file the program: a .js file, or Code.org's main.json for a project
 * @param {Array<object>} all every file given, for the pictures (animations) and sounds
 * @param {object} helpers {redraw, crop} from the editor
 * @returns {Promise<{project: object, assets: object, notes: Array<string>, title: string}>} the project
 */
export const translateGameLab = async (file, all, helpers = {}) => {
    let code = file.text;
    let manifest = null;
    if (/\.json$/i.test(file.name)) {
        const json = JSON.parse(file.text);
        code = String(json.source || '');
        manifest = json.animations || null;
    }
    const title = file.name.replace(/\.(js|json)$/i, '').replace(/^(code|main)$/i, 'Game Lab project');
    let ast;
    try {
        ast = parseJs(code);
    } catch (e) {
        throw new Error(`The Game Lab code could not be read: ${e.message}`);
    }
    const t = new Translator(ast);
    const text = t.program();

    // --- the sprite's costumes: a blank one, the animations, the letters ---
    const assets = {};
    const add = (data, ext) => {
        const id = md5(data);
        assets[`${id}.${ext}`] = data;
        return id;
    };
    const svg = s => new TextEncoder().encode(s);
    const blankId = add(svg(BLANK_SVG), 'svg');
    const costumes = [{name: 'fw blank', assetId: blankId, md5ext: `${blankId}.svg`, dataFormat: 'svg',
        bitmapResolution: 1, rotationCenterX: 1, rotationCenterY: 1}];
    const animations = [];
    const pictures = all.filter(f => /\.(png|jpe?g|gif|svg|webp)$/i.test(f.name));
    const used = t.animationsUsed;
    const frames = {};
    if (manifest && manifest.propsByKey) {
        for (const props of Object.values(manifest.propsByKey)) frames[props.name] = props;
    }
    for (const pic of pictures) {
        let ext = pic.name.split('.').pop()
            .toLowerCase();
        if (ext === 'jpeg') ext = 'jpg';
        const name = pic.name.replace(/\.[^.]+$/, '');
        let data = pic.data;
        if (ext === 'webp') {
            if (!helpers.redraw) continue;
            data = await helpers.redraw(data, 'image/webp', 1);
            ext = 'png';
        }
        let [width, height] = pictureSize(data, ext);
        const props = frames[name];
        if (props && props.frameCount > 1 && props.frameSize && helpers.crop && ext !== 'svg') {
            data = await helpers.crop(data, `image/${ext === 'jpg' ? 'jpeg' : ext}`, 0, 0, props.frameSize.x,
                props.frameSize.y);
            ext = 'png';
            width = props.frameSize.x;
            height = props.frameSize.y;
            t.notes.add(`The animation "${name}" has ${props.frameCount} frames; only its first is used.`);
        }
        const id = add(data, ext);
        costumes.push({name, assetId: id, md5ext: `${id}.${ext}`, dataFormat: ext, bitmapResolution: 1,
            rotationCenterX: width / 2, rotationCenterY: height / 2});
        animations.push({name, width, height});
    }
    const missing = [...used].filter(name => !animations.some(a => a.name === name));
    if (missing.length) {
        t.notes.add(`These animations were not found, so their sprites are boxes: ${missing.slice(0, 8).join(', ')}` +
            `${missing.length > 8 ? '...' : ''}. Choose their pictures (named like "${missing[0]}.png") with the code.`);
    }
    for (const ch of CHARS) {
        costumes.push({name: `~${ch}`, assetId: blankId, md5ext: `${blankId}.svg`, dataFormat: 'svg',
            bitmapResolution: 1, rotationCenterX: 1, rotationCenterY: 1});
    }
    const sounds = [];
    for (const name of t.soundsUsed) {
        const f = all.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (!f) {
            t.notes.add(`The sound "${name}" was not found (Code.org's sound library is not on this computer), ` +
                'so it does not play. Choose the .mp3 with the code to add it.');
            continue;
        }
        const ext = f.name.split('.').pop()
            .toLowerCase();
        const id = add(f.data, ext);
        sounds.push({name: name.replace(/\.[^.]+$/, ''), assetId: id, md5ext: `${id}.${ext}`, dataFormat: ext,
            rate: 44100, sampleCount: 0});
    }

    // --- the project ---
    const whiteId = add(svg(WHITE_SVG), 'svg');
    const colors = Object.entries({skyblue: 0x87ceeb, salmon: 0xfa8072, gold: 0xffd700, lightgreen: 0x90ee90,
        orchid: 0xda70d6, coral: 0xff7f50, ...COLOR_NAMES});
    const stage = {
        isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {},
        comments: {
            twconfig: {blockId: null, x: 0, y: 0, width: 350, height: 170, minimized: false,
                text: 'Configuration for https://turbowarp.org/\nYou can move, resize, and minimize this comment, ' +
                    'but don\'t edit it by hand. This comment can be deleted to remove the stored settings.\n' +
                    `${JSON.stringify({framerate: t.framerate, runtimeOptions: {fencing: false, miscLimits: false},
                        width: 400, height: 400})} // _twconfig_`}
        },
        currentCostume: 0,
        costumes: [{name: 'backdrop1', assetId: whiteId, md5ext: `${whiteId}.svg`, dataFormat: 'svg',
            bitmapResolution: 1, rotationCenterX: 200, rotationCenterY: 200}],
        sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on',
        textToSpeechLanguage: null
    };
    const setList = (id, name, value) => {
        stage.lists[id] = [name, value];
    };
    setList('fw-anim-names', OTHER_LISTS.animNames, animations.map(a => a.name));
    setList('fw-anim-w', OTHER_LISTS.animW, animations.map(a => a.width));
    setList('fw-anim-h', OTHER_LISTS.animH, animations.map(a => a.height));
    setList('fw-font', OTHER_LISTS.fwFont, glyphRows());
    setList('fw-color-names', OTHER_LISTS.colorNames, colors.map(([n]) => n));
    setList('fw-color-values', OTHER_LISTS.colorValues, colors.map(([, v]) => v));
    const game = {
        isStage: false, name: 'Game', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0, costumes, sounds, volume: 100, layerOrder: 1, visible: false, x: 0, y: 0, size: 100,
        direction: 90, draggable: false, rotationStyle: 'all around'
    };
    const project = {targets: [stage, game], monitors: [], extensions: ['pen'],
        meta: {semver: '3.0.0', vm: '0.2.0', agent: 'Flipwarp import from Code.org Game Lab'}};
    const ctx = {globals: {variables: stage.variables, lists: stage.lists}, broadcasts: stage.broadcasts};
    let built;
    try {
        built = buildTarget(parse(text), game, ctx);
    } catch (e) {
        throw new Error(`The translated program could not be made into blocks (${e.message}${
            e.line ? `, line ${e.line}` : ''}).`);
    }
    game.blocks = built.blocks;
    game.comments = built.comments;
    for (const c of built.created) {
        if (c.kind === 'broadcast') stage.broadcasts[c.id] = c.name;
        else if (c.kind === 'list') stage.lists[c.id] = [c.name, []];
        else stage.variables[c.id] = [c.name, 0];
    }
    // "switch costume to (fw costume)": the variable dropped into the dropdown.
    const costumeVar = Object.entries(stage.variables).find(([, v]) => v[0] === RUNTIME_VARS.fwCostume);
    for (const b of Object.values(game.blocks)) {
        if (!b || b.opcode !== 'looks_switchcostumeto' || !costumeVar) continue;
        const input = b.inputs.COSTUME;
        const shadow = input && game.blocks[input[1]];
        if (!shadow || !shadow.fields || !shadow.fields.COSTUME || shadow.fields.COSTUME[0] !== COSTUME_BY_VARIABLE) continue;
        shadow.fields.COSTUME = ['fw blank', null];
        b.inputs.COSTUME = [3, [12, costumeVar[1][0], costumeVar[0]], input[1]];
    }
    return {project, assets, notes: [...t.notes], title, text};
};

// The translation itself: JavaScript in, Flipwarp text out.
class Translator {
    constructor (ast) {
        this.ast = ast;
        this.notes = new Set();
        this.decls = new Map(); // ident -> declaration line
        this.functions = new Map(); // name -> {node, params, ident, returns}
        this.globals = new Set();
        this.groups = new Map(); // JS name -> list ident
        this.arrays = new Map(); // scope key -> list ident
        this.types = new Map(); // scope key -> kind
        this.keys = new Set();
        this.mouseEdges = false;
        this.animationsUsed = new Set();
        this.soundsUsed = new Set();
        this.framerate = 30;
        this.tempCount = 0;
        this.loopCount = 0;
        this.callbacks = [];
        this.callbackInfo = new Map();
        this.scope = null; // the function being translated, or null at the top
        for (const [ident, name] of Object.entries(SPRITE_LISTS)) this.declare(ident, name, 'list');
        for (const [ident, name] of Object.entries(OTHER_LISTS)) this.declare(ident, name, 'list');
        for (const [ident, name] of Object.entries(RUNTIME_VARS)) this.declare(ident, name, 'variable');
    }

    declare (ident, name, kind) {
        if (!this.decls.has(ident)) this.decls.set(ident, `global ${kind} ${ident} as ${str(name)};`);
        return ident;
    }
    note (what, node) {
        this.notes.add(node && node.loc ? `${what} (line ${node.loc.start.line})` : what);
    }
    temp () {
        return this.declare(`fwTmp${++this.tempCount}`, `fw temp ${this.tempCount}`, 'variable');
    }

    // --- names ---
    keyOf (name, fn = this.scope) {
        return fn && fn.locals.has(name) ? `${fn.name}.${name}` : name;
    }
    varIdent (name, fn = this.scope) {
        const local = fn && fn.locals.has(name);
        if (local) return this.declare(`v_${safe(fn.name)}__${safe(name)}`, `${fn.name}: ${name}`, 'variable');
        this.globals.add(name);
        return this.declare(`v_${safe(name)}`, name, 'variable');
    }
    listIdent (name, fn = this.scope) {
        const local = fn && fn.locals.has(name);
        const ident = local ? `l_${safe(fn.name)}__${safe(name)}` : `l_${safe(name)}`;
        return this.declare(ident, local ? `${fn.name}: ${name}` : name, 'list');
    }
    groupIdent (name) {
        if (name === 'allSprites') return 'allSprites';
        if (!this.groups.has(name)) this.groups.set(name, this.declare(`g_${safe(name)}`, `${name} (group)`, 'list'));
        return this.groups.get(name);
    }
    typeOf (name) {
        return this.types.get(this.keyOf(name)) || 'any';
    }

    // --- looking at the program first ---
    scan () {
        const top = this.ast.body;
        const fnOf = (name, node) => {
            const locals = new Set(node.params.map(p => (p.type === 'Identifier' ? p.name : p.left && p.left.name)));
            const walk = n => {
                if (!n || typeof n !== 'object') return;
                if (Array.isArray(n)) {
                    n.forEach(walk);
                    return;
                }
                if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') locals.add(d.id.name);
                if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') return;
                for (const k of Object.keys(n)) if (k !== 'loc' && n[k] && typeof n[k] === 'object') walk(n[k]);
            };
            walk(node.body);
            return {name, node, params: node.params.map(p => (p.type === 'Identifier' ? p.name : p.left.name)), locals,
                ident: `u_${safe(name)}`, returns: false};
        };
        for (const st of top) {
            if (st.type === 'FunctionDeclaration') this.functions.set(st.id.name, fnOf(st.id.name, st));
            if (st.type === 'VariableDeclaration') {
                for (const d of st.declarations) {
                    if (d.init && (d.init.type === 'FunctionExpression' || d.init.type === 'ArrowFunctionExpression')) {
                        this.functions.set(d.id.name, fnOf(d.id.name, d.init));
                    }
                }
            }
        }
        // Whether each function gives back a value.
        for (const fn of this.functions.values()) {
            const walk = n => {
                if (!n || typeof n !== 'object') return;
                if (Array.isArray(n)) return n.forEach(walk);
                if (n.type === 'ReturnStatement' && n.argument) fn.returns = true;
                if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') return;
                for (const k of Object.keys(n)) if (k !== 'loc' && n[k] && typeof n[k] === 'object') walk(n[k]);
            };
            walk(fn.node.body.type === 'BlockStatement' ? fn.node.body.body : []);
        }
        // What kind of value each variable holds, from what is put in it.
        const assigned = new Map();
        const put = (key, value) => {
            if (!assigned.has(key)) assigned.set(key, []);
            assigned.get(key).push(value);
        };
        const visit = (n, fn) => {
            if (!n || typeof n !== 'object') return;
            if (Array.isArray(n)) {
                n.forEach(x => visit(x, fn));
                return;
            }
            if (n.type === 'FunctionDeclaration' || ((n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && n !== (fn && fn.node))) {
                const inner = [...this.functions.values()].find(f => f.node === n);
                if (inner && inner !== fn) {
                    visit(inner.node.body, inner);
                    return;
                }
            }
            const key = name => (fn && fn.locals.has(name) ? `${fn.name}.${name}` : name);
            if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init) put(key(n.id.name), {node: n.init, fn});
            if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && n.operator === '=') {
                put(key(n.left.name), {node: n.right, fn});
            }
            for (const k of Object.keys(n)) if (k !== 'loc' && n[k] && typeof n[k] === 'object') visit(n[k], fn);
        };
        for (const st of top) {
            if (st.type === 'FunctionDeclaration') visit(this.functions.get(st.id.name).node.body, this.functions.get(st.id.name));
            else visit(st, null);
        }
        for (let pass = 0; pass < 3; pass++) {
            for (const [key, values] of assigned) {
                const kinds = new Set(values.map(v => this.classify(v.node, v.fn)));
                kinds.delete('any-null');
                const kind = kinds.size === 1 ? [...kinds][0] : kinds.has('sprite') && kinds.size === 2 && kinds.has('num') ?
                    'sprite' : 'any';
                this.types.set(key, kind);
                if (kind === 'group') {
                    const name = key.includes('.') ? key.split('.').pop() : key;
                    this.groupIdent(name);
                }
            }
        }
        if (this.types.get('edges') === 'edges') this.groupIdent('edges');
    }
    // A shallow look at what kind of value an expression gives.
    classify (n, fn) {
        if (!n) return 'any';
        switch (n.type) {
        case 'Literal':
            if (n.value === null) return 'any-null';
            return typeof n.value === 'boolean' ? 'bool' : typeof n.value === 'string' ? 'str' : 'num';
        case 'TemplateLiteral': return 'str';
        case 'ArrayExpression': return 'array';
        case 'BinaryExpression':
            if (['==', '===', '!=', '!==', '<', '>', '<=', '>='].includes(n.operator)) return 'bool';
            if (n.operator === '+' && (this.classify(n.left, fn) === 'str' || this.classify(n.right, fn) === 'str')) return 'str';
            return 'num';
        case 'LogicalExpression': return 'bool';
        case 'UnaryExpression': return n.operator === '!' ? 'bool' : 'num';
        case 'Identifier': {
            const key = fn && fn.locals.has(n.name) ? `${fn.name}.${n.name}` : n.name;
            return this.types.get(key) || 'any';
        }
        case 'CallExpression': {
            const c = n.callee;
            if (c.type === 'Identifier') {
                if (c.name === 'createSprite') return 'sprite';
                if (c.name === 'createGroup' || c.name === 'Group') return 'group';
                if (c.name === 'createEdgeSprites') return 'edges';
                if (['keyDown', 'keyWentDown', 'keyWentUp', 'mouseDown', 'mouseWentDown', 'mouseWentUp', 'mouseIsOver',
                    'mousePressedOver'].includes(c.name)) return 'bool';
                if (c.name === 'rgb' || c.name === 'color') return 'color';
                return 'num';
            }
            if (c.type === 'MemberExpression' && !c.computed) {
                const m = c.property.name;
                if (m === 'get') return 'sprite';
                if (['isTouching', 'overlap', 'collide', 'bounce', 'bounceOff', 'displace', 'contains', 'includes'].includes(m)) {
                    return 'bool';
                }
            }
            return 'any';
        }
        case 'MemberExpression':
            if (n.computed && n.object.type === 'Identifier' && this.classify(n.object, fn) === 'group') return 'sprite';
            return 'num';
        case 'NewExpression':
            if (n.callee.type === 'Identifier' && n.callee.name === 'Group') return 'group';
            return 'any';
        }
        return 'any';
    }

    // --- the whole program ---
    program () {
        this.scan();
        const init = [];
        for (const st of this.ast.body) {
            if (st.type === 'FunctionDeclaration') continue;
            if (st.type === 'VariableDeclaration' && st.declarations.every(d => d.init &&
                (d.init.type === 'FunctionExpression' || d.init.type === 'ArrowFunctionExpression'))) continue;
            init.push(...this.statement(st));
        }
        const fnTexts = [];
        for (const fn of this.functions.values()) fnTexts.push(this.functionText(fn));
        // Callbacks (overlap(group, function (a, b) {...})) written as they were met.
        for (let k = 0; k < this.callbacks.length; k++) fnTexts.push(this.functionText(this.callbacks[k]));

        const draw = this.functions.get('draw');
        const groupLists = [...new Set(this.groups.values())];
        const keyLines = [];
        for (const k of this.keys) {
            const v = this.keyVar(k);
            keyLines.push(`if (keyPressed(${str(k)})) {`, `${IND}${v} = 1;`, '} else {', `${IND}${v} = 0;`, '}');
        }
        if (this.mouseEdges) {
            this.declare('fwMouseWas', 'fw mouse was down', 'variable');
            keyLines.push('if (mouseDown()) {', `${IND}fwMouseWas = 1;`, '} else {', `${IND}fwMouseWas = 0;`, '}');
        }
        const reset = [
            ...Object.keys(SPRITE_LISTS).map(l => `deleteAllOfList(${l});`),
            'deleteAllOfList(allSprites);', 'deleteAllOfList(fwOrder);',
            ...groupLists.filter(g => g !== 'allSprites').map(g => `deleteAllOfList(${g});`),
            'fillColor = 16777215;', 'fillAlpha = 255;', 'fillOn = 1;', 'strokeColor = 0;', 'strokeAlpha = 255;',
            'strokeOn = 1;', 'strokeWeight = 1;', 'textSize = 12;', 'textAlignH = "left";', 'textAlignV = "baseline";',
            'rectCenter = 0;', 'ellipseCenter = 1;', 'camX = 200;', 'camY = 200;', 'camZoom = 1;', 'camOn = 1;',
            'fwZoom = 1;', 'frameCount = 0;', 'fwDepthDirty = 0;',
            'switchCostume("~ ");', 'fwCharBase = costume("number") - 1;', 'switchCostume("fw blank");',
            'pen.eraseAll();', 'resetTimer();'
        ];
        const destroy = [
            'replaceInList(salive, p_i, 0);',
            'deleteOfList(allSprites, itemNumberInList(allSprites, p_i));',
            'deleteOfList(fwOrder, itemNumberInList(fwOrder, p_i));',
            ...groupLists.filter(g => g !== 'allSprites').flatMap(g => block(`if (listContains(${g}, p_i))`,
                [`deleteOfList(${g}, itemNumberInList(${g}, p_i));`]))
        ];
        const frame = [
            'fw_update();',
            ...(draw ? [`${draw.ident}();`] : []),
            'frameCount += 1;',
            ...keyLines
        ];
        const out = [
            ...this.decls.values(),
            '',
            ...block('whenGreenFlagClicked', [
                'hide();',
                'fw_reset();',
                'fw_init();',
                ...block('forever', ['fw_frame();'])
            ]),
            '',
            ...block('define fast fw_reset() as "fw reset"', reset),
            '',
            ...block('define fast fw_init() as "fw run the program\'s top"', init),
            '',
            ...block('define fast fw_frame() as "fw one frame"', frame),
            '',
            ...block('define fast fw_destroy(p_i) as "fw destroy %s"', destroy),
            '',
            RUNTIME_TEXT,
            ...fnTexts.flatMap(t => [t, ''])
        ];
        return out.join('\n');
    }
    keyVar (k) {
        return this.declare(`fwKey_${safe(k)}`, `fw key ${k} was down`, 'variable');
    }

    functionText (fn) {
        const saved = this.scope;
        this.scope = fn;
        try {
            const params = fn.params.map((p, k) => `p${k}`);
            const label = [fn.name, ...fn.params.map(() => '%s')].join(' ');
            const lines = [];
            fn.params.forEach((p, k) => lines.push(`${this.varIdent(p, fn)} = p${k};`));
            if (fn.returns) {
                const r = this.declare(`r_${safe(fn.name)}`, `${fn.name} gives`, 'variable');
                lines.push(`${r} = "";`);
            }
            const body = fn.node.body.type === 'BlockStatement' ? fn.node.body.body :
                [{type: 'ReturnStatement', argument: fn.node.body, loc: fn.node.loc}];
            for (const st of body) lines.push(...this.statement(st));
            if (this.callsItself(fn)) this.note(`The function ${fn.name} calls itself; Scratch custom blocks share their variables, so it may not work the same`, fn.node);
            return block(`define fast ${fn.ident}(${params.join(', ')}) as ${str(label)}`, lines).join('\n');
        } finally {
            this.scope = saved;
        }
    }
    callsItself (fn) {
        let found = false;
        const walk = n => {
            if (!n || typeof n !== 'object' || found) return;
            if (Array.isArray(n)) return n.forEach(walk);
            if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === fn.name) found = true;
            for (const k of Object.keys(n)) if (k !== 'loc' && n[k] && typeof n[k] === 'object') walk(n[k]);
        };
        walk(fn.node.body);
        return found;
    }

    // --- statements ---
    statement (st) {
        try {
            return this.statementOf(st);
        } catch (e) {
            if (!(e instanceof Unsupported)) throw e;
            this.note(`Left out: ${e.message}`, st);
            return [];
        }
    }
    statements (list) {
        return list.flatMap(st => this.statement(st));
    }
    bodyOf (st) {
        return !st ? [] : st.type === 'BlockStatement' ? st.body : [st];
    }

    statementOf (st) {
        switch (st.type) {
        case 'EmptyStatement':
        case 'FunctionDeclaration':
        case 'DebuggerStatement':
            return [];
        case 'BlockStatement':
            return this.statements(st.body);
        case 'VariableDeclaration':
            return st.declarations.flatMap(d => {
                if (d.id.type !== 'Identifier') throw new Unsupported('this kind of "var"');
                if (!d.init) return [];
                if (d.init.type === 'FunctionExpression' || d.init.type === 'ArrowFunctionExpression') return [];
                return this.assign({type: 'Identifier', name: d.id.name}, '=', d.init, st);
            });
        case 'ExpressionStatement':
            return this.expressionStatement(st.expression, st);
        case 'IfStatement': {
            const pre = [];
            const c = this.cond(st.test, pre);
            const then = this.statements(this.bodyOf(st.consequent));
            if (!st.alternate) return [...pre, ...block(`if (${c})`, then)];
            const otherwise = st.alternate.type === 'IfStatement' ? this.statement(st.alternate) :
                this.statements(this.bodyOf(st.alternate));
            return [...pre, `if (${c}) {`, ...indent(then), '} else {', ...indent(otherwise), '}'];
        }
        case 'ReturnStatement': {
            const fn = this.scope;
            const lines = [];
            if (st.argument && fn && fn.returns) {
                const pre = [];
                const v = this.value(st.argument, pre);
                lines.push(...pre, `r_${safe(fn.name)} = ${v};`);
            }
            lines.push('stop("this script");');
            return lines;
        }
        case 'WhileStatement':
        case 'DoWhileStatement':
        case 'ForStatement':
            return this.loop(st);
        case 'ForInStatement':
        case 'ForOfStatement':
            throw new Unsupported('"for ... in/of" loops');
        case 'SwitchStatement':
            return this.switchOf(st);
        case 'BreakStatement':
        case 'ContinueStatement': {
            const loop = this.loops && this.loops[this.loops.length - 1];
            if (!loop) return [];
            return [`${st.type === 'BreakStatement' ? loop.brk : loop.cont} = 1;`];
        }
        }
        throw new Unsupported(`"${st.type}"`);
    }

    // A loop: while, do-while, for. Scratch has no break or continue, so a
    // loop that uses them gets a flag for each, and what follows one only
    // runs while the flag is down.
    loop (st) {
        const n = ++this.loopCount;
        const uses = (kind) => this.jumps(st.body, kind);
        const loop = {
            brk: uses('BreakStatement') ? this.declare(`fwBrk${n}`, `fw break ${n}`, 'variable') : null,
            cont: uses('ContinueStatement') ? this.declare(`fwCont${n}`, `fw continue ${n}`, 'variable') : null
        };
        this.loops = this.loops || [];
        this.loops.push(loop);
        try {
            const lines = [];
            if (st.type === 'ForStatement' && st.init) {
                if (st.init.type === 'VariableDeclaration') lines.push(...this.statement(st.init));
                else lines.push(...this.expressionStatement(st.init, st));
            }
            if (loop.brk) lines.push(`${loop.brk} = 0;`);
            const body = this.guarded(this.bodyOf(st.body), loop);
            if (loop.cont) body.unshift(`${loop.cont} = 0;`);
            const update = st.type === 'ForStatement' && st.update ? this.expressionStatement(st.update, st) : [];
            const pre = [];
            const c = st.test ? this.cond(st.test, pre) : '(1 == 1)';
            if (st.type === 'DoWhileStatement') {
                lines.push(...body, ...update);
            }
            // The test's own work (a function's value) is redone each time round.
            const again = pre.slice();
            const stop = loop.brk ? `!(${c}) || (${loop.brk} == 1)` : `!${w(c)}`;
            lines.push(...pre);
            lines.push(...block(`repeatUntil (${stop})`, [...body, ...(loop.brk ? block(`if (${loop.brk} == 0)`, update) : update), ...again]));
            return lines;
        } finally {
            this.loops.pop();
        }
    }
    // Whether a break or continue for this loop is somewhere in it.
    jumps (node, kind) {
        let found = false;
        const walk = (n, depth) => {
            if (!n || typeof n !== 'object' || found) return;
            if (Array.isArray(n)) return n.forEach(x => walk(x, depth));
            if (n.type === kind && depth === 0) found = true;
            const inner = ['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForInStatement', 'ForOfStatement']
                .includes(n.type) || (kind === 'BreakStatement' && n.type === 'SwitchStatement');
            if (n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration' || n.type === 'ArrowFunctionExpression') return;
            for (const k of Object.keys(n)) if (k !== 'loc' && n[k] && typeof n[k] === 'object') walk(n[k], inner ? depth + 1 : depth);
        };
        walk(node, 0);
        return found;
    }
    // A loop's body, where everything after a statement that can break or
    // continue only runs if it did not.
    guarded (list, loop) {
        const out = [];
        for (let k = 0; k < list.length; k++) {
            const st = list[k];
            out.push(...this.statement(st));
            const jumps = (loop.brk && this.jumps(st, 'BreakStatement')) || (loop.cont && this.jumps(st, 'ContinueStatement'));
            if (jumps && k < list.length - 1) {
                const flags = [loop.brk && `(${loop.brk} == 0)`, loop.cont && `(${loop.cont} == 0)`].filter(Boolean);
                out.push(...block(`if (${flags.join(' && ')})`, this.guarded(list.slice(k + 1), loop)));
                break;
            }
        }
        return out;
    }
    switchOf (st) {
        const pre = [];
        const subject = this.temp();
        pre.push(`${subject} = ${this.value(st.discriminant, pre)};`);
        // Cases that fall into the next one share its body.
        const arms = [];
        let tests = [];
        for (const c of st.cases) {
            if (c.test) tests.push(c.test);
            const body = c.consequent.filter(s => s.type !== 'BreakStatement');
            if (!c.consequent.length && c.test) continue;
            arms.push({tests: c.test ? tests : null, body});
            tests = [];
        }
        let lines = [];
        for (let k = arms.length - 1; k >= 0; k--) {
            const arm = arms[k];
            const body = this.statements(arm.body);
            if (!arm.tests) {
                lines = body;
                continue;
            }
            const condPre = [];
            const c = arm.tests.map(x => `${subject} == ${w(this.value(x, condPre))}`).join(' || ');
            lines = [...condPre, ...(lines.length ? [`if (${c}) {`, ...indent(body), '} else {', ...indent(lines), '}'] :
                block(`if (${c})`, body))];
        }
        return [...pre, ...lines];
    }

    // --- assignments ---
    expressionStatement (e, st) {
        const pre = [];
        switch (e.type) {
        case 'AssignmentExpression':
            return this.assign(e.left, e.operator, e.right, st);
        case 'UpdateExpression':
            return this.assign(e.argument, e.operator === '++' ? '+=' : '-=', {type: 'Literal', value: 1}, st);
        case 'SequenceExpression':
            return e.expressions.flatMap(x => this.expressionStatement(x, st));
        case 'CallExpression': {
            const lines = this.callStatement(e, pre);
            return [...pre, ...lines];
        }
        case 'LogicalExpression':
        case 'ConditionalExpression':
        case 'Identifier':
        case 'Literal':
        case 'MemberExpression':
            this.value(e, pre);
            return pre;
        }
        throw new Unsupported(`"${e.type}" on its own`);
    }

    assign (left, op, right, st) {
        const pre = [];
        const combine = (current, value) => {
            if (op === '=') return value;
            const o = op.slice(0, -1);
            if (o === '+' && (this.isText(right) || this.isText(left))) return `join(${current}, ${value})`;
            if (['+', '-', '*', '/', '%'].includes(o)) return `${w(current)} ${o} ${w(value)}`;
            throw new Unsupported(`"${op}"`);
        };
        if (left.type === 'Identifier') {
            const name = left.name;
            const kind = this.typeOf(name);
            // A group or an array is a list: what goes in it is added to it.
            if (op === '=' && right.type === 'ArrayExpression') {
                const list = this.listIdent(name);
                const lines = [`deleteAllOfList(${list});`];
                for (const el of right.elements) {
                    const p = [];
                    const v = this.value(el, p);
                    lines.push(...p, `addToList(${list}, ${v});`);
                }
                return lines;
            }
            if (op === '=' && right.type === 'CallExpression' && right.callee.type === 'Identifier' &&
                right.callee.name === 'createEdgeSprites') return this.edges();
            if (kind === 'group' || (op === '=' && this.classify(right, this.scope) === 'group')) {
                const list = this.groupIdent(name);
                return [`deleteAllOfList(${list});`];
            }
            if (kind === 'array' && op === '=') {
                // One array put into another: copied.
                const p = [];
                const from = this.arrayOf(right, p);
                const list = this.listIdent(name);
                const i = this.temp();
                return [...p, `deleteAllOfList(${list});`, `${i} = 1;`, ...block(`repeat (lengthOfList(${from}))`,
                    [`addToList(${list}, itemOfList(${from}, ${i}));`, `${i} += 1;`])];
            }
            if (name === 'frameCount') throw new Unsupported('setting frameCount');
            const v = this.varIdent(name);
            const value = this.value(right, pre);
            if (op === '+=' && !this.isText(right) && this.typeOf(name) !== 'str') return [...pre, `${v} += ${value};`];
            if (op === '-=') return [...pre, `${v} += ${w(`0 - ${w(value)}`)};`];
            return [...pre, `${v} = ${combine(v, value)};`];
        }
        if (left.type === 'MemberExpression') {
            const obj = left.object;
            const prop = !left.computed && left.property.name;
            // World.frameRate = 60, camera.x = 100...
            if (obj.type === 'Identifier' && obj.name === 'World' && prop === 'frameRate') {
                if (right.type === 'Literal' && typeof right.value === 'number') this.framerate = right.value;
                else this.note('World.frameRate set to a value worked out as the game runs; the game runs at 30', st);
                return [];
            }
            if (obj.type === 'Identifier' && obj.name === 'camera' && ['x', 'y', 'zoom'].includes(prop)) {
                const v = {x: 'camX', y: 'camY', zoom: 'camZoom'}[prop];
                const value = this.value(right, pre);
                return [...pre, `${v} = ${combine(v, value)};`];
            }
            if (left.computed) {
                const list = this.arrayOf(obj, pre);
                const index = this.value(left.property, pre);
                const value = this.value(right, pre);
                const current = `itemOfList(${list}, ${w(index)} + 1)`;
                return [...pre, `replaceInList(${list}, ${w(index)} + 1, ${combine(current, value)});`];
            }
            if (prop === 'debug' || prop === 'friction' || prop === 'mass' || prop === 'immovable' ||
                prop === 'restitution' || prop === 'collider' || prop === 'tint' || prop === 'alpha') return [];
            const p = PROPS[prop];
            if (!p) throw new Unsupported(`setting ".${prop}"`);
            const s = this.sprite(obj, pre);
            let value;
            if (p.bool) value = this.oneZero(right, pre);
            else if (p.color) value = this.colorOf([right], pre);
            else value = this.value(right, pre);
            const lines = [...pre, `replaceInList(${p.list}, ${s}, ${combine(`itemOfList(${p.list}, ${s})`, value)});`];
            if (prop === 'depth') lines.push('fwDepthDirty = 1;');
            return lines;
        }
        throw new Unsupported('this kind of assignment');
    }
    // A true/false value as 1 or 0, for the sprite lists.
    oneZero (node, pre) {
        if (node.type === 'Literal') return node.value ? '1' : '0';
        const c = this.cond(node, pre);
        const t = this.temp();
        pre.push(`if (${c}) {`, `${IND}${t} = 1;`, '} else {', `${IND}${t} = 0;`, '}');
        return t;
    }
    edges () {
        const lines = [];
        const make = (name, x, y, wd, ht) => {
            const v = this.varIdent(name, null);
            this.types.set(name, 'sprite');
            lines.push(`fw_create(${x}, ${y}, ${wd}, ${ht});`, `${v} = newSprite;`, `replaceInList(svis, ${v}, 0);`,
                `addToList(${this.groupIdent('edges')}, ${v});`);
        };
        lines.push(`deleteAllOfList(${this.groupIdent('edges')});`);
        make('leftEdge', -50, 200, 100, 400);
        make('rightEdge', 450, 200, 100, 400);
        make('topEdge', 200, -50, 400, 100);
        make('bottomEdge', 200, 450, 400, 100);
        return lines;
    }

    // --- expressions ---
    // Text: does this surely give text, so "+" joins?
    isText (n) {
        if (!n) return false;
        if (n.type === 'Literal' && typeof n.value === 'string') return true;
        if (n.type === 'TemplateLiteral') return true;
        if (n.type === 'BinaryExpression' && n.operator === '+') return this.isText(n.left) || this.isText(n.right);
        if (n.type === 'Identifier') return this.typeOf(n.name) === 'str';
        return false;
    }
    // A condition, for an if or a loop.
    cond (n, pre) {
        const e = this.expr(n, pre);
        if (e.k === 'bool') return e.t;
        if (e.k === 'sprite') return `${w(e.t)} > 0`;
        // JavaScript's "truthy": not 0, not "", not false.
        return `!((${e.t} == 0) || ((${e.t} == "") || (${e.t} == "false")))`;
    }
    // A value. A true/false one is kept as the text "true" or "false", as
    // Scratch shows a true/false block's value.
    value (n, pre) {
        const e = this.expr(n, pre);
        if (e.k !== 'bool') return e.t;
        if (e.t === '(1 == 1)') return '"true"';
        if (e.t === '(1 == 0)') return '"false"';
        const t = this.temp();
        pre.push(`if (${e.t}) {`, `${IND}${t} = "true";`, '} else {', `${IND}${t} = "false";`, '}');
        return t;
    }
    // The list an array expression is.
    arrayOf (n, pre) {
        if (n.type === 'Identifier') return this.listIdent(n.name);
        void pre;
        throw new Unsupported('an array that is not in a variable');
    }
    // The list a group expression is.
    groupOf (n) {
        if (n.type === 'Identifier') {
            if (n.name === 'allSprites') return 'allSprites';
            const kind = this.typeOf(n.name);
            if (kind === 'group' || kind === 'edges' || this.groups.has(n.name)) return this.groupIdent(n.name);
        }
        if (n.type === 'MemberExpression' && !n.computed && n.object.type === 'Identifier' && n.object.name === 'World' &&
            n.property.name === 'allSprites') return 'allSprites';
        return null;
    }
    // A sprite: the number that indexes the lists.
    sprite (n, pre) {
        return w(this.value(n, pre));
    }

    expr (n, pre) {
        const V = (t, k = 'num') => ({t, k});
        switch (n.type) {
        case 'Literal':
            if (typeof n.value === 'number') return V(num(n.value));
            if (typeof n.value === 'boolean') return V(n.value ? '(1 == 1)' : '(1 == 0)', 'bool');
            if (n.value === null) return V('""', 'str');
            if (n.regex) throw new Unsupported('regular expressions');
            return V(str(n.value), 'str');
        case 'TemplateLiteral': {
            let t = null;
            n.quasis.forEach((q, k) => {
                const parts = [];
                if (q.value.cooked) parts.push(str(q.value.cooked));
                if (k < n.expressions.length) parts.push(this.value(n.expressions[k], pre));
                for (const p of parts) t = t === null ? p : `join(${t}, ${p})`;
            });
            return V(t === null ? '""' : t, 'str');
        }
        case 'Identifier':
            return this.identifier(n, pre);
        case 'ThisExpression':
            throw new Unsupported('"this"');
        case 'UnaryExpression':
            if (n.operator === '!') {
                const c = this.cond(n.argument, pre);
                return V(`!${w(c)}`, 'bool');
            }
            if (n.operator === '-') {
                if (n.argument.type === 'Literal' && typeof n.argument.value === 'number') return V(num(-n.argument.value));
                return V(`0 - ${w(this.value(n.argument, pre))}`);
            }
            if (n.operator === '+') return V(this.value(n.argument, pre));
            if (n.operator === 'typeof') throw new Unsupported('"typeof"');
            throw new Unsupported(`"${n.operator}"`);
        case 'BinaryExpression': {
            const op = n.operator;
            if (op === '+' && (this.isText(n.left) || this.isText(n.right))) {
                return V(`join(${this.value(n.left, pre)}, ${this.value(n.right, pre)})`, 'str');
            }
            const l = w(this.value(n.left, pre));
            const r = w(this.value(n.right, pre));
            switch (op) {
            case '+': case '-': case '*': case '/': return V(`${l} ${op} ${r}`);
            case '%': return V(`${l} % ${r}`);
            case '==': case '===': return V(`${l} == ${r}`, 'bool');
            case '!=': case '!==': return V(`!(${l} == ${r})`, 'bool');
            case '<': case '>': return V(`${l} ${op} ${r}`, 'bool');
            case '<=': return V(`!(${l} > ${r})`, 'bool');
            case '>=': return V(`!(${l} < ${r})`, 'bool');
            case '**': return V(this.power(l, r));
            }
            throw new Unsupported(`"${op}"`);
        }
        case 'LogicalExpression': {
            const l = w(this.cond(n.left, pre));
            const r = w(this.cond(n.right, pre));
            if (n.operator === '&&') return V(`${l} && ${r}`, 'bool');
            if (n.operator === '||') return V(`${l} || ${r}`, 'bool');
            throw new Unsupported(`"${n.operator}"`);
        }
        case 'ConditionalExpression': {
            const t = this.temp();
            const c = this.cond(n.test, pre);
            const a = [];
            const av = this.value(n.consequent, a);
            const b = [];
            const bv = this.value(n.alternate, b);
            pre.push(`if (${c}) {`, ...indent([...a, `${t} = ${av};`]), '} else {', ...indent([...b, `${t} = ${bv};`]), '}');
            return V(t, 'any');
        }
        case 'MemberExpression':
            return this.member(n, pre);
        case 'CallExpression':
            return this.call(n, pre);
        case 'NewExpression':
            if (n.callee.type === 'Identifier' && n.callee.name === 'Group') return V('0', 'group');
            throw new Unsupported('"new"');
        case 'AssignmentExpression':
            pre.push(...this.assign(n.left, n.operator, n.right, n));
            return this.expr(n.left, pre);
        case 'UpdateExpression': {
            const before = this.temp();
            pre.push(`${before} = ${this.value(n.argument, pre)};`);
            pre.push(...this.assign(n.argument, n.operator === '++' ? '+=' : '-=', {type: 'Literal', value: 1}, n));
            return V(n.prefix ? this.value(n.argument, pre) : before);
        }
        case 'ArrayExpression':
            throw new Unsupported('an array that is not put straight into a variable');
        case 'ObjectExpression':
            throw new Unsupported('objects ({...})');
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
            throw new Unsupported('a function used as a value');
        }
        throw new Unsupported(`"${n.type}"`);
    }
    power (a, b) {
        if (/^\d+$/.test(b) && Number(b) <= 4) {
            if (Number(b) === 0) return '1';
            return Array(Number(b)).fill(a).join(' * ');
        }
        return `mathOp("e ^", ${w(b)} * mathOp("ln", ${a}))`;
    }

    identifier (n, pre) {
        const V = (t, k = 'num') => ({t, k});
        const name = n.name;
        const local = this.scope && this.scope.locals.has(name);
        if (!local) {
            switch (name) {
            case 'undefined': return V('""', 'str');
            case 'NaN': return V('"NaN"', 'str');
            case 'Infinity': return V('"Infinity"', 'str');
            case 'mouseX': return V('mouseX() + 200');
            case 'mouseY': return V('200 - mouseY()');
            case 'width': case 'height': return V('400');
            case 'frameCount': return V('frameCount');
            case 'PI': return V('3.141592653589793');
            case 'LEFT': return V('"left"', 'str');
            case 'RIGHT': return V('"right"', 'str');
            case 'CENTER': return V('"center"', 'str');
            case 'TOP': return V('"top"', 'str');
            case 'BOTTOM': return V('"bottom"', 'str');
            case 'BASELINE': return V('"baseline"', 'str');
            case 'CORNER': return V('"corner"', 'str');
            case 'CORNERS': return V('"corners"', 'str');
            case 'allSprites': return V('0', 'group');
            }
        }
        const kind = this.typeOf(name);
        if (kind === 'array') return V(this.listIdent(name), 'array');
        if (kind === 'group' || kind === 'edges') return V('0', 'group');
        if (this.functions.has(name) && !local && !this.globals.has(name)) throw new Unsupported(`the function ${name} used as a value`);
        const v = this.varIdent(name);
        if (kind === 'bool') return V(`${v} == "true"`, 'bool');
        return V(v, kind === 'sprite' ? 'sprite' : kind === 'str' ? 'str' : 'any');
    }

    member (n, pre) {
        const V = (t, k = 'num') => ({t, k});
        const obj = n.object;
        const prop = !n.computed ? n.property.name : null;
        if (obj.type === 'Identifier' && !(this.scope && this.scope.locals.has(obj.name))) {
            if (obj.name === 'Math') {
                if (prop === 'PI') return V('3.141592653589793');
                if (prop === 'E') return V('2.718281828459045');
            }
            if (obj.name === 'World') {
                switch (prop) {
                case 'mouseX': return V('mouseX() + 200');
                case 'mouseY': return V('200 - mouseY()');
                case 'frameCount': return V('frameCount');
                case 'seconds': return V('mathOp("floor", timer())');
                case 'width': case 'height': return V('400');
                case 'frameRate': return V(String(this.framerate));
                case 'allSprites': return V('0', 'group');
                }
            }
            if (obj.name === 'camera') {
                switch (prop) {
                case 'x': return V('camX');
                case 'y': return V('camY');
                case 'zoom': return V('camZoom');
                case 'mouseX': return V('((mouseX() / camZoom) + camX)');
                case 'mouseY': return V('(camY - (mouseY() / camZoom))');
                }
            }
        }
        // a.length: a list's, a group's, or text's.
        if (prop === 'length') {
            const g = this.groupOf(obj);
            if (g) return V(`lengthOfList(${g})`);
            if (obj.type === 'Identifier' && this.typeOf(obj.name) === 'array') return V(`lengthOfList(${this.listIdent(obj.name)})`);
            return V(`lengthOf(${this.value(obj, pre)})`);
        }
        if (n.computed) {
            const index = this.value(n.property, pre);
            const g = this.groupOf(obj);
            if (g) return V(`itemOfList(${g}, ${w(index)} + 1)`, 'sprite');
            if (obj.type === 'Identifier' && this.typeOf(obj.name) === 'array') {
                return V(`itemOfList(${this.listIdent(obj.name)}, ${w(index)} + 1)`, 'any');
            }
            return V(`letterOf(${w(index)} + 1, ${this.value(obj, pre)})`, 'str');
        }
        const p = PROPS[prop];
        if (p) {
            const s = this.sprite(obj, pre);
            if (p.bool) return V(`itemOfList(${p.list}, ${s}) == 1`, 'bool');
            return V(`itemOfList(${p.list}, ${s})`);
        }
        if (prop === 'animation') return V(`itemOfList(sanim, ${this.sprite(obj, pre)})`, 'str');
        if (prop === 'position') throw new Unsupported('".position" (use .x and .y)');
        throw new Unsupported(`".${prop}"`);
    }

    // A colour from fill()'s arguments: a name, "#hex", rgb(...), a gray, or r, g, b.
    colorOf (args, pre) {
        if (args.length >= 3) {
            const [r, g, b] = args.map(a => this.value(a, pre));
            return `((round(${r}) * 65536) + (round(${g}) * 256)) + round(${b})`;
        }
        const a = args[0];
        if (!a) return '0';
        if (a.type === 'Literal' && typeof a.value === 'number') return String(Math.round(a.value) * 65793);
        if (a.type === 'Literal' && typeof a.value === 'string') {
            const c = this.colorLiteral(a.value);
            if (c !== null) return String(c);
        }
        if (a.type === 'CallExpression' && a.callee.type === 'Identifier' && (a.callee.name === 'rgb' || a.callee.name === 'color')) {
            return this.colorOf(a.arguments, pre);
        }
        const v = this.value(a, pre);
        pre.push(`fw_color(${v});`);
        const t = this.temp();
        pre.push(`${t} = fwColor;`);
        return t;
    }
    // The alpha (0 to 255) in fill(r, g, b, a), rgb(r, g, b, a) or "rgba(...)", or 255.
    alphaOf (args, pre) {
        if (args.length >= 4) {
            const a = args[3];
            // rgb()'s alpha is 0 to 1; fill()'s is 0 to 255.
            return this.value(a, pre);
        }
        const a = args[0];
        if (a && a.type === 'CallExpression' && a.callee.type === 'Identifier' && a.callee.name === 'rgb' && a.arguments.length >= 4) {
            return `${w(this.value(a.arguments[3], pre))} * 255`;
        }
        if (a && a.type === 'Literal' && typeof a.value === 'string') {
            const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/.exec(a.value);
            if (m) return String(Number(m[1]) * 255);
            if (a.value === 'transparent') return '0';
        }
        return '255';
    }
    colorLiteral (text) {
        const s = String(text).trim()
            .toLowerCase();
        let m = /^#([0-9a-f]{6})$/.exec(s);
        if (m) return parseInt(m[1], 16);
        m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
        if (m) return parseInt(m[1] + m[1] + m[2] + m[2] + m[3] + m[3], 16);
        m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(s);
        if (m) return (Math.round(m[1]) * 65536) + (Math.round(m[2]) * 256) + Math.round(m[3]);
        if (s in COLOR_NAMES) return COLOR_NAMES[s];
        return null;
    }

    // A call that gives a value.
    call (n, pre) {
        const V = (t, k = 'num') => ({t, k});
        const c = n.callee;
        const args = n.arguments;
        const a = k => this.value(args[k], pre);
        if (c.type === 'Identifier' && !(this.scope && this.scope.locals.has(c.name))) {
            const user = this.functions.get(c.name);
            if (user) {
                pre.push(...this.userCall(user, args, pre));
                if (!user.returns) return V('""', 'str');
                const t = this.temp();
                pre.push(`${t} = r_${safe(user.name)};`);
                return V(t, 'any');
            }
            switch (c.name) {
            case 'randomNumber': return V(`pickRandom(${a(0)}, ${a(1)})`);
            case 'random':
                if (args.length === 0) return V('pickRandom(0, 0.9999999)');
                if (args.length === 1) return V(`pickRandom(0, ${w(a(0))} - 0.0000001)`);
                return V(`pickRandom(${a(0)}, ${w(a(1))} - 0.0000001)`);
            case 'round': return V(`round(${a(0)})`);
            case 'abs': return V(`mathOp("abs", ${a(0)})`);
            case 'sqrt': return V(`mathOp("sqrt", ${a(0)})`);
            case 'floor': return V(`mathOp("floor", ${a(0)})`);
            case 'ceil': return V(`mathOp("ceiling", ${a(0)})`);
            case 'sq': return V(`${w(a(0))} * ${w(a(0))}`);
            case 'min': return this.minMax(args, pre, 'min');
            case 'max': return this.minMax(args, pre, 'max');
            case 'pow': return V(this.power(w(a(0)), w(a(1))));
            case 'sin': case 'cos': case 'tan': return V(`mathOp(${str(c.name)}, ${w(a(0))} * 57.29577951308232)`);
            case 'atan2': return V(this.atan2(args[0], args[1], pre, true));
            case 'dist': return V(`mathOp("sqrt", ((${w(a(2))} - ${w(a(0))}) * (${w(a(2))} - ${w(a(0))})) + ((${w(a(3))} - ${w(a(1))}) * (${w(a(3))} - ${w(a(1))})))`);
            case 'constrain': {
                const lo = this.minMax([args[0], args[1]], pre, 'max').t;
                return V(`(${w(lo)} + ${w(a(2))} - mathOp("abs", ${w(lo)} - ${w(a(2))})) / 2`);
            }
            case 'map': return V(`${w(a(3))} + (((${w(a(0))} - ${w(a(1))}) * (${w(a(4))} - ${w(a(3))})) / (${w(a(2))} - ${w(a(1))}))`);
            case 'lerp': return V(`${w(a(0))} + ((${w(a(1))} - ${w(a(0))}) * ${w(a(2))})`);
            case 'keyDown': return V(`keyPressed(${this.key(args[0], pre)})`, 'bool');
            case 'keyWentDown': case 'keyWentUp': {
                const k = this.keyName(args[0]);
                if (k === null) throw new Unsupported(`${c.name} with a key worked out as the game runs`);
                this.keys.add(k);
                const was = this.keyVar(k);
                return c.name === 'keyWentDown' ? V(`keyPressed(${str(k)}) && (${was} == 0)`, 'bool') :
                    V(`!keyPressed(${str(k)}) && (${was} == 1)`, 'bool');
            }
            case 'mouseDown': case 'mouseIsPressed': return V('mouseDown()', 'bool');
            case 'mouseWentDown': this.mouseEdges = true; return V('mouseDown() && (fwMouseWas == 0)', 'bool');
            case 'mouseWentUp': this.mouseEdges = true; return V('!mouseDown() && (fwMouseWas == 1)', 'bool');
            case 'mouseDidMove': return V('(1 == 0)', 'bool');
            case 'mouseIsOver': case 'mousePressedOver':
                pre.push(`fw_mouseOver(${this.sprite(args[0], pre)});`);
                return V(c.name === 'mousePressedOver' ? '(fwHit == 1) && mouseDown()' : 'fwHit == 1', 'bool');
            case 'rgb': case 'color': return V(this.colorOf(args, pre), 'color');
            case 'createSprite': {
                const [x, y, wd, ht] = [0, 1, 2, 3].map(k => (args[k] ? this.value(args[k], pre) : (k < 2 ? '200' : '100')));
                pre.push(`fw_create(${x}, ${y}, ${wd}, ${ht});`);
                const t = this.temp();
                pre.push(`${t} = newSprite;`);
                return V(t, 'sprite');
            }
            case 'createGroup': return V('0', 'group');
            case 'textWidth': return V(`(lengthOf(${a(0)}) * 6) * (textSize / 10)`);
            case 'str': case 'String': return V(a(0), 'str');
            case 'int': case 'parseInt': return V(`mathOp("floor", ${a(0)})`);
            case 'Number': case 'parseFloat': case 'float': return V(`${w(a(0))} + 0`);
            case 'getTime': case 'millis': return V('timer() * 1000');
            case 'prompt': case 'promptNum': throw new Unsupported(`${c.name}() (Scratch's ask waits, so it cannot be inside a frame)`);
            }
            throw new Unsupported(`${c.name}()`);
        }
        if (c.type === 'MemberExpression' && !c.computed) {
            const obj = c.object;
            const m = c.property.name;
            if (obj.type === 'Identifier' && obj.name === 'Math' && !(this.scope && this.scope.locals.has('Math'))) {
                switch (m) {
                case 'random': return V('pickRandom(0, 0.9999999)');
                case 'round': return V(`round(${a(0)})`);
                case 'floor': return V(`mathOp("floor", ${a(0)})`);
                case 'ceil': return V(`mathOp("ceiling", ${a(0)})`);
                case 'abs': return V(`mathOp("abs", ${a(0)})`);
                case 'sqrt': return V(`mathOp("sqrt", ${a(0)})`);
                case 'min': return this.minMax(args, pre, 'min');
                case 'max': return this.minMax(args, pre, 'max');
                case 'pow': return V(this.power(w(a(0)), w(a(1))));
                case 'sin': case 'cos': case 'tan': return V(`mathOp(${str(m)}, ${w(a(0))} * 57.29577951308232)`);
                case 'asin': case 'acos': case 'atan': return V(`mathOp(${str(m)}, ${a(0)}) / 57.29577951308232`);
                case 'atan2': return V(this.atan2(args[0], args[1], pre, true));
                case 'log': return V(`mathOp("ln", ${a(0)})`);
                case 'exp': return V(`mathOp("e ^", ${a(0)})`);
                case 'sign': return V(`(${w(a(0))} > 0) - (${w(a(0))} < 0)`);
                case 'trunc': return V(`mathOp("floor", ${a(0)})`);
                }
                throw new Unsupported(`Math.${m}`);
            }
            const group = this.groupOf(obj);
            if (group) return this.groupCall(group, m, args, pre, n);
            if (obj.type === 'Identifier' && this.typeOf(obj.name) === 'array') return this.arrayCall(this.listIdent(obj.name), m, args, pre);
            if (['toUpperCase', 'toLowerCase', 'toString', 'toFixed', 'charAt', 'trim'].includes(m)) {
                const s = this.value(obj, pre);
                if (m === 'charAt') return V(`letterOf(${w(a(0))} + 1, ${s})`, 'str');
                if (m === 'toFixed') return V(args.length && args[0].type === 'Literal' && args[0].value === 0 ? `round(${s})` :
                    `round(${w(s)} * 100) / 100`);
                if (m !== 'toString' && m !== 'trim') this.note(`.${m}() has no block, so the text is left as it is`, n);
                return V(s, 'str');
            }
            return this.spriteCall(obj, m, args, pre, n);
        }
        throw new Unsupported('this kind of call');
    }
    minMax (args, pre, which) {
        const vals = args.map(x => this.value(x, pre));
        if (!vals.length) return {t: '0', k: 'num'};
        let t = vals[0];
        for (let k = 1; k < vals.length; k++) {
            const sign = which === 'min' ? '-' : '+';
            t = `((${w(t)} + ${w(vals[k])}) ${sign} mathOp("abs", ${w(t)} - ${w(vals[k])})) / 2`;
        }
        return {t, k: 'num'};
    }
    atan2 (yNode, xNode, pre, radians) {
        const y = this.value(yNode, pre);
        const x = this.value(xNode, pre);
        pre.push(`fw_atan2(${y}, ${x});`);
        const t = this.temp();
        pre.push(`${t} = fwA;`);
        return radians ? `${t} / 57.29577951308232` : t;
    }
    keyName (n) {
        if (n && n.type === 'Literal' && typeof n.value === 'string') return KEY(n.value);
        if (n && n.type === 'Literal' && typeof n.value === 'number') {
            const codes = {37: 'left arrow', 38: 'up arrow', 39: 'right arrow', 40: 'down arrow', 32: 'space', 13: 'enter'};
            return codes[n.value] || String.fromCharCode(n.value).toLowerCase();
        }
        if (n && n.type === 'Identifier' && /_ARROW$|^(SPACE|ENTER)$/.test(n.name)) return KEY(n.name);
        return null;
    }
    key (n, pre) {
        const k = this.keyName(n);
        if (k !== null) return str(k);
        return this.value(n, pre);
    }

    userCall (fn, args, pre) {
        const values = fn.params.map((p, k) => (args[k] ? this.value(args[k], pre) : '""'));
        for (let k = fn.params.length; k < args.length; k++) this.value(args[k], pre);
        return [`${fn.ident}(${values.join(', ')});`];
    }

    // A call that is a statement on its own line.
    callStatement (n, pre) {
        const c = n.callee;
        const args = n.arguments;
        const a = k => this.value(args[k], pre);
        if (c.type === 'Identifier' && !(this.scope && this.scope.locals.has(c.name))) {
            const user = this.functions.get(c.name);
            if (user) return this.userCall(user, args, pre);
            switch (c.name) {
            case 'background': {
                const color = this.colorOf(args, pre);
                return [`fw_background(${color});`];
            }
            case 'fill': return [`fillColor = ${this.colorOf(args, pre)};`, `fillAlpha = ${this.alphaOf(args, pre)};`, 'fillOn = 1;'];
            case 'noFill': return ['fillOn = 0;'];
            case 'stroke': return [`strokeColor = ${this.colorOf(args, pre)};`, `strokeAlpha = ${this.alphaOf(args, pre)};`,
                'strokeOn = 1;'];
            case 'noStroke': return ['strokeOn = 0;'];
            case 'strokeWeight': return [`strokeWeight = ${a(0)};`];
            case 'rect': return [`fw_rect(${a(0)}, ${a(1)}, ${a(2)}, ${args[3] ? a(3) : a(2)});`];
            case 'square': return [`fw_rect(${a(0)}, ${a(1)}, ${a(2)}, ${a(2)});`];
            case 'ellipse': return [`fw_ellipse(${a(0)}, ${a(1)}, ${a(2)}, ${args[3] ? a(3) : a(2)});`];
            case 'circle': return [`fw_ellipse(${a(0)}, ${a(1)}, ${a(2)}, ${a(2)});`];
            case 'line': return ['if (strokeOn == 1) {', `${IND}fw_pen(strokeColor, strokeAlpha);`,
                `${IND}fw_line(${a(0)}, ${a(1)}, ${a(2)}, ${a(3)}, strokeWeight);`, '}'];
            case 'point': return ['if (strokeOn == 1) {', `${IND}fw_pen(strokeColor, strokeAlpha);`,
                `${IND}fw_line(${a(0)}, ${a(1)}, ${a(0)}, ${a(1)}, strokeWeight);`, '}'];
            case 'triangle': case 'quad': {
                const pts = [];
                for (let k = 0; k + 1 < args.length; k += 2) pts.push([a(k), a(k + 1)]);
                this.note(`${c.name}() is drawn as its outline only`, n);
                const lines = ['fw_pen(strokeColor, strokeAlpha);'];
                pts.forEach((p, k) => {
                    const q = pts[(k + 1) % pts.length];
                    lines.push(`fw_line(${p[0]}, ${p[1]}, ${q[0]}, ${q[1]}, mathOp("ceiling", strokeWeight + 0.5));`);
                });
                return lines;
            }
            case 'text': {
                const s = a(0);
                return [`fw_text(${s}, ${a(1)}, ${a(2)});`];
            }
            case 'textSize': return [`textSize = ${a(0)};`];
            case 'textAlign': return [`textAlignH = ${a(0)};`, ...(args[1] ? [`textAlignV = ${a(1)};`] : [])];
            case 'rectMode': return [`if (${a(0)} == "center") {`, `${IND}rectCenter = 1;`, '} else {', `${IND}rectCenter = 0;`, '}'];
            case 'ellipseMode': return [`if (${a(0)} == "center") {`, `${IND}ellipseCenter = 1;`, '} else {',
                `${IND}ellipseCenter = 0;`, '}'];
            case 'drawSprites': return ['fw_drawSprites();'];
            case 'createEdgeSprites': return this.edges();
            case 'playSound': case 'playSpeech': case 'stopSound': return this.sound(c.name, args, pre, n);
            case 'textFont': case 'angleMode': case 'push': case 'pop': case 'showMobileControls':
            case 'noLoop': case 'loop': case 'smooth': case 'noSmooth':
                return [];
            case 'setTimeout': case 'setInterval': case 'timedLoop':
                throw new Unsupported(`${c.name}() (count frames in draw() instead)`);
            case 'createSprite': case 'createGroup':
                this.value(n, pre);
                return [];
            }
            this.value(n, pre);
            return [];
        }
        if (c.type === 'MemberExpression' && !c.computed) {
            const obj = c.object;
            const m = c.property.name;
            if (obj.type === 'Identifier' && obj.name === 'console') return [];
            if (obj.type === 'Identifier' && obj.name === 'camera' && !(this.scope && this.scope.locals.has('camera'))) {
                if (m === 'on') return ['camOn = 1;'];
                if (m === 'off') return ['camOn = 0;'];
                throw new Unsupported(`camera.${m}()`);
            }
            if (obj.type === 'Identifier' && obj.name === 'World') return [];
            const group = this.groupOf(obj);
            if (group) {
                const r = this.groupCall(group, m, args, pre, n, true);
                return r.lines || [];
            }
            if (obj.type === 'Identifier' && this.typeOf(obj.name) === 'array') {
                const r = this.arrayCall(this.listIdent(obj.name), m, args, pre, true);
                return r.lines || [];
            }
            const r = this.spriteCall(obj, m, args, pre, n, true);
            return r.lines || [];
        }
        this.value(n, pre);
        return [];
    }

    sound (fn, args, pre, n) {
        if (fn === 'stopSound') return ['stopAllSounds();'];
        if (fn === 'playSpeech') {
            this.note('playSpeech() has no block here, so it is silent', n);
            return [];
        }
        const a = args[0];
        if (!a || a.type !== 'Literal' || typeof a.value !== 'string') {
            this.note('a sound whose name is worked out as the game runs is not played', n);
            return [];
        }
        const name = String(a.value).split(/[\\/]/).pop();
        this.soundsUsed.add(name);
        return [`startSound(${str(name.replace(/\.[^.]+$/, ''))});`];
    }

    // sprite.something(...): a sprite's methods.
    spriteCall (obj, m, args, pre, n) {
        const V = (t, k = 'num') => ({t, k});
        const s = this.sprite(obj, pre);
        const a = k => this.value(args[k], pre);
        const lines = list => ({t: '""', k: 'str', lines: list});
        switch (m) {
        case 'setAnimation': case 'changeAnimation': case 'addAnimation': case 'setImage': {
            const arg = args[m === 'addAnimation' ? 1 : 0] || args[0];
            if (arg && arg.type === 'Literal') this.animationsUsed.add(String(arg.value));
            return lines([`fw_setAnimation(${s}, ${this.value(arg, pre)});`]);
        }
        case 'setVelocity': return lines([`replaceInList(svx, ${s}, ${a(0)});`, `replaceInList(svy, ${s}, ${a(1)});`]);
        case 'setSpeedAndDirection': case 'setSpeed': {
            const speed = a(0);
            const dir = args[1] ? a(1) : null;
            if (dir === null) {
                pre.push(`fw_atan2(itemOfList(svy, ${s}), itemOfList(svx, ${s}));`);
                return lines([`replaceInList(svx, ${s}, ${w(speed)} * mathOp("cos", fwA));`,
                    `replaceInList(svy, ${s}, ${w(speed)} * mathOp("sin", fwA));`]);
            }
            return lines([`replaceInList(svx, ${s}, ${w(speed)} * mathOp("cos", ${dir}));`,
                `replaceInList(svy, ${s}, ${w(speed)} * mathOp("sin", ${dir}));`]);
        }
        case 'addSpeed': return lines([`replaceInList(svx, ${s}, itemOfList(svx, ${s}) + (${w(a(0))} * mathOp("cos", ${a(1)})));`,
            `replaceInList(svy, ${s}, itemOfList(svy, ${s}) + (${w(a(0))} * mathOp("sin", ${a(1)})));`]);
        case 'getSpeed': return V(`mathOp("sqrt", (itemOfList(svx, ${s}) * itemOfList(svx, ${s})) + (itemOfList(svy, ${s}) * itemOfList(svy, ${s})))`);
        case 'getDirection': {
            pre.push(`fw_atan2(itemOfList(svy, ${s}), itemOfList(svx, ${s}));`);
            const t = this.temp();
            pre.push(`${t} = fwA;`);
            return V(t);
        }
        case 'pointTo': {
            pre.push(`fw_atan2(${w(a(1))} - itemOfList(sy, ${s}), ${w(a(0))} - itemOfList(sx, ${s}));`);
            return lines([`replaceInList(srot, ${s}, fwA);`]);
        }
        case 'destroy': case 'remove': return lines([`fw_destroy(${s});`]);
        case 'mirrorX': return args.length ? lines([`replaceInList(smirror, ${s}, ${a(0)});`]) : V(`itemOfList(smirror, ${s})`);
        case 'getScaledWidth': return V(`itemOfList(sw, ${s}) * itemOfList(sscale, ${s})`);
        case 'getScaledHeight': return V(`itemOfList(sh, ${s}) * itemOfList(sscale, ${s})`);
        case 'isTouching': case 'overlap': case 'collide': case 'bounce': case 'bounceOff': case 'displace':
            return this.touch(obj, null, m, args, pre, n);
        case 'mirrorY': case 'setCollider': case 'nextFrame': case 'previousFrame': case 'pause': case 'play':
        case 'setFrame': case 'limitSpeed': case 'attractionPoint': case 'setDefaultCollider': case 'frameDidChange':
            this.note(`sprite.${m}() has no block here, so it does nothing`, n);
            return lines([]);
        }
        throw new Unsupported(`.${m}()`);
    }

    // a.isTouching(b), a.collide(b, callback)...: sprites or groups on either side.
    touch (aNode, aGroup, m, args, pre, n) {
        const kind = {isTouching: 'overlap', overlap: 'overlap', collide: 'collide', bounce: 'bounce', bounceOff: 'bounce',
            displace: 'displace'}[m];
        const target = args[0];
        const bGroup = target ? this.groupOf(target) : null;
        const callback = args[1] || null;
        const any = this.temp();
        const lines = [`${any} = 0;`];
        const a = aGroup ? null : this.sprite(aNode, pre);
        const b = bGroup || !target ? null : this.sprite(target, pre);
        const hitBody = (x, y) => {
            const out = [`fw_touch(${x}, ${y}, ${str(kind)});`];
            const onHit = [`${any} = 1;`];
            if (callback) onHit.push(...this.callbackCall(callback, [x, y], pre, n));
            out.push(...block('if (fwHit == 1)', onHit));
            return out;
        };
        const loopOver = (list, body) => {
            // Backwards, so a sprite destroyed in the loop does not skip the next one.
            const i = this.temp();
            return [`${i} = lengthOfList(${list});`, ...block(`repeat (lengthOfList(${list}))`, [...body(`itemOfList(${list}, ${i})`), `${i} += -1;`])];
        };
        if (!target) throw new Unsupported(`.${m}() with nothing to touch`);
        if (!aGroup && !bGroup) lines.push(...hitBody(a, b));
        else if (!aGroup && bGroup) lines.push(...loopOver(bGroup, item => hitBody(a, item)));
        else if (aGroup && !bGroup) lines.push(...loopOver(aGroup, item => hitBody(item, b)));
        else lines.push(...loopOver(aGroup, x => loopOver(bGroup, y => hitBody(x, y))));
        pre.push(...lines);
        return {t: `${any} == 1`, k: 'bool', lines: []};
    }
    callbackCall (cb, values, pre, n) {
        if (cb.type === 'Identifier' && this.functions.has(cb.name)) {
            const fn = this.functions.get(cb.name);
            return [`${fn.ident}(${fn.params.map((p, k) => values[k] || '""').join(', ')});`];
        }
        if (cb.type === 'FunctionExpression' || cb.type === 'ArrowFunctionExpression') {
            if (!this.callbackInfo.has(cb)) {
                const name = `callback${this.callbacks.length + 1}`;
                const params = cb.params.map(p => p.name);
                const locals = new Set(params);
                const walk = x => {
                    if (!x || typeof x !== 'object') return;
                    if (Array.isArray(x)) return x.forEach(walk);
                    if (x.type === 'VariableDeclaration') for (const d of x.declarations) locals.add(d.id.name);
                    for (const k of Object.keys(x)) if (k !== 'loc' && x[k] && typeof x[k] === 'object') walk(x[k]);
                };
                walk(cb.body);
                this.callbackInfo.set(cb, {name, node: cb, params, locals, ident: `u_${name}`, returns: false});
                this.callbacks.push(this.callbackInfo.get(cb));
            }
            const info = this.callbackInfo.get(cb);
            return [`${info.ident}(${info.params.map((p, k) => values[k] || '""').join(', ')});`];
        }
        void pre;
        this.note('a callback that is not a function is left out', n);
        return [];
    }

    // group.something(...)
    groupCall (g, m, args, pre, n) {
        const V = (t, k = 'num') => ({t, k});
        const a = k => this.value(args[k], pre);
        const lines = list => ({t: '""', k: 'str', lines: list});
        const each = body => {
            const i = this.temp();
            return [`${i} = lengthOfList(${g});`, ...block(`repeat (lengthOfList(${g}))`, [...body(`itemOfList(${g}, ${i})`), `${i} += -1;`])];
        };
        const setEach = (list, valueText) => lines(each(s => [`replaceInList(${list}, ${s}, ${valueText});`]));
        switch (m) {
        case 'add': return lines([`if (!listContains(${g}, ${a(0)})) {`, `${IND}addToList(${g}, ${a(0)});`, '}']);
        case 'remove': return lines([`deleteOfList(${g}, itemNumberInList(${g}, ${a(0)}));`]);
        case 'clear': return lines([`deleteAllOfList(${g});`]);
        case 'contains': case 'includes': return V(`listContains(${g}, ${a(0)})`, 'bool');
        case 'get': return V(`itemOfList(${g}, ${w(a(0))} + 1)`, 'sprite');
        case 'size': return V(`lengthOfList(${g})`);
        case 'destroyEach': case 'removeSprites': return lines(each(s => [`fw_destroy(${s});`]));
        case 'setVelocityXEach': return setEach('svx', a(0));
        case 'setVelocityYEach': return setEach('svy', a(0));
        case 'setVelocityEach': {
            const x = a(0);
            const y = a(1);
            return lines(each(s => [`replaceInList(svx, ${s}, ${x});`, `replaceInList(svy, ${s}, ${y});`]));
        }
        case 'setLifetimeEach': return setEach('slife', a(0));
        case 'setRotationEach': return setEach('srot', a(0));
        case 'setRotationSpeedEach': return setEach('srs', a(0));
        case 'setScaleEach': return setEach('sscale', a(0));
        case 'setDepthEach': {
            const r = setEach('sdepth', a(0));
            r.lines.push('fwDepthDirty = 1;');
            return r;
        }
        case 'setVisibleEach': return setEach('svis', this.oneZero(args[0], pre));
        case 'setColorEach': case 'setTintEach': return setEach('scolor', this.colorOf([args[0]], pre));
        case 'setColliderEach': case 'setMirrorXEach': return lines([]);
        case 'setAnimationEach': {
            if (args[0] && args[0].type === 'Literal') this.animationsUsed.add(String(args[0].value));
            const v = a(0);
            return lines(each(s => [`fw_setAnimation(${s}, ${v});`]));
        }
        case 'setPropertyEach': {
            const prop = args[0] && args[0].type === 'Literal' ? PROPS[args[0].value] : null;
            if (!prop) throw new Unsupported('setPropertyEach with that property');
            return setEach(prop.list, prop.bool ? this.oneZero(args[1], pre) : a(1));
        }
        case 'maxDepth': case 'minDepth': {
            const t = this.temp();
            pre.push(`${t} = ${m === 'maxDepth' ? -100000 : 100000};`, ...each(s => block(`if (itemOfList(sdepth, ${s}) ${m === 'maxDepth' ? '>' : '<'} ${t})`, [`${t} = itemOfList(sdepth, ${s});`])));
            return V(t);
        }
        case 'isTouching': case 'overlap': case 'collide': case 'bounce': case 'bounceOff': case 'displace':
            return this.touch(null, g, m, args, pre, n);
        case 'length': return V(`lengthOfList(${g})`);
        }
        throw new Unsupported(`group.${m}()`);
    }

    // array.something(...)
    arrayCall (list, m, args, pre) {
        const V = (t, k = 'num') => ({t, k});
        const a = k => this.value(args[k], pre);
        const lines = l => ({t: '""', k: 'str', lines: l});
        switch (m) {
        case 'push': return {t: `lengthOfList(${list})`, k: 'num', lines: args.map((x, k) => `addToList(${list}, ${a(k)});`)};
        case 'pop': {
            const t = this.temp();
            pre.push(`${t} = itemOfList(${list}, lengthOfList(${list}));`, `deleteOfList(${list}, lengthOfList(${list}));`);
            return {t, k: 'any', lines: []};
        }
        case 'shift': {
            const t = this.temp();
            pre.push(`${t} = itemOfList(${list}, 1);`, `deleteOfList(${list}, 1);`);
            return {t, k: 'any', lines: []};
        }
        case 'unshift': return lines(args.map((x, k) => `insertInList(${list}, 1, ${a(k)});`));
        case 'indexOf': return V(`itemNumberInList(${list}, ${a(0)}) - 1`);
        case 'includes': return V(`listContains(${list}, ${a(0)})`, 'bool');
        case 'splice': {
            const i = this.temp();
            pre.push(`${i} = ${w(a(0))} + 1;`);
            const count = args[1] ? a(1) : `lengthOfList(${list})`;
            return lines(block(`repeat (${count})`, [`deleteOfList(${list}, ${i});`]));
        }
        case 'join': throw new Unsupported('array.join()');
        }
        throw new Unsupported(`array.${m}()`);
    }
}
