// The project's clock, when two different things want it slower.
//
// Scratch does not ask the wall clock what time it is: every timer in a
// project reads runtime.currentMSecs, which the VM refreshes once a frame. So
// whoever decides how fast frames run also decides what time the project
// thinks it is, and there can only be one of them.
//
// There were two. The editor's own slow motion wrapped the clock, and the
// Accessibility extension's speed block wrapped it again; while the extension
// was slowing, it stopped calling the wrapper underneath, so that one never
// noticed the time going by. The moment the speed went back to normal it
// handed over the whole of it at once: every wait fired, everything gliding
// teleported, and the timer jumped by however long the game had been slowed.
//
// Runs without a browser.
import {installGameplay} from '../../src/lib/flipwarp/gameplay.js';

// Enough of a browser and a runtime for the clock to be exercised. Nothing
// here draws or listens; the only thing being measured is what the project is
// told the time is.
global.document = {addEventListener: () => {}, documentElement: {dataset: {}}, hidden: false};
global.localStorage = {getItem: () => null, setItem: () => {}, removeItem: () => {}};

const runtime = {
    currentStepTime: 1000 / 30,
    currentMSecs: Date.now(),
    _step () {
        this.updateCurrentMSecs();
    },
    updateCurrentMSecs () {
        this.currentMSecs = Date.now();
    },
    on: () => {},
    removeListener: () => {},
    once: () => {},
    ioDevices: {keyboard: {postData: () => {}}, mouse: {postData: () => {}}},
    renderer: null,
    _renderInterpolatedPositions: () => {}
};
installGameplay({runtime, attachRenderer: null});

const framesIn = ms => Math.round(ms / runtime.currentStepTime);
const run = count => {
    for (let i = 0; i < count; i++) runtime._step();
};

const checks = [];

// --- the way in exists ----------------------------------------------------
checks.push([
    'the editor offers one way to ask for the project to run slower',
    runtime.flipwarpTime && typeof runtime.flipwarpTime.setSlowdown === 'function',
    Object.keys(runtime.flipwarpTime || {})
]);

// --- half speed -----------------------------------------------------------
runtime.flipwarpTime.setSlowdown(2);
const startedAt = runtime.currentMSecs;
run(framesIn(60000));
const passedWhileSlow = runtime.currentMSecs - startedAt;

checks.push([
    'a minute at half speed is half a minute of project time',
    Math.abs(passedWhileSlow - 30000) < 100,
    {passedWhileSlow}
]);

// --- and back again -------------------------------------------------------
runtime.flipwarpTime.setSlowdown(1);
const beforeTheNextFrame = runtime.currentMSecs;
run(1);
const firstFrameBack = runtime.currentMSecs - beforeTheNextFrame;

checks.push([
    'going back to normal speed does not hand over the time that was saved',
    firstFrameBack >= 0 && firstFrameBack < 200,
    {firstFrameBack}
]);

// --- both at once ---------------------------------------------------------
// The settings and the block are two different people asking, and asking
// twice for half speed should give a quarter rather than one of them winning.
runtime.flipwarpTime.setSlowdown(4);
const beforeQuarter = runtime.currentMSecs;
run(framesIn(4000));
const passedAtQuarter = runtime.currentMSecs - beforeQuarter;
runtime.flipwarpTime.setSlowdown(1);

checks.push([
    'quarter speed is a quarter',
    Math.abs(passedAtQuarter - 1000) < 100,
    {passedAtQuarter}
]);

// --- nonsense is refused --------------------------------------------------
runtime.flipwarpTime.setSlowdown('faster please');
checks.push([
    'a slowdown that is not a number leaves the speed alone',
    runtime.flipwarpTime.getSlowdown() === 1,
    runtime.flipwarpTime.getSlowdown()
]);

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra)}`);
    }
}
console.log(failed === 0 ? '\nclock working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
