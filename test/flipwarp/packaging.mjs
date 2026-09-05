// Packaging a project from inside the editor.
//
// The point of the check at the end is that the file this produces is opened
// in a browser and the project inside it actually runs. Everything up to that
// — a dialog appears, a button is pressed, a blob comes back — could pass
// while producing a file that does nothing, which is the only failure that
// would matter to anybody.
import fs from 'node:fs';
import {launchBrowser, SITE, repoPath} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: {width: 1280, height: 900}});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 200)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
await page.waitForTimeout(2500);

// --- the settings it copies rather than asks about ------------------------
// Changed first, so that finding them in the packaged project proves they
// were carried across rather than being the defaults on both sides.
await page.evaluate(() => {
    window.vm.setFramerate(45);
    window.vm.setRuntimeOptions({maxClones: Infinity, fencing: false});
});
await page.waitForTimeout(400);

// --- opening it -----------------------------------------------------------
const openMenu = async name => {
    const item = await page.$$(`[class*="menu-bar_menu-bar-item"]`);
    for (const el of item) {
        const text = (await el.textContent()).trim();
        if (text === name) {
            await el.click();
            return true;
        }
    }
    return false;
};
const openedFile = await openMenu('File');
await page.waitForTimeout(400);
const packageItem = await page.$$('[class*="menu_menu-item"]');
let clicked = false;
for (const el of packageItem) {
    if (/package/i.test((await el.textContent()) || '')) {
        await el.click();
        clicked = true;
        break;
    }
}
await page.waitForTimeout(600);

const dialogShowing = await page.evaluate(() =>
    Boolean(document.querySelector('[class*="package-modal_body"]')));

// --- making a web page ----------------------------------------------------
await page.evaluate(() => {
    const input = document.querySelector('[class*="package-modal_text"]');
    if (input) {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'Test Package');
        input.dispatchEvent(new Event('input', {bubbles: true}));
    }
});

const goButton = await page.$('[class*="package-modal_go"]');
await goButton.click();

// Packaging fetches several megabytes of runtime and compresses the project,
// so this waits on the outcome rather than on a fixed delay.
await page.waitForFunction(
    () => Boolean(document.querySelector('a[class*="package-modal_go"]')) ||
        Boolean(document.querySelector('[class*="package-modal_error"]')),
    {timeout: 180000}
);

const outcome = await page.evaluate(() => {
    const link = document.querySelector('a[class*="package-modal_go"]');
    const error = document.querySelector('[class*="package-modal_error"]');
    return {
        made: Boolean(link),
        name: link ? link.getAttribute('download') : null,
        said: link ? link.textContent.trim() : null,
        error: error ? error.textContent.trim() : null
    };
});

// The file itself, fetched back out of the blob the link points at.
const html = outcome.made ? await page.evaluate(async () => {
    const link = document.querySelector('a[class*="package-modal_go"]');
    const response = await fetch(link.href);
    return response.text();
}) : null;

// --- does it run? ---------------------------------------------------------
// Written into the built site so it can be opened over http: a packaged
// project asks for things a file:// page is not allowed to have.
let ranByItself = null;
let packagedErrors = [];
if (html) {
    const where = repoPath('build', 'flipwarp-packaging-test.html');
    fs.writeFileSync(where, html);
    try {
        const played = await ctx.newPage();
        played.on('pageerror', e => packagedErrors.push(e.message.slice(0, 200)));
        await played.goto(`${SITE}/flipwarp-packaging-test.html`, {waitUntil: 'domcontentloaded'});
        await played.waitForTimeout(6000);
        ranByItself = await played.evaluate(() => {
            const canvas = document.querySelector('canvas');
            return {
                hasCanvas: Boolean(canvas),
                drawn: canvas ? canvas.width > 0 && canvas.height > 0 : false,
                title: document.title,
                // The green flag the dialog asks for when the project is not
                // set to start on its own.
                hasControls: Boolean(document.querySelector('[class*="control"], .control-button'))
            };
        });
        await played.close();
    } finally {
        if (process.env.FLIPWARP_KEEP_PACKAGE) console.log(`kept: ${where}`);
        else fs.unlinkSync(where);
    }
}

// What the packaged file was told about how the project runs. Read out of the
// file rather than from the packager, because what ends up in the file is the
// only thing that matters.
// The packager writes these as the JavaScript that sets them up, not as
// JSON, so this looks for the calls rather than for quoted keys.
const carried = html ? {
    framerate: /setFramerate\(45\)/.test(html),
    infiniteClones: /maxClones:\s*Infinity/.test(html),
    fencingOff: /fencing:\s*false/.test(html)
} : null;

await browser.close();

const checks = [
    ['the File menu opens', openedFile === true, openedFile],
    ['Package project is in it', clicked === true, clicked],
    ['and opens Flipwarp\'s own dialog, not the packager website',
        dialogShowing === true, dialogShowing],
    ['it makes a file', outcome.made === true, outcome],
    ['named after what you called it', outcome.name === 'Test Package.html', outcome],
    ['and says how big it is', /MB/.test(outcome.said || ''), outcome],
    ['the file is a web page', Boolean(html && /^\s*<!DOCTYPE html>/i.test(html)), {
        starts: html ? html.slice(0, 40) : null
    }],
    ['with the whole project inside it', Boolean(html && html.length > 100000), {
        size: html ? html.length : 0
    }],
    ['it opens and draws', ranByItself && ranByItself.hasCanvas && ranByItself.drawn,
        ranByItself],
    ['under the name you gave it', ranByItself && ranByItself.title === 'Test Package',
        ranByItself],
    ['and raises no errors of its own', packagedErrors.length === 0, packagedErrors],
    ['the framerate came from the project, not a default',
        carried && carried.framerate === true, carried],
    ['and so did the clone limit and the fencing',
        carried && carried.fencingOff === true && carried.infiniteClones === true, carried],
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
console.log(failed === 0 ? '\npackaging working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
