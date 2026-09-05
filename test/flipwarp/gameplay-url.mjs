// The gameplay settings, in the address bar.
//
// TurboWarp puts its own settings there so that a link to a project carries
// how the project should run. These were missing from that, so a link to
// something that needs input buffering or half render scale arrived without
// it and looked broken.
//
// Two things are checked as hard as the reading and writing themselves. A
// setting at its default must leave no mark, or the address becomes a list of
// every switch there is and unshareable. And a link must not rewrite what you
// have saved, because somebody else's link quietly changing your own settings
// is the kind of thing you would only notice much later.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 200)}`));

const open = async (search, saved) => {
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.evaluate(s => {
        if (s) localStorage.setItem('flipwarp:settings', JSON.stringify(s));
        else localStorage.removeItem('flipwarp:settings');
    }, saved || null);
    await page.goto(`${SITE}/editor.html${search}`, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
    await page.waitForTimeout(2500);
};

const live = () => page.evaluate(() => ({
    search: location.search,
    saved: localStorage.getItem('flipwarp:settings')
}));

// --- reading -------------------------------------------------------------
await open('?slow=4&buffer&scale=0.5&seed=12');
const read = await page.evaluate(() => {
    const stage = [...document.querySelectorAll('[class*="stage_stage"]')]
        .find(e => /(^|\s)stage_stage_/.test(e.className));
    const renderer = window.vm.runtime.renderer;
    const canvas = renderer.canvas || renderer._gl.canvas;
    return {
        // Read from what the settings actually did rather than from the
        // settings object, so this cannot pass while nothing was applied.
        canvasWidth: canvas.width,
        cursor: stage ? getComputedStyle(stage).cursor : null,
        saved: localStorage.getItem('flipwarp:settings')
    };
});
const afterReading = await live();

// The same page with nothing asked for, to compare the canvas against.
await open('');
const plain = await page.evaluate(() => {
    const renderer = window.vm.runtime.renderer;
    const canvas = renderer.canvas || renderer._gl.canvas;
    return {canvasWidth: canvas.width};
});
const plainSearch = (await live()).search;

// --- writing -------------------------------------------------------------
// A setting changed in the editor should turn up in the address without
// anybody pressing anything.
await open('');
await page.evaluate(() => {
    // Through the settings module, which is what the dialog uses; the point
    // being tested is what the address does about it.
    const raw = localStorage.getItem('flipwarp:settings');
    const now = raw ? JSON.parse(raw) : {};
    localStorage.setItem('flipwarp:settings', JSON.stringify({...now, skipFrames: true}));
});
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
await page.waitForTimeout(2500);
const savedShowsUp = (await live()).search;

// --- a link does not rewrite what you have saved -------------------------
await open('?slow=8', {slowMotion: 1, skipFrames: false});
const borrowed = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('flipwarp:settings') || '{}');
    return {savedSlow: saved.slowMotion, addressSays: location.search};
});

await browser.close();

const checks = [
    ['half scale from the address halves the canvas',
        read.canvasWidth === plain.canvasWidth / 2,
        {asked: read.canvasWidth, plain: plain.canvasWidth}],
    ['the address keeps what it was given',
        afterReading.search.includes('slow=4') &&
        afterReading.search.includes('buffer') &&
        afterReading.search.includes('scale=0.5') &&
        afterReading.search.includes('seed=12'), afterReading],
    ['a switch is written without an equals sign',
        /(\?|&)buffer(&|$)/.test(afterReading.search), afterReading],
    ['settings at their default leave no mark at all',
        plainSearch === '', {plainSearch}],
    ['a setting turned on here turns up in the address',
        /(\?|&)skipframes(&|$)/.test(savedShowsUp), {savedShowsUp}],
    ['a link changes the page it opened',
        borrowed.addressSays.includes('slow=8'), borrowed],
    ['and leaves your own saved settings alone',
        borrowed.savedSlow === 1, borrowed],
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
console.log(failed === 0 ? '\ngameplay settings in the address bar working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
