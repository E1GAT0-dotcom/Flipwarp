// Checks the thumbnails download: that it finds pictures in the images folder
// rather than beside the code, packs no program files at all, and writes a
// list that names the pictures it actually got.
import { launchBrowser, repoPath, SITE } from './launch.mjs';
import { writeFixture } from './fixture.mjs';
import { execSync } from 'node:child_process';

writeFixture();

const b = await launchBrowser();
const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 900 } });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 140)));

await p.goto(`${SITE}/flipwarp-check.html`, { waitUntil: 'domcontentloaded' });
await p.fill('#listUrl', `${SITE}/fake-list.js`);
await p.fill('#baseUrl', `${SITE}/`);
await p.click('#run');
await p.waitForFunction(() => document.getElementById('phase').textContent === 'done', { timeout: 90000 });

const dl = p.waitForEvent('download', { timeout: 60000 });
await p.click('#bundleImages');
const download = await dl;
const path = '/tmp/thumbs.zip';
await download.saveAs(path);
const status = await p.$eval('#bundleStatus', e => e.textContent);
await b.close();

const listing = execSync(`unzip -Z1 ${path}`).toString().trim().split('\n');
const manifest = JSON.parse(execSync(`unzip -p ${path} penguinmod/extensions.json`).toString());
const withPicture = manifest.filter(e => e.image);

const checks = [
  ['downloaded as its own zip', download.suggestedFilename() === 'flipwarp-penguinmod-thumbnails.zip'],
  ['holds no program files', !listing.some(n => n.endsWith('.js'))],
  ['found the picture under images/', listing.includes('penguinmod/images/Test/icon.svg')],
  ['carries the list', listing.includes('penguinmod/extensions.json')],
  ['says where it goes', listing.includes('WHERE-THIS-GOES.txt')],
  ['the list names the picture it got', withPicture.length === 1 && withPicture[0].image === 'images/Test/icon.svg'],
  ['a missing picture leaves the entry without one', manifest.some(e => e.name === 'Uses PM Shapes' && !e.image)],
  // Everything from the registry, including the one whose file is missing —
  // the thumbnails zip does not decide which extensions exist.
  ['every extension is still listed', manifest.length === 7]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
console.log('status:', status);
console.log(failed === 0 ? '\nthumbnails download working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
