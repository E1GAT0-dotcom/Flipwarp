/* eslint-disable */
// ===== The Scratch runtime: how Scratch runs a project, made for Game Lab =====
// Exported from Flipwarp. Below this runtime come the game's own sprites and
// scripts. Game Lab runs older JavaScript (no generators), so each script is a
// small "state machine": a function that runs until Scratch would let other
// scripts have a turn, remembers where it got to (state), and returns.
// Every frame (draw) each running script gets a turn, in the order Scratch
// would, until something on the stage changed; then the sprites are drawn.
// Positions are Scratch's (x right, y up, the stage 480 by 360 around 0, 0);
// only the drawing turns them into Game Lab's 400 by 400 canvas.

var YIELD = {value: undefined, done: false};
var DONE = {value: undefined, done: true};
var NEXT_FRAME_VALUE = {nextFrame: true};
var NEXT_FRAME = {value: NEXT_FRAME_VALUE, done: false};

/** A script or custom block that runs step by step: next() runs it to its next pause. */
function machine(step) {
    return {next: step};
}

// --- Scratch's rules for values ---------------------------------------------

var S = {};

S.num = function (value) {
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    var n = Number(value);
    return isNaN(n) ? 0 : n;
};
S.bool = function (value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        return !(value === '' || value === '0' || value.toLowerCase() === 'false');
    }
    return !!value;
};
function isWhiteSpace(v) {
    return v === null || (typeof v === 'string' && v.replace(/\s/g, '').length === 0);
}
S.compare = function (a, b) {
    var n1 = Number(a);
    var n2 = Number(b);
    if (n1 === 0 && isWhiteSpace(a)) n1 = NaN;
    else if (n2 === 0 && isWhiteSpace(b)) n2 = NaN;
    if (isNaN(n1) || isNaN(n2)) {
        var s1 = String(a).toLowerCase();
        var s2 = String(b).toLowerCase();
        if (s1 < s2) return -1;
        if (s1 > s2) return 1;
        return 0;
    }
    if (n1 === Infinity && n2 === Infinity) return 0;
    if (n1 === -Infinity && n2 === -Infinity) return 0;
    return n1 - n2;
};
S.lt = function (a, b) { return S.compare(a, b) < 0; };
S.gt = function (a, b) { return S.compare(a, b) > 0; };
S.eq = function (a, b) { return S.compare(a, b) === 0; };
function isInt(v) {
    if (typeof v === 'number') return isNaN(v) || v === Math.floor(v);
    if (typeof v === 'boolean') return true;
    if (typeof v === 'string') return v.indexOf('.') < 0;
    return false;
}
S.random = function (from, to) {
    var n1 = S.num(from);
    var n2 = S.num(to);
    var low = Math.min(n1, n2);
    var high = Math.max(n1, n2);
    if (low === high) return low;
    if (isInt(from) && isInt(to)) return low + Math.floor(Math.random() * ((high + 1) - low));
    return (Math.random() * (high - low)) + low;
};
S.join = function (a, b) { return String(a) + String(b); };
S.letterOf = function (index, text) {
    var s = String(text);
    var i = S.num(index) - 1;
    if (i < 0 || i >= s.length) return '';
    return s.charAt(i);
};
S.lengthOf = function (text) { return String(text).length; };
S.contains = function (text, part) {
    return String(text).toLowerCase().indexOf(String(part).toLowerCase()) !== -1;
};
S.mod = function (a, b) {
    var n = S.num(a);
    var m = S.num(b);
    var result = n % m;
    if (result / m < 0) result += m;
    return result;
};
S.round = function (v) { return Math.round(S.num(v)); };
function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }
S.mathop = function (op, value) {
    var n = S.num(value);
    switch (String(op).toLowerCase()) {
    case 'abs': return Math.abs(n);
    case 'floor': return Math.floor(n);
    case 'ceiling': return Math.ceil(n);
    case 'sqrt': return Math.sqrt(n);
    case 'sin': return Math.round(Math.sin(toRad(n)) * 1e10) / 1e10;
    case 'cos': return Math.round(Math.cos(toRad(n)) * 1e10) / 1e10;
    case 'tan':
        var angle = n % 360;
        if (angle === -270 || angle === 90) return Infinity;
        if (angle === -90 || angle === 270) return -Infinity;
        return Math.round(Math.tan(toRad(n)) * 1e10) / 1e10;
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
function listIndex(index, length, acceptAll) {
    if (typeof index !== 'number') {
        var text = String(index);
        if (text === 'all') return acceptAll ? 'all' : 0;
        if (text === 'last') return length > 0 ? length : 0;
        if (text === 'random' || text === 'any') return length > 0 ? 1 + Math.floor(Math.random() * length) : 0;
    }
    var i = Math.floor(S.num(index));
    if (i < 1 || i > length) return 0;
    return i;
}
S.listAdd = function (list, item) { list.push(item); };
S.listDelete = function (list, index) {
    var i = listIndex(index, list.length, true);
    if (i === 'all') { list.length = 0; return; }
    if (i) list.splice(i - 1, 1);
};
S.listDeleteAll = function (list) { list.length = 0; };
S.listInsert = function (list, index, item) {
    var i = listIndex(index, list.length + 1, false);
    if (i) list.splice(i - 1, 0, item);
};
S.listReplace = function (list, index, item) {
    var i = listIndex(index, list.length, false);
    if (i) list[i - 1] = item;
};
S.listItem = function (list, index) {
    var i = listIndex(index, list.length, false);
    return i ? list[i - 1] : '';
};
S.listIndexOf = function (list, item) {
    for (var i = 0; i < list.length; i++) if (S.eq(list[i], item)) return i + 1;
    return 0;
};
S.listContains = function (list, item) { return S.listIndexOf(list, item) !== 0; };
S.listContents = function (list) {
    var allSingle = true;
    for (var i = 0; i < list.length; i++) if (String(list[i]).length !== 1) allSingle = false;
    return list.join(allSingle ? '' : ' ');
};
function limitPrecision(c) {
    var r = Math.round(c);
    return Math.abs(c - r) < 1e-9 ? r : c;
}
function wrapClamp(value, min, max) {
    var range = (max - min) + 1;
    return value - (Math.floor((value - min) / range) * range);
}
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function copyOf(object) {
    var out = {};
    for (var k in object) if (Object.prototype.hasOwnProperty.call(object, k)) out[k] = object[k];
    return out;
}
function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = ((b - r) / d) + 2;
        else h = ((r - g) / d) + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, max === 0 ? 0 : d / max, max];
}
function colorToRgba(value) {
    if (typeof value === 'string' && value.charAt(0) === '#') {
        var hex = value.length === 4 ? value.charAt(1) + value.charAt(1) + value.charAt(2) + value.charAt(2) +
            value.charAt(3) + value.charAt(3) : value.slice(1, 7);
        var n = parseInt(hex, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
    }
    var v = S.num(value);
    var a = (v >>> 24) & 255;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a === 0 ? 255 : a];
}

