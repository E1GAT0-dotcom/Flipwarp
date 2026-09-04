// Costume folders. The check that matters is the last one: a folder has to
// survive the project being saved and opened again, or it is not a folder,
// it is a decoration.
//
// And the one before it: the costume's name must not change. Renaming is how
// the addon does folders, and it breaks every "switch costume to" that used
// the old name.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const page = await browser.newPage({viewport: {width: 1300, height: 900}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);

// Six costumes, and a script that switches to one of them by name — the thing
// that breaks if a folder is hidden in the name.
await page.evaluate(() => {
    const vm = window.vm;
    const t = vm.editingTarget;
    const first = t.getCostumes()[0];
    for (let i = 2; i <= 6; i++) {
        t.addCostume(Object.assign({}, first, {name: `costume${i}`}), t.getCostumes().length);
    }
    vm.emitTargetsUpdate();
});
await page.click('text=Costumes');
await page.waitForTimeout(2000);

const names = () => page.evaluate(() =>
    window.vm.editingTarget.getCostumes().map(c => c.name));
const folders = () => page.evaluate(() =>
    window.vm.editingTarget.getCostumes().map(c => c.flipwarpFolder || null));
const items = () => page.$$('[class*="selector_list-item"]');
const headers = () => page.$$eval('[class*="selector_folder-header"]',
    els => els.map(e => e.textContent.trim()));
const visibleCount = () => page.$$eval('[class*="selector_list-item"]',
    els => els.filter(e => e.offsetParent !== null).length);

const namesBefore = await names();

// --- put three of them in a folder ---------------------------------------
let list = await items();
await list[1].click();
await page.waitForTimeout(300);
list = await items();
await list[3].click({modifiers: ['Shift']});
await page.waitForTimeout(500);
await page.click('[class*="selector_batch-button"]:has-text("Folder")');
await page.waitForTimeout(400);
await page.fill('[class*="selector_folder-input"]', 'walk cycle');
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);

const foldersAfter = await folders();
const namesAfter = await names();
const headerText = await headers();

// --- closing the folder hides what is in it ------------------------------
const shownBefore = await visibleCount();
await page.click('[class*="selector_folder-header"]');
await page.waitForTimeout(600);
const shownCollapsed = await visibleCount();
const collapsedHeader = await headers();
await page.click('[class*="selector_folder-header"]');
await page.waitForTimeout(600);
const shownAgain = await visibleCount();

// --- save the project and open it again ----------------------------------
const survived = await page.evaluate(async () => {
    const vm = window.vm;
    // Exactly what the Save to your computer button produces.
    const blob = await vm.saveProjectSb3();
    const buffer = await blob.arrayBuffer();
    const before = vm.editingTarget.getCostumes().map(c => ({
        name: c.name, folder: c.flipwarpFolder || null
    }));
    await vm.loadProject(buffer);
    const after = vm.runtime.targets.filter(t => t.isOriginal && !t.isStage)[0]
        .getCostumes().map(c => ({name: c.name, folder: c.flipwarpFolder || null}));
    return {before, after};
});

// And that the file itself still looks like an ordinary Scratch project.
const fileShape = await page.evaluate(async () => {
    const json = JSON.parse(window.vm.toJSON());
    return {
        keys: Object.keys(json),
        hasFolders: !!(json.flipwarp && json.flipwarp.folders),
        // A costume in the saved file must carry nothing unusual.
        costumeKeys: Object.keys(
            json.targets.find(t => !t.isStage).costumes[1]).sort()
    };
});

await page.screenshot({path: '/tmp/folders.png'});
await browser.close();

const inFolder = foldersAfter.filter(f => f === 'walk cycle').length;
const same = JSON.stringify(survived.before) === JSON.stringify(survived.after);

const checks = [
    ['six costumes to start with', namesBefore.length === 6, namesBefore.length],
    ['three of them went into the folder', inFolder === 3, foldersAfter],
    ['their names were not touched', JSON.stringify(namesAfter) === JSON.stringify(namesBefore),
        {namesBefore, namesAfter}],
    ['the folder has a line of its own', headerText.length === 1 && /walk cycle/.test(headerText[0]),
        headerText],
    ['and it says how many are in it', /3/.test(headerText[0] || ''), headerText],
    ['closing it hides them', shownCollapsed === shownBefore - 3, {shownBefore, shownCollapsed}],
    ['opening it shows them again', shownAgain === shownBefore, {shownBefore, shownAgain}],
    ['the arrow turns round', /▸/.test(collapsedHeader[0] || ''), collapsedHeader],
    ['folders survive saving and opening again', same, survived],
    ['the saved file is still an ordinary project',
        ['targets', 'monitors', 'extensions', 'meta'].every(k => fileShape.keys.includes(k)),
        fileShape.keys],
    ['with the folders in a section of their own', fileShape.hasFolders],
    ['and nothing unusual on the costumes themselves',
        !fileShape.costumeKeys.some(k => /flipwarp/i.test(k)), fileShape.costumeKeys],
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
console.log(failed === 0 ? '\ncostume folders working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
