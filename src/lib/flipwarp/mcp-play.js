// The playing half of flipwarp-mcp: run the project, press its keys, click
// its stage, look at it, and read what it is doing.
//
// Input goes in the way the editor's own stage sends it (postIOData), so a
// project cannot tell Claude's key press from a person's. Timing lives on the
// server side; everything here is a single moment: put a key down, let it go,
// take a picture.

import {asEvent} from './project-keys.js';
import {isFrozen, setFrozen, stepOneFrame} from './gameplay.js';

const LOG_LIMIT = 200;
const LIST_LIMIT = 50;
const CLONE_LIMIT = 50;

// A hidden tab gets its timers slowed by the browser, and the project with
// them. Claude cannot see the tab, so it is told.
const pageVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

// --- what the page has been saying ---------------------------------------

// Errors from a project show up in the console, not in the editor, a script
// the compiler cannot run says so there and nowhere else. Kept here so Claude
// can read them back.
const logs = [];
let logsInstalled = false;

const describe = value => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch (e) {
        return String(value);
    }
};

const remember = (level, args) => {
    const text = args.map(describe).join(' ');
    // Our own connection notices are noise in a list of what went wrong, and
    // so is React complaining about the editor's own components: neither is
    // anything a project did, and Claude would go looking for the cause.
    if (text.startsWith('[flipwarp-mcp]')) return;
    if (/^Warning: /.test(text) && /react|componentWill|fb\.me/i.test(text)) return;
    logs.push({level, text: text.slice(0, 2000), at: Date.now()});
    if (logs.length > LOG_LIMIT) logs.shift();
};

const installLogCapture = () => {
    if (logsInstalled) return;
    logsInstalled = true;
    for (const level of ['error', 'warn']) {
        const real = console[level]; // eslint-disable-line no-console
        // eslint-disable-next-line no-console
        console[level] = (...args) => {
            remember(level, args);
            return real.apply(console, args);
        };
    }
    window.addEventListener('error', e => remember('error', [e.error || e.message]));
    window.addEventListener('unhandledrejection', e => remember('error', [e.reason]));
};

// --- the question box ----------------------------------------------------

// What is being asked, and by whom. A visible sprite asks in its own speech
// bubble and the question box itself is left blank, so the words come from the
// bubble that went up just before.
let question = null;
let asker = null;
let askedAgain = false;
let lastSay = null;
let questionWatched = false;
const watchQuestions = vm => {
    if (questionWatched) return;
    questionWatched = true;
    vm.runtime.on('SAY', (target, type, text) => {
        lastSay = {target, text};
    });
    vm.runtime.on('QUESTION', q => {
        askedAgain = true;
        if (q === null) {
            question = null;
            asker = null;
        } else if (q === '' && lastSay) {
            question = String(lastSay.text);
            asker = lastSay.target.getName();
        } else {
            question = String(q);
            asker = 'Stage';
        }
    });
};

// --- keys ----------------------------------------------------------------

const held = new Set();

const eventFor = scratchKey => {
    const event = asEvent(scratchKey);
    if (!event) {
        throw new Error(`"${scratchKey}" is not a key Scratch knows. Use the names keyPressed uses: ` +
            '"space", "up arrow", "down arrow", "left arrow", "right arrow", "enter", or a single letter or digit.');
    }
    return event;
};

const postKey = (vm, scratchKey, isDown) => {
    const event = eventFor(scratchKey);
    vm.postIOData('keyboard', {key: event.key, keyCode: event.keyCode, isDown});
    if (isDown) held.add(scratchKey);
    else held.delete(scratchKey);
};

const releaseAll = vm => {
    for (const key of [...held]) postKey(vm, key, false);
};

// --- the mouse -----------------------------------------------------------

// Scratch coordinates to the canvas pixels the stage sends, measured on the
// canvas as it is drawn on the page: the renderer picks sprites in those.
const canvasPoint = (vm, x, y) => {
    const canvas = vm.renderer && vm.renderer.canvas;
    const rect = canvas ? canvas.getBoundingClientRect() : null;
    const width = rect && rect.width ? rect.width : vm.runtime.stageWidth;
    const height = rect && rect.height ? rect.height : vm.runtime.stageHeight;
    return {
        x: ((x / vm.runtime.stageWidth) + 0.5) * width,
        y: (0.5 - (y / vm.runtime.stageHeight)) * height,
        canvasWidth: width,
        canvasHeight: height
    };
};

// --- pictures --------------------------------------------------------------

