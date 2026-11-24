/* eslint-disable */
// scratch-runtime.js: how Scratch runs a project, for a game exported from
// Flipwarp. The game's own code is in game.js; this file is the engine under
// it: sprites, costumes, clones, broadcasts, the pen, sounds, the keyboard
// and mouse, and Scratch's rules for numbers and text.
//
// Each script is a generator function. Where Scratch would let other scripts
// have a turn (the end of each pass round a loop, a wait), the script
// yields. Every frame the engine gives each running script a turn, in the
// order Scratch would, until something on the stage changed, then draws.

(function () {
'use strict';

// --- Scratch's rules for values ---------------------------------------------

const S = {};

/** A value as a number, the way Scratch casts it: anything not a number is 0. */
S.num = function (value) {
    if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
};

/** A value as true or false: "", "0" and "false" are false. */
S.bool = function (value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        return !(value === '' || value === '0' || value.toLowerCase() === 'false');
    }
    return Boolean(value);
};

/** A value as text. */
S.str = function (value) {
    return String(value);
};

const isWhiteSpace = v => v === null || (typeof v === 'string' && v.trim().length === 0);

/** Compare like Scratch: as numbers when both are numbers, else as text ignoring case. */
S.compare = function (a, b) {
    let n1 = Number(a);
    let n2 = Number(b);
    if (n1 === 0 && isWhiteSpace(a)) n1 = NaN;
    else if (n2 === 0 && isWhiteSpace(b)) n2 = NaN;
    if (Number.isNaN(n1) || Number.isNaN(n2)) {
        const s1 = String(a).toLowerCase();
        const s2 = String(b).toLowerCase();
        if (s1 < s2) return -1;
        if (s1 > s2) return 1;
        return 0;
    }
    if (n1 === Infinity && n2 === Infinity) return 0;
    if (n1 === -Infinity && n2 === -Infinity) return 0;
    return n1 - n2;
};
S.lt = (a, b) => S.compare(a, b) < 0;
S.gt = (a, b) => S.compare(a, b) > 0;
S.eq = (a, b) => S.compare(a, b) === 0;

const isInt = v => {
    if (typeof v === 'number') return Number.isNaN(v) || v === Math.floor(v);
    if (typeof v === 'boolean') return true;
    if (typeof v === 'string') return v.indexOf('.') < 0;
    return false;
};

/** pick random a to b: whole numbers unless either end has a decimal point. */
S.random = function (from, to) {
    const n1 = S.num(from);
    const n2 = S.num(to);
    const low = Math.min(n1, n2);
    const high = Math.max(n1, n2);
    if (low === high) return low;
    if (isInt(from) && isInt(to)) return low + Math.floor(Math.random() * ((high + 1) - low));
    return (Math.random() * (high - low)) + low;
};

S.join = (a, b) => String(a) + String(b);
S.letterOf = function (index, text) {
    const s = String(text);
    const i = S.num(index) - 1;
    if (i < 0 || i >= s.length) return '';
    return s.charAt(i);
};
S.lengthOf = text => String(text).length;
S.contains = (text, part) => String(text).toLowerCase().indexOf(String(part).toLowerCase()) !== -1;
S.mod = function (a, b) {
    const n = S.num(a);
    const modulus = S.num(b);
    let result = n % modulus;
    if (result / modulus < 0) result += modulus;
    return result;
};
S.round = v => Math.round(S.num(v));

const toRad = deg => deg * Math.PI / 180;
const toDeg = rad => rad * 180 / Math.PI;
S.mathop = function (op, value) {
    const n = S.num(value);
    switch (String(op).toLowerCase()) {
    case 'abs': return Math.abs(n);
    case 'floor': return Math.floor(n);
    case 'ceiling': return Math.ceil(n);
    case 'sqrt': return Math.sqrt(n);
    case 'sin': return Math.round(Math.sin(toRad(n)) * 1e10) / 1e10;
    case 'cos': return Math.round(Math.cos(toRad(n)) * 1e10) / 1e10;
    case 'tan': {
        const angle = n % 360;
        if (angle === -270 || angle === 90) return Infinity;
        if (angle === -90 || angle === 270) return -Infinity;
        return Math.round(Math.tan(toRad(n)) * 1e10) / 1e10;
    }
    case 'asin': return toDeg(Math.asin(n));
    case 'acos': return toDeg(Math.acos(n));
    case 'atan': return toDeg(Math.atan(n));
    case 'ln': return Math.log(n);
    case 'log': return Math.log(n) / Math.LN10;
    case 'e ^': return Math.exp(n);
    case '10 ^': return Math.pow(10, n);
    }
    return 0;
};

// Lists: arrays, changed in place, numbered from 1 like Scratch.
const listIndex = function (index, length, acceptAll) {
    if (typeof index !== 'number') {
        const text = String(index);
        if (text === 'all') return acceptAll ? 'all' : 0;
        if (text === 'last') return length > 0 ? length : 0;
        if (text === 'random' || text === 'any') return length > 0 ? 1 + Math.floor(Math.random() * length) : 0;
    }
    const i = Math.floor(S.num(index));
    if (i < 1 || i > length) return 0;
    return i;
};
S.listAdd = (list, item) => { list.push(item); };
S.listDelete = function (list, index) {
    const i = listIndex(index, list.length, true);
    if (i === 'all') { list.length = 0; return; }
    if (i) list.splice(i - 1, 1);
};
S.listDeleteAll = list => { list.length = 0; };
S.listInsert = function (list, index, item) {
    const i = listIndex(index, list.length + 1, false);
    if (i) list.splice(i - 1, 0, item);
};
S.listReplace = function (list, index, item) {
    const i = listIndex(index, list.length, false);
    if (i) list[i - 1] = item;
};
S.listItem = function (list, index) {
    const i = listIndex(index, list.length, false);
    return i ? list[i - 1] : '';
};
S.listIndexOf = function (list, item) {
    for (let i = 0; i < list.length; i++) if (S.eq(list[i], item)) return i + 1;
    return 0;
};
S.listContains = (list, item) => S.listIndexOf(list, item) !== 0;
S.listContents = function (list) {
    const allSingle = list.every(item => String(item).length === 1);
    return list.join(allSingle ? '' : ' ');
};

// The precision Scratch reports positions with.
const limitPrecision = function (coordinate) {
    const rounded = Math.round(coordinate);
    return Math.abs(coordinate - rounded) < 1e-9 ? rounded : coordinate;
};
const wrapClamp = function (value, min, max) {
    const range = (max - min) + 1;
    return value - (Math.floor((value - min) / range) * range);
};
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Pen colours: hue, saturation, brightness and transparency, 0 to 100.
const hsvToRgb = function (h, s, v) {
    h = (h % 360 + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
};
const rgbToHsv = function (r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = ((b - r) / d) + 2;
        else h = ((r - g) / d) + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, max === 0 ? 0 : d / max, max];
};
const colorToRgba = function (value) {
    if (typeof value === 'string' && value.charAt(0) === '#') {
        const hex = value.length === 4 ?
            value.slice(1).split('').map(c => c + c).join('') : value.slice(1, 7);
        const n = parseInt(hex, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
    }
    const n = S.num(value);
    const a = (n >>> 24) & 255;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a === 0 ? 255 : a];
};

// --- the engine ---------------------------------------------------------------

const KEY_NAMES = {' ': 'space', ArrowUp: 'up arrow', ArrowDown: 'down arrow', ArrowLeft: 'left arrow',
    ArrowRight: 'right arrow', Enter: 'enter'};
const keyName = function (event) {
    if (KEY_NAMES[event.key]) return KEY_NAMES[event.key];
    if (event.key && event.key.length === 1) return event.key.toLowerCase();
    return event.key ? event.key.toLowerCase() : '';
};
const normalKey = key => String(key).toLowerCase();

// What a script yields to wait for the next frame, as Scratch's volume and
// sound effect blocks do.
const NEXT_FRAME = Object.freeze({nextFrame: true});

// Hats that start again from the top when started while running.
const RESTARTS = {flag: true, key: false, click: true, stageClick: true, receive: true, backdrop: false,
    greater: false, clone: false};

class Thread {
    constructor (target, hat, gen) {
        this.target = target;
        this.hat = hat;
        this.gen = gen;
        this.done = false;
    }
}

class Game {
    constructor (options) {
        this.width = options.width || 480;
        this.height = options.height || 360;
        this.framerate = options.framerate || 30;
        this.fencing = options.fencing !== false;
        this.miscLimits = options.miscLimits !== false;
        this.maxClones = typeof options.maxClones === 'number' ? options.maxClones : 300;
        this.globals = {};
        this.globalLists = {};
        this.stage = null;
        this.layers = [];
        this.threads = [];
        this.keys = Object.create(null);
        this.mouse = {x: 0, y: 0, down: false};
        this.answer = '';
        this.username = '';
        this.redraw = false;
        this.cloneCount = 0;
        this.timerStart = 0;
        this.virtualTime = null;
        this.edgeState = new Map();
        this.monitors = [];
        this.questions = [];
        this.started = false;
        this.loadingCount = 0;
        this.audioUnlocked = false;
    }

    // -- time --
    now () {
        return this.virtualTime !== null ? this.virtualTime : performance.now() / 1000;
    }
    get timer () {
        return this.now() - this.timerStart;
    }
    resetTimer () {
        this.timerStart = this.now();
    }

    // -- making the project --
    addStage (spec) {
        this.stage = new Target(this, spec, true);
        Object.assign(this.globals, spec.variables || {});
        for (const name of Object.keys(spec.lists || {})) this.globalLists[name] = spec.lists[name].slice();
        this.stage.vars = this.globals;
        this.stage.lists = this.globalLists;
        return this.stage;
    }
    addSprite (spec) {
        const sprite = new Target(this, spec, false);
        sprite.vars = Object.assign({}, spec.variables || {});
        sprite.lists = {};
        for (const name of Object.keys(spec.lists || {})) sprite.lists[name] = spec.lists[name].slice();
        this.layers.push(sprite);
        return sprite;
    }
    sprite (name) {
        return this.layers.find(t => t.isOriginal && t.name === name) || null;
    }
    allTargets () {
        return [this.stage].concat(this.layers);
    }

    // -- threads --
    /** Start the scripts with this hat, topmost sprite first, like Scratch. */
    startHats (kind, match, only) {
        const started = [];
        const order = this.allTargets().slice().reverse();
        for (const target of order) {
            if (only && target !== only) continue;
            for (const hat of target.hats) {
                if (hat.kind !== kind) continue;
                if (match !== undefined && !hat.matches(match)) continue;
                const running = this.threads.find(t => t.target === target && t.hat === hat && !t.done);
                if (running) {
                    if (!RESTARTS[kind]) continue;
                    running.gen = hat.fn.call(null, target);
                    started.push(running);
                    continue;
                }
                const thread = new Thread(target, hat, hat.fn.call(null, target));
                this.threads.push(thread);
                started.push(thread);
            }
        }
        return started;
    }

    greenFlag () {
        this.stopAll();
        this.resetTimer();
        this.startHats('flag');
    }

    stopAll () {
        for (const t of this.threads) t.done = true;
        this.threads = [];
        for (const target of this.layers.slice()) {
            if (!target.isOriginal) target.removeClone();
        }
        for (const target of this.allTargets()) {
            target.clearEffects();
            target.bubble = null;
            target.soundEffects = {pitch: 0, pan: 0};
        }
        this.stopAllSounds();
        this.questions = [];
        this.hidePrompt();
        this.redraw = true;
    }

    broadcast (name) {
        return this.startHats('receive', String(name));
    }
    *broadcastAndWait (name) {
        const started = this.broadcast(name);
        const runs = started.map(t => ({thread: t, gen: t.gen}));
        while (runs.some(r => !r.thread.done && r.thread.gen === r.gen)) yield;
    }

    *wait (seconds) {
        const end = this.now() + Math.max(0, S.num(seconds));
        // Scratch asks for the stage to be drawn when a wait starts, which ends the frame.
        this.redraw = true;
        yield;
        while (this.now() < end) yield;
    }

    /** One frame: edge hats, then every script's turns, then the picture. */
    step () {
        this.checkEdgeHats();
        this.redraw = false;
        for (const thread of this.threads) thread.sleeping = false;
        const budget = 0.75 * 1000 / this.framerate;
        const start = performance.now();
        let passes = 0;
        do {
            let ran = false;
            for (let i = 0; i < this.threads.length; i++) {
                const thread = this.threads[i];
                if (thread.done || thread.sleeping) continue;
                if (thread.target.removed) {
                    thread.done = true;
                    continue;
                }
                ran = true;
                this.current = thread;
                try {
                    const result = thread.gen.next();
                    if (result.done) thread.done = true;
                    else if (result.value === NEXT_FRAME) thread.sleeping = true;
                } catch (e) {
                    thread.done = true;
                    console.error(`A script in ${thread.target.name} stopped with an error:`, e);
                }
            }
            this.current = null;
            this.threads = this.threads.filter(t => !t.done);
            passes++;
            if (!ran) break;
        } while (this.threads.length && !this.redraw && performance.now() - start < budget && passes < 10000);
        this.render();
    }

    checkEdgeHats () {
        for (const target of this.allTargets()) {
            for (const hat of target.hats) {
                if (hat.kind !== 'greater') continue;
                const value = hat.menu === 'TIMER' ? this.timer : -1;
                const now = value > S.num(hat.value(target));
                const before = this.edgeState.get(hat) || false;
                this.edgeState.set(hat, now);
                if (now && !before) {
                    const thread = new Thread(target, hat, hat.fn.call(null, target));
                    this.threads.push(thread);
                }
            }
        }
    }

    // -- the backdrop --
    get backdropNumber () {
        return this.stage.costumeIndex + 1;
    }
    get backdropName () {
        return this.stage.costumes[this.stage.costumeIndex].name;
    }
    switchBackdrop (value) {
        const stage = this.stage;
        const text = String(value);
        const count = stage.costumes.length;
        if (text === 'next backdrop') stage.setCostume(stage.costumeIndex + 1);
        else if (text === 'previous backdrop') stage.setCostume(stage.costumeIndex - 1);
        else if (text === 'random backdrop') {
            if (count > 1) {
                let pick = Math.floor(Math.random() * (count - 1));
                if (pick >= stage.costumeIndex) pick++;
                stage.setCostume(pick);
            }
        } else stage.switchCostume(value);
        return this.startHats('backdrop', this.backdropName);
    }
    *switchBackdropAndWait (value) {
        const started = this.switchBackdrop(value);
        const runs = started.map(t => ({thread: t, gen: t.gen}));
        while (runs.some(r => !r.thread.done && r.thread.gen === r.gen)) yield;
    }

    // -- sensing --
    keyPressed (key) {
        const k = normalKey(key);
        if (k === 'any') return Object.keys(this.keys).some(name => this.keys[name]);
        return !!this.keys[k];
    }
    get mouseX () {
        return Math.round(this.mouse.x);
    }
    get mouseY () {
        return Math.round(this.mouse.y);
    }
    get mouseDown () {
        return this.mouse.down;
    }
    get loudness () {
        return -1;
    }
    current (what) {
        const d = new Date();
        switch (String(what).toLowerCase()) {
        case 'year': return d.getFullYear();
        case 'month': return d.getMonth() + 1;
        case 'date': return d.getDate();
        case 'dayofweek': return d.getDay() + 1;
        case 'hour': return d.getHours();
        case 'minute': return d.getMinutes();
        case 'second': return d.getSeconds();
        }
        return 0;
    }
    daysSince2000 () {
        const msPerDay = 24 * 60 * 60 * 1000;
        const start = new Date(2000, 0, 1);
        const today = new Date();
        const dstAdjust = today.getTimezoneOffset() - start.getTimezoneOffset();
        let mSecsSinceStart = today.valueOf() - start.valueOf();
        mSecsSinceStart += ((today.getTimezoneOffset() - dstAdjust) * 60 * 1000);
        return mSecsSinceStart / msPerDay;
    }
    propertyOf (property, objectName) {
        if (objectName === '_stage_') {
            if (property === 'backdrop #') return this.backdropNumber;
            if (property === 'backdrop name') return this.backdropName;
            if (property === 'volume') return this.stage.volume;
            return Object.prototype.hasOwnProperty.call(this.globals, property) ? this.globals[property] : 0;
        }
        const target = this.sprite(String(objectName));
        if (!target) return 0;
        switch (property) {
        case 'x position': return target.x;
        case 'y position': return target.y;
        case 'direction': return target.direction;
        case 'costume #': return target.costumeIndex + 1;
        case 'costume name': return target.costumes[target.costumeIndex].name;
        case 'size': return target.size;
        case 'volume': return target.volume;
        }
        return Object.prototype.hasOwnProperty.call(target.vars, property) ? target.vars[property] : 0;
    }

    // -- ask and answer --
    *ask (target, question) {
        const entry = {target, question: String(question), answered: false};
        this.questions.push(entry);
        if (this.questions.length === 1) this.showQuestion(entry);
        while (!entry.answered) yield;
    }
    showQuestion (entry) {
        const visibleSprite = !entry.target.isStage && entry.target.visible;
        if (visibleSprite) entry.target.setBubble('say', entry.question);
        this.showPrompt(visibleSprite ? '' : entry.question, text => {
            this.answer = text;
            entry.answered = true;
            if (visibleSprite) entry.target.setBubble('say', '');
            this.questions.shift();
            if (this.questions.length) this.showQuestion(this.questions[0]);
        });
    }
    showPrompt (question, done) {
        const box = this.ui && this.ui.prompt;
        if (!box) return;
        box.label.textContent = question;
        box.label.style.display = question ? '' : 'none';
        box.input.value = '';
        box.root.style.display = '';
        box.done = done;
        setTimeout(() => box.input.focus(), 0);
    }
    hidePrompt () {
        if (this.ui && this.ui.prompt) this.ui.prompt.root.style.display = 'none';
    }

    // -- sounds --
    stopAllSounds () {
        for (const target of this.allTargets()) target.stopSounds();
    }

    // -- the pen --
    penClear () {
        if (this.penCtx) this.penCtx.clearRect(0, 0, this.penCanvas.width, this.penCanvas.height);
        this.redraw = true;
    }

    // -- variable and list readouts --
    showMonitor (id, visible) {
        const monitor = this.monitors.find(m => m.id === id);
        if (monitor) {
            monitor.visible = visible;
            this.redraw = true;
        }
    }

    // -- loading --
    track (promise) {
        this.loadingCount++;
        return promise.then(() => { this.loadingCount--; }, () => { this.loadingCount--; });
    }
}

// --- a sprite or the stage ------------------------------------------------------

class Target {
    constructor (game, spec, isStage) {
        this.game = game;
        this.name = spec.name;
        this.isStage = isStage;
        this.isOriginal = true;
        this.original = this;
        this.removed = false;
        this.hats = [];
        this.x = spec.x || 0;
        this.y = spec.y || 0;
        this.direction = typeof spec.direction === 'number' ? spec.direction : 90;
        this.size = typeof spec.size === 'number' ? spec.size : 100;
        this.visible = isStage ? true : spec.visible !== false;
        this.rotationStyle = spec.rotationStyle || 'all around';
        this.draggable = !!spec.draggable;
        this.volume = typeof spec.volume === 'number' ? spec.volume : 100;
        this.effects = {color: 0, fisheye: 0, whirl: 0, pixelate: 0, mosaic: 0, brightness: 0, ghost: 0};
        this.soundEffects = {pitch: 0, pan: 0};
        this.bubble = null;
        this.costumes = (spec.costumes || []).map(c => new Costume(game, c));
        this.costumeIndex = Math.min(spec.costume || 0, Math.max(0, this.costumes.length - 1));
        this.sounds = (spec.sounds || []).map(s => new Sound(game, s));
        this.playing = [];
        this.pen = {down: false, color: 66.66, saturation: 100, brightness: 100, transparency: 0, size: 1};
    }

    // -- scripts --
    on (kind, fn, extra) {
        const hat = Object.assign({kind, fn, matches: () => true}, extra || {});
        this.hats.push(hat);
        return hat;
    }
    whenFlagClicked (fn) { return this.on('flag', fn); }
    whenKeyPressed (key, fn) {
        const k = normalKey(key);
        return this.on('key', fn, {matches: pressed => k === 'any' || pressed === k});
    }
    whenThisSpriteClicked (fn) { return this.on('click', fn); }
    whenStageClicked (fn) { return this.on('stageClick', fn); }
    whenIReceive (name, fn) {
        const n = String(name).toLowerCase();
        return this.on('receive', fn, {matches: m => String(m).toLowerCase() === n});
    }
    whenBackdropSwitchesTo (name, fn) {
        const n = String(name).toLowerCase();
        return this.on('backdrop', fn, {matches: m => String(m).toLowerCase() === n});
    }
    whenGreaterThan (menu, value, fn) {
        return this.on('greater', fn, {menu: String(menu).toUpperCase(), value});
    }
    whenIStartAsAClone (fn) { return this.on('clone', fn); }

    stopOtherScripts () {
        const me = this.game.current;
        for (const t of this.game.threads) if (t.target === this && t !== me) t.done = true;
    }

    // -- motion --
    setXY (x, y, force) {
        if (this.isStage) return;
        const oldX = this.x;
        const oldY = this.y;
        x = S.num(x);
        y = S.num(y);
        if (this.game.fencing && !force) {
            const fenced = this.fencedPosition(x, y);
            x = fenced[0];
            y = fenced[1];
        }
        this.x = x;
        this.y = y;
        if (this.pen.down) this.drawPenLine(oldX, oldY, x, y);
        if (this.visible) this.game.redraw = true;
    }
    goTo (x, y) { this.setXY(x, y); }
    changeX (dx) { this.setXY(this.x + S.num(dx), this.y); }
    changeY (dy) { this.setXY(this.x, this.y + S.num(dy)); }
    setX (x) { this.setXY(x, this.y); }
    setY (y) { this.setXY(this.x, y); }
    moveSteps (steps) {
        const radians = toRad(90 - this.direction);
        const n = S.num(steps);
        this.setXY(this.x + (n * Math.cos(radians)), this.y + (n * Math.sin(radians)));
    }
    setDirection (direction) {
        const d = S.num(direction);
        if (!Number.isFinite(d)) return;
        this.direction = wrapClamp(d, -179, 180);
        if (this.visible) this.game.redraw = true;
    }
    turnRight (degrees) { this.setDirection(this.direction + S.num(degrees)); }
    turnLeft (degrees) { this.setDirection(this.direction - S.num(degrees)); }
    positionOf (name) {
        const what = String(name);
        if (what === '_mouse_') return [this.game.mouseX, this.game.mouseY];
        if (what === '_random_') {
            return [Math.round(this.game.width * (Math.random() - 0.5)),
                Math.round(this.game.height * (Math.random() - 0.5))];
        }
        const other = this.game.sprite(what);
        return other ? [other.x, other.y] : null;
    }
    goToTarget (name) {
        const at = this.positionOf(name);
        if (at) this.setXY(at[0], at[1]);
    }
    pointTowards (name) {
        const what = String(name);
        let at;
        if (what === '_random_') {
            this.setDirection(Math.round(Math.random() * 360) - 180);
            return;
        }
        at = this.positionOf(what);
        if (!at) return;
        const dx = at[0] - this.x;
        const dy = at[1] - this.y;
        this.setDirection(90 - toDeg(Math.atan2(dy, dx)));
    }
    *glideTo (seconds, x, y) {
        const duration = S.num(seconds);
        const startX = this.x;
        const startY = this.y;
        const endX = S.num(x);
        const endY = S.num(y);
        if (duration <= 0) {
            this.setXY(endX, endY);
            return;
        }
        const start = this.game.now();
        yield;
        for (;;) {
            const t = (this.game.now() - start) / duration;
            if (t >= 1) {
                this.setXY(endX, endY);
                return;
            }
            this.setXY(startX + ((endX - startX) * t), startY + ((endY - startY) * t));
            yield;
        }
    }
    *glideToTarget (seconds, name) {
        const at = this.positionOf(name);
        if (at) yield* this.glideTo(seconds, at[0], at[1]);
    }
    setRotationStyle (style) {
        this.rotationStyle = String(style);
        if (this.visible) this.game.redraw = true;
    }
    get xPosition () { return limitPrecision(this.x); }
    get yPosition () { return limitPrecision(this.y); }
    bounceOnEdge () {
        const bounds = this.bounds();
        if (!bounds) return;
        const w = this.game.width / 2;
        const h = this.game.height / 2;
        const distLeft = Math.max(0, w + bounds.left);
        const distTop = Math.max(0, h - bounds.top);
        const distRight = Math.max(0, w - bounds.right);
        const distBottom = Math.max(0, h + bounds.bottom);
        let nearest = '';
        let minDist = Infinity;
        if (distLeft < minDist) { minDist = distLeft; nearest = 'left'; }
        if (distTop < minDist) { minDist = distTop; nearest = 'top'; }
        if (distRight < minDist) { minDist = distRight; nearest = 'right'; }
        if (distBottom < minDist) { minDist = distBottom; nearest = 'bottom'; }
        if (minDist > 0) return;
        const radians = toRad(90 - this.direction);
        let dx = Math.cos(radians);
        let dy = -Math.sin(radians);
        if (nearest === 'left') dx = Math.max(0.2, Math.abs(dx));
        else if (nearest === 'top') dy = Math.max(0.2, Math.abs(dy));
        else if (nearest === 'right') dx = 0 - Math.max(0.2, Math.abs(dx));
        else if (nearest === 'bottom') dy = 0 - Math.max(0.2, Math.abs(dy));
        this.setDirection(toDeg(Math.atan2(dy, dx)) + 90);
        const fenced = this.keepInFence(this.x, this.y);
        this.setXY(fenced[0], fenced[1], true);
    }

    // -- the shape on the stage --
    costume () {
        return this.costumes[this.costumeIndex];
    }
    scaleX () {
        let flip = 1;
        if (this.rotationStyle === 'left-right' && this.direction < 0) flip = -1;
        return flip * this.size / 100;
    }
    drawAngle () {
        if (this.rotationStyle === 'all around') return this.direction - 90;
        return 0;
    }
    /** The corners of the costume's drawn part, on the stage. */
    corners () {
        const c = this.costume();
        if (!c || !c.loaded) return null;
        const box = c.box;
        const sx = this.scaleX();
        const sy = this.size / 100;
        const angle = toRad(this.drawAngle());
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const points = [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]];
        return points.map(p => {
            // Costume units from the turning point, y going up.
            const px = (p[0] - c.centerX) * sx;
            const py = (c.centerY - p[1]) * sy;
            return [this.x + (px * cos) + (py * sin), this.y - (px * sin) + (py * cos)];
        });
    }
    bounds () {
        const points = this.corners();
        if (!points) return null;
        const xs = points.map(p => p[0]);
        const ys = points.map(p => p[1]);
        return {left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys)};
    }
    /** Where a move to x, y ends with fencing on: Scratch keeps a sliver (up to 15 steps) on the stage. */
    fencedPosition (x, y) {
        const b = this.bounds();
        if (!b) return [x, y];
        const dx = x - this.x;
        const dy = y - this.y;
        const inset = Math.floor(Math.min(b.right - b.left, b.top - b.bottom) / 2);
        const sx = (this.game.width / 2) - Math.min(15, inset);
        const sy = (this.game.height / 2) - Math.min(15, inset);
        if (b.right + dx < -sx) x = Math.ceil(this.x - (sx + b.right));
        else if (b.left + dx > sx) x = Math.floor(this.x + (sx - b.left));
        if (b.top + dy < -sy) y = Math.ceil(this.y - (sy + b.top));
        else if (b.bottom + dy > sy) y = Math.floor(this.y + (sy - b.bottom));
        return [x, y];
    }
    /** The whole sprite back inside the stage, as "if on edge, bounce" puts it. */
    keepInFence (x, y) {
        const b = this.bounds();
        if (!b) return [x, y];
        const left = b.left + (x - this.x);
        const right = b.right + (x - this.x);
        const top = b.top + (y - this.y);
        const bottom = b.bottom + (y - this.y);
        const w = this.game.width / 2;
        const h = this.game.height / 2;
        let dx = 0;
        let dy = 0;
        if (left < -w) dx += -w - left;
        if (right > w) dx += w - right;
        if (top > h) dy += h - top;
        if (bottom < -h) dy += -h - bottom;
        return [x + dx, y + dy];
    }

    // -- looks --
    setCostume (index) {
        const count = this.costumes.length;
        if (!count) return;
        this.costumeIndex = wrapClamp(Math.round(index), 0, count - 1);
        if (this.visible) this.game.redraw = true;
    }
    switchCostume (value) {
        if (typeof value === 'number') {
            this.setCostume(value - 1);
            return;
        }
        const text = String(value);
        const named = this.costumes.findIndex(c => c.name === text);
        if (named >= 0) {
            this.setCostume(named);
            return;
        }
        if (!this.isStage && text === 'next costume') this.setCostume(this.costumeIndex + 1);
        else if (!this.isStage && text === 'previous costume') this.setCostume(this.costumeIndex - 1);
        else if (text.trim() !== '' && !Number.isNaN(Number(text))) this.setCostume(Number(text) - 1);
    }
    nextCostume () { this.setCostume(this.costumeIndex + 1); }
    get costumeNumber () { return this.costumeIndex + 1; }
    get costumeName () { return this.costumes[this.costumeIndex] ? this.costumes[this.costumeIndex].name : ''; }
    setSize (size) {
        let s = S.num(size);
        const c = this.costume();
        if (this.game.fencing && c && c.loaded) {
            const w = c.width;
            const h = c.height;
            const minScale = Math.min(1, Math.max(5 / w, 5 / h));
            const maxScale = Math.min((1.5 * this.game.width) / w, (1.5 * this.game.height) / h);
            s = clamp(s / 100, minScale, maxScale) * 100;
        }
        this.size = s;
        if (this.visible) this.game.redraw = true;
    }
    changeSize (by) { this.setSize(this.size + S.num(by)); }
    setEffect (name, value) {
        const effect = String(name).toLowerCase();
        let v = S.num(value);
        if (effect === 'ghost') v = clamp(v, 0, 100);
        if (effect === 'brightness') v = clamp(v, -100, 100);
        this.effects[effect] = v;
        if (this.visible) this.game.redraw = true;
    }
    changeEffect (name, by) {
        const effect = String(name).toLowerCase();
        this.setEffect(effect, (this.effects[effect] || 0) + S.num(by));
    }
    clearEffects () {
        for (const k of Object.keys(this.effects)) this.effects[k] = 0;
        if (this.visible) this.game.redraw = true;
    }
    show () { this.visible = true; this.game.redraw = true; }
    hide () { this.visible = false; this.game.redraw = true; }
    goToFront () {
        const layers = this.game.layers;
        layers.splice(layers.indexOf(this), 1);
        layers.push(this);
        this.game.redraw = true;
    }
    goToBack () {
        const layers = this.game.layers;
        layers.splice(layers.indexOf(this), 1);
        layers.unshift(this);
        this.game.redraw = true;
    }
    goToLayer (where) {
        if (String(where) === 'back') this.goToBack();
        else this.goToFront();
    }
    changeLayer (direction, by) {
        const layers = this.game.layers;
        const from = layers.indexOf(this);
        const step = Math.round(S.num(by)) * (String(direction) === 'backward' ? -1 : 1);
        const to = clamp(from + step, 0, layers.length - 1);
        layers.splice(from, 1);
        layers.splice(to, 0, this);
        this.game.redraw = true;
    }
    setBubble (type, text) {
        let message = text;
        if (typeof message === 'number') message = parseFloat(message.toFixed(2));
        message = String(message);
        this.bubble = message === '' ? null : {type, text: message};
        this.game.redraw = true;
        return this.bubble;
    }
    say (text) { this.setBubble('say', text); }
    think (text) { this.setBubble('think', text); }
    *sayFor (text, seconds) {
        const bubble = this.setBubble('say', text);
        yield* this.game.wait(seconds);
        if (this.bubble === bubble) this.setBubble('say', '');
    }
    *thinkFor (text, seconds) {
        const bubble = this.setBubble('think', text);
        yield* this.game.wait(seconds);
        if (this.bubble === bubble) this.setBubble('think', '');
    }
    setDragMode (draggable) {
        this.draggable = String(draggable) === 'draggable';
    }

    // -- clones --
    createClone (name) {
        const game = this.game;
        const what = String(name);
        const from = what === '_myself_' ? this : game.sprite(what);
        if (!from || from.isStage) return;
        if (game.cloneCount >= game.maxClones) return;
        const clone = Object.create(Target.prototype);
        Object.assign(clone, from);
        clone.isOriginal = false;
        clone.original = from.original;
        clone.removed = false;
        clone.vars = Object.assign({}, from.vars);
        clone.lists = {};
        for (const k of Object.keys(from.lists)) clone.lists[k] = from.lists[k].slice();
        clone.effects = Object.assign({}, from.effects);
        clone.soundEffects = Object.assign({}, from.soundEffects);
        clone.pen = Object.assign({}, from.pen);
        clone.bubble = null;
        clone.playing = [];
        game.cloneCount++;
        // Just behind the sprite it was made from.
        const layers = game.layers;
        layers.splice(layers.indexOf(from), 0, clone);
        game.startHats('clone', undefined, clone);
        if (clone.visible) game.redraw = true;
    }
    /** @returns {boolean} true when this was a clone and is gone, so its script ends */
    deleteClone () {
        if (this.isOriginal) return false;
        this.removeClone();
        return true;
    }
    removeClone () {
        if (this.removed) return;
        this.removed = true;
        this.stopSounds();
        const layers = this.game.layers;
        const at = layers.indexOf(this);
        if (at >= 0) layers.splice(at, 1);
        this.game.cloneCount--;
        for (const t of this.game.threads) if (t.target === this) t.done = true;
        this.game.redraw = true;
    }

    // -- sensing --
    touching (name) {
        const what = String(name);
        if (what === '_mouse_') return this.containsPoint(this.game.mouse.x, this.game.mouse.y);
        if (what === '_edge_') {
            const b = this.bounds();
            if (!b) return false;
            const w = this.game.width / 2;
            const h = this.game.height / 2;
            return b.left < -w || b.right > w || b.top > h || b.bottom < -h;
        }
        if (!this.visible) return false;
        for (const other of this.game.layers) {
            if (other === this || other.removed || !other.visible || other.original.name !== what) continue;
            if (this.game.touches(this, other)) return true;
        }
        return false;
    }
    touchingColor (color) {
        return this.game.touchesColor(this, colorToRgba(color));
    }
    containsPoint (x, y) {
        if (!this.visible) return false;
        return this.game.pointInside(this, x, y);
    }
    distanceTo (name) {
        if (this.isStage) return 10000;
        const at = this.positionOf(name);
        if (!at) return 10000;
        const dx = this.x - at[0];
        const dy = this.y - at[1];
        return Math.sqrt((dx * dx) + (dy * dy));
    }

    // -- sounds --
    soundIndex (value) {
        if (typeof value === 'number') {
            const count = this.sounds.length;
            if (!count) return -1;
            return wrapClamp(Math.round(value) - 1, 0, count - 1);
        }
        const text = String(value);
        const named = this.sounds.findIndex(s => s.name === text);
        if (named >= 0) return named;
        if (text.trim() !== '' && !Number.isNaN(Number(text)) && this.sounds.length) {
            return wrapClamp(Math.round(Number(text)) - 1, 0, this.sounds.length - 1);
        }
        return -1;
    }
    startSound (value) {
        const index = this.soundIndex(value);
        if (index < 0) return null;
        const sound = this.sounds[index];
        // The same sound on the same sprite starts again rather than doubling.
        this.playing = this.playing.filter(p => {
            if (p.sound === sound) { p.stop(); return false; }
            return !p.ended;
        });
        const playing = sound.play(this.volume, this.soundEffects);
        if (playing) this.playing.push(playing);
        return {sound, playing};
    }
    *playSoundUntilDone (value) {
        const started = this.startSound(value);
        if (!started) return;
        const rate = Math.pow(2, this.soundEffects.pitch / 120);
        const seconds = started.sound.duration / rate;
        yield* this.game.wait(seconds);
    }
    stopSounds () {
        for (const p of this.playing) p.stop();
        this.playing = [];
    }
    setVolume (value) {
        this.volume = clamp(S.num(value), 0, 100);
        for (const p of this.playing) p.setVolume(this.volume);
    }
    changeVolume (by) { this.setVolume(this.volume + S.num(by)); }
    setSoundEffect (name, value) {
        const effect = String(name).toLowerCase();
        if (effect === 'pitch') this.soundEffects.pitch = clamp(S.num(value), -360, 360);
        if (effect === 'pan') this.soundEffects.pan = clamp(S.num(value), -100, 100);
        for (const p of this.playing) p.setEffects(this.soundEffects);
    }
    changeSoundEffect (name, by) {
        const effect = String(name).toLowerCase();
        this.setSoundEffect(effect, (this.soundEffects[effect] || 0) + S.num(by));
    }
    clearSoundEffects () {
        this.soundEffects = {pitch: 0, pan: 0};
        for (const p of this.playing) p.setEffects(this.soundEffects);
    }

    // -- the pen --
    penRgba () {
        const p = this.pen;
        const rgb = hsvToRgb((p.color / 100) * 360, p.saturation / 100, p.brightness / 100);
        return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${1 - (p.transparency / 100)})`;
    }
    penDown () {
        this.pen.down = true;
        this.drawPenLine(this.x, this.y, this.x, this.y);
    }
    penUp () { this.pen.down = false; }
    drawPenLine (x1, y1, x2, y2) {
        const g = this.game;
        if (!g.penCtx) return;
        const ctx = g.penCtx;
        const k = g.penScale;
        ctx.strokeStyle = this.penRgba();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = this.pen.size * k;
        ctx.lineCap = 'round';
        const ax = (x1 + (g.width / 2)) * k;
        const ay = ((g.height / 2) - y1) * k;
        const bx = (x2 + (g.width / 2)) * k;
        const by = ((g.height / 2) - y2) * k;
        if (ax === bx && ay === by) {
            ctx.beginPath();
            ctx.arc(ax, ay, this.pen.size * k / 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.stroke();
        }
        g.redraw = true;
    }
    setPenColor (value) {
        const rgba = colorToRgba(value);
        const hsv = rgbToHsv(rgba[0], rgba[1], rgba[2]);
        this.pen.color = (hsv[0] / 360) * 100;
        this.pen.saturation = hsv[1] * 100;
        this.pen.brightness = hsv[2] * 100;
        this.pen.transparency = 100 * (1 - (rgba[3] / 255));
    }
    setPenParam (param, value) {
        const p = String(param).toLowerCase();
        const v = S.num(value);
        if (p === 'color') this.pen.color = wrapClamp(v, 0, 100);
        else if (p === 'saturation') this.pen.saturation = clamp(v, 0, 100);
        else if (p === 'brightness') this.pen.brightness = clamp(v, 0, 100);
        else if (p === 'transparency') this.pen.transparency = clamp(v, 0, 100);
    }
    changePenParam (param, by) {
        const p = String(param).toLowerCase();
        this.setPenParam(p, (this.pen[p] || 0) + S.num(by));
    }
    setPenSize (size) { this.pen.size = clamp(S.num(size), 1, 1200); }
    changePenSize (by) { this.setPenSize(this.pen.size + S.num(by)); }
    stamp () {
        const g = this.game;
        if (!g.penCtx) return;
        g.drawTarget(g.penCtx, this, g.penScale);
        g.redraw = true;
    }
}

// --- pictures and sounds --------------------------------------------------------

class Costume {
    constructor (game, spec) {
        this.name = spec.name;
        this.file = spec.file;
        this.resolution = spec.resolution || 1;
        this.rawCenterX = spec.centerX || 0;
        this.rawCenterY = spec.centerY || 0;
        this.loaded = false;
        this.image = new Image();
        game.track(new Promise((resolve, reject) => {
            this.image.onload = () => {
                const r = this.resolution;
                this.width = (this.image.naturalWidth || this.image.width) / r;
                this.height = (this.image.naturalHeight || this.image.height) / r;
                this.centerX = this.rawCenterX / r;
                this.centerY = this.rawCenterY / r;
                this.box = game.opaqueBox(this);
                this.loaded = true;
                resolve();
            };
            this.image.onerror = () => {
                console.error(`Could not load the picture ${this.file}`);
                this.width = 1;
                this.height = 1;
                this.centerX = 0;
                this.centerY = 0;
                this.box = {left: 0, top: 0, right: 1, bottom: 1};
                reject();
            };
        }));
        this.image.src = this.file;
    }
}

class Sound {
    constructor (game, spec) {
        this.game = game;
        this.name = spec.name;
        this.file = spec.file;
        this.duration = spec.rate && spec.sampleCount ? spec.sampleCount / spec.rate : 0;
    }
    play (volume, effects) {
        if (!this.game.audioUnlocked) return null;
        const audio = new Audio(this.file);
        const handle = {sound: this, audio, ended: false};
        audio.preservesPitch = false;
        audio.mozPreservesPitch = false;
        audio.webkitPreservesPitch = false;
        handle.setVolume = v => { audio.volume = clamp(v / 100, 0, 1); };
        handle.setEffects = e => {
            try { audio.playbackRate = clamp(Math.pow(2, e.pitch / 120), 0.0625, 16); } catch (err) { /* */ }
        };
        handle.stop = () => {
            handle.ended = true;
            try { audio.pause(); } catch (err) { /* */ }
        };
        audio.onended = () => { handle.ended = true; };
        handle.setVolume(volume);
        handle.setEffects(effects);
        const played = audio.play();
        if (played && played.catch) played.catch(() => { handle.ended = true; });
        return handle;
    }
}

// --- drawing and touching ----------------------------------------------------------

Game.prototype.opaqueBox = function (costume) {
    // The costume's see-through-or-not pixels, kept for "touching", and the
    // box Scratch measures edges and fences with: from the centre of the
    // outermost drawn pixels, so a 24-wide box is 23 wide to Scratch.
    const r = costume.resolution;
    const full = {left: 0.5 / r, top: 0.5 / r, right: costume.width - (0.5 / r), bottom: costume.height - (0.5 / r)};
    try {
        const w = Math.max(1, Math.round(costume.width * r));
        const h = Math.max(1, Math.round(costume.height * r));
        if (w * h > 4000000) return full;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(costume.image, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const alpha = new Uint8Array(w * h);
        let left = w, top = h, right = -1, bottom = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const a = data[(((y * w) + x) * 4) + 3];
                alpha[(y * w) + x] = a;
                if (a > 0) {
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    if (y > bottom) bottom = y;
                }
            }
        }
        costume.alpha = alpha;
        costume.alphaW = w;
        costume.alphaH = h;
        if (right < 0) return {left: costume.centerX, top: costume.centerY, right: costume.centerX, bottom: costume.centerY};
        return {left: (left + 0.5) / r, top: (top + 0.5) / r, right: (right + 0.5) / r, bottom: (bottom + 0.5) / r};
    } catch (e) {
        // A page opened straight from a file cannot read its pictures' pixels.
        this.pixelsUnreadable = true;
        return full;
    }
};

/** Whether a stage point lands on a drawn pixel of the target's costume, as Scratch samples it. */
Game.prototype.hit = function (target, x, y) {
    const c = target.costume();
    if (!c || !c.loaded) return false;
    if (!c.alpha) {
        const b = target.bounds();
        return !!b && x >= b.left && x <= b.right && y >= b.bottom && y <= b.top;
    }
    const angle = toRad(target.drawAngle());
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = x - target.x;
    const dy = y - target.y;
    const px = ((dx * cos) - (dy * sin)) / target.scaleX();
    const py = ((dx * sin) + (dy * cos)) / (target.size / 100);
    const u = (c.centerX + px) / c.width;
    const v = (c.centerY - py) / c.height;
    // As Scratch: no cut-off at the costume's far edges, the pixel index decides.
    const w = c.alphaW;
    const h = c.alphaH;
    const sx = Math.floor(u * (w - 1));
    const sy = Math.floor(v * (h - 1));
    const at = (ax, ay) => (ax >= 0 && ay >= 0 && ax < w && ay < h ? c.alpha[(ay * w) + ax] : 0);
    // Unturned at its own size Scratch reads the nearest pixel, otherwise any of four.
    const plain = target.size === 100 && Math.abs(target.drawAngle() % 90) < 1e-9 && target.scaleX() > 0;
    if (plain) return at(sx, sy) > 0;
    return at(sx, sy) > 0 || at(sx + 1, sy) > 0 || at(sx, sy + 1) > 0 || at(sx + 1, sy + 1) > 0;
};

const snapBox = b => ({left: Math.floor(b.left), right: Math.ceil(b.right), bottom: Math.floor(b.bottom),
    top: Math.ceil(b.top)});

Game.prototype.drawTarget = function (ctx, target, k, plain) {
    const c = target.costume();
    if (!c || !c.loaded) return;
    ctx.save();
    // On top of whatever the caller set: the stage at the size it asked for.
    ctx.scale(k, k);
    if (target.isStage) {
        ctx.drawImage(c.image, (this.width / 2) - c.centerX, (this.height / 2) - c.centerY, c.width, c.height);
        ctx.restore();
        return;
    }
    ctx.translate((this.width / 2) + target.x, (this.height / 2) - target.y);
    ctx.rotate(toRad(target.drawAngle()));
    ctx.scale(target.scaleX(), target.size / 100);
    if (!plain) {
        ctx.globalAlpha = 1 - (target.effects.ghost / 100);
        const filters = [];
        if (target.effects.brightness) filters.push(`brightness(${1 + (target.effects.brightness / 100)})`);
        if (target.effects.color) filters.push(`hue-rotate(${(target.effects.color * 360 / 200) % 360}deg)`);
        if (filters.length) ctx.filter = filters.join(' ');
    }
    ctx.drawImage(c.image, -c.centerX, -c.centerY, c.width, c.height);
    ctx.restore();
};

Game.prototype.scratchCanvas = function (w, h) {
    if (!this.testCanvas) {
        this.testCanvas = document.createElement('canvas');
        this.testCtx = this.testCanvas.getContext('2d', {willReadFrequently: true});
    }
    if (this.testCanvas.width < w) this.testCanvas.width = w;
    if (this.testCanvas.height < h) this.testCanvas.height = h;
    this.testCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.testCtx.globalCompositeOperation = 'source-over';
    this.testCtx.clearRect(0, 0, w, h);
    return this.testCtx;
};

Game.prototype.touches = function (a, b) {
    const ba = a.bounds();
    const bb = b.bounds();
    if (!ba || !bb) return false;
    const sa = snapBox(ba);
    sa.left = Math.max(sa.left, Math.floor(-this.width / 2));
    sa.right = Math.min(sa.right, Math.ceil(this.width / 2));
    sa.bottom = Math.max(sa.bottom, Math.floor(-this.height / 2));
    sa.top = Math.min(sa.top, Math.ceil(this.height / 2));
    const sb = snapBox(bb);
    const left = Math.max(sa.left, sb.left);
    const right = Math.min(sa.right, sb.right);
    const bottom = Math.max(sa.bottom, sb.bottom);
    const top = Math.min(sa.top, sb.top);
    if (left > right || bottom > top) return false;
    if (sa.right - sa.left === 0 || sa.top - sa.bottom === 0) return false;
    for (let x = left; x <= right; x++) {
        for (let y = bottom; y <= top; y++) {
            if (this.hit(a, x, y) && this.hit(b, x, y)) return true;
        }
    }
    return false;
};

Game.prototype.pointInside = function (target, x, y) {
    return this.hit(target, x, y);
};

Game.prototype.touchesColor = function (target, rgba) {
    const b = target.bounds();
    if (!b || !target.visible || this.pixelsUnreadable) return false;
    const left = Math.max(b.left, -this.width / 2);
    const right = Math.min(b.right, this.width / 2);
    const bottom = Math.max(b.bottom, -this.height / 2);
    const top = Math.min(b.top, this.height / 2);
    if (left >= right || bottom >= top) return false;
    const w = Math.ceil(right - left) + 1;
    const h = Math.ceil(top - bottom) + 1;
    try {
        const ctx = this.scratchCanvas(w, h * 2);
        const origin = () => ctx.translate(-((this.width / 2) + left), -((this.height / 2) - top));
        // Top half: everything else on the stage. Bottom half: this sprite.
        ctx.save();
        origin();
        this.drawTarget(ctx, this.stage, 1);
        if (this.penCanvas) {
            ctx.drawImage(this.penCanvas, 0, 0, this.width, this.height);
        }
        for (const other of this.layers) {
            if (other !== target && other.visible && !other.removed) this.drawTarget(ctx, other, 1);
        }
        ctx.restore();
        ctx.save();
        ctx.translate(0, h);
        origin();
        this.drawTarget(ctx, target, 1, true);
        ctx.restore();
        const stage = ctx.getImageData(0, 0, w, h).data;
        const mask = ctx.getImageData(0, h, w, h).data;
        for (let i = 0; i < stage.length; i += 4) {
            if (mask[i + 3] === 0 || stage[i + 3] === 0) continue;
            if ((stage[i] & 0xF8) === (rgba[0] & 0xF8) && (stage[i + 1] & 0xF8) === (rgba[1] & 0xF8) &&
                (stage[i + 2] & 0xF0) === (rgba[2] & 0xF0)) return true;
        }
        return false;
    } catch (e) {
        this.pixelsUnreadable = true;
        return false;
    }
};

Game.prototype.render = function () {
    const ctx = this.ctx;
    if (!ctx) return;
    const k = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawTarget(ctx, this.stage, k);
    if (this.penCanvas) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.penCanvas, 0, 0, this.canvas.width, this.canvas.height);
    }
    for (const target of this.layers) {
        if (target.visible) this.drawTarget(ctx, target, k);
    }
    for (const target of this.layers) {
        if (target.visible && target.bubble) this.drawBubble(ctx, target, k);
    }
    this.updateMonitors();
};

Game.prototype.drawBubble = function (ctx, target, k) {
    const b = target.bounds();
    if (!b) return;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.font = '14px Helvetica, Arial, sans-serif';
    const maxWidth = 170;
    const words = target.bubble.text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = word;
        } else line = test;
    }
    lines.push(line);
    const width = Math.max(50, Math.min(maxWidth, Math.max(...lines.map(l => ctx.measureText(l).width)))) + 20;
    const height = (lines.length * 17) + 16;
    let x = (this.width / 2) + b.right;
    if (x + width > this.width) x = Math.max(0, (this.width / 2) + b.left - width);
    let y = (this.height / 2) - b.top - height - 8;
    if (y < 0) y = 0;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, width, height, 14);
    else ctx.rect(x, y, width, height);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#575e75';
    lines.forEach((l, i) => ctx.fillText(l, x + 10, y + 22 + (i * 17)));
    ctx.restore();
};

Game.prototype.updateMonitors = function () {
    for (const m of this.monitors) {
        if (!m.el) continue;
        m.el.style.display = m.visible ? '' : 'none';
        if (!m.visible) continue;
        const value = m.read();
        if (m.mode === 'list') {
            const items = Array.isArray(value) ? value : [];
            const key = items.join('\u0000');
            if (key !== m.last) {
                m.last = key;
                m.valueEl.innerHTML = '';
                items.forEach((item, i) => {
                    const row = document.createElement('div');
                    row.className = 'list-row';
                    row.innerHTML = '<span class="list-index"></span><span class="list-item"></span>';
                    row.firstChild.textContent = i + 1;
                    row.lastChild.textContent = item;
                    m.valueEl.appendChild(row);
                });
                m.lengthEl.textContent = `length ${items.length}`;
            }
        } else {
            let shown = value;
            if (typeof shown === 'number') shown = Math.round(shown * 1e6) / 1e6;
            const text = String(shown);
            if (text !== m.last) {
                m.last = text;
                m.valueEl.textContent = text;
                if (m.slider && document.activeElement !== m.slider) m.slider.value = S.num(value);
            }
        }
    }
};

// --- the page: canvas, buttons, keyboard and mouse -----------------------------------

Game.prototype.mount = function (root) {
    const game = this;
    this.root = root;
    this.canvas = root.querySelector('canvas.stage');
    this.ctx = this.canvas.getContext('2d');
    this.penCanvas = document.createElement('canvas');
    this.penScale = 2;
    this.penCanvas.width = this.width * this.penScale;
    this.penCanvas.height = this.height * this.penScale;
    this.penCtx = this.penCanvas.getContext('2d');
    const prompt = root.querySelector('.prompt');
    this.ui = {prompt: {
        root: prompt,
        label: prompt.querySelector('.prompt-question'),
        input: prompt.querySelector('input'),
        done: null
    }};
    const submit = () => {
        const box = game.ui.prompt;
        box.root.style.display = 'none';
        if (box.done) {
            const done = box.done;
            box.done = null;
            done(box.input.value);
        }
    };
    this.ui.prompt.input.addEventListener('keydown', e => {
        if (e.key === 'Enter') submit();
        e.stopPropagation();
    });
    prompt.querySelector('button').addEventListener('click', submit);

    const resize = () => {
        const box = root.querySelector('.stage-wrap');
        const room = box.clientWidth || this.width;
        const fit = Math.min(room / this.width, (window.innerHeight - 60) / this.height, 3);
        const cssWidth = Math.max(120, Math.floor(this.width * Math.max(fit, 0.25)));
        const cssHeight = Math.floor(cssWidth * this.height / this.width);
        const ratio = window.devicePixelRatio || 1;
        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${cssHeight}px`;
        this.canvas.width = Math.round(cssWidth * ratio);
        this.canvas.height = Math.round(cssHeight * ratio);
        this.scale = this.canvas.width / this.width;
        const overlay = root.querySelector('.overlay');
        overlay.style.width = `${cssWidth}px`;
        overlay.style.height = `${cssHeight}px`;
        overlay.style.setProperty('--k', String(cssWidth / this.width));
        this.render();
    };
    window.addEventListener('resize', resize);

    const toStage = e => {
        const rect = this.canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width * this.width) - (this.width / 2);
        const y = (this.height / 2) - ((e.clientY - rect.top) / rect.height * this.height);
        return [clamp(x, -this.width / 2, this.width / 2), clamp(y, -this.height / 2, this.height / 2)];
    };
    let dragging = null;
    this.canvas.addEventListener('pointermove', e => {
        const at = toStage(e);
        this.mouse.x = at[0];
        this.mouse.y = at[1];
        if (dragging) {
            dragging.target.setXY(at[0] - dragging.dx, at[1] - dragging.dy, true);
        }
    });
    this.canvas.addEventListener('pointerdown', e => {
        this.unlockAudio();
        const at = toStage(e);
        this.mouse.x = at[0];
        this.mouse.y = at[1];
        this.mouse.down = true;
        this.canvas.focus();
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const target = this.layers[i];
            if (target.removed || !target.visible) continue;
            if (this.pointInside(target, at[0], at[1])) {
                if (target.draggable) dragging = {target, dx: at[0] - target.x, dy: at[1] - target.y};
                this.startHats('click', undefined, target);
                return;
            }
        }
        this.startHats('stageClick');
    });
    window.addEventListener('pointerup', () => {
        this.mouse.down = false;
        dragging = null;
    });
    window.addEventListener('keydown', e => {
        if (e.target && e.target.tagName === 'INPUT') return;
        this.unlockAudio();
        const name = keyName(e);
        if (!name) return;
        if (['space', 'up arrow', 'down arrow', 'left arrow', 'right arrow'].includes(name)) e.preventDefault();
        // Held keys repeat, and Scratch starts the key's scripts on every repeat.
        this.keys[name] = true;
        this.startHats('key', name);
    });
    window.addEventListener('keyup', e => {
        const name = keyName(e);
        if (name) delete this.keys[name];
    });

    root.querySelector('.green-flag').addEventListener('click', () => {
        this.unlockAudio();
        this.hideStartScreen();
        this.greenFlag();
    });
    root.querySelector('.stop').addEventListener('click', () => this.stopAll());
    const start = root.querySelector('.start-screen');
    start.addEventListener('click', () => {
        this.unlockAudio();
        this.hideStartScreen();
        this.greenFlag();
    });

    this.buildMonitors(root.querySelector('.overlay'));
    resize();
};

