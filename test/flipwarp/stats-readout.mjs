// The readout in the corner of the stage.
//
// The editor already shows a frame rate, but it shows the one that was asked
// for, not the one that is happening, and those agree right up until the
// moment you need to know. This shows what is actually happening, so the test
// is mostly about whether the numbers move when the thing they measure moves.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 200)}`));

const open = async settings => {
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.evaluate(s => {
        localStorage.setItem('flipwarp:settings', JSON.stringify(s));
    }, settings);
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
    await page.waitForTimeout(2500);
};

// --- off by default -------------------------------------------------------
await open({});
const whenOff = await page.$('[class*="stats-readout_readout"]');

// --- on -------------------------------------------------------------------
await open({statsReadout: true});
await page.waitForTimeout(1500);

const shown = await page.evaluate(() => {
    const box = document.querySelector('[class*="stats-readout_readout"]');
    if (!box) return null;
    const stage = [...document.querySelectorAll('[class*="stage_stage"]')]
        .find(e => /(^|\s)stage_stage_/.test(e.className));
    const mine = box.getBoundingClientRect();
    const over = stage ? stage.getBoundingClientRect() : null;
    return {
        text: box.textContent,
        // Over the stage rather than beside it, and out of the way of a click
        // on the stage itself.
        onTheStage: Boolean(over && mine.left >= over.left - 1 && mine.top >= over.top - 1 &&
            mine.right <= over.right + 1),
        clickThrough: getComputedStyle(box).pointerEvents === 'none'
    };
});

// --- the numbers follow what is happening --------------------------------
// A frame made to overrun on purpose, which is the state the readout exists
// to make visible.
const underLoad = await page.evaluate(async () => {
    const runtime = window.vm.runtime;
    const hog = () => {
        const until = Date.now() + 60;
        while (Date.now() < until) { /* deliberately */ }
    };
    runtime.on('BEFORE_EXECUTE', hog);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const box = document.querySelector('[class*="stats-readout_readout"]');
    const text = box ? box.textContent : '';
    const over = box ? box.querySelector('[class*="stats-readout_over"]') : null;
    runtime.removeListener('BEFORE_EXECUTE', hog);
    return {text, saysOver: Boolean(over)};
});

// And a clone shows up in the count.
const withClones = await page.evaluate(async () => {
    const runtime = window.vm.runtime;
    const me = runtime.targets.find(t => !t.isStage);
    const made = [];
    for (let i = 0; i < 3; i++) {
        const clone = me.makeClone();
        if (!clone) continue;
        runtime.addTarget(clone);
        made.push(clone);
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
    const box = document.querySelector('[class*="stats-readout_readout"]');
    const text = box ? box.textContent : '';
    for (const clone of made) runtime.disposeTarget(clone);
    return {text, made: made.length};
});

await browser.close();

const checks = [
    ['it is not there until it is asked for', whenOff === null, whenOff],
    ['it appears when it is', shown !== null, shown],
    ['over the stage, not beside it', shown && shown.onTheStage === true, shown],
    ['and clicks go straight through it', shown && shown.clickThrough === true, shown],
    ['it names the frame rate, the frame time, the scripts and the sprites',
        shown && /fps/.test(shown.text) && /frame/.test(shown.text) &&
        /scripts/.test(shown.text) && /sprites/.test(shown.text), shown],
    ['a frame that runs long is marked',
        underLoad.saysOver === true, underLoad],
    ['clones are counted',
        withClones.made === 3 && /\+ 3/.test(withClones.text), withClones],
    ['no errors', errs.length === 0, errs]
];

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra)}`);
    }
}
console.log(failed === 0 ? '\nstats readout working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