const snapshot = vm => new Promise((resolve, reject) => {
    const renderer = vm.renderer;
    if (!renderer) {
        reject(new Error('The stage has no renderer yet.'));
        return;
    }
    const timer = setTimeout(() => reject(new Error('The stage did not draw. Is the editor tab visible?')), 5000);
    renderer.requestSnapshot(url => {
        clearTimeout(timer);
        resolve(url);
    });
    // Drawn now rather than on the next frame, so a frozen project can still
    // be looked at.
    renderer.draw();
});

const loadImage = url => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the stage picture.'));
    img.src = url;
});

// Drawn at the stage's own size, so one pixel of the picture is one step in
// Scratch: pixel (px, py) is x = px - width / 2, y = height / 2 - py.
const screenshot = async (vm, {grid = false, scale = 1} = {}) => {
    const img = await loadImage(await snapshot(vm));
    const w = vm.runtime.stageWidth;
    const h = vm.runtime.stageHeight;
    const s = Math.max(0.25, Math.min(2, Number(scale) || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (grid) {
        // Lines every 60 steps, labelled in Scratch coordinates, so a
        // position read off the picture can go straight into goToXY.
        ctx.save();
        ctx.scale(s, s);
        ctx.lineWidth = 1 / s;
        ctx.font = `${10 / Math.max(s, 0.5)}px sans-serif`;
        for (let x = -Math.floor(w / 2 / 60) * 60; x <= w / 2; x += 60) {
            const px = x + (w / 2);
            ctx.strokeStyle = x === 0 ? 'rgba(255,0,0,0.6)' : 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.moveTo(px, 0);
            ctx.lineTo(px, h);
            ctx.stroke();
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillText(String(x), px + 2, h - 3);
        }
        for (let y = -Math.floor(h / 2 / 60) * 60; y <= h / 2; y += 60) {
            const py = (h / 2) - y;
            ctx.strokeStyle = y === 0 ? 'rgba(255,0,0,0.6)' : 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(w, py);
            ctx.stroke();
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            // The bottom line's label would sit on top of the x labels.
            if (py < h - 12) ctx.fillText(String(y), 2, py - 2);
        }
        ctx.restore();
    }
    const url = canvas.toDataURL('image/png');
    return {
        png: url.slice(url.indexOf(',') + 1),
        width: canvas.width,
        height: canvas.height,
        visible: pageVisible()
    };
};

// --- reading what the project is doing -----------------------------------

const valueOf = v => {
    if (v.type !== 'list') return v.value;
    if (v.value.length <= LIST_LIMIT) return v.value;
    return {first: v.value.slice(0, LIST_LIMIT), length: v.value.length};
};

const variablesOf = target => {
    const out = {};
    for (const v of Object.values(target.variables)) {
        if (v.type === 'broadcast_msg') continue;
        out[v.name] = valueOf(v);
    }
    return out;
};

const bubbleOf = target => {
    const bubble = target.getCustomState('Scratch.looks');
    return bubble && bubble.text ? {[bubble.type]: String(bubble.text)} : null;
};

const where = target => ({
    x: Math.round(target.x * 100) / 100,
    y: Math.round(target.y * 100) / 100,
    direction: target.direction,
    size: Math.round(target.size * 100) / 100,
    costume: target.getCostumes()[target.currentCostume].name,
    visible: target.visible,
    ghost: target.effects.ghost || 0,
    layer: target.getLayerOrder ? target.getLayerOrder() : null
});

const stateOf = (vm, {sprites, clones = true} = {}) => {
    const runtime = vm.runtime;
    const stage = runtime.getTargetForStage();
    const wanted = sprites && sprites.length ? new Set(sprites) : null;
    const originals = runtime.targets.filter(t => t.isSprite && t.isOriginal &&
        (!wanted || wanted.has(t.getName())));
    const mouse = runtime.ioDevices.mouse;
    return {
        running: runtime.threads.length > 0,
        visible: pageVisible(),
        frozen: isFrozen(),
        timer: Math.round(runtime.ioDevices.clock.projectTimer() * 1000) / 1000,
        question,
        asker,
        mouse: {x: mouse.getScratchX(), y: mouse.getScratchY(), down: mouse.getIsDown()},
        keysHeld: [...held],
        stage: {
            backdrop: stage.getCostumes()[stage.currentCostume].name,
            globals: variablesOf(stage)
        },
        sprites: originals.map(t => {
            const own = runtime.targets.filter(c => c.isSprite && !c.isOriginal && c.sprite === t.sprite);
            const out = {name: t.getName(), ...where(t), saying: bubbleOf(t), variables: variablesOf(t)};
            out.clones = own.length;
            if (clones && own.length) {
                out.cloneList = own.slice(0, CLONE_LIMIT).map(c => ({
                    ...where(c),
                    saying: bubbleOf(c),
                    variables: variablesOf(c)
                }));
            }
            return out;
        })
    };
};

// --- the requests ----------------------------------------------------------

export const PLAY_METHODS = {
    greenFlag: vm => {
        releaseAll(vm);
        vm.greenFlag();
        return {started: true, frozen: isFrozen(), visible: pageVisible()};
    },

    stop: vm => {
        releaseAll(vm);
        vm.stopAll();
        return {stopped: true};
    },

    keys: (vm, {down = [], up = []}) => {
        // Checked before any are sent, so a bad name cannot leave half the
        // keys held.
        for (const key of [...down, ...up]) eventFor(key);
        for (const key of up) postKey(vm, key, false);
        for (const key of down) postKey(vm, key, true);
        return {keysHeld: [...held]};
    },

    releaseKeys: vm => {
        releaseAll(vm);
        return {keysHeld: []};
    },

    mouse: (vm, {x, y, down}) => {
        if (typeof x !== 'number' || typeof y !== 'number') throw new Error('The mouse needs an x and a y.');
        const point = canvasPoint(vm, x, y);
        const data = {...point};
        if (typeof down === 'boolean') {
            data.isDown = down;
            data.button = 0;
        }
        vm.postIOData('mouse', data);
        const m = vm.runtime.ioDevices.mouse;
        return {x: m.getScratchX(), y: m.getScratchY(), down: m.getIsDown()};
    },

    answer: (vm, {text}) => {
        if (question === null) throw new Error('Nothing is asking a question right now.');
        const answered = {answered: String(text), question, asker};
        askedAgain = false;
        vm.runtime.emit('ANSWER', String(text));
        // The editor's own answer box closes itself when it is submitted. This
        // answer did not come from it, so it is told there is no question any
        // more, unless answering this one put the next one up.
        if (!askedAgain) vm.runtime.emit('QUESTION', null);
        return answered;
    },

    freeze: (vm, {frozen}) => {
        setFrozen(!!frozen);
        return {frozen: isFrozen()};
    },

    // Run here and now, one after another, rather than handed to the VM's
    // timer: a hidden tab gets about one tick a second, and ten frames would
    // take ten seconds. Each frame goes through the same step the timer calls,
    // freeze and all, so it is the frame the project would have had.
    stepFrames: (vm, {frames = 1}) => {
        const count = Math.max(1, Math.min(600, Math.floor(frames)));
        let ran = 0;
        const onFrame = () => {
            ran++;
        };
        vm.runtime.on('AFTER_EXECUTE', onFrame);
        try {
            for (let i = 0; i < count; i++) {
                stepOneFrame();
                vm.runtime._step();
            }
        } finally {
            vm.runtime.off('AFTER_EXECUTE', onFrame);
        }
        return {frames: ran, frozen: isFrozen()};
    },

    // How the project runs, the settings TurboWarp keeps under Advanced, and
    // by default stored in the project so it runs the same everywhere.
    gameOptions: (vm, {framerate, fencing, interpolation, highQualityPen, infiniteClones, store = true}) => {
        if (typeof framerate === 'number') vm.setFramerate(framerate);
        if (typeof interpolation === 'boolean') vm.setInterpolation(interpolation);
        const runtimeOptions = {};
        if (typeof fencing === 'boolean') runtimeOptions.fencing = fencing;
        if (typeof infiniteClones === 'boolean') runtimeOptions.maxClones = infiniteClones ? Infinity : 300;
        if (Object.keys(runtimeOptions).length) vm.setRuntimeOptions(runtimeOptions);
        if (typeof highQualityPen === 'boolean' && vm.renderer) vm.renderer.setUseHighQualityRender(highQualityPen);
        if (store) vm.storeProjectOptions();
        const runtime = vm.runtime;
        return {
            framerate: runtime.frameLoop.framerate,
            interpolation: runtime.interpolationEnabled,
            fencing: runtime.runtimeOptions.fencing,
            infiniteClones: runtime.runtimeOptions.maxClones === Infinity,
            highQualityPen: !!(vm.renderer && vm.renderer.useHighQualityRender),
            stored: !!store
        };
    },

    screenshot: (vm, params) => screenshot(vm, params),

    state: (vm, params) => stateOf(vm, params),

    logs: (vm, {clear = false, since = 0}) => {
        const out = logs.filter(l => l.at > since);
        if (clear) logs.length = 0;
        return {logs: out};
    }
};

/**
 * Start listening, once, as the bridge connects: a question asked before
 * Claude first looked would otherwise never be seen.
 * @param {object} vm the VM
 */
export const installPlay = vm => {
    installLogCapture();
    watchQuestions(vm);
};
