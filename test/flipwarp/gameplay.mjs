// The settings that change how a project runs.
//
// Tested through a real editor rather than by calling the module directly,
// because every one of them is a wrapper around something inside the VM or
// the renderer, and a wrapper that is never reached is exactly the failure a
// unit test cannot see. Settings are written to storage and the page
// reloaded, which is also how a person changes them, so this doubles as a
// check that they survive a reload.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: {width: 1280, height: 800}});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 200)}`));

const open = async settings => {
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.evaluate(s => {
        localStorage.setItem('flipwarp:settings', JSON.stringify(s));
    }, settings);
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
    await page.waitForTimeout(2500);
};

// BEFORE_EXECUTE fires once per frame the VM actually runs, which is
// precisely what these settings change, so counting it is how most of this
// file measures anything.
const countFrames = ms => page.evaluate(async duration => {
    let frames = 0;
    const tick = () => frames++;
    window.vm.runtime.on('BEFORE_EXECUTE', tick);
    await new Promise(resolve => setTimeout(resolve, duration));
    window.vm.runtime.removeListener('BEFORE_EXECUTE', tick);
    return frames;
}, ms);

// --- holding still, stepping a frame, and the clock -----------------------
await open({stepButton: true});

const buttons = await page.$$('[class*="step-control_button"]');
const hold = buttons[0];
const step = buttons[1];

await hold.click();
await page.waitForTimeout(200);

const clockBefore = await page.evaluate(() => window.vm.runtime.currentMSecs);
const heldFrames = await countFrames(600);
const whileHeld = {
    frames: heldFrames,
    clockMoved: (await page.evaluate(() => window.vm.runtime.currentMSecs)) - clockBefore
};

await page.evaluate(() => {
    window.__stepFrames = 0;
    window.__stepTick = () => window.__stepFrames++;
    window.vm.runtime.on('BEFORE_EXECUTE', window.__stepTick);
});

await step.click();
await page.waitForTimeout(300);
const afterOne = await page.evaluate(() => window.__stepFrames);
await step.click();
await step.click();
await page.waitForTimeout(400);
const afterThree = await page.evaluate(() => window.__stepFrames);

// Letting go must not hand the project the time it spent held.
const letGo = await page.evaluate(() => {
    const runtime = window.vm.runtime;
    window.vm.runtime.removeListener('BEFORE_EXECUTE', window.__stepTick);
    return {before: runtime.currentMSecs};
});
await hold.click();
await page.waitForTimeout(700);
const resumed = await page.evaluate(before => {
    const moved = window.vm.runtime.currentMSecs - before;
    return {moved};
}, letGo.before);

// --- slow motion ----------------------------------------------------------
await open({});
const normalFrames = await countFrames(1000);

await open({slowMotion: 4});
const quarterFrames = await countFrames(1000);

// --- render scale ---------------------------------------------------------
const canvasWidth = () => page.evaluate(() => {
    const renderer = window.vm.runtime.renderer;
    const canvas = renderer.canvas || renderer._gl.canvas;
    return canvas.width;
});
await open({});
const scaleNormal = await canvasWidth();
await open({renderScale: 2});
const scaleDouble = await canvasWidth();
await open({renderScale: 0.5});
const scaleHalf = await canvasWidth();

// --- the pointer over the stage -------------------------------------------
// The canvas itself carries no class; the box around it does, and several
// other boxes have names that start the same way — stage-wrapper, and
// stage-overlays — so this has to pick the one whose name ends there.
const stageCursor = () => page.evaluate(() => {
    const stage = [...document.querySelectorAll('[class*="stage_stage"]')]
        .find(e => /(^|\s)stage_stage_/.test(e.className));
    return stage ? getComputedStyle(stage).cursor : null;
});
await open({});
const cursorShown = await stageCursor();
await open({hidePointer: true});
const cursorHidden = await stageCursor();

// --- fixed randomness -----------------------------------------------------
// The seeded sequence is put in place when a project starts running and taken
// away when it stops, so the test starts and stops one the same way the
// runtime does.
const sampleRuns = () => page.evaluate(() => {
    const runtime = window.vm.runtime;
    const run = () => {
        runtime.emit('PROJECT_RUN_START');
        const drawn = [];
        for (let i = 0; i < 5; i++) drawn.push(Math.random());
        runtime.emit('PROJECT_RUN_STOP');
        return drawn;
    };
    return {first: run(), second: run()};
});
await open({fixedRandom: true, randomSeed: 7});
const seeded = await sampleRuns();
await open({fixedRandom: true, randomSeed: 8});
const otherSeed = await sampleRuns();
await open({});
const unseeded = await sampleRuns();

