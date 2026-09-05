// The settings that change how a project runs, rather than how the editor
// around it looks.
//
// None of this forks the VM or the renderer. Both are pulled straight from
// TurboWarp at install time, so anything changed inside them would be undone
// by the next `npm install`; everything here reaches in from outside and
// wraps a method instead. Each wrapper is put on once and reads the setting
// on every call, so turning a setting off is instant and there is never an
// unwrapping step to get wrong — the wrapper stays, and hands straight
// through.
//
// The one thing that needs explaining is the clock.
//
// Scratch does not ask the wall clock what time it is. Every timer in the
// project — `timer`, `wait _ seconds`, `glide` — reads runtime.currentMSecs,
// which the VM refreshes from Date.now() once per frame. So a project that
// misses ten seconds of frames comes back to find ten seconds have passed:
// every wait fires at once and everything that was gliding teleports. That is
// what a pause does if you simply stop calling the step function.
//
// So this file owns that clock. It advances by real elapsed time while
// nothing here is bending it, which is exactly what the VM did on its own,
// and by exactly one frame per frame while something is — which is what makes
// pausing, slow motion and stepping a frame at a time behave the way you
// would expect rather than piling up time to be paid back all at once.

import {getSettings} from './settings.js';

let installed = false;
let vm = null;

// --- the clock ------------------------------------------------------------

// Kept in floating point and rounded only when handed over, so that a
// framerate the frame time does not divide evenly — 25fps is 40ms, but 24fps
// is 41.666… — does not lose a fraction of a millisecond every frame and
// drift away from real time over a long session.
let virtualNow = Date.now();
let lastRealNow = Date.now();

// Whether anything is currently bending time. Slow motion and stepping both
// do; so does being frozen, though while frozen no frames run at all and the
// clock simply stops, which is the point.
let frozen = false;
let framesOwed = 0;

const timeIsBent = () => frozen || framesOwed > 0 || getSettings().slowMotion > 1;

const advanceClock = () => {
    const realNow = Date.now();
    if (timeIsBent()) {
        // One frame of project time per frame that actually ran, whatever the
        // wall clock says.
        virtualNow += vm.runtime.currentStepTime;
    } else {
        virtualNow += realNow - lastRealNow;
    }
    lastRealNow = realNow;
    return virtualNow;
};

// Time spent frozen is not time the project experienced, so when it starts
// again the gap must not be handed to it in one lump.
const forgetTimePassed = () => {
    lastRealNow = Date.now();
};

// --- freezing -------------------------------------------------------------

const frozenListeners = new Set();

const audioContext = () => {
    const engine = vm && vm.runtime && vm.runtime.audioEngine;
    return engine && engine.audioContext;
};

// Suspending is asynchronous and so is resuming, and asking for both in quick
// succession — a phone that is backgrounded and immediately foregrounded —
// can otherwise land them out of order and leave the project silent while it
// runs. Chaining them keeps the last request the one that wins.
let audioChange = Promise.resolve();
const setAudioSuspended = suspended => {
    const context = audioContext();
    if (!context) return;
    audioChange = audioChange
        .then(() => (suspended ? context.suspend() : context.resume()))
        .catch(() => {
            // A context the browser has taken away on its own is not
            // something to report; the next green flag makes a new one.
        });
};

/**
 * Stop or start the project's frames without stopping the project.
 * @param {boolean} value true to freeze
 */
export const setFrozen = value => {
    if (frozen === value) return;
    frozen = value;
    if (!frozen) forgetTimePassed();
    setAudioSuspended(frozen);
    for (const fn of frozenListeners) fn(frozen);
};

/**
 * @returns {boolean} whether frames are stopped
 */
export const isFrozen = () => frozen;

/**
 * @param {function} fn called with the new state whenever it changes
 * @returns {function} call to stop listening
 */
export const onFrozenChanged = fn => {
    frozenListeners.add(fn);
    return () => frozenListeners.delete(fn);
};

/**
 * Run exactly one frame, freezing first if the project is not already
 * frozen — pressing step on a running project means "stop here and let me
 * look", not "run one more frame among the sixty you were going to run
 * anyway".
 */
export const stepOneFrame = () => {
    setFrozen(true);
    framesOwed++;
};

// --- seeded randomness ----------------------------------------------------

// mulberry32: small, fast, and good enough that a project cannot tell it from
// the browser's own. What matters here is only that the same seed gives the
// same sequence every time, on every machine.
const seededRandom = seed => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const realRandom = Math.random;
let randomReplaced = false;

const startSeededRandom = () => {
    if (randomReplaced) return;
    randomReplaced = true;
    Math.random = seededRandom(getSettings().randomSeed);
};

const stopSeededRandom = () => {
    if (!randomReplaced) return;
    randomReplaced = false;
    Math.random = realRandom;
};