// Scratch's key names and Game Lab's.
var KEY_NAMES = {'up arrow': 'up', 'down arrow': 'down', 'left arrow': 'left', 'right arrow': 'right',
    'space': 'space', 'enter': 'enter'};
var ANY_KEYS = ['up arrow', 'down arrow', 'left arrow', 'right arrow', 'space', 'enter',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u',
    'v', 'w', 'x', 'y', 'z', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
function gameLabKey(key) {
    var k = String(key).toLowerCase();
    return KEY_NAMES[k] || k;
}

// Hats that start again from the top when started while running.
var RESTARTS = {flag: true, key: false, click: true, stageClick: true, receive: true, backdrop: false,
    greater: false, clone: false};

// --- the game -----------------------------------------------------------------

function Game(options) {
    this.width = options.width || 480;
    this.height = options.height || 360;
    this.framerate = options.framerate || 30;
    this.fencing = options.fencing !== false;
    this.maxClones = typeof options.maxClones === 'number' ? options.maxClones : 300;
    this.globals = {};
    this.globalLists = {};
    this.stage = null;
    this.layers = [];
    this.threads = [];
    this.answer = '';
    this.username = '';
    this.redraw = false;
    this.cloneCount = 0;
    this.timerStart = 0;
    this.virtualTime = null;
    this.edgeState = [];
    this.monitors = [];
    this.penLines = [];
    this.stamps = [];
    this.stampsUsed = 0;
    this.counter = 0;
    this.hatKeys = [];
    this.started = false;
    this.NEXT_FRAME = NEXT_FRAME;
    // The Scratch stage inside Game Lab's 400 by 400 canvas.
    this.k = Math.min(400 / this.width, 400 / this.height);
    this.offsetX = (400 - (this.width * this.k)) / 2;
    this.offsetY = (400 - (this.height * this.k)) / 2;
}

Game.prototype.now = function () {
    return this.virtualTime !== null ? this.virtualTime : new Date().getTime() / 1000;
};
Game.prototype.timer = function () {
    return this.now() - this.timerStart;
};
Game.prototype.resetTimer = function () {
    this.timerStart = this.now();
};

Game.prototype.addStage = function (spec) {
    this.stage = new Target(this, spec, true);
    var k;
    for (k in spec.variables) this.globals[k] = spec.variables[k];
    for (k in spec.lists) this.globalLists[k] = spec.lists[k].slice();
    this.stage.vars = this.globals;
    this.stage.lists = this.globalLists;
    return this.stage;
};
Game.prototype.addSprite = function (spec) {
    var sprite = new Target(this, spec, false);
    sprite.vars = copyOf(spec.variables || {});
    sprite.lists = {};
    for (var k in spec.lists) sprite.lists[k] = spec.lists[k].slice();
    this.layers.push(sprite);
    return sprite;
};
Game.prototype.sprite = function (name) {
    for (var i = 0; i < this.layers.length; i++) {
        if (this.layers[i].isOriginal && this.layers[i].name === name) return this.layers[i];
    }
    return null;
};
Game.prototype.allTargets = function () {
    return [this.stage].concat(this.layers);
};

function Thread(target, hat) {
    this.target = target;
    this.hat = hat;
    this.gen = hat.fn(target, false);
    this.done = false;
    this.sleeping = false;
}

/** Start the scripts with this hat, topmost sprite first, like Scratch. */
Game.prototype.startHats = function (kind, match, only) {
    var started = [];
    var order = this.allTargets().reverse();
    for (var t = 0; t < order.length; t++) {
        var target = order[t];
        if (only && target !== only) continue;
        for (var h = 0; h < target.hats.length; h++) {
            var hat = target.hats[h];
            if (hat.kind !== kind) continue;
            if (match !== undefined && !hat.matches(match)) continue;
            var running = null;
            for (var i = 0; i < this.threads.length; i++) {
                var th = this.threads[i];
                if (th.target === target && th.hat === hat && !th.done) running = th;
            }
            if (running) {
                if (!RESTARTS[kind]) continue;
                running.gen = hat.fn(target, false);
                started.push(running);
                continue;
            }
            var thread = new Thread(target, hat);
            this.threads.push(thread);
            started.push(thread);
        }
    }
    return started;
};

Game.prototype.greenFlag = function () {
    this.stopAll();
    this.resetTimer();
    this.started = true;
    this.startHats('flag');
};

Game.prototype.stopAll = function () {
    var i;
    for (i = 0; i < this.threads.length; i++) this.threads[i].done = true;
    this.threads = [];
    var layers = this.layers.slice();
    for (i = 0; i < layers.length; i++) if (!layers[i].isOriginal) layers[i].removeClone();
    var all = this.allTargets();
    for (i = 0; i < all.length; i++) {
        all[i].clearEffects();
        all[i].bubble = null;
    }
    this.stopAllSounds();
    this.redraw = true;
};

Game.prototype.broadcast = function (name) {
    return this.startHats('receive', String(name));
};
/** Waits until every script the message started has finished. */
Game.prototype.waitFor = function (started) {
    var runs = [];
    for (var i = 0; i < started.length; i++) runs.push({thread: started[i], gen: started[i].gen});
    return machine(function () {
        for (var j = 0; j < runs.length; j++) {
            if (!runs[j].thread.done && runs[j].thread.gen === runs[j].gen) return YIELD;
        }
        return DONE;
    });
};
Game.prototype.broadcastAndWait = function (name) {
    return this.waitFor(this.broadcast(name));
};
Game.prototype.wait = function (seconds) {
    var game = this;
    var end = this.now() + Math.max(0, S.num(seconds));
    var first = true;
    return machine(function () {
        if (first) {
            first = false;
            // Scratch asks for the stage to be drawn when a wait starts, which ends the frame.
            game.redraw = true;
            return YIELD;
        }
        return game.now() < end ? YIELD : DONE;
    });
};

/** One frame: edge hats, then every script's turns. */
Game.prototype.step = function () {
    this.checkEdgeHats();
    this.redraw = false;
    var i;
    for (i = 0; i < this.threads.length; i++) this.threads[i].sleeping = false;
    var budget = 0.75 * 1000 / this.framerate;
    var start = new Date().getTime();
    var passes = 0;
    for (;;) {
        var ran = false;
        for (i = 0; i < this.threads.length; i++) {
            var thread = this.threads[i];
            if (thread.done || thread.sleeping) continue;
            if (thread.target.removed) {
                thread.done = true;
                continue;
            }
            ran = true;
            this.currentThread = thread;
            var result = thread.gen.next();
            if (result.done) thread.done = true;
            else if (result.value === NEXT_FRAME_VALUE) thread.sleeping = true;
        }
        this.currentThread = null;
        var left = [];
        for (i = 0; i < this.threads.length; i++) if (!this.threads[i].done) left.push(this.threads[i]);
        this.threads = left;
        passes++;
        if (!ran || !this.threads.length || this.redraw || new Date().getTime() - start >= budget || passes >= 10000) {
            break;
        }
    }
};

Game.prototype.checkEdgeHats = function () {
    var all = this.allTargets();
    for (var t = 0; t < all.length; t++) {
        for (var h = 0; h < all[t].hats.length; h++) {
            var hat = all[t].hats[h];
            if (hat.kind !== 'greater') continue;
            var value = hat.menu === 'TIMER' ? this.timer() : -1;
            var now = value > S.num(hat.value(all[t]));
            var before = !!hat.wasAbove;
            hat.wasAbove = now;
            if (now && !before) this.threads.push(new Thread(all[t], hat));
        }
    }
};

// -- the backdrop --
Game.prototype.backdropNumber = function () { return this.stage.costumeIndex + 1; };
Game.prototype.backdropName = function () { return this.stage.costumes[this.stage.costumeIndex].name; };
Game.prototype.switchBackdrop = function (value) {
    var stage = this.stage;
    var text = String(value);
    var count = stage.costumes.length;
    if (text === 'next backdrop') stage.setCostume(stage.costumeIndex + 1);
    else if (text === 'previous backdrop') stage.setCostume(stage.costumeIndex - 1);
    else if (text === 'random backdrop') {
        if (count > 1) {
            var pick = Math.floor(Math.random() * (count - 1));
            if (pick >= stage.costumeIndex) pick++;
            stage.setCostume(pick);
        }
    } else stage.switchCostume(value);
    return this.startHats('backdrop', this.backdropName());
};
Game.prototype.switchBackdropAndWait = function (value) {
    return this.waitFor(this.switchBackdrop(value));
};

// -- sensing --
Game.prototype.keyPressed = function (key) {
    var k = String(key).toLowerCase();
    if (k === 'any') {
        for (var i = 0; i < ANY_KEYS.length; i++) if (this.isKeyDown(ANY_KEYS[i])) return true;
        return false;
    }
    return this.isKeyDown(k);
};
Game.prototype.isKeyDown = function (key) {
    if (this.testKeys) return !!this.testKeys[key];
    return keyDown(gameLabKey(key));
};
Game.prototype.mouseX = function () {
    return Math.round(((World.mouseX - this.offsetX) / this.k) - (this.width / 2));
};
Game.prototype.mouseY = function () {
    return Math.round((this.height / 2) - ((World.mouseY - this.offsetY) / this.k));
};
Game.prototype.mouseIsDown = function () {
    return this.testKeys ? false : mouseDown('leftButton');
};
Game.prototype.loudness = function () { return -1; };
Game.prototype.current = function (what) {
    var d = new Date();
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
};
Game.prototype.daysSince2000 = function () {
    return (new Date().getTime() - 946684800000) / 86400000;
};
Game.prototype.propertyOf = function (property, objectName) {
    if (objectName === '_stage_') {
        if (property === 'backdrop #') return this.backdropNumber();
        if (property === 'backdrop name') return this.backdropName();
        if (property === 'volume') return this.stage.volume;
        return Object.prototype.hasOwnProperty.call(this.globals, property) ? this.globals[property] : 0;
    }
    var target = this.sprite(String(objectName));
    if (!target) return 0;
    switch (property) {
    case 'x position': return target.xPosition();
    case 'y position': return target.yPosition();
    case 'direction': return target.direction;
    case 'costume #': return target.costumeIndex + 1;
    case 'costume name': return target.costumeName();
    case 'size': return target.size;
    case 'volume': return target.volume;
    }
    return Object.prototype.hasOwnProperty.call(target.vars, property) ? target.vars[property] : 0;
};
/** Game Lab has no way to type an answer: the question shows, and the answer stays empty. */
Game.prototype.ask = function (target, question) {
    target.say(question);
    var wait = this.wait(2);
    var game = this;
    return machine(function () {
        var r = wait.next();
        if (!r.done) return r;
        target.say('');
        game.answer = '';
        return DONE;
    });
};

// -- sounds --
Game.prototype.stopAllSounds = function () {
    if (typeof stopSound === 'function' && !this.testKeys) stopSound();
};

// -- the pen --
Game.prototype.penClear = function () {
    this.penLines = [];
    this.stampsUsed = 0;
    this.redraw = true;
};

Game.prototype.showMonitor = function (id, visible) {
    for (var i = 0; i < this.monitors.length; i++) {
        if (this.monitors[i].id === id) this.monitors[i].visible = visible;
    }
};

// -- touching: the costumes' outline boxes, turned with the sprite --
Game.prototype.touches = function (a, b) {
    // The whole pixels, edges meeting counting as touching, as Scratch finds them.
    var pa = a.corners(0.5);
    var pb = b.corners(0.5);
    if (!pa || !pb) return false;
    return !separated(pa, pb) && !separated(pb, pa);
};
function separated(p, q) {
    // Is there a gap along one of p's edges? (separating axis test)
    for (var i = 0; i < 4; i++) {
        var a = p[i];
        var b = p[(i + 1) % 4];
        var nx = b[1] - a[1];
        var ny = a[0] - b[0];
        var minP = Infinity, maxP = -Infinity, minQ = Infinity, maxQ = -Infinity;
        for (var j = 0; j < 4; j++) {
            var dp = (p[j][0] * nx) + (p[j][1] * ny);
            var dq = (q[j][0] * nx) + (q[j][1] * ny);
            if (dp < minP) minP = dp;
            if (dp > maxP) maxP = dp;
            if (dq < minQ) minQ = dq;
            if (dq > maxQ) maxQ = dq;
        }
        if (maxP < minQ || maxQ < minP) return true;
    }
    return false;
}
Game.prototype.pointInside = function (target, x, y) {
    var p = target.corners();
    if (!p) return false;
    var inside = false;
    for (var i = 0, j = 3; i < 4; j = i++) {
        if (((p[i][1] > y) !== (p[j][1] > y)) &&
            (x < ((p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1])) + p[i][0])) inside = !inside;
    }
    return inside;
};

