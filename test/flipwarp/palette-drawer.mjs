// The block palette on a phone.
//
// The palette costs 310 points of width. On a thousand-point screen that is a
// fair price for seeing every block; on a phone's 460 it leaves 150 points of
// workspace, which is not a workspace. So on a phone it slides over the
// workspace rather than sitting beside it.
//
// What actually has to be true: the workspace gets the width back, a tap opens
// the drawer, taking a block out of it puts it away again, and the block ends
// up in the workspace rather than under the drawer it came from. And none of
// this happens on a screen with room for the palette.
import {launchBrowser, SITE} from './launch.mjs';

const PHONE = {width: 460, height: 1000};
const SIDEWAYS = {width: 1000, height: 460};

const browser = await launchBrowser();
const errs = [];

const open = async (size, hasTouch = true) => {
    const ctx = await browser.newContext({viewport: size, hasTouch});
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('.blocklySvg', {timeout: 90000});
    await page.waitForTimeout(4000);
    return page;
};

const look = page => page.evaluate(() => {
    const workspace = window.ScratchBlocks.getMainWorkspace();
    const metrics = workspace.getMetrics();
    const flyout = document.querySelector('.blocklyFlyout');
    const box = flyout ? flyout.getBoundingClientRect() : null;
    return {
        drawer: document.documentElement.dataset.palette || '(not a drawer)',
        workspaceWidth: Math.round(metrics.viewWidth),
        flyoutLeft: box ? Math.round(box.x) : 0,
        flyoutWidth: box ? Math.round(box.width) : 0
    };
});

const blocksInWorkspace = page => page.evaluate(() =>
    window.ScratchBlocks.getMainWorkspace().getAllBlocks().length);

// --- the phone ------------------------------------------------------------
const phone = await open(PHONE);
const cdp = await phone.context().newCDPSession(phone);
const finger = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{x, y, id: 1}]
});
const tap = async handle => {
    const box = await handle.boundingBox();
    await finger('touchStart', box.x + (box.width / 2), box.y + (box.height / 2));
    await finger('touchEnd', box.x + (box.width / 2), box.y + (box.height / 2));
    await phone.waitForTimeout(900);
};

const atStart = await look(phone);

const categories = await phone.$$('.scratchCategoryMenuItem');
await tap(categories[3]);
const opened = await look(phone);

// Tapping the same category again puts it away.
await tap(categories[3]);
const closedAgain = await look(phone);

// --- take a block out of it -----------------------------------------------
await tap(categories[0]);
await phone.waitForTimeout(600);
const before = await blocksInWorkspace(phone);
// Measured in the page: an SVG group has no box Playwright will hand back.
// Measured inside the page: Playwright will not hand back a box for an SVG
// group, and the flyout is full of them.
const from = await phone.evaluate(() => {
    const blocks = [...document.querySelectorAll('.blocklyFlyout .blocklyDraggable')]
        .map(block => block.getBoundingClientRect())
        .filter(box => box.height > 20 && box.width > 40 && box.y > 150 && box.y < 700);
    if (!blocks.length) return null;
    return {x: Math.round(blocks[0].x + 30), y: Math.round(blocks[0].y + (blocks[0].height / 2))};
});
const startX = from.x;
const startY = from.y;
await finger('touchStart', startX, startY);
for (let i = 1; i <= 8; i++) {
    await finger('touchMove', startX + (i * 25), startY + (i * 12));
}
await finger('touchEnd', startX + 200, startY + 96);
await phone.waitForTimeout(1500);

const after = await blocksInWorkspace(phone);
const afterDrag = await look(phone);
const landedClear = await phone.evaluate(() => {
    const workspace = window.ScratchBlocks.getMainWorkspace();
    const blocks = workspace.getTopBlocks(false);
    if (!blocks.length) return null;
    // Where the block sits on screen, against where the drawer would cover.
    const at = blocks[blocks.length - 1].getBoundingRectangle();
    return Math.round((at.topLeft.x * workspace.scale) + workspace.getMetrics().absoluteLeft);
});

await phone.screenshot({path: '/tmp/palette-phone.png'});
await phone.context().close();

// --- a screen with room for it --------------------------------------------
const sideways = await open(SIDEWAYS);
const landscape = await look(sideways);
const landscapeOverflow = await sideways.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight
}));
await sideways.screenshot({path: '/tmp/palette-landscape.png'});
await sideways.context().close();

// --- and a desktop, which must be untouched -------------------------------
const desktop = await open({width: 1280, height: 900}, false);
const onDesktop = await look(desktop);
await desktop.context().close();

await browser.close();

const checks = [
    ['on a phone the palette starts put away', atStart.drawer === 'shut', atStart],
    ['and the workspace gets the width back',
        atStart.workspaceWidth >= 380, atStart.workspaceWidth],
    ['tapping a category opens it', opened.drawer === 'open', opened],
    ['over the workspace rather than beside it',
        opened.workspaceWidth === atStart.workspaceWidth,
        {shut: atStart.workspaceWidth, open: opened.workspaceWidth}],
    ['and it is where it can be seen', opened.flyoutLeft > 0 && opened.flyoutWidth > 200, opened],
    ['tapping the same category again puts it away',
        closedAgain.drawer === 'shut', closedAgain],
    ['dragging a block out adds it to the workspace', after > before, {before, after}],
    ['and puts the drawer away behind it', afterDrag.drawer === 'shut', afterDrag],
    ['the block lands clear of where the drawer was',
        landedClear !== null && landedClear > 60, landedClear],
    ['sideways, the palette is an ordinary palette',
        landscape.drawer === '(not a drawer)', landscape],
    ['and nothing is cut off the screen',
        landscapeOverflow.x === 0 && landscapeOverflow.y === 0, landscapeOverflow],
    ['on a desktop nothing has changed at all',
        onDesktop.drawer === '(not a drawer)' && onDesktop.flyoutWidth > 200, onDesktop],
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
console.log(failed === 0 ? '\npalette drawer working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
