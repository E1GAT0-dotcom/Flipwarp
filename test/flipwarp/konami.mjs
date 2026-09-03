// Checks the doge easter egg: that the Konami code changes the cat faces when
// Cat Blocks is on, does nothing at all when it is off, and that a near miss
// does not set it off.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];

const openEditor = async (catBlocks) => {
    const page = await browser.newPage({viewport: {width: 1200, height: 800}});
    page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
    // The addon settings are read from storage at start-up, so they have to be
    // in place before the page loads.
    await page.addInitScript(on => {
        localStorage.setItem('flipwarp:addons', JSON.stringify({'cat-blocks': {enabled: on}}));
    }, catBlocks);
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('text=Costumes', {timeout: 60000});
    await page.waitForTimeout(3000);
    return page;
};

const konami = async page => {
    // Click into the workspace first. Blockly moves the selected block with
    // the arrow keys and stops the event there, so pressing the code with the
    // page freshly loaded is an easier test than the one people actually run.
    const canvas = await page.$('.blocklyWorkspace, .blocklySvg');
    if (canvas) await canvas.click({position: {x: 200, y: 200}}).catch(() => {});
    for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
        'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(30);
    }
    await page.waitForTimeout(600);
};

// An empty project has no scripts, so every cat you can see is in the block
// palette — which is its own workspace, outside .blocklyDraggable. The whole
// page is searched for that reason.
//
// A cat's inner ears are pink and its face has no ellipse; a shiba's ears are
// tan and its face has an ellipse for the muzzle.
const faceShape = page => page.evaluate(() => ({
    pink: document.querySelectorAll('path[fill="#FFD5E6"]').length,
    tan: document.querySelectorAll('path[fill="#C58C4E"]').length,
    muzzles: document.querySelectorAll('ellipse').length
}));

// --- with Cat Blocks on ---------------------------------------------------
const withCats = await openEditor(true);
const before = await faceShape(withCats);

// A near miss first: the code with one key wrong must do nothing.
for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowUp']) {
    await withCats.keyboard.press(key);
}
await withCats.waitForTimeout(500);
const afterNearMiss = await faceShape(withCats);

await konami(withCats);
const afterCode = await faceShape(withCats);
await withCats.screenshot({path: '/tmp/doge.png'});

// --- with Cat Blocks off --------------------------------------------------
const withoutCats = await openEditor(false);
await konami(withoutCats);
const noCats = await faceShape(withoutCats);
const stillFine = await withoutCats.evaluate(() =>
    !!document.querySelector('.blocklyDraggable'));

await browser.close();

const checks = [
    ['cat faces are there to begin with', before.pink > 0 && before.muzzles === 0],
    ['a near miss changes nothing', afterNearMiss.muzzles === 0 && afterNearMiss.pink > 0],
    ['the code turns them into doges', afterCode.muzzles > 0],
    ['the pink ears all go tan', afterCode.tan === before.pink && afterCode.pink === 0],
    ['every face changed, not just some', afterCode.muzzles === afterCode.tan / 2],
    ['with cat blocks off there is nothing to change', noCats.pink === 0 && noCats.muzzles === 0],
    ['and the editor is unharmed', stillFine === true]
];

let failed = 0;
for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
}
console.log('before:', JSON.stringify(before));
console.log('after: ', JSON.stringify(afterCode));
for (const e of errs) console.log(e);
console.log(failed === 0 ? '\ndoge working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