// -- drawing with Game Lab's sprites --
Game.prototype.toCanvasX = function (x) { return this.offsetX + ((x + (this.width / 2)) * this.k); };
Game.prototype.toCanvasY = function (y) { return this.offsetY + (((this.height / 2) - y) * this.k); };

Game.prototype.render = function () {
    var i;
    background('white');
    // The backdrop, then the pen, then the sprites front to back.
    this.stage.place(-10000);
    drawSprites(this.backdropGroup);
    for (i = 0; i < this.penLines.length; i++) {
        var l = this.penLines[i];
        stroke(l.color);
        strokeWeight(Math.max(1, l.size * this.k));
        line(this.toCanvasX(l.x1), this.toCanvasY(l.y1), this.toCanvasX(l.x2), this.toCanvasY(l.y2));
    }
    noStroke();
    for (i = 0; i < this.stamps.length; i++) this.stamps[i].visible = i < this.stampsUsed;
    drawSprites(this.stampGroup);
    for (i = 0; i < this.layers.length; i++) this.layers[i].place(i);
    drawSprites(this.spriteGroup);
    for (i = 0; i < this.layers.length; i++) {
        if (this.layers[i].visible && this.layers[i].bubble) this.drawBubble(this.layers[i]);
    }
    this.drawMonitors();
    // The edges of the stage, outside Scratch's 480 by 360.
    fill('black');
    if (this.offsetY > 0) {
        rect(0, 0, 400, this.offsetY);
        rect(0, 400 - this.offsetY, 400, this.offsetY);
    }
    if (this.offsetX > 0) {
        rect(0, 0, this.offsetX, 400);
        rect(400 - this.offsetX, 0, this.offsetX, 400);
    }
};

