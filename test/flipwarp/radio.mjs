// The radio: the volume bookkeeping, which is where the thinking is, and then
// the control in a real editor.
//
// What is NOT checked here is that a station makes a sound. This machine
// cannot reach the station directory, and a browser will not start audio
// without a real click anyway — so that part is checked by hand on the live
// site. What this does check is that failing to reach the directory says so
// plainly instead of leaving a spinner going forever, which is the failure
// this environment can actually produce.
import {launchBrowser, SITE} from './launch.mjs';
import {Radio} from '../../src/lib/flipwarp/radio.js';

let failed = 0;
const check = (name, ok, extra) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra)}`);
    }
};

// --- the volume rules -----------------------------------------------------
const r = new Radio();
r.setVolume(0.8);
check('volume is what was set', r.effectiveVolume() === 0.8, r.effectiveVolume());

r.setProjectRunning(true, 'duck');
check('a running project turns it down', r.effectiveVolume() < 0.8 && r.effectiveVolume() > 0, r.effectiveVolume());

r.setProjectRunning(false, 'duck');
check('stopping puts it back', r.effectiveVolume() === 0.8, r.effectiveVolume());

r.setProjectRunning(true, 'mute');
check('the mute setting silences it', r.effectiveVolume() === 0, r.effectiveVolume());
r.setProjectRunning(false, 'mute');
check('and stopping brings it back', r.effectiveVolume() === 0.8, r.effectiveVolume());

r.setProjectRunning(true, 'nothing');
check('the leave-alone setting leaves it alone', r.effectiveVolume() === 0.8, r.effectiveVolume());
r.setProjectRunning(false, 'nothing');

// The one that would be easy to get wrong: a project must not un-mute
// something the person muted themselves.
r.setMuted(true);
r.setProjectRunning(true, 'duck');
r.setProjectRunning(false, 'duck');
check('a project cannot undo a mute you chose', r.effectiveVolume() === 0, r.effectiveVolume());
r.setMuted(false);
check('and unmuting still works afterwards', r.effectiveVolume() === 0.8, r.effectiveVolume());

r.setVolume(5);
check('volume cannot go above full', r.volume === 1, r.volume);
r.setVolume(-3);
check('or below silence', r.volume === 0, r.volume);

// --- the control in the editor -------------------------------------------
const browser = await launchBrowser();
const errs = [];

const open = async on => {
    const page = await browser.newPage({viewport: {width: 1280, height: 880}});
    page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
    await page.addInitScript(v => {
        localStorage.setItem('flipwarp:settings', JSON.stringify({musicPlayer: v}));
    }, on);
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('text=Costumes', {timeout: 60000});
    await page.waitForTimeout(3000);
    return page;
};

const off = await open(false);
const hidden = await off.$('[class*="radio-control_radio"]');

const on = await open(true);
const shown = await on.$('[class*="radio-control_radio"]');

// It has to sit beside the green flag, not somewhere else on the page.
const placed = await on.evaluate(() => {
    const radio = document.querySelector('[class*="radio-control_radio"]');
    const flag = document.querySelector('[class*="green-flag_green-flag"]');
    if (!radio || !flag) return null;
    const a = radio.getBoundingClientRect();
    const b = flag.getBoundingClientRect();
    return {rightOfFlag: a.left > b.left, sameRow: Math.abs(a.top - b.top) < 30};
});

// Opening the picker with no way to reach the directory must say so.
await on.click('[class*="radio-control_name"]');
await on.waitForTimeout(9000);
const noteText = await on.$$eval('[class*="radio-control_note"]', els => els.map(e => e.textContent));
const stillSpinning = await on.$$eval('[class*="radio-control_note"]',
    els => els.some(e => /Loading/.test(e.textContent)));
const genres = await on.$$eval('[class*="radio-control_genre"] option', els => els.map(e => e.textContent));

await on.screenshot({path: '/tmp/radio.png'});
await browser.close();

check('off by default it is not there', hidden === null);
check('turned on it appears', shown !== null);
check('it sits beside the green flag', placed && placed.rightOfFlag && placed.sameRow, placed);
check('the genres are offered', genres.length >= 4, genres);
check('an unreachable directory says so rather than spinning forever',
    noteText.length > 0 && !stillSpinning, noteText);
check('the editor raised no errors', errs.length === 0, errs);

console.log(failed === 0 ? '\nradio working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
