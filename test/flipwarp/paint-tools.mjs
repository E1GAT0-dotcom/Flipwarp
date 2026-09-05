// The magic wand and the lasso.
//
// Both decide which pixels are in and then hand the rest of the paint editor
// an ordinary selection, so what is worth testing is the deciding: that a
// wand click takes the shape it was clicked on and not the one next to it,
// that turning off "touching only" makes it take both, and that a lasso takes
// what it drew round. Each is checked by selecting, deleting, and looking at
// what the costume is left holding — which is what the person would do.
//
// The two shapes are deliberately different sizes, so the number of pixels
// left says which one survived without needing to know where on the canvas
// the costume ended up.
import {launchBrowser, SITE} from './launch.mjs';

const BIG = {x: 100, y: 100, w: 140, h: 140};
const SMALL = {x: 500, y: 120, w: 80, h: 80};

// The paint editor works on a board twice the size of the costume it saves —
// a bitmap costume is stored at half these numbers — so a square drawn 140
// wide is 70 wide by the time it is counted.
const stored = box => (box.w / 2) * (box.h / 2);
const BIG_PIXELS = stored(BIG);
const SMALL_PIXELS = stored(SMALL);

const browser = await launchBrowser();
const errs = [];
const page = await browser.newPage({viewport: {width: 1400, height: 950}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));

await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);
await page.click('text=Costumes');
await page.waitForTimeout(2000);
await page.click('text=Convert to Bitmap');
await page.waitForTimeout(2000);

// Board coordinates to page coordinates. The board is 960 by 720 whatever
// size the canvas happens to be drawn at.
let canvasBox = null;
const measure = async () => {
    canvasBox = await page.$eval('[class*="paint-editor"] canvas', el => {
        const r = el.getBoundingClientRect();
        return {x: r.x, y: r.y, w: r.width, h: r.height};
    });
};
await measure();
const at = (x, y) => ({
    x: canvasBox.x + ((x / 960) * canvasBox.w),
    y: canvasBox.y + ((y / 720) * canvasBox.h)
});

const drag = async (from, to, steps = 12) => {
    const a = at(from.x, from.y);
    const b = at(to.x, to.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(a.x + (((b.x - a.x) * i) / steps), a.y + (((b.y - a.y) * i) / steps));
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
};

const drawRect = box => drag({x: box.x, y: box.y}, {x: box.x + box.w, y: box.y + box.h});

// Everything the costume still has drawn on it, counted from the costume
// itself rather than from anything inside the paint editor.
const drawnPixels = () => page.evaluate(() => new Promise(resolve => {
    const target = window.vm.editingTarget;
    const costume = target.getCostumes()[target.currentCostume];
    const image = new Image();
    image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 8) opaque++;
        resolve(opaque);
    };
    image.onerror = () => resolve(-1);
    image.src = costume.asset.encodeDataURI();
}));

const clearAll = async () => {
    await page.click('[title^="Select"]');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(400);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(700);
};

const drawBoth = async () => {
    await clearAll();
    await page.click('[title^="Rectangle"]');
    await page.waitForTimeout(400);
    await drawRect(BIG);
    await drawRect(SMALL);
    await page.waitForTimeout(800);
};

const near = (got, want) => Math.abs(got - want) <= Math.max(400, want * 0.06);

// --- the wand takes the shape it was clicked on ---------------------------
await drawBoth();
const bothDrawn = await drawnPixels();

await page.click('[title^="Magic Wand"]');
await page.waitForTimeout(500);
let p = at(BIG.x + (BIG.w / 2), BIG.y + (BIG.h / 2));
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(900);
await page.keyboard.press('Delete');
await page.waitForTimeout(1000);
const afterWandDelete = await drawnPixels();

// --- and with "touching only" off, every matching pixel -------------------
await drawBoth();
await page.click('[title^="Magic Wand"]');
await page.waitForTimeout(500);
const touchingBox = await page.$('[class*="mode-tools"] input[type=checkbox]');
const wasChecked = touchingBox ? await touchingBox.isChecked() : null;
if (touchingBox) await touchingBox.uncheck();
await page.waitForTimeout(400);
p = at(BIG.x + (BIG.w / 2), BIG.y + (BIG.h / 2));
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(1200);
await page.keyboard.press('Delete');
await page.waitForTimeout(1000);
const afterGlobalDelete = await drawnPixels();
if (touchingBox) await touchingBox.check();

// --- the lasso takes what it drew round -----------------------------------
await drawBoth();
await page.click('[title^="Lasso"]');
await page.waitForTimeout(500);
// A loop well clear of the big square and well round the small one.
const loop = [
    {x: SMALL.x - 40, y: SMALL.y - 40},
    {x: SMALL.x + SMALL.w + 40, y: SMALL.y - 40},
    {x: SMALL.x + SMALL.w + 40, y: SMALL.y + SMALL.h + 40},
    {x: SMALL.x - 40, y: SMALL.y + SMALL.h + 40}
];
const first = at(loop[0].x, loop[0].y);
await page.mouse.move(first.x, first.y);
await page.mouse.down();
for (const corner of [...loop.slice(1), loop[0]]) {
    const c = at(corner.x, corner.y);
    await page.mouse.move(c.x, c.y, {steps: 10});
}
await page.mouse.up();
await page.waitForTimeout(1000);
await page.keyboard.press('Delete');
await page.waitForTimeout(1000);
const afterLassoDelete = await drawnPixels();

await page.screenshot({path: '/tmp/paint-tools.png'});
await browser.close();

const checks = [
    ['two squares get drawn', near(bothDrawn, BIG_PIXELS + SMALL_PIXELS), bothDrawn],
    ['the wand takes the square it was clicked on',
        near(afterWandDelete, SMALL_PIXELS), {afterWandDelete, expected: SMALL_PIXELS}],
    ['"touching only" starts on', wasChecked === true, wasChecked],
    ['with it off the wand takes both squares',
        afterGlobalDelete <= 400, afterGlobalDelete],
    ['the lasso takes what it drew round',
        near(afterLassoDelete, BIG_PIXELS), {afterLassoDelete, expected: BIG_PIXELS}],
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
console.log(failed === 0 ? '\npaint tools working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