// A renderer that has already been wrapped, marked on the renderer itself
// so that attaching a second one — which the paint editor does — wraps that
// one too rather than wrapping the first one twice.
const MARK = '__flipwarpGameplay';

// --- the renderer ---------------------------------------------------------

const installRenderer = (renderer, shouldSkipDraw) => {
    renderer[MARK] = true;

    // How many pixels the stage is drawn with. The VM asks for a size in
    // layout pixels and the renderer multiplies by the screen's own pixel
    // ratio; this multiplies once more. Above 1 the sprites are sharper on a
    // high-resolution screen, below 1 there is a great deal less to draw,
    // which is the difference between a phone holding 30 frames a second and
    // not.
    const realResize = renderer.resize;
    let asked = null;
    renderer.resize = function (width, height) {
        asked = [width, height];
        const scale = getSettings().renderScale;
        return realResize.call(this, width * scale, height * scale);
    };
    // Changing the setting has to take effect without waiting for the window
    // to be dragged, so the last size asked for is kept and asked for again.
    renderer[`${MARK}Resize`] = () => {
        if (asked) renderer.resize(asked[0], asked[1]);
    };

    // Comparing boxes instead of pixels. The pixel-perfect version walks
    // every point where two sprites' boxes overlap and asks both whether
    // anything is drawn there — correct, and the single most expensive thing
    // a busy project does. The boxes have already been worked out by the time
    // that loop starts, so the fast version is simply the answer before it.
    const realTouching = renderer.isTouchingDrawables;
    renderer.isTouchingDrawables = function (drawableID, candidateIDs = this._drawList) {
        if (!getSettings().fastCollisions) {
            return realTouching.call(this, drawableID, candidateIDs);
        }
        const drawable = this._allDrawables[drawableID];
        if (!drawable || !drawable._visible) return false;
        const candidates = this._candidatesTouching(
            drawableID,
            candidateIDs.filter(id => this._allDrawables[id]._visible)
        );
        return candidates.length > 0;
    };

    // Dropping the drawing rather than the simulation. A frame that has
    // already overrun its budget is a frame the picture can be left out of:
    // the project keeps its timing, and the screen updates every other frame
    // instead of every frame, which is what a game that is nearly too heavy
    // should do rather than running in slow motion.
    const realDraw = renderer.draw;
    // Counted rather than merely done, because a frame that was not drawn
    // leaves no trace anywhere else: without this the setting cannot be shown
    // to be working, only asserted to be.
    renderer.flipwarpSkippedFrames = 0;
    renderer.draw = function (...args) {
        if (shouldSkipDraw()) {
            renderer.flipwarpSkippedFrames++;
            return;
        }
        return realDraw.apply(this, args);
    };
};

/**
 * Ask the renderer to work out its size again, for when the scale setting
 * changes.
 */
export const refreshRenderScale = () => {
    const renderer = vm && vm.runtime && vm.runtime.renderer;
    if (renderer && renderer[`${MARK}Resize`]) renderer[`${MARK}Resize`]();
};

// --- keys and clicks that happen between frames ---------------------------

// A project only looks at the keyboard once a frame. At 30 frames a second
// that is every 33ms, and a quick tap is shorter than that more often than
// you would think — the key goes down and up between two looks, and the
// project never sees it at all. That is the "it didn't register my jump"
// complaint, and it is not the player's reflexes.
//
// So a key that goes down is held down until the project has had at least one
// look at it. Nothing is invented: the press really happened, and this only
// decides when the release is allowed to.
const installInputBuffering = runtime => {
    const keyboard = runtime.ioDevices && runtime.ioDevices.keyboard;
    const mouse = runtime.ioDevices && runtime.ioDevices.mouse;
    if (!keyboard) return;

    // Bumped once per frame, so "has the project looked since?" is a
    // comparison rather than a timer.
    let frame = 0;

    const pressedAt = new Map();
    let heldReleases = [];

    // A press that arrives between two frames is first looked at by the frame
    // after the one that is counted now — so the release may go out at the
    // start of the frame after that, and no sooner.
    const releaseIsDue = held => frame > held.frame + 1;

    const realKeyPost = keyboard.postData.bind(keyboard);
    const flush = () => {
        if (heldReleases.length === 0) return;
        const stillWaiting = [];
        for (const release of heldReleases) {
            if (releaseIsDue(release)) realKeyPost(release.data);
            else stillWaiting.push(release);
        }
        heldReleases = stillWaiting;
    };

    runtime.on('BEFORE_EXECUTE', () => {
        frame++;
        flush();
    });

    keyboard.postData = data => {
        if (!getSettings().inputBuffering || !data || !data.key) {
            return realKeyPost(data);
        }
        if (data.isDown) {
            pressedAt.set(data.key, frame);
            return realKeyPost(data);
        }
        const at = pressedAt.get(data.key);
        pressedAt.delete(data.key);
        // Let go before any frame has run with it down: hold the release back
        // until one has.
        if (at === frame) {
            heldReleases.push({data, frame});
            return;
        }
        return realKeyPost(data);
    };

    // A click has exactly the same problem, and a mouse that is let go too
    // quickly is a tap on a phone rather than an unusually fast finger.
    if (!mouse) return;
    const realMousePost = mouse.postData.bind(mouse);
    let mouseDownAt = null;
    let heldMouseUp = null;
    runtime.on('BEFORE_EXECUTE', () => {
        if (heldMouseUp && releaseIsDue(heldMouseUp)) {
            realMousePost(heldMouseUp.data);
            heldMouseUp = null;
        }
    });
    mouse.postData = data => {
        if (!getSettings().inputBuffering || !data || typeof data.isDown !== 'boolean') {
            return realMousePost(data);
        }
        if (data.isDown) {
            mouseDownAt = frame;
            return realMousePost(data);
        }
        if (mouseDownAt === frame) {
            heldMouseUp = {data, frame};
            mouseDownAt = null;
            return;
        }
        mouseDownAt = null;
        return realMousePost(data);
    };
};