Game.prototype.drawBubble = function (target) {
    var b = target.bounds();
    if (!b) return;
    var text = target.bubble.text;
    textSize(12);
    var width = Math.min(170, Math.max(40, text.length * 6.5)) + 12;
    var lines = Math.ceil((text.length * 6.5) / 170);
    var height = (lines * 15) + 10;
    var x = this.toCanvasX(b.right);
    var y = this.toCanvasY(b.top) - height - 4;
    if (x + width > 400) x = Math.max(0, this.toCanvasX(b.left) - width);
    if (y < this.offsetY) y = this.offsetY;
    fill('white');
    stroke('#c0c0c0');
    strokeWeight(2);
    rect(x, y, width, height);
    noStroke();
    fill('#575e75');
    textAlign(LEFT, TOP);
    text(text, x + 6, y + 5, width - 12, height - 6);
};

Game.prototype.drawMonitors = function () {
    textSize(11);
    textAlign(LEFT, TOP);
    for (var i = 0; i < this.monitors.length; i++) {
        var m = this.monitors[i];
        if (!m.visible) continue;
        var x = this.toCanvasX(m.x - (this.width / 2));
        var y = this.toCanvasY((this.height / 2) - m.y);
        var value = m.read();
        var shown = m.mode === 'list' ? 'list of ' + value.length + ': ' + value.slice(0, 5).join(', ') :
            String(typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value);
        var label = m.mode === 'large' ? '' : m.label + ' ';
        var w = ((label.length + shown.length) * 6.5) + 10;
        fill('#e6f0ff');
        stroke('#c6cdd4');
        strokeWeight(1);
        rect(x, y, w, 18);
        noStroke();
        fill('#575e75');
        text(label, x + 4, y + 3);
        fill('#ff8c1a');
        text(shown, x + 4 + (label.length * 6.5), y + 3);
    }
};

/** Set the game up: Game Lab's sprites for everything, and the keys its hats listen for. */
Game.prototype.load = function (test) {
    this.testKeys = test ? {} : null;
    if (test) this.virtualTime = 0;
    World.frameRate = this.framerate;
    // The costumes' pictures, when the code carries them (costumePictures, at the end of the code).
    this.pictureData = typeof costumePictures === 'function' ? costumePictures() : {};
    this.pictures = {};
    for (var name in this.pictureData) {
        if (Object.prototype.hasOwnProperty.call(this.pictureData, name)) {
            this.pictures[name] = loadImage(this.pictureData[name]);
        }
    }
    this.backdropGroup = createGroup();
    this.stampGroup = createGroup();
    this.spriteGroup = createGroup();
    this.stage.makeSprite(this.backdropGroup);
    for (var i = 0; i < this.layers.length; i++) this.layers[i].makeSprite(this.spriteGroup);
};

/** A costume's picture carried in the code, or null when it is an uploaded animation. */
Game.prototype.picture = function (name) {
    return (this.pictures && this.pictures[name]) || null;
};

