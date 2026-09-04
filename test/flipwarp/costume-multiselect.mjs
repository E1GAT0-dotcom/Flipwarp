// Picking several costumes at once: ctrl to add one, shift for a run, and
// then acting on all of them together.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const page = await browser.newPage({viewport: {width: 1300, height: 900}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);

// Six costumes, so a run of them is worth selecting.
await page.evaluate(async () => {
    const vm = window.vm;
    const target = vm.editingTarget;
    const first = target.getCostumes()[0];
    for (let i = 2; i <= 6; i++) {
        await vm.addCostume(first.md5ext || `${first.assetId}.${first.dataFormat}`, {
            name: `costume${i}`, md5: first.md5ext, asset: first.asset,
            bitmapResolution: first.bitmapResolution,
            rotationCenterX: first.rotationCenterX, rotationCenterY: first.rotationCenterY,
            dataFormat: first.dataFormat, assetId: first.assetId
        }, target.id);
    }
});
await page.click('text=Costumes');
await page.waitForTimeout(2500);

const names = () => page.evaluate(() => window.vm.editingTarget.getCostumes().map(c => c.name));
const items = () => page.$$('[class*="selector_list-item"]');
// Scoped to the costume list: the selected sprite in the sprite pane carries
// the same class and would be counted with them.
const selectedCount = () => page.$$eval(
    '[class*="selector_list-area"] [class*="sprite-selector-item_is-selected"]',
    els => els.length);
const bar = () => page.$('[class*="selector_batch-bar"]');
// The whole strip's text, rather than one element inside it: the count is
// what matters, not which tag it happens to live in.
const barText = async () => {
    const el = await page.$('[class*="selector_batch-bar"]');
    return el ? (await el.textContent()) : null;
};

const startNames = await names();

// --- plain click selects one ---------------------------------------------
let list = await items();
await list[0].click();
await page.waitForTimeout(500);
const afterPlain = await selectedCount();
const barAfterPlain = await bar();

// --- ctrl+click adds ------------------------------------------------------
list = await items();
await list[2].click({modifiers: ['Control']});
await page.waitForTimeout(400);
await list[4].click({modifiers: ['Control']});
await page.waitForTimeout(500);
const afterCtrl = await selectedCount();
const ctrlBar = await barText();

// --- ctrl+click again removes --------------------------------------------
list = await items();
await list[4].click({modifiers: ['Control']});
await page.waitForTimeout(500);
const afterCtrlOff = await selectedCount();

// --- shift+click takes the run -------------------------------------------
list = await items();
await list[1].click();
await page.waitForTimeout(400);
list = await items();
await list[4].click({modifiers: ['Shift']});
await page.waitForTimeout(600);
const afterShift = await selectedCount();
const shiftBar = await barText();

// --- delete them all ------------------------------------------------------
const beforeDelete = (await names()).length;
await page.click('[class*="selector_batch-delete"]');
await page.waitForTimeout(1500);
const afterDelete = await names();
const barGone = await bar();

// --- and a plain click goes back to one ----------------------------------
list = await items();
await list[0].click();
await page.waitForTimeout(500);
const backToOne = await selectedCount();

await page.screenshot({path: '/tmp/multiselect.png'});
await browser.close();

const checks = [
    ['six costumes to start with', startNames.length === 6, startNames],
    ['a plain click selects one', afterPlain === 1, afterPlain],
    ['and shows no batch strip', barAfterPlain === null],
    ['ctrl+click adds them up', afterCtrl === 3, afterCtrl],
    ['the strip says how many', /3 selected/.test(ctrlBar || ''), ctrlBar],
    ['ctrl+click again takes one off', afterCtrlOff === 2, afterCtrlOff],
    ['shift+click takes the whole run', afterShift === 4, afterShift],
    ['and says so', /4 selected/.test(shiftBar || ''), shiftBar],
    ['deleting removes every one of them', afterDelete.length === beforeDelete - 4,
        {beforeDelete, after: afterDelete.length}],
    ['and the right ones are left', afterDelete.length === 2, afterDelete],
    ['the strip goes away afterwards', barGone === null],
    ['a plain click goes back to one', backToOne === 1, backToOne],
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
console.log(failed === 0 ? '\nmulti-select working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
