// The rest of the editor on a phone: the menu bar, the costume and sound
// tabs, the extension picker, and the bar along the bottom.
//
// Most of these are one bug with several faces — something was given a fixed
// width or a fixed height that a phone does not have — and the one worth
// keeping a test on is the menu bar, because its failure was so misleading. A
// bar that scrolls sideways has to clip what overflows it, and what overflows
// a menu bar is its menus: File, Edit and Settings opened perfectly and were
// clipped to nothing, while Addons and Advanced worked because they are
// buttons with nothing to drop down.
import {launchBrowser, SITE} from './launch.mjs';

const PHONE = {width: 460, height: 1000};

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: PHONE, hasTouch: true});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('.blocklySvg', {timeout: 90000});
await page.waitForTimeout(4000);

const cdp = await ctx.newCDPSession(page);
const finger = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{x, y, id: 1}]
});
const tap = async (x, y) => {
    await finger('touchStart', x, y);
    await finger('touchEnd', x, y);
    await page.waitForTimeout(1000);
};
const tapOn = async selector => {
    const handle = await page.$(selector);
    if (!handle) throw new Error(`nothing matched ${selector}`);
    const box = await handle.boundingBox();
    await tap(box.x + (box.width / 2), box.y + (box.height / 2));
};
const overflow = () => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

// The three tabs, by position. Matching them by their words picks up the whole
// panel underneath as well, because it contains the words too.
const TABS = {code: 0, costumes: 1, sounds: 2};
const openTab = async which => {
    const tabs = await page.$$('[class*="gui_tab_"]');
    const box = await tabs[TABS[which]].boundingBox();
    await tap(box.x + (box.width / 2), box.y + (box.height / 2));
    await page.waitForTimeout(1800);
};

// --- the menu bar ---------------------------------------------------------
const barRows = await page.evaluate(() => {
    const bar = document.querySelector('[class*="menu-bar_menu-bar_"]');
    return Math.round(bar.getBoundingClientRect().height);
});
const barOverflow = await overflow();

// A menu has to be visible, not merely present: the bug was that it was there
// all along, clipped by an ancestor to a strip of nothing.
const menuIsVisible = async name => {
    const item = await page.$(`[class*="menu-bar_menu-bar-item"]:has-text("${name}")`);
    const box = await item.boundingBox();
    await tap(box.x + (box.width / 2), box.y + (box.height / 2));
    const seen = await page.evaluate(() => {
        const menu = document.querySelector('[class*="menu_menu_"]');
        if (!menu) return {open: false};
        const rect = menu.getBoundingClientRect();
        let parent = menu.parentElement;
        while (parent && parent !== document.body) {
            const style = getComputedStyle(parent);
            const clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
            if (clips) {
                const box2 = parent.getBoundingClientRect();
                // Clipped away if the menu needs more room than the thing
                // holding it is willing to show.
                if (rect.bottom > box2.bottom + 1) return {open: true, clipped: true};
            }
            parent = parent.parentElement;
        }
        return {open: true, clipped: false, height: Math.round(rect.height)};
    });
    // Put it away again, and make sure it went: a menu left open swallows the
    // next tap and the failure lands somewhere unrelated.
    await page.keyboard.press('Escape');
    await tap(430, 760);
    await page.waitForTimeout(600);
    return seen;
};

// --- the costume tab ------------------------------------------------------
await openTab('costumes');
const costumeOverflow = await overflow();
const paintFits = await page.evaluate(() => {
    const canvas = document.querySelector('[class*="paint-editor_canvas-container"]');
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    return Math.round(box.right) <= window.innerWidth + 1;
});
const listWidth = () => page.evaluate(() => {
    const list = document.querySelector('[class*="asset-panel_selector"]');
    return list ? Math.round(list.getBoundingClientRect().width) : -1;
});
const listOpen = await listWidth();
await tapOn('[class*="asset-panel_handle"]');
const listShut = await listWidth();

// --- the bottom bar names the tab you are in ------------------------------
const barLabel = () => page.evaluate(() => {
    const button = document.querySelector('[class*="pane-switcher_pane_"]');
    return button ? button.textContent : null;
});
const labelOnCostumes = await barLabel();
await openTab('sounds');
const labelOnSounds = await barLabel();
// Folding the list is remembered across the two tabs, which are different
// copies of the same panel.
const listStillShut = await listWidth();
await openTab('code');
const labelOnCode = await barLabel();