/** Each Game Lab frame (draw): keys and clicks, then a Scratch frame, then the picture. */
Game.prototype.frame = function () {
    if (!this.started) {
        this.render();
        fill('rgba(0,0,0,0.4)');
        rect(0, 0, 400, 400);
        fill('white');
        textSize(22);
        textAlign(CENTER, CENTER);
        text('Click to play', 200, 200);
        if (mouseWentDown('leftButton')) this.greenFlag();
        return;
    }
    var i;
    for (i = 0; i < this.hatKeys.length; i++) {
        var key = this.hatKeys[i];
        if (key === 'any') {
            for (var j = 0; j < ANY_KEYS.length; j++) {
                if (keyWentDown(gameLabKey(ANY_KEYS[j]))) this.startHats('key', ANY_KEYS[j]);
            }
        } else if (keyWentDown(gameLabKey(key))) {
            this.startHats('key', key);
        }
    }
    if (mouseWentDown('leftButton')) {
        var x = this.mouseX();
        var y = this.mouseY();
        var clicked = false;
        for (i = this.layers.length - 1; i >= 0 && !clicked; i--) {
            var target = this.layers[i];
            if (!target.removed && target.visible && this.pointInside(target, x, y)) {
                this.startHats('click', undefined, target);
                clicked = true;
            }
        }
        if (!clicked) this.startHats('stageClick');
    }
    this.step();
    this.render();
};

/** For tests: run frames on a clock that moves one frame at a time, without drawing. */
Game.prototype.stepFrames = function (count) {
    for (var i = 0; i < count; i++) {
        this.step();
        if (this.virtualTime !== null) this.virtualTime += 1 / this.framerate;
    }
};

Game.prototype.snapshot = function () {
    var out = {globals: copyOf(this.globals), lists: {}, sprites: {}, backdrop: this.backdropName()};
    for (var name in this.globalLists) out.lists[name] = this.globalLists[name].slice();
    for (var i = 0; i < this.layers.length; i++) {
        var t = this.layers[i];
        if (!t.isOriginal) continue;
        var clones = 0;
        for (var j = 0; j < this.layers.length; j++) {
            if (!this.layers[j].isOriginal && this.layers[j].original === t && !this.layers[j].removed) clones++;
        }
        out.sprites[t.name] = {x: t.xPosition(), y: t.yPosition(), direction: t.direction, size: t.size,
            visible: t.visible, costume: t.costumeName(), variables: copyOf(t.vars), clones: clones};
    }
    return out;
};

// --- a sprite or the stage ---------------------------------------------------------

function Target(game, spec, isStage) {
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
    this.volume = typeof spec.volume === 'number' ? spec.volume : 100;
    this.effects = {color: 0, fisheye: 0, whirl: 0, pixelate: 0, mosaic: 0, brightness: 0, ghost: 0};
    this.bubble = null;
    this.costumes = spec.costumes || [];
    this.costumeIndex = Math.min(spec.costume || 0, Math.max(0, this.costumes.length - 1));
    this.sounds = spec.sounds || [];
    this.pen = {down: false, color: 66.66, saturation: 100, brightness: 100, transparency: 0, size: 1};
    this.glSprite = null;
}

Target.prototype.on = function (kind, fn, extra) {
    var hat = {kind: kind, fn: fn, matches: function () { return true; }};
    if (extra) for (var k in extra) hat[k] = extra[k];
    this.hats.push(hat);
    return hat;
};
Target.prototype.whenFlagClicked = function (fn) { return this.on('flag', fn); };
Target.prototype.whenKeyPressed = function (key, fn) {
    var k = String(key).toLowerCase();
    if (this.game.hatKeys.indexOf(k) < 0) this.game.hatKeys.push(k);
    return this.on('key', fn, {matches: function (pressed) { return k === 'any' || pressed === k; }});
};
Target.prototype.whenThisSpriteClicked = function (fn) { return this.on('click', fn); };
Target.prototype.whenStageClicked = function (fn) { return this.on('stageClick', fn); };
Target.prototype.whenIReceive = function (name, fn) {
    var n = String(name).toLowerCase();
    return this.on('receive', fn, {matches: function (m) { return String(m).toLowerCase() === n; }});
};
Target.prototype.whenBackdropSwitchesTo = function (name, fn) {
    var n = String(name).toLowerCase();
    return this.on('backdrop', fn, {matches: function (m) { return String(m).toLowerCase() === n; }});
};
Target.prototype.whenGreaterThan = function (menu, value, fn) {
    return this.on('greater', fn, {menu: String(menu).toUpperCase(), value: value});
};
Target.prototype.whenIStartAsAClone = function (fn) { return this.on('clone', fn); };
Target.prototype.stopOtherScripts = function () {
    var me = this.game.currentThread;
    for (var i = 0; i < this.game.threads.length; i++) {
        var t = this.game.threads[i];
        if (t.target === this && t !== me) t.done = true;
    }
};

