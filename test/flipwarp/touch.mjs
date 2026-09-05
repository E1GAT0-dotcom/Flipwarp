// Working on a touchscreen.
//
// The rule the whole thing hangs on is that touch is about what the person
// last used, not what the device can do — a laptop with a touchscreen has
// both, and someone holding a mouse should not be given chunky buttons. So the
// first thing tested is that the mode follows the input and goes back again.
//
// After that: that things are actually bigger in touch mode, that two fingers
// zoom the workspace, and that a long press still opens the menu that Copy as
// text and Paste as blocks live on — which is the only way to reach them
// without a right mouse button.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];

const openEditor = async opts => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('text=Costumes', {timeout: 60000});
    await page.waitForTimeout(3500);
    return page;
};

const mode = page => page.evaluate(() => document.documentElement.dataset.input);
const heightOf = (page, selector) => page.$eval(selector, el => el.getBoundingClientRect().height);
const TAB = '[class*="gui_tab-list"] [class*="gui_tab"]';

// --- a plain desktop, no touchscreen at all --------------------------------
const plain = await openEditor({viewport: {width: 1024, height: 768}});
const plainMode = await mode(plain);
const plainTab = await heightOf(plain, TAB);
await plain.context().close();

// --- something with a touchscreen -----------------------------------------
const page = await openEditor({viewport: {width: 1024, height: 768}, hasTouch: true});
const touchMode = await mode(page);
const touchTab = await heightOf(page, TAB);
const touchFlag = await heightOf(page, '[class*="green-flag"]');

// Pick up a mouse and it should all go back, without waiting for a click.
await page.mouse.move(500, 400);
await page.mouse.move(520, 410);
await page.waitForTimeout(400);
const mouseMode = await mode(page);
const mouseTab = await heightOf(page, TAB);

// And one tap brings it back.
const flagAt = await page.$eval('[class*="green-flag"]', el => {
    const r = el.getBoundingClientRect();
    return {x: r.x + (r.width / 2), y: r.y + (r.height / 2)};
});
await page.touchscreen.tap(flagAt.x, flagAt.y);
await page.waitForTimeout(500);
const backToTouch = await mode(page);

// --- two fingers zoom the workspace ---------------------------------------
const scaleNow = () => page.evaluate(() => window.ScratchBlocks.getMainWorkspace().scale);
const beforePinch = await scaleNow();

const box = await page.$eval('.blocklySvg', el => {
    const r = el.getBoundingClientRect();
    return {x: r.x, y: r.y, w: r.width, h: r.height};
});
// Off centre on purpose: the middle of the workspace is where the scrollbars
// cross, and a touch there never reaches Blockly at all.
const cx = box.x + (box.w * 0.6);
const cy = box.y + (box.h * 0.6);

// Playwright has no pinch, so the touches are made by hand. They are ordinary
// TouchEvents on the element Blockly was injected into, which is what a real
// pinch delivers.
const pinch = (from, to) => page.evaluate(({x, y, from: a, to: b}) => {
    const element = document.querySelector('.injectionDiv') ||
        document.querySelector('.blocklySvg').parentElement;
    const touch = (id, tx, ty) =>
        new Touch({identifier: id, target: element, clientX: tx, clientY: ty});
    const fire = (type, gap) => {
        const list = [touch(1, x - (gap / 2), y), touch(2, x + (gap / 2), y)];
        element.dispatchEvent(new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : list,
            targetTouches: type === 'touchend' ? [] : list,
            changedTouches: list
        }));
    };
    fire('touchstart', a);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
        fire('touchmove', a + (((b - a) * i) / steps));
    }
    fire('touchend', b);
}, {x: cx, y: cy, from, to});

await pinch(100, 260);
await page.waitForTimeout(600);
const afterSpread = await scaleNow();
await pinch(260, 100);
await page.waitForTimeout(600);
const afterSqueeze = await scaleNow();

// --- a pinch must never zoom the page ------------------------------------
// Two fingers on the workspace zoom the blocks. If the browser gets the
// gesture first it zooms the whole editor instead, and a page left zoomed in
// survives turning the phone and cannot always be zoomed back out — so the
// browser is told to keep its hands off before any finger lands.
const handsOff = await page.evaluate(() => {
    const of = selector => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el).touchAction : null;
    };
    return {
        workspace: of('.injectionDiv'),
        stage: of('[class*="stage_stage_"] canvas')
    };
});

// --- a long press opens the workspace menu --------------------------------
await page.evaluate(({x, y}) => {
    const el = document.elementFromPoint(x, y);
    const list = [new Touch({identifier: 9, target: el, clientX: x, clientY: y})];
    el.dispatchEvent(new TouchEvent('touchstart', {
        bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: list
    }));
}, {x: cx, y: cy});
await page.waitForTimeout(1300);
const menu = await page.$$eval('.goog-menuitem', els => els.map(e => e.textContent.trim()));

await page.screenshot({path: '/tmp/touch.png'});
await browser.close();

const checks = [
    ['a machine with no touchscreen starts as a mouse', plainMode === 'mouse', plainMode],
    ['one with a touchscreen and no mouse starts as touch', touchMode === 'touch', touchMode],
    ['the tabs are taller in touch mode', touchTab > plainTab + 4, {plainTab, touchTab}],
    ['and the green flag is bigger', touchFlag >= 38, touchFlag],
    ['moving a mouse switches back without waiting for a click',
        mouseMode === 'mouse', mouseMode],
    ['and the tabs go back with it', Math.abs(mouseTab - plainTab) < 1, {mouseTab, plainTab}],
    ['a tap switches to touch again', backToTouch === 'touch', backToTouch],
    ['spreading two fingers zooms in', afterSpread > beforePinch * 1.2,
        {beforePinch, afterSpread}],
    ['squeezing them zooms back out', afterSqueeze < afterSpread * 0.85,
        {afterSpread, afterSqueeze}],
    ['the browser is told not to zoom the page on the workspace',
        handsOff.workspace === 'none', handsOff],
    ['nor on the stage', handsOff.stage === 'none', handsOff],
    ['a long press opens the workspace menu', menu.length > 0, menu],
    ['with Paste as blocks on it', menu.some(item => item.includes('Paste as blocks')), menu],
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
console.log(failed === 0 ? '\ntouch working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
