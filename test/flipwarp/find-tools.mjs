// The find tool after the changes Greg asked for:
//   a result scrolls the workspace to the script, not just opens the sprite
//   arrows walk every match without the panel closing
//   a replacement can delete the whole block, whatever its arguments are
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const page = await browser.newPage({viewport: {width: 1400, height: 920}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.addInitScript(() => {
    localStorage.setItem('flipwarp:settings', JSON.stringify({
        searchProject: true, findReplace: true, blockSheet: true
    }));
});
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);

// Four scripts far apart on the canvas, three of them using goToXY with
// different numbers — which is exactly the case that made him ask.
await page.evaluate(() => {
    const vm = window.vm;
    const json = JSON.parse(vm.toJSON());
    const t = json.targets.find(x => !x.isStage);
    const script = (n, x, y, gx, gy) => ({
        [`hat${n}`]: {opcode: 'event_whenflagclicked', next: `go${n}`, parent: null,
            inputs: {}, fields: {}, topLevel: true, shadow: false, x, y},
        [`go${n}`]: {opcode: 'motion_gotoxy', next: `mv${n}`, parent: `hat${n}`,
            inputs: {X: [1, [4, String(gx)]], Y: [1, [4, String(gy)]]}, fields: {},
            topLevel: false, shadow: false},
        [`mv${n}`]: {opcode: 'motion_movesteps', next: null, parent: `go${n}`,
            inputs: {STEPS: [1, [4, '10']]}, fields: {}, topLevel: false, shadow: false}
    });
    t.blocks = {
        ...script(1, 40, 40, 0, 0),
        ...script(2, 40, 900, 37, -12),
        ...script(3, 40, 1800, -100, 250),
        // A loop holding a goToXY, to prove deleting takes the block only and
        // not the loop around it.
        loopHat: {opcode: 'event_whenflagclicked', next: 'loop', parent: null,
            inputs: {}, fields: {}, topLevel: true, shadow: false, x: 700, y: 40},
        loop: {opcode: 'control_repeat', next: null, parent: 'loopHat',
            inputs: {TIMES: [1, [6, '4']], SUBSTACK: [2, 'goInner']}, fields: {},
            topLevel: false, shadow: false},
        goInner: {opcode: 'motion_gotoxy', next: 'turnInner', parent: 'loop',
            inputs: {X: [1, [4, '5']], Y: [1, [4, '5']]}, fields: {},
            topLevel: false, shadow: false},
        turnInner: {opcode: 'motion_turnright', next: null, parent: 'goInner',
            inputs: {DEGREES: [1, [4, '15']]}, fields: {}, topLevel: false, shadow: false}
    };
    return vm.loadProject(JSON.stringify(json));
});
await page.waitForTimeout(2500);

const countGoTo = () => page.evaluate(() => Object.values(
    JSON.parse(window.vm.toJSON()).targets.find(t => !t.isStage).blocks)
    .filter(b => b.opcode === 'motion_gotoxy').length);
const countAll = () => page.evaluate(() => Object.values(
    JSON.parse(window.vm.toJSON()).targets.find(t => !t.isStage).blocks)
    .filter(b => !b.shadow).length);
// Where the camera is, read off the page rather than out of Blockly — there
// is more than one copy of Blockly loaded and only the DOM is unambiguous.
const scrollNow = () => page.evaluate(() => {
    const canvases = [...document.querySelectorAll('.blocklyBlockCanvas')];
    // The palette has one of these too. The workspace's is the one with the
    // scripts in it.
    const canvas = canvases.find(c => c.querySelectorAll('.blocklyDraggable').length > 3) ||
        canvases[canvases.length - 1];
    if (!canvas) return null;
    return {transform: canvas.getAttribute('transform') || ''};
});

const openTools = async tab => {
    if (!await page.$('[class*="flipwarp-tools_window"]')) {
        await page.click('button:has-text("Tools")');
        await page.waitForTimeout(700);
    }
    await page.click(`[class*="flipwarp-tools_tab"]:has-text("${tab}")`);
    await page.waitForTimeout(500);
};

const type = async (which, value) => {
    const boxes = await page.$$('[class*="flipwarp-tools_input"]');
    await boxes[which].fill(value);
    await page.waitForTimeout(250);
};

// --- 1. Find, and the camera moves ---------------------------------------
await openTools('Search all sprites');
await type(0, 'goToXY');
await page.click('[class*="flipwarp-tools_go"]');
await page.waitForTimeout(2000);

const stepText = () => page.$eval('[class*="flipwarp-tools_step-count"]', el => el.textContent);
const firstCount = await stepText();
const scrollFirst = await scrollNow();
const panelStillOpen = await page.$('[class*="flipwarp-tools_window"]');

// --- 2. The arrows walk the matches --------------------------------------
const nextButton = '[class*="flipwarp-tools_step"][title="Next"]';
await page.click(nextButton);
await page.waitForTimeout(1400);
const secondCount = await stepText();
const scrollSecond = await scrollNow();

await page.click(nextButton);
await page.waitForTimeout(1400);
const thirdCount = await stepText();
const scrollThird = await scrollNow();

const stillOpenAfterWalking = await page.$('[class*="flipwarp-tools_window"]');

// --- 3. Delete the whole block, whatever the numbers are -----------------
await openTools('Find and replace');
await type(0, 'goToXY');
const wholeBlock = await page.$('label:has-text("Delete the whole block") input');
await wholeBlock.check();
await page.waitForTimeout(300);
await type(0, 'goToXY');
await page.click('[class*="flipwarp-tools_go"]');
await page.waitForTimeout(1800);

const plannedRows = await page.$$eval('[class*="flipwarp-tools_result_"]', els => els.length);
const previewSays = await page.$$eval('[class*="flipwarp-tools_after"]', els => els.map(e => e.textContent));

const goToBefore = await countGoTo();
const allBefore = await countAll();
await page.click('[class*="flipwarp-tools_apply"]');
await page.waitForTimeout(2500);
const goToAfter = await countGoTo();
const allAfter = await countAll();
const statusText = await page.$eval('[class*="flipwarp-tools_status"]', el => el.textContent);

// The loop and its turn block must survive — only the goToXY inside it goes.
const survivors = await page.evaluate(() => {
    const blocks = JSON.parse(window.vm.toJSON()).targets.find(t => !t.isStage).blocks;
    return Object.values(blocks).filter(b => !b.shadow).map(b => b.opcode).sort();
});

await page.screenshot({path: '/tmp/find-tools.png'});
await browser.close();

const moved = (a, b) => !!a && !!b && a.transform !== b.transform;

const checks = [
    ['finding shows how many there are', /of 4/.test(firstCount), firstCount],
    ['and goes to the first one', /^1 of/.test(firstCount), firstCount],
    ['the panel stays open', panelStillOpen !== null],
    ['next moves to the second', /^2 of/.test(secondCount), secondCount],
    ['and the workspace actually scrolled', moved(scrollFirst, scrollSecond), {scrollFirst, scrollSecond}],
    ['next again moves to the third', /^3 of/.test(thirdCount), thirdCount],
    ['and scrolled again', moved(scrollSecond, scrollThird), {scrollSecond, scrollThird}],
    ['the panel is still open after walking', stillOpenAfterWalking !== null],
    ['every goToXY is found whatever its numbers', plannedRows === 4, plannedRows],
    ['the preview says they would be deleted',
        previewSays.length === 4 && previewSays.every(t => /deleted/.test(t)), previewSays],
    ['there were four to start with', goToBefore === 4, goToBefore],
    ['all four are gone', goToAfter === 0, goToAfter],
    ['and only those four went', allAfter === allBefore - 4, {allBefore, allAfter}],
    ['the loop around one of them survived', survivors.includes('control_repeat'), survivors],
    ['and the block after it inside the loop survived', survivors.includes('motion_turnright'), survivors],
    ['it said what it deleted', /eleted 4 blocks/.test(statusText), statusText],
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
console.log(failed === 0 ? '\nfind tools working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
