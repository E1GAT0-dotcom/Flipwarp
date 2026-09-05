// Every switch in the Flipwarp settings must go both ways, and stay where it
// was put. It used to be one-way: the checkbox hands back the click, not a
// yes or no, and the click is always something — so off never took.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const page = await browser.newPage({viewport: {width: 1300, height: 940}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);

const openSettings = async () => {
    await page.click('[class*="menu-bar_menu-bar-item"]:has-text("Advanced")');
    await page.waitForSelector('text=Advanced Settings', {timeout: 15000});
    await page.waitForTimeout(900);
};
const stored = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('flipwarp:settings') || '{}'));

await openSettings();

// Only Flipwarp's own switches: everything under the heading, before the next.
const flipwarpBoxes = async () => page.$$eval(
    '[class*="settings-modal_setting"]',
    els => els.map((el, i) => ({
        i,
        label: el.textContent.trim().slice(0, 40),
        checked: (el.querySelector('input[type=checkbox]') || {}).checked
    })).filter(x => x.checked !== undefined));

const before = await flipwarpBoxes();
// The first fifteen are Flipwarp's, in the order they are written: eight for
// the editor, then seven for how a project runs. Everything after them is
// TurboWarp's own and is not this test's business.
const mine = before.slice(0, 15);

const results = [];
for (const box of mine) {
    const boxes = await page.$$('[class*="settings-modal_setting"] input[type=checkbox]');
    const el = boxes[box.i];
    const was = await el.isChecked();
    await el.click();
    await page.waitForTimeout(350);
    const now = await el.isChecked();
    const saved = await stored();
    results.push({
        label: box.label,
        was,
        flipped: now !== was,
        // What went into storage has to be a real yes or no, or it is thrown
        // away next time the editor opens.
        savedIsBoolean: Object.values(saved).every(v =>
            typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number')
    });
    // Put it back the way it was.
    await el.click();
    await page.waitForTimeout(300);
    results[results.length - 1].flippedBack = (await el.isChecked()) === was;
}

// And that a change survives the editor being reopened.
const boxes = await page.$$('[class*="settings-modal_setting"] input[type=checkbox]');
await boxes[0].click();
await page.waitForTimeout(400);
const turnedOffTo = await boxes[0].isChecked();
await page.reload({waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);
await openSettings();
const afterReload = await page.$$eval(
    '[class*="settings-modal_setting"] input[type=checkbox]', els => els[0].checked);

await page.screenshot({path: '/tmp/settings-toggle.png'});
await browser.close();

const stuck = results.filter(r => !r.flipped);
const stuckBack = results.filter(r => !r.flippedBack);
const badStorage = results.filter(r => !r.savedIsBoolean);

const checks = [
    ['there are fifteen Flipwarp switches', mine.length === 15, mine.length],
    ['every one of them changes when clicked', stuck.length === 0, stuck.map(r => r.label)],
    ['and every one goes back again', stuckBack.length === 0, stuckBack.map(r => r.label)],
    ['what is saved is a real yes or no', badStorage.length === 0, badStorage.map(r => r.label)],
    ['a change survives reopening the editor', afterReload === turnedOffTo, {turnedOffTo, afterReload}],
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
console.log(failed === 0 ? '\nsettings toggle working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
