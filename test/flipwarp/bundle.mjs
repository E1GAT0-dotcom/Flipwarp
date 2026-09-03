import { launchBrowser, repoPath, SITE } from './launch.mjs';
const b = await launchBrowser();
const ctx = await b.newContext({ acceptDownloads: true, viewport: {width:1200,height:900} });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0,140)));
await p.goto(`${SITE}/flipwarp-check.html`, { waitUntil: 'domcontentloaded' });
await p.fill('#listUrl', `${SITE}/fake-list.js`);
await p.fill('#baseUrl', `${SITE}/`);
await p.click('#run');
await p.waitForFunction(() => document.getElementById('phase').textContent === 'done', { timeout: 90000 });
const rows = await p.$$eval('#results tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.textContent.trim())));
rows.forEach(r => console.log(' ', r.slice(0,3).join(' | ')));

const dl = p.waitForEvent('download', { timeout: 60000 });
await p.click('#bundle');
const download = await dl;
const path = '/tmp/bundle.zip';
await download.saveAs(path);
console.log('zip saved as:', download.suggestedFilename());
console.log('status:', await p.$eval('#bundleStatus', e => e.textContent));
await b.close();

// The zip has to unpack straight into a site: a penguinmod folder with the
// files inside it, and the list the editor's PenguinMod tab reads.
import { execSync } from 'node:child_process';
const listing = execSync(`unzip -Z1 ${path}`).toString().trim().split('\n');
const need = [
  ['unpacks as a penguinmod folder', listing.every(n => n === 'WHERE-THIS-GOES.txt' || n.startsWith('penguinmod/'))],
  ['carries the list the editor reads', listing.includes('penguinmod/extensions.json')],
  ['carries the credits', listing.includes('penguinmod/CREDITS.txt')],
  ['says where it goes', listing.includes('WHERE-THIS-GOES.txt')],
  ['carries the extension files', listing.some(n => n.startsWith('penguinmod/Test/'))]
];
let failed = 0;
for (const [name, ok] of need) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const manifest = JSON.parse(execSync(`unzip -p ${path} penguinmod/extensions.json`).toString());
console.log(`manifest lists ${manifest.length}, first: ${manifest[0] && manifest[0].name}`);
process.exit(failed === 0 ? 0 : 1);
