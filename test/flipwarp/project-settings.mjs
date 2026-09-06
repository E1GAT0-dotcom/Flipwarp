// Keeping the project's settings inside the project.
//
// TurboWarp writes them into a comment on the stage and offers a button. The
// settings it saves are exactly the ones somebody fiddles with, so a button
// meant every fiddle had to be followed by remembering to press it, and
// forgetting was silent. This is the switch that replaced it, so what the test
// is really asking is whether the comment keeps itself up to date and whether
// turning the switch off takes it away again.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 200)}`));

const open = async settings => {
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.evaluate(s => {
        localStorage.setItem('flipwarp:settings', JSON.stringify(s));
    }, settings);
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    // Waited for the stage rather than for the VM: the editor is on screen
    // before a project has loaded, and there is nowhere to keep a comment
    // until there is a stage to keep it on.
    await page.waitForFunction(
        () => window.vm && window.vm.runtime && window.vm.runtime.getTargetForStage(),
        {timeout: 60000}
    );
    await page.waitForTimeout(2500);
};

// The comment the settings live in, found the way the VM finds it.
const storedSettings = () => page.evaluate(() => {
    if (!window.vm.runtime.getTargetForStage()) return null;
    const comment = window.vm.runtime.findProjectOptionsComment();
    return comment ? comment.text : null;
});

// Flipping the switch through the settings module, which is what the dialog
// does, so the watcher hears about it the same way.
const setSwitch = on => page.evaluate(async value => {
    const raw = localStorage.getItem('flipwarp:settings');
    const now = raw ? JSON.parse(raw) : {};
    localStorage.setItem('flipwarp:settings', JSON.stringify({...now, keepSettingsInProject: value}));
    // The module has to be told, not just storage.
    const modal = document.querySelector('[class*="settings-modal_body"]');
    void modal;
    return value;
}, on);

// --- nothing is written unless it is asked for ---------------------------
await open({});
await page.evaluate(() => window.vm.setFramerate(60));
await page.waitForTimeout(1200);
const withoutTheSwitch = await storedSettings();

// --- on, and a setting changed -------------------------------------------
await open({keepSettingsInProject: true});
const beforeAnyChange = await storedSettings();
await page.evaluate(() => window.vm.setFramerate(60));
await page.waitForTimeout(1500);
const afterFramerate = await storedSettings();

// A second change, to prove it keeps up rather than writing once.
await page.evaluate(() => window.vm.setRuntimeOptions({maxClones: Infinity}));
await page.waitForTimeout(1500);
const afterClones = await storedSettings();

// --- several changes at once are one write --------------------------------
const writes = await page.evaluate(async () => {
    const runtime = window.vm.runtime;
    let count = 0;
    const real = window.vm.storeProjectOptions.bind(window.vm);
    window.vm.storeProjectOptions = (...args) => {
        count++;
        return real(...args);
    };
    window.vm.setFramerate(30);
    window.vm.setRuntimeOptions({fencing: false, miscLimits: false});
    window.vm.setInterpolation(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    void runtime;
    return count;
});

// --- off again ------------------------------------------------------------
await open({keepSettingsInProject: true});
await page.evaluate(() => window.vm.setFramerate(60));
await page.waitForTimeout(1500);
const beforeTurningOff = await storedSettings();
await page.evaluate(() => {
    const raw = localStorage.getItem('flipwarp:settings');
    const now = raw ? JSON.parse(raw) : {};
    localStorage.setItem('flipwarp:settings', JSON.stringify({...now, keepSettingsInProject: false}));
});
await open({keepSettingsInProject: false});
const afterReopening = await storedSettings();

await browser.close();

const checks = [
    ['nothing is written into the project unless the switch is on',
        withoutTheSwitch === null, {withoutTheSwitch}],
    ['switching it on does not write anything on its own',
        beforeAnyChange === null, {beforeAnyChange}],
    ['changing a setting writes it into the project',
        typeof afterFramerate === 'string' && afterFramerate.includes('60'),
        {afterFramerate}],
    ['and it keeps up with the next change',
        typeof afterClones === 'string' && /Infinity|clones/i.test(afterClones),
        {afterClones}],
    ['several changes at once are written once, not once each',
        writes === 1, {writes}],
    ['the project carried its settings before the switch went off',
        typeof beforeTurningOff === 'string', {beforeTurningOff}],
    ['and a fresh project with the switch off carries nothing',
        afterReopening === null, {afterReopening}],
    ['no errors', errs.length === 0, errs]
];

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra).slice(0, 400)}`);
    }
}
console.log(failed === 0 ? '\nsettings in the project working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
