// The text styles in the real editor: that the setting is there, that picking
// Python changes what the text says, and — the part that matters — that
// pressing Blocks on Python text puts the same blocks back.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];

const openEditor = async style => {
    const page = await browser.newPage({viewport: {width: 1280, height: 860}});
    page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
    await page.addInitScript(s => {
        localStorage.setItem('flipwarp:settings', JSON.stringify({textStyle: s, indentSize: 4}));
    }, style);
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('text=Costumes', {timeout: 60000});
    await page.waitForTimeout(3000);
    return page;
};

// A script with a hat, a loop, an if/else and a comparison — enough that the
// two styles have to disagree about it.
const buildScript = page => page.evaluate(() => {
    const vm = window.vm;
    const target = vm.editingTarget;
    const blocks = {
        hat: {opcode: 'event_whenflagclicked', next: 'rep', parent: null, inputs: {}, fields: {},
            topLevel: true, shadow: false, x: 40, y: 40},
        rep: {opcode: 'control_repeat', next: null, parent: 'hat',
            inputs: {TIMES: [1, [6, '10']], SUBSTACK: [2, 'iff']}, fields: {},
            topLevel: false, shadow: false},
        iff: {opcode: 'control_if_else', next: null, parent: 'rep',
            inputs: {CONDITION: [2, 'gt'], SUBSTACK: [2, 'mv'], SUBSTACK2: [2, 'turn']},
            fields: {}, topLevel: false, shadow: false},
        gt: {opcode: 'operator_gt', next: null, parent: 'iff',
            inputs: {OPERAND1: [1, [10, '3']], OPERAND2: [1, [10, '5']]}, fields: {},
            topLevel: false, shadow: false},
        mv: {opcode: 'motion_movesteps', next: null, parent: 'iff',
            inputs: {STEPS: [1, [4, '10']]}, fields: {}, topLevel: false, shadow: false},
        turn: {opcode: 'motion_turnright', next: null, parent: 'iff',
            inputs: {DEGREES: [1, [4, '15']]}, fields: {}, topLevel: false, shadow: false}
    };
    const json = JSON.parse(vm.toJSON());
    const t = json.targets.find(x => x.name === target.getName());
    t.blocks = blocks;
    return vm.loadProject(JSON.stringify(json)).then(() => true);
});

const openText = async page => {
    await page.click('button:has-text("Text")');
    await page.waitForTimeout(1500);
    return page.$eval('textarea', el => el.value);
};

// --- JavaScript -----------------------------------------------------------
const js = await openEditor('js');
await buildScript(js);
await js.waitForTimeout(2000);
const jsText = await openText(js);

// --- Python ---------------------------------------------------------------
const py = await openEditor('python');
await buildScript(py);
await py.waitForTimeout(2000);
const pyText = await openText(py);

// Press Blocks and make sure it went back without complaint, then read it
// again — if the text comes back the same, the blocks came back the same.
await py.click('button:has-text("Blocks")');
await py.waitForTimeout(2500);
const errorShown = await py.$('[class*="flipwarp-panel_error"]');
const stillOpen = await py.$('textarea');
const pyAgain = await openText(py);

const settingThere = await py.evaluate(() =>
    JSON.parse(localStorage.getItem('flipwarp:settings')).textStyle);

await py.screenshot({path: '/tmp/python-text.png'});
await browser.close();

const checks = [
    ['JavaScript writes braces', jsText.includes('{') && jsText.includes('}')],
    ['JavaScript ends lines with semicolons', /;\s*$/m.test(jsText)],
    ['JavaScript writes turnRight', jsText.includes('turnRight(')],
    ['Python writes colons instead of braces', pyText.includes(':') && !pyText.includes('{')],
    ['Python has no semicolons', !pyText.includes(';')],
    ['Python writes turn_right', pyText.includes('turn_right(')],
    ['Python indents the body', /\n {4}\S/.test(pyText)],
    ['the two styles really differ', jsText !== pyText],
    ['pressing Blocks on Python text raised no error', errorShown === null],
    ['and closed the panel', stillOpen === null],
    ['and the text is unchanged afterwards', pyText === pyAgain],
    ['the setting is remembered', settingThere === 'python']
];

let failed = 0;
for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
}
console.log('\n--- JavaScript ---\n' + jsText);
console.log('--- Python ---\n' + pyText);
for (const e of errs) console.log(e);
console.log(failed === 0 ? '\ntext styles working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