// --- skipping the drawing -------------------------------------------------
// Forced rather than waited for: a frame is made to overrun on purpose, which
// is the only way to see the decision without a machine slow enough to make
// one on its own.
const drawCounts = async settings => {
    await open(settings);
    return page.evaluate(async () => {
        const runtime = window.vm.runtime;
        const renderer = runtime.renderer;
        let frames = 0;
        const before = renderer.flipwarpSkippedFrames || 0;
        // Every frame takes longer than its budget.
        const hog = () => {
            frames++;
            const until = Date.now() + 45;
            while (Date.now() < until) { /* deliberately */ }
        };
        runtime.on('BEFORE_EXECUTE', hog);
        await new Promise(resolve => setTimeout(resolve, 1500));
        runtime.removeListener('BEFORE_EXECUTE', hog);
        return {skipped: (renderer.flipwarpSkippedFrames || 0) - before, frames};
    });
};
const drawnNormally = await drawCounts({});
const drawnSkipping = await drawCounts({skipFrames: true});

// --- keys that go down and up between frames ------------------------------
const tap = () => page.evaluate(async () => {
    const runtime = window.vm.runtime;
    const keyboard = runtime.ioDevices.keyboard;
    const wait = ms => new Promise(r => setTimeout(r, ms));

    // Straight after a frame, so the whole tap lands in the gap before the
    // next one — which is the case the setting is about.
    await new Promise(resolve => runtime.once('BEFORE_EXECUTE', resolve));
    window.vm.postIOData('keyboard', {key: 'q', keyCode: 81, isDown: true});
    window.vm.postIOData('keyboard', {key: 'q', keyCode: 81, isDown: false});
    const rightAfter = keyboard.getKeyIsDown('q');

    // One frame later the project has had its look.
    await new Promise(resolve => runtime.once('BEFORE_EXECUTE', resolve));
    const duringNextFrame = keyboard.getKeyIsDown('q');
    await wait(200);
    const later = keyboard.getKeyIsDown('q');
    return {rightAfter, duringNextFrame, later};
});
await open({});
const tapUnbuffered = await tap();
await open({inputBuffering: true});
const tapBuffered = await tap();

await browser.close();

const checks = [
    ['a held project runs no frames', whileHeld.frames === 0, whileHeld],
    ['and its clock stands still', whileHeld.clockMoved === 0, whileHeld],
    ['step runs exactly one frame', afterOne === 1, {afterOne}],
    ['and three presses run three', afterThree === 3, {afterThree, afterOne}],
    ['letting go does not hand back the time it was held',
        resumed.moved > 0 && resumed.moved < 900, resumed],
    ['quarter speed runs about a quarter of the frames',
        quarterFrames > normalFrames * 0.15 && quarterFrames < normalFrames * 0.45,
        {normalFrames, quarterFrames}],
    ['double render scale doubles the canvas',
        scaleDouble === scaleNormal * 2, {scaleNormal, scaleDouble}],
    ['and half halves it', scaleHalf === scaleNormal / 2, {scaleNormal, scaleHalf}],
    ['the pointer goes when asked',
        cursorHidden === 'none' && cursorShown !== 'none', {cursorShown, cursorHidden}],
    ['a fixed seed gives the same run twice',
        String(seeded.first) === String(seeded.second), seeded],
    ['a different seed gives a different run',
        String(seeded.first) !== String(otherSeed.first), {seeded, otherSeed}],
    ['turned off, two runs differ',
        String(unseeded.first) !== String(unseeded.second), unseeded],
    ['an overrunning project skips nothing by default',
        drawnNormally.skipped === 0, drawnNormally],
    ['and drops the drawing on some frames when told to',
        drawnSkipping.skipped > 0 && drawnSkipping.skipped < drawnSkipping.frames,
        drawnSkipping],
    ['a tap between frames is lost without buffering',
        tapUnbuffered.duringNextFrame === false, tapUnbuffered],
    ['and survives one frame with it',
        tapBuffered.duringNextFrame === true && tapBuffered.later === false, tapBuffered],
    ['the editor raised no errors', errs.length === 0, errs]
];

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra)}`);
    }
}
console.log(failed === 0 ? '\ngameplay settings working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