// -- motion --
Target.prototype.setXY = function (x, y, force) {
    if (this.isStage) return;
    var oldX = this.x;
    var oldY = this.y;
    x = S.num(x);
    y = S.num(y);
    if (this.game.fencing && !force) {
        var fenced = this.fencedPosition(x, y);
        x = fenced[0];
        y = fenced[1];
    }
    this.x = x;
    this.y = y;
    if (this.pen.down) this.drawPenLine(oldX, oldY, x, y);
    if (this.visible) this.game.redraw = true;
};
Target.prototype.goTo = function (x, y) { this.setXY(x, y); };
Target.prototype.changeX = function (dx) { this.setXY(this.x + S.num(dx), this.y); };
Target.prototype.changeY = function (dy) { this.setXY(this.x, this.y + S.num(dy)); };
Target.prototype.setX = function (x) { this.setXY(x, this.y); };
Target.prototype.setY = function (y) { this.setXY(this.x, y); };
Target.prototype.moveSteps = function (steps) {
    var radians = toRad(90 - this.direction);
    var n = S.num(steps);
    this.setXY(this.x + (n * Math.cos(radians)), this.y + (n * Math.sin(radians)));
};
Target.prototype.setDirection = function (direction) {
    var d = S.num(direction);
    if (!isFinite(d)) return;
    this.direction = wrapClamp(d, -179, 180);
    if (this.visible) this.game.redraw = true;
};
Target.prototype.turnRight = function (degrees) { this.setDirection(this.direction + S.num(degrees)); };
Target.prototype.turnLeft = function (degrees) { this.setDirection(this.direction - S.num(degrees)); };
Target.prototype.positionOf = function (name) {
    var what = String(name);
    if (what === '_mouse_') return [this.game.mouseX(), this.game.mouseY()];
    if (what === '_random_') {
        return [Math.round(this.game.width * (Math.random() - 0.5)), Math.round(this.game.height * (Math.random() - 0.5))];
    }
    var other = this.game.sprite(what);
    return other ? [other.x, other.y] : null;
};
Target.prototype.goToTarget = function (name) {
    var at = this.positionOf(name);
    if (at) this.setXY(at[0], at[1]);
};
Target.prototype.pointTowards = function (name) {
    var what = String(name);
    if (what === '_random_') {
        this.setDirection(Math.round(Math.random() * 360) - 180);
        return;
    }
    var at = this.positionOf(what);
    if (!at) return;
    this.setDirection(90 - toDeg(Math.atan2(at[1] - this.y, at[0] - this.x)));
};
Target.prototype.glideTo = function (seconds, x, y) {
    var me = this;
    var duration = S.num(seconds);
    var startX = this.x;
    var startY = this.y;
    var endX = S.num(x);
    var endY = S.num(y);
    var start = this.game.now();
    var first = true;
    return machine(function () {
        if (duration <= 0) {
            me.setXY(endX, endY);
            return DONE;
        }
        if (first) {
            first = false;
            return YIELD;
        }
        var t = (me.game.now() - start) / duration;
        if (t >= 1) {
            me.setXY(endX, endY);
            return DONE;
        }
        me.setXY(startX + ((endX - startX) * t), startY + ((endY - startY) * t));
        return YIELD;
    });
};
Target.prototype.glideToTarget = function (seconds, name) {
    var at = this.positionOf(name);
    if (!at) return machine(function () { return DONE; });
    return this.glideTo(seconds, at[0], at[1]);
};
Target.prototype.setRotationStyle = function (style) {
    this.rotationStyle = String(style);
    if (this.visible) this.game.redraw = true;
};
Target.prototype.xPosition = function () { return limitPrecision(this.x); };
Target.prototype.yPosition = function () { return limitPrecision(this.y); };
Target.prototype.bounceOnEdge = function () {
    var b = this.bounds();
    if (!b) return;
    var w = this.game.width / 2;
    var h = this.game.height / 2;
    var dists = [['left', Math.max(0, w + b.left)], ['top', Math.max(0, h - b.top)],
        ['right', Math.max(0, w - b.right)], ['bottom', Math.max(0, h + b.bottom)]];
    var nearest = dists[0];
    for (var i = 1; i < 4; i++) if (dists[i][1] < nearest[1]) nearest = dists[i];
    if (nearest[1] > 0) return;
    var radians = toRad(90 - this.direction);
    var dx = Math.cos(radians);
    var dy = -Math.sin(radians);
    if (nearest[0] === 'left') dx = Math.max(0.2, Math.abs(dx));
    else if (nearest[0] === 'top') dy = Math.max(0.2, Math.abs(dy));
    else if (nearest[0] === 'right') dx = 0 - Math.max(0.2, Math.abs(dx));
    else dy = 0 - Math.max(0.2, Math.abs(dy));
    this.setDirection(toDeg(Math.atan2(dy, dx)) + 90);
    var fenced = this.keepInFence(this.x, this.y);
    this.setXY(fenced[0], fenced[1], true);
};

// -- the shape on the stage --
Target.prototype.costume = function () { return this.costumes[this.costumeIndex]; };
Target.prototype.scaleX = function () {
    var flip = this.rotationStyle === 'left-right' && this.direction < 0 ? -1 : 1;
    return flip * this.size / 100;
};
Target.prototype.drawAngle = function () {
    return this.rotationStyle === 'all around' ? this.direction - 90 : 0;
};
/** The corners of the costume's drawn part, on the stage, as Scratch measures it. */
Target.prototype.corners = function (grow) {
    var c = this.costume();
    if (!c) return null;
    var g = grow || 0;
    var box = [c.box[0] - g, c.box[1] - g, c.box[2] + g, c.box[3] + g];
    var sx = this.scaleX();
    var sy = this.size / 100;
    var angle = toRad(this.drawAngle());
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var points = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]];
    var out = [];
    for (var i = 0; i < 4; i++) {
        var px = (points[i][0] - c.centerX) * sx;
        var py = (c.centerY - points[i][1]) * sy;
        out.push([this.x + (px * cos) + (py * sin), this.y - (px * sin) + (py * cos)]);
    }
    return out;
};
Target.prototype.bounds = function () {
    var p = this.corners();
    if (!p) return null;
    var b = {left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity};
    for (var i = 0; i < 4; i++) {
        b.left = Math.min(b.left, p[i][0]);
        b.right = Math.max(b.right, p[i][0]);
        b.bottom = Math.min(b.bottom, p[i][1]);
        b.top = Math.max(b.top, p[i][1]);
    }
    return b;
};
Target.prototype.fencedPosition = function (x, y) {
    var b = this.bounds();
    if (!b) return [x, y];
    var dx = x - this.x;
    var dy = y - this.y;
    var inset = Math.floor(Math.min(b.right - b.left, b.top - b.bottom) / 2);
    var sx = (this.game.width / 2) - Math.min(15, inset);
    var sy = (this.game.height / 2) - Math.min(15, inset);
    if (b.right + dx < -sx) x = Math.ceil(this.x - (sx + b.right));
    else if (b.left + dx > sx) x = Math.floor(this.x + (sx - b.left));
    if (b.top + dy < -sy) y = Math.ceil(this.y - (sy + b.top));
    else if (b.bottom + dy > sy) y = Math.floor(this.y + (sy - b.bottom));
    return [x, y];
};
Target.prototype.keepInFence = function (x, y) {
    var b = this.bounds();
    if (!b) return [x, y];
    var left = b.left + (x - this.x);
    var right = b.right + (x - this.x);
    var top = b.top + (y - this.y);
    var bottom = b.bottom + (y - this.y);
    var w = this.game.width / 2;
    var h = this.game.height / 2;
    var dx = 0;
    var dy = 0;
    if (left < -w) dx += -w - left;
    if (right > w) dx += w - right;
    if (top > h) dy += h - top;
    if (bottom < -h) dy += -h - bottom;
    return [x + dx, y + dy];
};

