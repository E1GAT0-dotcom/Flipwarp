// Buttons over the stage, for projects that expect a keyboard.
//
// A phone has no arrow keys, so a project built around them cannot be played
// on one at all. The point of these is not that they exist but that they are
// the right ones — read off the project's own blocks, so a project played with
// the mouse gets none and a project that uses the arrows and the space bar
// gets exactly those five.
//
// Then the part that is easy to get wrong: a key has to stay down while the
// finger is down. A button that sends a press and a release together looks
// fine and is useless for anything that moves while a key is held.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: {width: 900, height: 800}, hasTouch: true});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('.blocklySvg', {timeout: 90000});
await page.waitForTimeout(3500);

const labels = () => page.$$eval('[class*="stage-controls_key_"]', els => els.map(e => e.textContent));

// An empty project asks about no keys at all.
const beforeAnyKeys = await labels();

// A project that moves with the arrows and fires with the space bar, plus a
// "key q pressed?" to prove the other block is read too.
await page.evaluate(() => {
    const vm = window.vm;
    const json = JSON.parse(vm.toJSON());
    const target = json.targets.find(t => !t.isStage);
    target.blocks = {
        hatUp: {opcode: 'event_whenkeypressed', next: null, parent: null, inputs: {},
            fields: {KEY_OPTION: ['up arrow', null]}, topLevel: true, shadow: false, x: 40, y: 40},
        hatLeft: {opcode: 'event_whenkeypressed', next: null, parent: null, inputs: {},
            fields: {KEY_OPTION: ['left arrow', null]}, topLevel: true, shadow: false, x: 40, y: 160},
        hatSpace: {opcode: 'event_whenkeypressed', next: null, parent: null, inputs: {},
            fields: {KEY_OPTION: ['space', null]}, topLevel: true, shadow: false, x: 40, y: 280},
        forever: {opcode: 'control_forever', next: null, parent: null,
            inputs: {SUBSTACK: [2, 'ifq']}, fields: {}, topLevel: true, shadow: false, x: 300, y: 40},
        ifq: {opcode: 'control_if', next: null, parent: 'forever',
            inputs: {CONDITION: [2, 'pressq']}, fields: {}, topLevel: false, shadow: false},
        pressq: {opcode: 'sensing_keypressed', next: null, parent: 'ifq',
            inputs: {KEY_OPTION: [1, 'qopt']}, fields: {}, topLevel: false, shadow: false},
        qopt: {opcode: 'sensing_keyoptions', next: null, parent: 'pressq', inputs: {},
            fields: {KEY_OPTION: ['q', null]}, topLevel: false, shadow: true}
    };
    return vm.loadProject(JSON.stringify(json));
});
await page.waitForTimeout(2500);
const shown = await labels();

// --- a press has to hold ---------------------------------------------------
// With real touch events rather than the mouse. Not fussiness: the buttons are
// only there while a finger is what was last used, so moving a mouse anywhere
// near them is what makes them go away. Playwright can tap but not press and
// hold, so the touches go in through the browser's own debugging protocol.
const cdp = await ctx.newCDPSession(page);
const finger = async (type, x, y) => {
    await cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{x, y, id: 1}]
    });
};

const isDown = key => page.evaluate(k =>
    window.vm.runtime.ioDevices.keyboard._keysPressed.includes(k), key);

const upButton = await page.$('[class*="stage-controls_key_"][data-key="up arrow"]');
const box = await upButton.boundingBox();
const x = box.x + (box.width / 2);
const y = box.y + (box.height / 2);

await finger('touchStart', x, y);
await page.waitForTimeout(500);
const downWhileHeld = await isDown('up arrow');
await page.waitForTimeout(500);
const stillDown = await isDown('up arrow');
await finger('touchEnd', x, y);
await page.waitForTimeout(400);
const upAfterRelease = await isDown('up arrow');

// A finger that slides off the button still has to let go of the key.
await finger('touchStart', x, y);
await page.waitForTimeout(300);
await finger('touchMove', x + 300, y - 200);
await finger('touchEnd', x + 300, y - 200);
await page.waitForTimeout(400);
const releasedAfterSlidingOff = !(await isDown('up arrow'));

await page.screenshot({path: '/tmp/stage-controls.png'});
await browser.close();

const has = (list, label) => list.includes(label);

const checks = [
    ['a project with no key blocks gets no buttons', beforeAnyKeys.length === 0, beforeAnyKeys],
    ['the arrows it uses appear', has(shown, '▲') && has(shown, '◀'), shown],
    ['an arrow it does not use stays away', !has(shown, '▼') && !has(shown, '▶'), shown],
    ['space appears', has(shown, 'space'), shown],
    ['and a key read by "key pressed?" appears too', has(shown, 'Q'), shown],
    ['pressing one holds the key down', downWhileHeld === true],
    ['and it stays down', stillDown === true],
    ['letting go releases it', upAfterRelease === false],
    ['sliding off the button releases it too', releasedAfterSlidingOff],
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
console.log(failed === 0 ? '\nstage controls working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
