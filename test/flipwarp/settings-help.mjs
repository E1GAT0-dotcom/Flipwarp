// The "?" beside every Flipwarp setting. It used to open an empty box: the
// help was written inside the setting, and only a prop was ever read.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const page = await browser.newPage({viewport: {width: 1300, height: 940}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);

// Advanced opens the settings dialog directly. The menu bar's "Settings" is a
// different thing — the theme and language menu.
await page.click('[class*="menu-bar_menu-bar-item"]:has-text("Advanced")');
await page.waitForSelector('text=Advanced Settings', {timeout: 15000});
await page.waitForTimeout(1200);

// Every setting that has a "?" of its own, Flipwarp's and TurboWarp's alike.
const results = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = [];
    const settings = [...document.querySelectorAll('[class*="settings-modal_setting"]')];
    for (const setting of settings) {
        const button = setting.querySelector('[class*="settings-modal_help-icon"]');
        if (!button) continue;
        const label = (setting.querySelector('[class*="settings-modal_label"]')
            || setting).textContent.trim().slice(0, 44);
        // Measured by what the setting says, not by which element says it:
        // the help box had no style of its own to look for.
        const before = setting.innerText.replace(/\s+/g, ' ').trim();
        button.click();
        await wait(80);
        const after = setting.innerText.replace(/\s+/g, ' ').trim();
        const opened = after.length > before.length;
        const added = after.slice(before.length).trim();
        // Put it back so the next one starts from the same place.
        button.click();
        await wait(50);
        const closed = setting.innerText.replace(/\s+/g, ' ').trim() === before;
        out.push({label, opened, closed, chars: added.length});
    }
    return out;
});

await page.screenshot({path: '/tmp/settings-help.png'});
await browser.close();

const empty = results.filter(r => r.opened && r.chars === 0);
const silent = results.filter(r => !r.opened);

const checks = [
    ['there are settings with a "?"', results.length > 5, results.length],
    ['every one of them opens something', silent.length === 0, silent.map(r => r.label)],
    ['and none of them opens an empty box', empty.length === 0, empty.map(r => r.label)],
    ['the help actually says something', results.every(r => r.chars > 20),
        results.filter(r => r.chars <= 20).map(r => `${r.label}: ${r.chars} chars`)],
    ['and closes again when pressed twice', results.every(r => r.closed),
        results.filter(r => !r.closed).map(r => r.label)],
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
console.log(`\nchecked ${results.length} help buttons`);
console.log(failed === 0 ? 'settings help working' : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
