// The menus that hang off the bar along the top.
//
// An accent colour is meant to tint that bar — that is the whole point of
// picking one. The menus were taking their colour from the same place, which
// is fine while the accent is a shade of blue and the page is white, and
// obviously wrong the moment either of those changes: on the dark theme with
// the rainbow accent, the bar was a rainbow and every dropdown over the dark
// page was flat red.
//
// So the menus have their own colour now. The light theme sets it to the same
// value the bar uses, because that is how it has always looked and nobody
// asked for that to change; the dark theme sets it to the dark theme's own
// panel colour, and the accent no longer reaches it.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];

const read = async theme => {
    const ctx = await browser.newContext({viewport: {width: 1280, height: 800}});
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`PAGEERROR ${JSON.stringify(theme)}: ${e.message.slice(0, 160)}`));
    await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
    await page.evaluate(t => {
        localStorage.setItem('flipwarp:theme', JSON.stringify(t));
    }, theme);
    await page.reload({waitUntil: 'domcontentloaded'});
    await page.waitForSelector('[class*="menu-bar_menu-bar"]', {timeout: 60000});
    await page.waitForTimeout(2500);

    // Open Settings, which is a real dropdown rather than a button.
    await page.evaluate(() => {
        const item = [...document.querySelectorAll('[class*="menu-bar_menu-bar-item"]')]
            .find(e => /settings/i.test(e.textContent));
        if (item) item.click();
    });
    await page.waitForTimeout(600);

    const out = await page.evaluate(() => {
        const bar = document.querySelector('[class*="menu-bar_menu-bar"]');
        const menu = document.querySelector('[class*="menu_menu"]');
        const paint = e => (e ? getComputedStyle(e).backgroundColor : null);
        return {
            barBg: paint(bar),
            menuBg: paint(menu),
            menuOpen: Boolean(menu && menu.getBoundingClientRect().height > 20)
        };
    });
    await ctx.close();
    return out;
};

// How dark a colour is, roughly. Enough to tell a near-black panel from a
// bright red one without pinning the test to an exact hex that a future
// palette tweak would break.
const brightness = css => {
    const n = (css || '').match(/\d+/g);
    if (!n || n.length < 3) return null;
    return (Number(n[0]) * 0.299) + (Number(n[1]) * 0.587) + (Number(n[2]) * 0.114);
};

const darkRainbow = await read({gui: 'dark', accent: 'rainbow'});
const darkRed = await read({gui: 'dark', accent: 'red'});
const lightPlain = await read({gui: 'light', accent: 'blue'});

await browser.close();

const checks = [
    ['the Settings menu opens at all', darkRainbow.menuOpen === true, darkRainbow],
    ['on the dark theme the menu is dark, whatever the accent',
        brightness(darkRainbow.menuBg) < 60, darkRainbow],
    ['a red accent does not make the menus red either',
        brightness(darkRed.menuBg) < 60, darkRed],
    ['and the bar still wears the accent',
        brightness(darkRed.barBg) > brightness(darkRed.menuBg) + 40, darkRed],
    ['the light theme is left exactly as it was',
        lightPlain.menuBg === lightPlain.barBg, lightPlain],
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
console.log(failed === 0 ? '\nmenu colour working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
