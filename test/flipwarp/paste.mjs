// Paste as blocks: the other half of Copy as text.
//
// The test that matters is the round trip through the clipboard's shape —
// copy a script out as text, paste it back, and end up with two identical
// scripts rather than one mangled one. Then the things that are easy to get
// wrong: not disturbing what is already in the sprite, making a variable the
// sprite has not got, and refusing bad text without changing anything.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];

const page = await browser.newPage({viewport: {width: 1300, height: 900}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);

// A sprite with one script and one local variable.
await page.evaluate(() => {
    const vm = window.vm;
    const json = JSON.parse(vm.toJSON());
    const t = json.targets.find(x => !x.isStage);
    t.variables = {'v-1': ['speed', 0]};
    t.blocks = {
        hat: {opcode: 'event_whenflagclicked', next: 'set', parent: null, inputs: {}, fields: {},
            topLevel: true, shadow: false, x: 40, y: 40},
        set: {opcode: 'data_setvariableto', next: 'rep', parent: 'hat',
            inputs: {VALUE: [1, [10, '5']]}, fields: {VARIABLE: ['speed', 'v-1']},
            topLevel: false, shadow: false},
        rep: {opcode: 'control_repeat', next: null, parent: 'set',
            inputs: {TIMES: [1, [6, '4']], SUBSTACK: [2, 'mv']}, fields: {},
            topLevel: false, shadow: false},
        mv: {opcode: 'motion_movesteps', next: null, parent: 'rep',
            inputs: {STEPS: [1, [4, '10']]}, fields: {}, topLevel: false, shadow: false}
    };
    return vm.loadProject(JSON.stringify(json));
});
await page.waitForTimeout(2500);

const countScripts = () => page.evaluate(() => {
    const blocks = JSON.parse(window.vm.toJSON()).targets.find(t => !t.isStage).blocks;
    return Object.values(blocks).filter(b => b.topLevel && !b.shadow).length;
});
const countBlocks = () => page.evaluate(() => {
    const blocks = JSON.parse(window.vm.toJSON()).targets.find(t => !t.isStage).blocks;
    return Object.values(blocks).filter(b => !b.shadow).length;
});
const varNames = () => page.evaluate(() => {
    const json = JSON.parse(window.vm.toJSON());
    const sprite = json.targets.find(t => !t.isStage);
    const stage = json.targets.find(t => t.isStage);
    return [...Object.values(sprite.variables || {}), ...Object.values(stage.variables || {})].map(v => v[0]);
});

// The text a person would have on their clipboard. Produced the way they
// would produce it — open the text panel and read what is in it — rather than
// by reaching into the library, which the page cannot do.
await page.click('button:has-text("Text")');
await page.waitForTimeout(1200);
const scriptText = await page.$eval('textarea', el => el.value);
await page.click('button:has-text("Blocks")');
await page.waitForTimeout(1500);

const scriptsBefore = await countScripts();
const blocksBefore = await countBlocks();

// --- paste the same script back -------------------------------------------
const paste = async text => {
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('FLIPWARP_PASTE', {detail: {at: null}}));
    });
    await page.waitForSelector('[class*="paste-blocks_editor"]', {timeout: 10000});
    await page.$eval('[class*="paste-blocks_editor"]', (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', {bubbles: true}));
    }, text);
    await page.waitForTimeout(400);
    await page.click('[class*="paste-blocks_add"]');
    await page.waitForTimeout(1800);
    const shown = await page.$$eval('[class*="paste-blocks_error"]', els => els.map(e => e.textContent));
    if (shown.length) console.log('  paste refused:', shown.join(' | '));
};

await paste(scriptText);
const scriptsAfter = await countScripts();
const blocksAfter = await countBlocks();
const boxGone = await page.$('[class*="paste-blocks_editor"]');

// --- paste something that uses a variable this sprite has not got ---------
const withNewName = scriptText
    .replace(/\bspeed\b/g, 'wobble')
    .replace(/\bmy_speed\b/g, 'wobble');
await paste(withNewName);
const namesAfter = await varNames();
const scriptsAfterTwo = await countScripts();

// --- refuse bad text without changing anything ---------------------------
await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('FLIPWARP_PASTE', {detail: {at: null}}));
});
await page.waitForSelector('[class*="paste-blocks_editor"]', {timeout: 10000});
await page.$eval('[class*="paste-blocks_editor"]', el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, 'wobbleAbout(3);');
    el.dispatchEvent(new Event('input', {bubbles: true}));
});
await page.click('[class*="paste-blocks_add"]');
await page.waitForTimeout(1200);
const errorShown = await page.$('[class*="paste-blocks_error"]');
const boxStillOpen = await page.$('[class*="paste-blocks_editor"]');
const scriptsAfterBad = await countScripts();

await page.screenshot({path: '/tmp/paste.png'});
await browser.close();

const checks = [
    ['the sprite started with one script', scriptsBefore === 1, scriptsBefore],
    ['pasting it back makes a second', scriptsAfter === 2, scriptsAfter],
    ['and nothing was lost from the first', blocksAfter === blocksBefore * 2, {blocksBefore, blocksAfter}],
    ['the box closes when it worked', boxGone === null],
    ['a name the sprite has not got is made', namesAfter.includes('wobble'), namesAfter],
    ['and that script is added too', scriptsAfterTwo === 3, scriptsAfterTwo],
    ['bad text is refused', errorShown !== null],
    ['the box stays open so it can be fixed', boxStillOpen !== null],
    ['and nothing was added', scriptsAfterBad === 3, scriptsAfterBad],
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
console.log('\ncopied text:\n' + scriptText);
console.log(failed === 0 ? '\npaste working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