// -- looks --
Target.prototype.setCostume = function (index) {
    var count = this.costumes.length;
    if (!count) return;
    this.costumeIndex = wrapClamp(Math.round(index), 0, count - 1);
    if (this.visible) this.game.redraw = true;
};
Target.prototype.switchCostume = function (value) {
    if (typeof value === 'number') {
        this.setCostume(value - 1);
        return;
    }
    var text = String(value);
    for (var i = 0; i < this.costumes.length; i++) {
        if (this.costumes[i].name === text) {
            this.setCostume(i);
            return;
        }
    }
    if (!this.isStage && text === 'next costume') this.setCostume(this.costumeIndex + 1);
    else if (!this.isStage && text === 'previous costume') this.setCostume(this.costumeIndex - 1);
    else if (text.replace(/\s/g, '') !== '' && !isNaN(Number(text))) this.setCostume(Number(text) - 1);
};
Target.prototype.nextCostume = function () { this.setCostume(this.costumeIndex + 1); };
Target.prototype.costumeNumber = function () { return this.costumeIndex + 1; };
Target.prototype.costumeName = function () {
    return this.costumes[this.costumeIndex] ? this.costumes[this.costumeIndex].name : '';
};
Target.prototype.setSize = function (size) {
    var s = S.num(size);
    var c = this.costume();
    if (this.game.fencing && c) {
        var minScale = Math.min(1, Math.max(5 / c.width, 5 / c.height));
        var maxScale = Math.min((1.5 * this.game.width) / c.width, (1.5 * this.game.height) / c.height);
        s = clamp(s / 100, minScale, maxScale) * 100;
    }
    this.size = s;
    if (this.visible) this.game.redraw = true;
};
Target.prototype.changeSize = function (by) { this.setSize(this.size + S.num(by)); };
Target.prototype.setEffect = function (name, value) {
    var effect = String(name).toLowerCase();
    var v = S.num(value);
    if (effect === 'ghost') v = clamp(v, 0, 100);
    if (effect === 'brightness') v = clamp(v, -100, 100);
    this.effects[effect] = v;
    if (this.visible) this.game.redraw = true;
};
Target.prototype.changeEffect = function (name, by) {
    var effect = String(name).toLowerCase();
    this.setEffect(effect, (this.effects[effect] || 0) + S.num(by));
};
Target.prototype.clearEffects = function () {
    for (var k in this.effects) this.effects[k] = 0;
    if (this.visible) this.game.redraw = true;
};
Target.prototype.show = function () { this.visible = true; this.game.redraw = true; };
Target.prototype.hide = function () { this.visible = false; this.game.redraw = true; };
Target.prototype.goToLayer = function (where) {
    var layers = this.game.layers;
    layers.splice(layers.indexOf(this), 1);
    if (String(where) === 'back') layers.unshift(this);
    else layers.push(this);
    this.game.redraw = true;
};
Target.prototype.changeLayer = function (direction, by) {
    var layers = this.game.layers;
    var from = layers.indexOf(this);
    var step = Math.round(S.num(by)) * (String(direction) === 'backward' ? -1 : 1);
    var to = clamp(from + step, 0, layers.length - 1);
    layers.splice(from, 1);
    layers.splice(to, 0, this);
    this.game.redraw = true;
};
Target.prototype.setBubble = function (type, text) {
    var message = text;
    if (typeof message === 'number') message = parseFloat(message.toFixed(2));
    message = String(message);
    this.bubble = message === '' ? null : {type: type, text: message};
    this.game.redraw = true;
    return this.bubble;
};
Target.prototype.say = function (text) { this.setBubble('say', text); };
Target.prototype.think = function (text) { this.setBubble('think', text); };
Target.prototype.sayFor = function (text, seconds, type) {
    var me = this;
    var bubble = this.setBubble(type || 'say', text);
    var wait = this.game.wait(seconds);
    return machine(function () {
        var r = wait.next();
        if (!r.done) return r;
        if (me.bubble === bubble) me.setBubble('say', '');
        return DONE;
    });
};
Target.prototype.thinkFor = function (text, seconds) { return this.sayFor(text, seconds, 'think'); };

// -- clones --
Target.prototype.createClone = function (name) {
    var game = this.game;
    var what = String(name);
    var from = what === '_myself_' ? this : game.sprite(what);
    if (!from || from.isStage || game.cloneCount >= game.maxClones) return;
    var clone = new Target(game, {name: from.name, costumes: from.costumes, sounds: from.sounds}, false);
    for (var k in from) {
        if (Object.prototype.hasOwnProperty.call(from, k)) clone[k] = from[k];
    }
    clone.isOriginal = false;
    clone.original = from.original;
    clone.removed = false;
    clone.vars = copyOf(from.vars);
    clone.lists = {};
    for (var l in from.lists) clone.lists[l] = from.lists[l].slice();
    clone.effects = copyOf(from.effects);
    clone.pen = copyOf(from.pen);
    clone.bubble = null;
    clone.glSprite = null;
    if (game.spriteGroup) clone.makeSprite(game.spriteGroup);
    game.cloneCount++;
    // Just behind the sprite it was made from.
    game.layers.splice(game.layers.indexOf(from), 0, clone);
    game.startHats('clone', undefined, clone);
    if (clone.visible) game.redraw = true;
};
Target.prototype.deleteClone = function () {
    if (this.isOriginal) return false;
    this.removeClone();
    return true;
};
Target.prototype.removeClone = function () {
    if (this.removed) return;
    this.removed = true;
    var at = this.game.layers.indexOf(this);
    if (at >= 0) this.game.layers.splice(at, 1);
    this.game.cloneCount--;
    for (var i = 0; i < this.game.threads.length; i++) {
        if (this.game.threads[i].target === this) this.game.threads[i].done = true;
    }
    if (this.glSprite) this.glSprite.destroy();
    this.glSprite = null;
    this.game.redraw = true;
};

// -- sensing --
Target.prototype.touching = function (name) {
    var what = String(name);
    if (what === '_mouse_') return this.visible && this.game.pointInside(this, this.game.mouseX(), this.game.mouseY());
    if (what === '_edge_') {
        var b = this.bounds();
        if (!b) return false;
        var w = this.game.width / 2;
        var h = this.game.height / 2;
        return b.left < -w || b.right > w || b.top > h || b.bottom < -h;
    }
    if (!this.visible) return false;
    var layers = this.game.layers;
    for (var i = 0; i < layers.length; i++) {
        var other = layers[i];
        if (other === this || other.removed || !other.visible || other.original.name !== what) continue;
        if (this.game.touches(this, other)) return true;
    }
    return false;
};
Target.prototype.touchingColor = function () { return false; };
Target.prototype.distanceTo = function (name) {
    if (this.isStage) return 10000;
    var at = this.positionOf(name);
    if (!at) return 10000;
    var dx = this.x - at[0];
    var dy = this.y - at[1];
    return Math.sqrt((dx * dx) + (dy * dy));
};

