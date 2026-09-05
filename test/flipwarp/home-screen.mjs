// Adding Flipwarp to a phone's home screen.
//
// What makes that possible is a manifest — a small file saying what the app is
// called, which icon to use, and that it should open without a browser bar
// around it. The site had one all along and never linked to it: the link was
// written only for a site at the root of a domain, and this one lives in a
// folder, so a phone was offered a bookmark rather than an app.
//
// Everything checked here is about the page a phone actually reads.
import fs from 'node:fs';
import path from 'node:path';
import {launchBrowser, SITE, repoPath} from './launch.mjs';

const build = repoPath('build');
const editor = fs.readFileSync(path.join(build, 'editor.html'), 'utf8');
const player = fs.readFileSync(path.join(build, 'index.html'), 'utf8');

const linkOn = html => {
    const match = /<link[^>]+rel="manifest"[^>]+href="([^"]+)"/.exec(html);
    return match ? match[1] : null;
};

const editorLink = linkOn(editor);
const playerLink = linkOn(player);

const manifestPath = path.join(build, 'manifest.webmanifest');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Every path inside a manifest is read relative to the manifest itself, which
// is what lets the same file work at the root of a domain and in a folder. A
// path starting with a slash would break the second case.
const relative = value => typeof value === 'string' && !value.startsWith('/') &&
    !value.startsWith('http');

const iconFiles = manifest.icons.map(icon => path.join(build, icon.src));
const missingIcons = iconFiles.filter(file => !fs.existsSync(file));
const maskable = manifest.icons.filter(icon => (icon.purpose || '').includes('maskable'));

// The page the icon opens has to be a page that exists.
const startsAt = path.join(build, manifest.start_url);

// And it has to work in a browser, not just on disk.
const browser = await launchBrowser();
const errs = [];
const ctx = await browser.newContext({viewport: {width: 460, height: 1000}, hasTouch: true});
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForTimeout(3000);
const fetched = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return {found: false};
    try {
        const response = await fetch(link.href);
        if (!response.ok) return {found: true, ok: false, status: response.status};
        const body = await response.json();
        return {found: true, ok: true, name: body.name, display: body.display};
    } catch (e) {
        return {found: true, ok: false, error: String(e).slice(0, 80)};
    }
});
await browser.close();

const checks = [
    ['the editor links a manifest', editorLink !== null, editorLink],
    ['so does the player page', playerLink !== null, playerLink],
    ['the manifest is where the link says', fs.existsSync(manifestPath)],
    ['the browser can actually load it', fetched.ok === true, fetched],
    ['it opens without a browser bar around it',
        manifest.display === 'standalone', manifest.display],
    ['it has a name to put under the icon',
        Boolean(manifest.name && manifest.short_name), manifest],
    ['every icon it names exists', missingIcons.length === 0, missingIcons],
    ['including one shaped for Android, which crops them',
        maskable.length > 0, manifest.icons],
    ['the icon opens a page that exists', fs.existsSync(startsAt), manifest.start_url],
    ['and nothing inside it is tied to the root of a domain',
        relative(manifest.start_url) && manifest.icons.every(icon => relative(icon.src)),
        manifest],
    ['the page raised no errors', errs.length === 0, errs]
];

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra)}`);
    }
}
console.log(failed === 0 ? '\nhome screen working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
