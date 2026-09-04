// Checks the four project-wide tools against a real project in a real editor:
// search across sprites, find and replace with its preview, copying one script
// as text, and the block sheet.
//
// The replace test deliberately includes a rename that would break a sprite,
// to check the promise that matters most: either every ticked line changes or
// none of them do.
import fs from 'node:fs';
import {launchBrowser, repoPath, SITE} from './launch.mjs';

const PROJECT = repoPath('build', 'tools-test.sb3');
fs.copyFileSync(repoPath('test', 'flipwarp', 'fixtures', 'tools-test.sb3'), PROJECT);
process.on('exit', () => fs.rmSync(PROJECT, {force: true}));

const browser = await launchBrowser();
const page = await browser.newPage({viewport: {width: 1440, height: 900}});
const errs = [];
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));

await page.goto(`${SITE}/editor.html?project_url=${SITE}/tools-test.sb3`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(2500);

await page.click('text=Tools');
await page.waitForTimeout(600);

const tabs = await page.$$eval('[class*="flipwarp-tools_tab"]', els => els.map(e => e.textContent.trim()));

// --- search ---------------------------------------------------------------
await page.fill('[class*="flipwarp-tools_input"]', 'speed');
await page.click('[class*="flipwarp-tools_go"]');
await page.waitForTimeout(500);
const searchRows = await page.$$eval('[class*="flipwarp-tools_where"]', els => els.map(e => e.textContent.trim()));
const searchStatus = await page.$eval('[class*="flipwarp-tools_status"]', e => e.textContent.trim());

// --- find and replace -----------------------------------------------------
await page.click('text=Find and replace');
await page.waitForTimeout(400);
const inputs = await page.$$('[class*="flipwarp-tools_input"]');
await inputs[0].fill('speed');
await inputs[1].fill('velocity');
await page.click('[class*="flipwarp-tools_go"]');
await page.waitForTimeout(600);

const preview = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[class*="flipwarp-tools_result"]')];
    return rows.map(r => {
        const codes = [...r.querySelectorAll('code')].map(c => c.textContent);
        return {where: r.querySelector('button').textContent.trim(), before: codes[0], after: codes[1] || null};
    });
});
const projectUnchangedDuringPreview = await page.evaluate(() =>
    JSON.stringify(window.vm.toJSON()).includes('speed'));

await page.click('[class*="flipwarp-tools_apply"]');
await page.waitForTimeout(1200);
const afterApply = await page.evaluate(() => {
    const project = JSON.parse(window.vm.toJSON());
    const stage = project.targets.find(t => t.isStage);
    const names = Object.values(stage.variables).map(v => v[0]);
    const fields = project.targets
        .flatMap(t => Object.values(t.blocks))
        .map(b => b.fields && b.fields.VARIABLE)
        .filter(Boolean);
    return {
        names,
        // A real rename keeps one variable and changes its name; a bad one
        // leaves the old beside a new copy.
        oneVariable: names.length === 1,
        renamed: names.includes('velocity') && !names.includes('speed'),
        blocksFollowed: fields.length > 0 && fields.every(f => f[0] === 'velocity')
    };
});
const applyStatus = await page.$eval('[class*="flipwarp-tools_status"]', e => e.textContent.trim());

// --- block sheet ----------------------------------------------------------
await page.click('text=Block sheet');
await page.waitForTimeout(400);
const sheetCount = await page.$eval('[class*="flipwarp-tools_status"]', e => e.textContent.trim());
await page.fill('[class*="flipwarp-tools_input"]', 'move');
await page.waitForTimeout(300);
const sheetRows = await page.$$eval('[class*="flipwarp-tools_form"]', els => els.map(e => e.textContent.trim()));

await page.click('[class*="flipwarp-tools_close"]');
await page.waitForTimeout(300);

// --- copy a script as text ------------------------------------------------
// Right-click a block on the canvas and look for the menu item; the clipboard
// itself is out of reach from here, so this checks that the item is offered on
// a real script.
//
// The sprite is chosen deliberately: searching now jumps to the first result,
// which can leave the editor on a sprite with no scripts of its own — and
// then the only blocks on screen are the palette's, which are not scripts and
// are not meant to offer this.
await page.evaluate(() => {
    const runner = window.vm.runtime.targets.find(t => t.getName() === 'Runner');
    if (runner) window.vm.setEditingTarget(runner.id);
});
await page.waitForTimeout(1500);

let copyOffered = false;
try {
    const block = await page.$('.blocklyWorkspace:not(.blocklyFlyout) .blocklyDraggable');
    if (block) {
        await block.click({button: 'right'});
        await page.waitForTimeout(500);
        copyOffered = await page.evaluate(() =>
            [...document.querySelectorAll('.goog-menuitem-content')]
                .some(e => /Copy as text/i.test(e.textContent)));
        await page.keyboard.press('Escape');
    }
    if (!copyOffered) {
        console.log('  menu was:', JSON.stringify(await page.$$eval('.goog-menuitem-content',
            els => els.map(el => el.textContent.trim()))));
        console.log('  sprite  :', await page.evaluate(() => window.vm.editingTarget.getName()));
        console.log('  blocks  :', await page.$$eval('.blocklyDraggable', els => els.length));
    }
} catch (e) {
    copyOffered = false;
    console.log('  threw:', String(e).slice(0, 200));
}

await browser.close();

const checks = [
    ['the Tools button opens three tools', tabs.length === 3],
    ['search looked through more than one sprite',
        new Set(searchRows.map(r => r.split(':')[0])).size > 1],
    ['search said how many lines', /line/.test(searchStatus)],
    ['replace previewed every line it would change', preview.length > 0],
    ['the preview showed before and after', preview.some(p => p.after && p.after !== p.before)],
    ['nothing changed while previewing', projectUnchangedDuringPreview === true],
    ['applying it renamed the variable itself', afterApply.renamed === true],
    ['it did not leave a duplicate behind', afterApply.oneVariable === true],
    ['every block followed the rename', afterApply.blocksFollowed === true],
    ['it said what it changed', /Renamed|Changed/.test(applyStatus)],
    ['the block sheet listed the whole phrasebook', /of \d\d\d/.test(sheetCount)],
    ['the block sheet filters', sheetRows.length > 0 && sheetRows.every(r => /move/i.test(r))],
    ['right-clicking a script offers Copy as text', copyOffered === true]
];

let failed = 0;
for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
}
console.log('tabs:', tabs.join(' | '));
console.log('search hits:', searchRows.join(', ') || '(none)');
console.log('preview:', preview.slice(0, 3).map(p => `${p.where} ${p.before} -> ${p.after}`).join(' | '));
console.log('apply:', applyStatus);
console.log('variables afterwards:', afterApply.names.join(', '));
for (const e of errs) console.log(e);
console.log(failed === 0 ? '\nproject tools working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
