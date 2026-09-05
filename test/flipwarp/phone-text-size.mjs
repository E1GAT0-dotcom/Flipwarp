// A phone set to larger text. Android and iOS both let the system text size
// be turned up, and the browser honours it by growing the root font — so every
// measurement in the editor that was written in rem grows with it while the
// screen stays exactly as wide as it was.
//
// Two bugs hid behind that, and neither showed at the default size, which is
// why this file exists rather than another case bolted onto phone-panels:
//
//   - The extension categories are a row that wraps. It was also given a fixed
//     height with the overflow hidden, which is a wrap that throws away
//     everything it wraps: at larger text the last two categories went onto a
//     second row nothing had made room for, and reading the picker you would
//     conclude Flipwarp had no extensions of its own.
//
//   - The run controls and the pane switcher are both pinned to the bottom of
//     the screen, so neither pushes the other along. Grown, they simply met in
//     the middle, and the radio ended up underneath the Blocks button.
import {launchBrowser, SITE} from './launch.mjs';

const PHONE = {width: 460, height: 1000};
const SIZES = [16, 20, 24];

const browser = await launchBrowser();
const errs = [];
const results = [];

for (const size of SIZES) {
    const ctx = await browser.newContext({viewport: PHONE, hasTouch: true});
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`PAGEERROR ${size}px: ${e.message.slice(0, 160)}`));
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.addStyleTag({content: `html { font-size: ${size}px; }`});
    await page.evaluate(() => {
        document.documentElement.dataset.input = 'touch';
    });
    await page.waitForSelector('[class*="pane-switcher_bar"]', {timeout: 60000});
    await page.waitForTimeout(2500);

    // The radio has to be switched on to be in the way at all: it is the
    // widest thing in the strip and the one that collided.
    await page.evaluate(() => {
        localStorage.setItem('tw:flipwarp-radio', 'true');
    });
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.addStyleTag({content: `html { font-size: ${size}px; }`});
    await page.waitForSelector('[class*="pane-switcher_bar"]', {timeout: 60000});
    await page.waitForTimeout(3000);

    const bottom = await page.evaluate(() => {
        const strip = document.querySelector('[class*="controls_controls-container"]');
        const panes = document.querySelector('[class*="pane-switcher_panes"]');
        if (!strip || !panes) return {missing: true};
        const s = strip.getBoundingClientRect();
        const p = panes.getBoundingClientRect();
        // Everything in the strip has to stay reachable: it may scroll
        // sideways, but the flag must still be on screen without scrolling.
        const flag = document.querySelector('[class*="green-flag_green-flag"]');
        const f = flag && flag.getBoundingClientRect();
        return {
            overlap: Math.round(Math.max(0, s.right - p.left)),
            stripRight: Math.round(s.right),
            panesLeft: Math.round(p.left),
            flagVisible: Boolean(f && f.left >= 0 && f.right <= window.innerWidth && f.width > 0)
        };
    });

    // --- the extension categories -------------------------------------------
    await page.evaluate(() => {
        const open = [...document.querySelectorAll('button, [role="button"]')]
            .find(e => /add extension/i.test(e.getAttribute('aria-label') || e.title || ''));
        if (open) open.click();
    });
    await page.waitForTimeout(500);
    if (!(await page.$('[class*="library_filter-bar-item"]'))) {
        // The picker is opened from the bottom-left button on a phone; fall
        // back to the one the editor always has.
        const btn = await page.$('[class*="extension-button"], [class*="controls_extension"]');
        if (btn) await btn.click();
        await page.waitForTimeout(1200);
    }
    await page.waitForTimeout(1500);

    const picker = await page.evaluate(() => {
        // The bar holds the search box as well as the categories, and both
        // wear the same class; only the ones with a word on them are
        // categories.
        const items = [...document.querySelectorAll('[class*="library_filter-bar-item"]')]
            .filter(e => e.textContent.trim());
        const wrap = document.querySelector('[class*="library_tag-wrapper"]');
        if (!wrap) return {missing: true};
        const w = wrap.getBoundingClientRect();
        return {
            names: items.map(e => e.textContent.trim()),
            // Inside its own box, and inside the screen: a category the box
            // has cut off is a category that does not exist as far as anyone
            // reading the picker is concerned.
            shown: items.filter(e => {
                const b = e.getBoundingClientRect();
                return b.width > 0 && b.height > 0 &&
                    b.bottom <= w.bottom + 1 && b.right <= window.innerWidth + 1;
            }).length,
            rows: new Set(items.map(e => Math.round(e.getBoundingClientRect().y))).size
        };
    });

    results.push({size, bottom, picker});
    await ctx.close();
}

await browser.close();

const checks = [];
for (const {size, bottom, picker} of results) {
    checks.push([
        `at ${size}px text the run controls stay clear of the pane switcher`,
        bottom.overlap === 0, bottom
    ]);
    checks.push([
        `at ${size}px text the green flag is still on screen`,
        bottom.flagVisible === true, bottom
    ]);
    checks.push([
        `at ${size}px text every extension category is readable`,
        picker.names && picker.shown === picker.names.length && picker.names.length >= 5, picker
    ]);
}
checks.push(['no errors at any text size', errs.length === 0, errs]);

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra)}`);
    }
}
console.log(failed === 0 ? '\nlarger phone text working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