// --- the run controls live in the bottom bar ------------------------------
// Pinned in from above the stage rather than rebuilt, so there is one of each
// in the page — which is what lets the pause button, added by an addon to
// whichever strip it finds first, end up in the right place.
const inTheBar = await page.evaluate(() => {
    const bar = document.querySelector('[class*="pane-switcher_bar"]');
    const strip = document.querySelector('[class*="controls_controls-container"]');
    if (!bar || !strip) return null;
    const barBox = bar.getBoundingClientRect();
    const box = strip.getBoundingClientRect();
    const inside = box.top >= barBox.top - 2 && box.bottom <= barBox.bottom + 2;
    const middle = {x: box.x + 12, y: box.y + (box.height / 2)};
    const onTop = document.elementFromPoint(middle.x, middle.y);
    return {
        inside,
        strips: document.querySelectorAll('[class*="controls_controls-container"]').length,
        flags: document.querySelectorAll('[class*="green-flag_green-flag"]').length,
        // Painted, not merely positioned: the bar sits in a different stacking
        // context, so an opaque bar hides these however high their z-index.
        reachable: Boolean(onTop && onTop.closest('[class*="controls_controls-container"]'))
    };
});

// --- the extension picker -------------------------------------------------
await tapOn('[class*="gui_extension-button"]');
await page.waitForTimeout(2500);
const library = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[class*="library_filter-bar-item"]')]
        .map(e => e.textContent.trim())
        .filter(Boolean);
    const cards = [...document.querySelectorAll('[class*="library-item_featured-item"]')]
        .slice(0, 4)
        .map(e => {
            const box = e.getBoundingClientRect();
            return {x: Math.round(box.x), y: Math.round(box.y)};
        });
    const switcher = document.querySelector('[class*="pane-switcher_bar"]');
    return {
        tabs,
        perRow: cards.length > 1 ? cards.filter(c => c.y === cards[0].y).length : 0,
        switcherShowing: switcher ? getComputedStyle(switcher).display !== 'none' : false
    };
});

// --- the menus themselves, last, because an open menu swallows the next tap -
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await openTab('code');
const fileMenu = await menuIsVisible('File');
const settingsMenu = await menuIsVisible('Settings');


await page.screenshot({path: '/tmp/phone-panels.png'});
await browser.close();

const checks = [
    ['the menu bar wraps rather than scrolling', barRows > 60 && barRows < 100, barRows],
    ['and nothing runs off the side', barOverflow === 0, barOverflow],
    ['the File menu opens', fileMenu.open === true, fileMenu],
    ['and is not clipped away', fileMenu.clipped === false, fileMenu],
    ['the Settings menu opens too', settingsMenu.open === true, settingsMenu],
    ['and is not clipped away either', settingsMenu.clipped === false, settingsMenu],
    ['the costume tab fits the screen', costumeOverflow === 0, costumeOverflow],
    ['and so does the paint canvas', paintFits === true, paintFits],
    ['the costume list can be folded away', listOpen > 40 && listShut === 0,
        {listOpen, listShut}],
    ['and stays folded on the sounds tab', listStillShut === 0, listStillShut],
    ['the bottom bar names the tab you are in',
        labelOnCostumes === 'Costumes' && labelOnSounds === 'Sounds' && labelOnCode === 'Blocks',
        {labelOnCostumes, labelOnSounds, labelOnCode}],
    ['the run controls sit in the bottom bar', inTheBar && inTheBar.inside, inTheBar],
    ['there is only one of them in the page',
        inTheBar && inTheBar.strips === 1 && inTheBar.flags === 1, inTheBar],
    ['and they can actually be pressed', inTheBar && inTheBar.reachable, inTheBar],
    ['the extension picker shows every category, not just All',
        library.tabs.length >= 3, library.tabs],
    ['with Flipwarp\'s own last, after the editors it is built on',
        library.tabs[library.tabs.length - 1] === 'Flipwarp', library.tabs],
    ['and fits more than one extension to a row', library.perRow >= 2, library],
    ['the bottom bar gets out of the way of a dialog',
        library.switcherShowing === false, library],
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
console.log(failed === 0 ? '\nphone panels working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