Game.prototype.hideStartScreen = function () {
    const start = this.root && this.root.querySelector('.start-screen');
    if (start) start.style.display = 'none';
};

Game.prototype.unlockAudio = function () {
    this.audioUnlocked = true;
};

Game.prototype.buildMonitors = function (overlay) {
    for (const m of this.monitors) {
        const el = document.createElement('div');
        el.className = `monitor monitor-${m.mode}`;
        el.style.left = `calc(${m.x}px * var(--k))`;
        el.style.top = `calc(${m.y}px * var(--k))`;
        if (m.mode === 'list') {
            el.style.width = `calc(${m.width || 100}px * var(--k))`;
            el.style.height = `calc(${m.height || 200}px * var(--k))`;
            el.innerHTML = '<div class="monitor-label"></div><div class="list-items"></div><div class="list-length"></div>';
            el.querySelector('.monitor-label').textContent = m.label;
            m.valueEl = el.querySelector('.list-items');
            m.lengthEl = el.querySelector('.list-length');
        } else if (m.mode === 'large') {
            el.innerHTML = '<div class="monitor-value"></div>';
            m.valueEl = el.firstChild;
        } else {
            el.innerHTML = '<span class="monitor-label"></span><span class="monitor-value"></span>';
            el.querySelector('.monitor-label').textContent = m.label;
            m.valueEl = el.querySelector('.monitor-value');
            if (m.mode === 'slider') {
                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = m.sliderMin;
                slider.max = m.sliderMax;
                slider.step = m.isDiscrete ? 1 : 0.01;
                slider.addEventListener('input', () => m.write(Number(slider.value)));
                el.appendChild(slider);
                m.slider = slider;
            }
        }
        m.el = el;
        overlay.appendChild(el);
    }
};

