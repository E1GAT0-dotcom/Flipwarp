// The section of starred items at the top of a library.
//
// It is built from what was starred when the window was opened rather than
// from what is starred right now, and that is deliberate: an item that jumped
// to the top the instant you starred it would move out from under the finger
// that starred it, and the row you were reading would be somewhere else.
//
// The bug was the other half of it. Taking a star off did not take the item
// out of the top section, because that section was still working from the
// opening list, so it sat pinned above everything with an empty star on it,
// looking like an item that had decided it was important, and stayed there
// until the window was closed and opened again.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 200)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.vm, {timeout: 60000});
await page.waitForTimeout(2500);

const openPicker = async () => {
    await page.evaluate(() => {
        const button = [...document.querySelectorAll('button, [role="button"]')]
            .find(e => /add extension/i.test(e.getAttribute('aria-label') || e.title || ''));
        if (button) button.click();
    });
    await page.waitForTimeout(3000);
};
const closePicker = async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
};

// The first row, and whether its star is filled. Both are read together
// because the complaint was about the two disagreeing.
const topRow = () => page.evaluate(() => {
    const first = document.querySelector('[class*="library-item_featured-item"]');
    if (!first) return null;
    const star = first.querySelector('[class*="favorite"]');
    return {
        name: first.querySelector('[class*="featured-text"]').textContent.trim().slice(0, 30),
        starred: star ? star.className.includes('favorite-selected') ||
            star.getAttribute('aria-pressed') === 'true' : null
    };
});

const starNth = n => page.evaluate(index => {
    const items = [...document.querySelectorAll('[class*="library-item_featured-item"]')];
    const pick = items[index];
    if (!pick) return null;
    const name = pick.querySelector('[class*="featured-text"]').textContent.trim().slice(0, 30);
    const star = pick.querySelector('[class*="favorite"]');
    if (star) star.click();
    return name;
}, n);

await openPicker();
const before = await topRow();

// Star something that is not already at the top.
const chosen = await starNth(3);
await page.waitForTimeout(600);
const afterStarring = await topRow();

// It moves to the top only once the window has been opened again.
await closePicker();
await openPicker();
const afterReopen = await topRow();

// And taking the star off takes it out of the top section straight away,
// rather than leaving it pinned there with an empty star.
await starNth(0);
await page.waitForTimeout(600);
const afterUnstarring = await topRow();

await browser.close();

const checks = [
    ['a library opens with something in it', Boolean(before && before.name), before],
    ['starring something does not move it under your finger',
        afterStarring && afterStarring.name === before.name,
        {before, afterStarring}],
    ['it is at the top next time the window is opened',
        afterReopen && afterReopen.name === chosen, {chosen, afterReopen}],
    ['and taking the star off puts it back where it belongs',
        afterUnstarring && afterUnstarring.name !== chosen,
        {chosen, afterUnstarring}],
    ['which is where it was before any of this',
        afterUnstarring && afterUnstarring.name === before.name,
        {before, afterUnstarring}],
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
console.log(failed === 0 ? '\nlibrary favourites working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
