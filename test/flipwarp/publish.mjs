// Publishing to Scratch, as far as this side of the fence goes.
//
// What can be tested here is everything Flipwarp does: the dialog, the file it
// saves, the ticket it puts on the clipboard, and the number it remembers so
// that publishing the same project twice can offer to go over the top of the
// first one.
//
// What cannot be tested here is the bookmarklet's three calls to Scratch,
// because testing those means a Scratch account and a real project to write
// to. So the bookmarklet is checked for the things that can be checked without
// one: that it is a valid bookmark address, that the program inside it parses,
// that it refuses to do anything anywhere but Scratch, and that it names only
// the endpoints it is supposed to name.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({
    viewport: {width: 1280, height: 900},
    permissions: ['clipboard-read', 'clipboard-write']
});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 200)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
await page.waitForTimeout(2500);

// --- it is in the File menu ----------------------------------------------
const openFile = async () => {
    const items = await page.$$('[class*="menu-bar_menu-bar-item"]');
    for (const el of items) {
        if ((await el.textContent()).trim() === 'File') {
            await el.click();
            return true;
        }
    }
    return false;
};
const inTheMenu = await openFile();
await page.waitForTimeout(400);
let opened = false;
for (const el of await page.$$('[class*="menu_menu-item"]')) {
    if (/publish to scratch/i.test((await el.textContent()) || '')) {
        await el.click();
        opened = true;
        break;
    }
}
await page.waitForTimeout(700);

const dialog = await page.evaluate(() => {
    const body = document.querySelector('[class*="publish-modal_body"]');
    if (!body) return null;
    return {
        showing: true,
        // A dialog with no background of its own shows the blocks through it,
        // which is the bug the packaging dialog had.
        paint: getComputedStyle(body).backgroundColor,
        fields: [...body.querySelectorAll('input, textarea')].length,
        // Off unless asked for. Sharing something publicly is not a default.
        shareTicked: [...body.querySelectorAll('input[type=checkbox]')].some(i => i.checked)
    };
});

// --- filling it in and pressing the button --------------------------------
await page.evaluate(() => {
    const body = document.querySelector('[class*="publish-modal_body"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const areaSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
    const title = body.querySelector('input[type=text]');
    setter.call(title, 'Ice Drifter V4');
    title.dispatchEvent(new Event('input', {bubbles: true}));
    const notes = body.querySelector('textarea');
    areaSetter.call(notes, 'Arrow keys to drift.');
    notes.dispatchEvent(new Event('input', {bubbles: true}));
});
await page.waitForTimeout(300);

const buttons = await page.$$('[class*="publish-modal_go"]');
await buttons[0].click();
// Saving the project and reading it back takes a moment.
await page.waitForFunction(
    () => {
        const body = document.querySelector('[class*="publish-modal_body"]');
        return Boolean(body && body.querySelector('a[download]'));
    },
    {timeout: 60000}
);

const ready = await page.evaluate(async () => {
    const body = document.querySelector('[class*="publish-modal_body"]');
    const link = body.querySelector('a[download]');
    const file = await fetch(link.href).then(r => r.arrayBuffer());
    let ticket = null;
    try {
        ticket = JSON.parse(await navigator.clipboard.readText());
    } catch (e) {
        ticket = {unreadable: String(e).slice(0, 60)};
    }
    return {
        name: link.getAttribute('download'),
        // A real project, not an empty file: an .sb3 is a zip, so it starts
        // with the two letters every zip starts with.
        looksLikeAProject: file.byteLength > 1000 &&
            String.fromCharCode(...new Uint8Array(file.slice(0, 2))) === 'PK',
        size: file.byteLength,
        ticket
    };
});

// --- the number it remembers ----------------------------------------------
const remembered = await page.evaluate(() => {
    const raw = localStorage.getItem('flipwarp:scratch-projects');
    return raw ? JSON.parse(raw) : null;
});

// --- the bookmarklet ------------------------------------------------------
const mark = await page.evaluate(async () => {
    const body = document.querySelector('[class*="publish-modal_body"]');
    const quiet = [...body.querySelectorAll('[class*="publish-modal_quiet"]')];
    const copyIt = quiet.find(b => /bookmarklet/i.test(b.textContent));
    copyIt.click();
    await new Promise(resolve => setTimeout(resolve, 400));
    const text = await navigator.clipboard.readText();
    return {
        text,
        isBookmarklet: text.startsWith('javascript:'),
        source: decodeURIComponent(text.slice('javascript:'.length))
    };
});

let parses = false;
try {
    // eslint-disable-next-line no-new-func
    new Function(mark.source);
    parses = true;
} catch (e) {
    errs.push(`bookmarklet does not parse: ${e.message}`);
}

await browser.close();

// Every address the bookmarklet is allowed to touch. Anything else in there
// would be it reaching somewhere it was not asked to reach.
const allowed = [
    'https://scratch.mit.edu/session/',
    'https://api.scratch.mit.edu/projects/',
    'https://api.scratch.mit.edu/proxy/projects/'
];
const addresses = (mark.source.match(/https?:\/\/[^'"\s+]+/g) || []);
const strays = addresses.filter(a => !allowed.some(ok => a.startsWith(ok)));

const checks = [
    ['Publish to Scratch is in the File menu', inTheMenu && opened, {inTheMenu, opened}],
    ['the dialog opens', dialog && dialog.showing === true, dialog],
    ['and is not see-through',
        dialog && /^rgb\(/.test(dialog.paint), dialog],
    ['sharing is off unless it is asked for',
        dialog && dialog.shareTicked === false, dialog],
    ['it saves the project as a file named after the title',
        ready.name === 'Ice Drifter V4.sb3', ready],
    ['and the file is a real project',
        ready.looksLikeAProject === true, {size: ready.size}],
    ['the title and notes go on the clipboard',
        ready.ticket && ready.ticket.title === 'Ice Drifter V4' &&
        ready.ticket.instructions === 'Arrow keys to drift.', ready.ticket],
    ['and sharing is written down as a no',
        ready.ticket && ready.ticket.share === false, ready.ticket],
    ['nothing is remembered for a project going somewhere new',
        remembered === null || Object.values(remembered).every(v => v === ''),
        remembered],
    ['the bookmarklet is a bookmark address',
        mark.isBookmarklet === true, {starts: mark.text.slice(0, 30)}],
    ['the program inside it is valid JavaScript', parses === true, null],
    ['it refuses to run anywhere but Scratch',
        /scratch\.mit\.edu/.test(mark.source) && /hostname/.test(mark.source), null],
    ['and it reaches nowhere it was not asked to',
        strays.length === 0, {addresses, strays}],
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
console.log(failed === 0 ? '\npublishing working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
