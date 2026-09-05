// A phone.
//
// Two things have to be true and neither is obvious from looking at a
// screenshot. The first is that nothing runs off the side: the editor asks for
// at least 1024 pixels and says so in an inline style, and if that is still in
// force the whole page slides sideways and half the buttons are off the edge.
// The second is that the stage still draws after you have been away from it —
// hiding a pane gives it no size, and a renderer told it has no size gives
// back a blank white square, which is why the panes are scrolled rather than
// hidden.
//
// Then the text panel, which is the awkward one on a phone: the symbols it is
// made of are two taps away on a phone keyboard, so there is a row of them.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: {width: 400, height: 820}, hasTouch: true});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('.blocklySvg', {timeout: 90000});
await page.waitForTimeout(4000);

const tap = async handle => {
    const box = await handle.boundingBox();
    await page.touchscreen.tap(box.x + (box.width / 2), box.y + (box.height / 2));
};
const paneButtons = () => page.$$('[class*="pane-switcher_pane_"]');
const paneNow = () => page.evaluate(() => document.documentElement.dataset.pane);
const overflow = () => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

const startingPane = await paneNow();
const overflowAtStart = await overflow();

// How much of the stage is actually painted. A stage that has lost its size
// comes back blank, and blank is the failure this is here to catch.
const stageInk = () => page.evaluate(() => {
    const canvas = document.querySelector('canvas[class*="stage_stage"]') ||
        [...document.querySelectorAll('canvas')].find(c => c.width > 100 && c.height > 100);
    if (!canvas) return -1;
    const shot = document.createElement('canvas');
    shot.width = 60;
    shot.height = 45;
    const context = shot.getContext('2d');
    context.drawImage(canvas, 0, 0, 60, 45);
    const data = context.getImageData(0, 0, 60, 45).data;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
        // Anything that is not the white backdrop.
        if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) painted++;
    }
    return painted;
});

const [blocksButton, stageButton] = await paneButtons();
const switcherShows = Boolean(blocksButton && stageButton);

await tap(stageButton);
await page.waitForTimeout(1800);
const afterStage = await paneNow();
const inkFirst = await stageInk();

await tap(blocksButton);
await page.waitForTimeout(1200);
const backToCode = await paneNow();
await tap(stageButton);
await page.waitForTimeout(1800);
const inkAgain = await stageInk();

// --- the text panel with a phone keyboard ---------------------------------
await tap(blocksButton);
await page.waitForTimeout(1200);
const textButton = await page.$('[class*="flipwarp-panel_toggle-button"]');
await tap(textButton);
await page.waitForTimeout(2500);

const symbols = await page.$$eval('[class*="flipwarp-panel_symbol_"]',
    els => els.map(e => e.textContent));
const lengthBefore = await page.$eval('[class*="flipwarp-panel_editor"]', el => el.value.length);
const brace = await page.$('[class*="flipwarp-panel_symbol_"][data-symbol="{"]');
await tap(brace);
await page.waitForTimeout(700);
const lengthAfter = await page.$eval('[class*="flipwarp-panel_editor"]', el => el.value.length);
const keptFocus = await page.evaluate(() =>
    document.activeElement && document.activeElement.tagName === 'TEXTAREA');

await page.screenshot({path: '/tmp/phone.png'});

// --- the player page ------------------------------------------------------
// A different layout with the same problem: the stage there is shown at the
// project's own size, which is wider than a phone.
const player = await ctx.newPage();
player.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await player.goto(`${SITE}/index.html`, {waitUntil: 'domcontentloaded'});
await player.waitForTimeout(9000);
const playerOverflow = await player.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stageFits = await player.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].find(c => c.width > 100);
    return canvas ? canvas.getBoundingClientRect().width <= window.innerWidth : false;
});
await player.screenshot({path: '/tmp/phone-player.png'});

await browser.close();

const checks = [
    ['the pane switcher shows on a phone', switcherShows],
    ['it starts on the blocks', startingPane === 'code', startingPane],
    ['nothing runs off the side of the screen', overflowAtStart === 0, overflowAtStart],
    ['tapping Stage switches to it', afterStage === 'stage', afterStage],
    ['and the stage is actually drawing', inkFirst > 20, inkFirst],
    ['tapping Blocks switches back', backToCode === 'code', backToCode],
    ['and the stage still draws after going away and returning', inkAgain > 20, inkAgain],
    ['the text panel offers the symbols a phone keyboard hides',
        symbols.includes('{') && symbols.includes(';'), symbols],
    ['tapping one types it', lengthAfter === lengthBefore + 1, {lengthBefore, lengthAfter}],
    ['without taking the keyboard away', keptFocus],
    ['the player page does not run off the side either', playerOverflow === 0, playerOverflow],
    ['and its stage is shrunk to fit', stageFits],
    ['neither page raised an error', errs.length === 0, errs]
];

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra)}`);
    }
}
console.log(failed === 0 ? '\nphone working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