// -- sounds: Game Lab plays uploaded MP3s by name, with no volume or effects --
Target.prototype.soundIndex = function (value) {
    var count = this.sounds.length;
    if (!count) return -1;
    if (typeof value === 'number') return wrapClamp(Math.round(value) - 1, 0, count - 1);
    var text = String(value);
    for (var i = 0; i < count; i++) if (this.sounds[i].name === text) return i;
    if (text.replace(/\s/g, '') !== '' && !isNaN(Number(text))) return wrapClamp(Math.round(Number(text)) - 1, 0, count - 1);
    return -1;
};
Target.prototype.startSound = function (value) {
    var index = this.soundIndex(value);
    if (index < 0) return null;
    var sound = this.sounds[index];
    if (!this.game.testKeys && this.volume > 0) playSound(sound.file, false);
    return sound;
};
Target.prototype.playSoundUntilDone = function (value) {
    var sound = this.startSound(value);
    return this.game.wait(sound ? sound.duration : 0);
};
Target.prototype.setVolume = function (value) { this.volume = clamp(S.num(value), 0, 100); };
Target.prototype.changeVolume = function (by) { this.setVolume(this.volume + S.num(by)); };
Target.prototype.setSoundEffect = function () {};
Target.prototype.changeSoundEffect = function () {};
Target.prototype.clearSoundEffects = function () {};

// -- the pen: lines kept and drawn again each frame; stamps are sprites --
Target.prototype.penColor = function () {
    var p = this.pen;
    var rgb = hsvToRgb((p.color / 100) * 360, p.saturation / 100, p.brightness / 100);
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (1 - (p.transparency / 100)) + ')';
};
Target.prototype.penDown = function () {
    this.pen.down = true;
    this.drawPenLine(this.x, this.y, this.x, this.y);
};
Target.prototype.penUp = function () { this.pen.down = false; };
Target.prototype.drawPenLine = function (x1, y1, x2, y2) {
    this.game.penLines.push({x1: x1, y1: y1, x2: x2, y2: y2, color: this.penColor(), size: this.pen.size});
    this.game.redraw = true;
};
Target.prototype.setPenColor = function (value) {
    var rgba = colorToRgba(value);
    var hsv = rgbToHsv(rgba[0], rgba[1], rgba[2]);
    this.pen.color = (hsv[0] / 360) * 100;
    this.pen.saturation = hsv[1] * 100;
    this.pen.brightness = hsv[2] * 100;
    this.pen.transparency = 100 * (1 - (rgba[3] / 255));
};
Target.prototype.setPenParam = function (param, value) {
    var p = String(param).toLowerCase();
    var v = S.num(value);
    if (p === 'color') this.pen.color = wrapClamp(v, 0, 100);
    else if (p === 'saturation' || p === 'brightness' || p === 'transparency') this.pen[p] = clamp(v, 0, 100);
};
Target.prototype.changePenParam = function (param, by) {
    var p = String(param).toLowerCase();
    this.setPenParam(p, (this.pen[p] || 0) + S.num(by));
};
Target.prototype.setPenSize = function (size) { this.pen.size = clamp(S.num(size), 1, 1200); };
Target.prototype.changePenSize = function (by) { this.setPenSize(this.pen.size + S.num(by)); };
Target.prototype.stamp = function () {
    var game = this.game;
    if (!game.stampGroup) return;
    // Stamps are sprites left where they were stamped, used again after the pen is cleared.
    var s = game.stamps[game.stampsUsed];
    if (!s) {
        s = createSprite(0, 0);
        game.stampGroup.add(s);
        game.stamps.push(s);
    }
    game.stampsUsed++;
    this.pose(s);
    game.redraw = true;
};

// -- Game Lab's sprite for this target --
Target.prototype.makeSprite = function (group) {
    this.glSprite = createSprite(0, 0);
    group.add(this.glSprite);
};
/** Put this target's Game Lab sprite where Scratch would draw it. */
Target.prototype.place = function (depth) {
    var s = this.glSprite;
    if (!s) return;
    s.visible = this.visible && !this.removed;
    s.depth = depth;
    this.pose(s);
};
Target.prototype.pose = function (s) {
    var c = this.costume();
    if (!c) return;
    var game = this.game;
    if (s.animationName !== c.animation) {
        var picture = game.picture(c.animation);
        if (picture) {
            // A picture carried in this code (costumePictures, at the end): nothing to upload.
            if (!s.pictureNames) s.pictureNames = {};
            if (!s.pictureNames[c.animation]) {
                s.addImage(c.animation, picture);
                s.pictureNames[c.animation] = true;
            }
            s.changeImage(c.animation);
        } else {
            s.setAnimation(c.animation);
        }
        s.animationName = c.animation;
    }
    var size = this.isStage ? 1 : this.size / 100;
    var angle = this.isStage ? 0 : this.drawAngle();
    var flip = this.isStage ? 1 : (this.scaleX() < 0 ? -1 : 1);
    // Game Lab turns a sprite round its middle; Scratch round the costume's turning point.
    var ox = ((c.width / 2) - c.centerX) * size * flip;
    var oy = ((c.height / 2) - c.centerY) * size;
    var r = toRad(angle);
    var x = this.isStage ? 0 : this.x;
    var y = this.isStage ? 0 : this.y;
    var cx = game.toCanvasX(x) + (((ox * Math.cos(r)) - (oy * Math.sin(r))) * game.k);
    var cy = game.toCanvasY(y) + (((ox * Math.sin(r)) + (oy * Math.cos(r))) * game.k);
    s.x = cx;
    s.y = cy;
    s.rotation = angle;
    s.scale = (size / c.resolution) * game.k;
    s.mirrorX(flip);
    s.alpha = 1 - ((this.effects.ghost || 0) / 100);
};

// ===== The game: its sprites and scripts (made from the Scratch project) =====
