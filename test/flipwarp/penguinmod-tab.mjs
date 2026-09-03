// Checks the PenguinMod tab: that it appears, lists what is in the site's own
// penguinmod folder, and loads one without asking the user's permission —
// because a file served from the same site as the editor is not a stranger.
import { launchBrowser, repoPath, SITE } from './launch.mjs';
import fs from 'node:fs';

// Put a known two-extension folder in place of whatever the build is carrying,
// so this test says the same thing whichever bundle is shipped, and put the
// real one back afterwards.
const BUNDLE = repoPath('build/penguinmod');
const KEEP = repoPath('build/penguinmod.real');
const FIXTURES = repoPath('test/flipwarp/fixtures/Test');
if (fs.existsSync(BUNDLE)) fs.renameSync(BUNDLE, KEEP);
fs.mkdirSync(`${BUNDLE}/Test`, { recursive: true });
for (const f of ['batch2.js', 'shapes.js']) fs.copyFileSync(`${FIXTURES}/${f}`, `${BUNDLE}/Test/${f}`);
fs.writeFileSync(`${BUNDLE}/extensions.json`, JSON.stringify([
  {name: 'Batch Two', description: 'gui, serializers, extension manager', code: 'Test/batch2.js',
      creator: 'Someone', image: null, tags: []},
  {name: 'Shapes', description: 'penguinmod shapes', code: 'Test/shapes.js',
      creator: 'Someone Else', image: null, tags: []}
], null, 2));
const restore = () => {
  fs.rmSync(BUNDLE, { recursive: true, force: true });
  if (fs.existsSync(KEEP)) fs.renameSync(KEEP, BUNDLE);
};
process.on('exit', restore);

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
const dialogs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 160)));
// These extensions are marked as not working on the Scratch website, so the
// editor asks before enabling one — the same question it asks for TurboWarp's.
// Say yes, and record that it was asked.
page.on('dialog', async d => {
    dialogs.push(d.message().slice(0, 120));
    await d.accept();
});

await page.goto(`${SITE}/editor.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Costumes', { timeout: 60000 });
await page.waitForTimeout(2500);

// Open the extension picker from the button at the bottom of the palette.
await page.click('[class*="add-extension-button"], [class*="extension-button"]');
await page.waitForSelector('text=Choose an Extension', { timeout: 20000 });
await page.waitForTimeout(1200);

const tabNames = await page.$$eval('[class*="filter-bar"] [class*="tag-button"], [class*="tagWrapper"] [class*="tag"]',
    els => els.map(e => e.textContent.trim()));

// The All tab has to include them too, mixed in with everything else.
const onAllTab = await page.$$eval('[class*="library-item_library-item-name"]',
    els => els.map(e => e.textContent.trim()));

await page.click('text=PenguinMod');
await page.waitForTimeout(800);

const shown = await page.$$eval('[class*="library-item_library-item-name"]',
    els => els.map(e => e.textContent.trim()));
const banner = await page.$eval('[class*="tag-banner"]', e => e.textContent.trim()).catch(() => '');
await page.screenshot({ path: repoPath('shot-pm-tab-open.png') });

// Loading one should not raise the "a project wants to load an extension"
// dialog, and should end with the extension really loaded.
await page.click('text=Batch Two');
await page.waitForTimeout(3000);

const after = await page.evaluate(() => ({
  loaded: window.vm.extensionManager.isExtensionLoaded('batch2'),
  askedPermission: !!document.querySelector('[class*="security-manager"]'),
  penLoadedToo: window.vm.extensionManager.isExtensionLoaded('pen')
}));

await page.screenshot({ path: repoPath('shot-pm-tab.png') });
await browser.close();

const checks = [
  ['a PenguinMod tab exists', tabNames.some(t => /PenguinMod/i.test(t))],
  ['the tab lists the bundled extensions', shown.includes('Batch Two') && shown.includes('Shapes')],
  ['they are on the All tab as well', onAllTab.includes('Batch Two') && onAllTab.includes('Shapes')],
  ['the tab explains what these are', /made by PenguinMod/i.test(banner)],
  ['the tab offers PenguinMod\'s own editor', /Open PenguinMod/i.test(banner)],
  ['choosing one loads it', after.loaded === true],
  ['it did not ask permission for our own site', after.askedPermission === false],
  ['an extension it depends on loaded too', after.penLoadedToo === true],
  ['it warned that it will not work on Scratch', dialogs.some(d => /incompatible with Scratch/i.test(d))]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
console.log('tabs:', tabNames.join(', '));
console.log('listed:', shown.join(', '));
for (const e of errs) console.log(e);
console.log(failed === 0 ? '\nPenguinMod tab working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
