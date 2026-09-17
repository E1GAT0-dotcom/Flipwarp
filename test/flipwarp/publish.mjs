// Publishing to Scratch, which is written but not yet proven.
//
// The half of it that talks to Scratch cannot be tested from here: that needs
// an account and a real project to write over. So it is out of the File menu
// until it has been tried by hand, and this checks two things.
//
// One, that it really is out of the menu, so nobody finds it by accident and
// discovers the untried half for us.
//
// Two, the things about the bookmarklet that can be checked without a Scratch
// account: that the program parses, that it refuses to do anything anywhere
// but Scratch, that it names only the addresses it is supposed to name, that
// it still asks before making a new project, which is the guard against the
// thing that gets accounts banned, and that it can open a project file itself.
// Those run here in plain Node, because the bookmarklet is a piece of text
// with nothing else attached to it.
import {launchBrowser, SITE} from './launch.mjs';
import {BOOKMARKLET_SOURCE} from '../../src/lib/flipwarp/bookmarklet-source.js';

const errs = [];

// --- the bookmarklet, checked without a browser ----------------------------
let parses = false;
try {
    // eslint-disable-next-line no-new-func
    new Function(BOOKMARKLET_SOURCE);
    parses = true;
} catch (e) {
    errs.push(`bookmarklet does not parse: ${e.message}`);
}

// Every address it is allowed to touch. Anything else in there would be it
// reaching somewhere it was not asked to reach.
const allowed = [
    'https://scratch.mit.edu/session/',
    'https://scratch.mit.edu/projects/',
    'https://projects.scratch.mit.edu/',
    'https://assets.scratch.mit.edu/',
    'https://api.scratch.mit.edu/projects/',
    'https://api.scratch.mit.edu/proxy/projects/'
];
const addresses = (BOOKMARKLET_SOURCE.match(/https?:\/\/[^'"\s+]+/g) || []);
const strays = addresses.filter(a => !allowed.some(ok => a.startsWith(ok)));

// --- and the menu, checked in one --------------------------------------
const browser = await launchBrowser();
const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 200)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
await page.waitForTimeout(2500);

let openedFile = false;
for (const el of await page.$$('[class*="menu-bar_menu-bar-item"]')) {
    if ((await el.textContent()).trim() === 'File') {
        await el.click();
        openedFile = true;
        break;
    }
}
await page.waitForTimeout(500);

const fileMenu = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[class*="menu_menu-item"]')];
    return {
        names: items.map(i => i.textContent.trim()),
        // The packager sits in the same section, so if that is gone the menu
        // itself broke and the absence below would mean nothing.
        hasPackager: items.some(i => /package project/i.test(i.textContent)),
        hasPublish: items.some(i => /publish to scratch/i.test(i.textContent))
    };
});

await browser.close();

const checks = [
    ['the File menu opens', openedFile && fileMenu.names.length > 3, fileMenu.names],
    ['Package project is still in it', fileMenu.hasPackager === true, fileMenu.names],
    ['and Publish to Scratch is not, while it is unfinished',
        fileMenu.hasPublish === false, fileMenu.names],
    ['the bookmarklet is valid JavaScript', parses === true, null],
    ['it refuses to run anywhere but Scratch',
        /scratch\.mit\.edu/.test(BOOKMARKLET_SOURCE) &&
        /hostname/.test(BOOKMARKLET_SOURCE), null],
    ['it reaches nowhere it was not asked to', strays.length === 0, {addresses, strays}],
    ['it asks before making a new project',
        /confirm\(/.test(BOOKMARKLET_SOURCE) && /banned/i.test(BOOKMARKLET_SOURCE), null],
    ['it can open a project file itself',
        /DecompressionStream/.test(BOOKMARKLET_SOURCE) &&
        /0x06054b50/.test(BOOKMARKLET_SOURCE), null],
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
console.log(failed === 0 ? '\npublishing is put away' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