/** Start the game once its pictures are in: draw it, then run frames. */
Game.prototype.run = function (root, options) {
    const opts = options || {};
    this.mount(root);
    const loading = root.querySelector('.loading');
    const go = () => {
        if (this.loadingCount > 0) {
            setTimeout(go, 50);
            return;
        }
        if (loading) loading.style.display = 'none';
        this.render();
        if (opts.test) {
            // Driven frame by frame from outside, on a clock of its own.
            this.virtualTime = 0;
            this.audioUnlocked = false;
            this.hideStartScreen();
            window.scratchGame = this;
            return;
        }
        const frame = 1000 / this.framerate;
        let last = performance.now();
        const loop = now => {
            if (now - last >= frame - 2) {
                last = now - ((now - last) % frame);
                this.step();
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        window.scratchGame = this;
    };
    go();
};

/** For tests: run frames on a clock that moves one frame at a time. */
Game.prototype.stepFrames = function (count) {
    for (let i = 0; i < count; i++) {
        this.step();
        if (this.virtualTime !== null) this.virtualTime += 1 / this.framerate;
    }
};

/** For tests: every sprite's position, costume and variables. */
Game.prototype.snapshot = function () {
    const out = {globals: Object.assign({}, this.globals), lists: {}, sprites: {}};
    for (const name of Object.keys(this.globalLists)) out.lists[name] = this.globalLists[name].slice();
    for (const t of this.layers) {
        if (!t.isOriginal) continue;
        out.sprites[t.name] = {
            x: t.xPosition, y: t.yPosition, direction: t.direction, size: t.size, visible: t.visible,
            costume: t.costumeName, variables: Object.assign({}, t.vars),
            clones: this.layers.filter(c => !c.isOriginal && c.original === t && !c.removed).length
        };
    }
    out.backdrop = this.backdropName;
    return out;
};

Game.prototype.NEXT_FRAME = NEXT_FRAME;
window.ScratchGame = Game;
window.ScratchRules = S;
})();