// --- installing -----------------------------------------------------------

/**
 * Put every wrapper on. Safe to call more than once; only the first does
 * anything.
 * @param {object} virtualMachine the VM
 */
export const installGameplay = virtualMachine => {
    if (installed || !virtualMachine || !virtualMachine.runtime) return;
    installed = true;
    vm = virtualMachine;
    const runtime = vm.runtime;

    // --- the clock ---------------------------------------------------------
    runtime.updateCurrentMSecs = function () {
        this.currentMSecs = Math.round(advanceClock());
    };

    // --- frames: freeze, slow motion, stepping, skipping the drawing -------
    const realStep = runtime._step;
    // How long the last frame took, and whether the last one skipped its
    // drawing. Only ever one skipped in a row, so the picture cannot stop.
    let lastFrameCost = 0;
    let skippedLastDraw = false;
    let tick = 0;
    // Read by the wrapper around draw(), below, which the VM calls from
    // inside the step this decides about.
    let skipThisDraw = false;

    runtime._step = function () {
        const settings = getSettings();

        if (framesOwed > 0) {
            framesOwed--;
        } else if (frozen) {
            return;
        } else if (settings.slowMotion > 1) {
            tick = (tick + 1) % settings.slowMotion;
            if (tick !== 0) return;
        }

        skipThisDraw = settings.skipFrames &&
            lastFrameCost > runtime.currentStepTime &&
            !skippedLastDraw;
        skippedLastDraw = skipThisDraw;

        const started = Date.now();
        try {
            return realStep.call(this);
        } finally {
            lastFrameCost = Date.now() - started;
            skipThisDraw = false;
        }
    };

    // Interpolation draws between frames on its own animation loop, which
    // would otherwise carry on smoothing towards a position while the project
    // is stopped dead.
    const realInterpolate = runtime._renderInterpolatedPositions;
    runtime._renderInterpolatedPositions = function () {
        if (frozen) return;
        return realInterpolate.call(this);
    };

    // Pressing the green flag on a frozen project runs it, the way pressing
    // it on a stopped one does. Anything else would be a project that looks
    // broken and a button that looks ignored.
    const realGreenFlag = runtime.greenFlag;
    runtime.greenFlag = function () {
        setFrozen(false);
        return realGreenFlag.call(this);
    };

    // --- randomness --------------------------------------------------------
    // Held only while the project is running: the seeded sequence is for the
    // project, and leaving it in place afterwards would quietly make the
    // whole editor deterministic as well.
    runtime.on('PROJECT_RUN_START', () => {
        if (getSettings().fixedRandom) startSeededRandom();
    });
    runtime.on('PROJECT_RUN_STOP', stopSeededRandom);
    runtime.on('PROJECT_STOP_ALL', stopSeededRandom);

    // --- keys and clicks that happen between frames ------------------------
    installInputBuffering(runtime);

    // --- the renderer ------------------------------------------------------
    // It may not be attached yet — the stage builds it — so this waits for it
    // rather than assuming.
    const withRenderer = () => {
        if (!runtime.renderer || runtime.renderer[MARK]) return;
        installRenderer(runtime.renderer, () => skipThisDraw);
    };
    withRenderer();
    const realAttach = vm.attachRenderer;
    if (realAttach) {
        vm.attachRenderer = function (...args) {
            const out = realAttach.apply(this, args);
            withRenderer();
            return out;
        };
    }

    // --- the tab going to the background -----------------------------------
    document.addEventListener('visibilitychange', () => {
        if (!getSettings().pauseOffScreen) return;
        setFrozen(document.hidden);
    });
};
