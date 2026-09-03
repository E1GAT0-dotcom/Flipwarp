// Checks the loading screen names what it is loading.
//
// Two halves. The first watches a real project open and samples the screen
// while it is up — that proves the wiring reaches the page. The second loads
// the same project again through the engine and collects every report, which
// is deterministic: sampling the screen cannot catch all twenty-two assets
// when a local file loads in a fraction of a second.
import fs from 'node:fs';
import { launchBrowser, repoPath, SITE } from './launch.mjs';

// A five-sprite, twenty-two-asset project, put where the served site can
// reach it. Keeping it as a fixture rather than building it here means this
// test measures the loading screen and not a project generator.
const PROJECT = repoPath('build', 'loading-test.sb3');
if (!fs.existsSync(PROJECT)) {
  fs.copyFileSync(repoPath('test', 'flipwarp', 'fixtures', 'loading-test.sb3'), PROJECT);
  process.on('exit', () => fs.rmSync(PROJECT, {force: true}));
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 160)));

const seen = [];
const watch = page.exposeFunction('flipwarpSample', s => seen.push(s));

await page.goto(
  `${SITE}/editor.html?project_url=${SITE}/loading-test.sb3`,
  { waitUntil: 'domcontentloaded' }
);
await watch;

await page.evaluate(() => {
  const tick = () => {
    const line = document.querySelector('[class*="loader_asset-line"]');
    const bar = document.querySelector('[class*="loader_bar-inner"]');
    const pct = document.querySelector('[class*="loader_bar-percent"]');
    if (line || bar) {
      window.flipwarpSample({
        text: line ? line.textContent : '',
        width: bar ? bar.style.width : '',
        percent: pct ? pct.textContent : ''
      });
    }
    if (document.querySelector('[class*="loader_background"]')) setTimeout(tick, 20);
  };
  tick();
});

await page.waitForSelector('text=Costumes', { timeout: 60000 });
await page.waitForTimeout(1000);

const after = await page.evaluate(() => ({
  loaderGone: !document.querySelector('[class*="loader_background"]'),
  sprites: [...document.querySelectorAll('[class*="sprite-selector-item_sprite-name"]')]
      .map(e => e.textContent.trim())
}));

// Now every report, from a load we can watch from the beginning.
const reports = await page.evaluate(async () => {
  const got = [];
  const listen = info => got.push(info);
  window.vm.on('FLIPWARP_ASSET', listen);
  const res = await fetch('/loading-test.sb3');
  await window.vm.loadProject(await res.arrayBuffer());
  window.vm.off('FLIPWARP_ASSET', listen);
  return got;
});

await browser.close();

const named = seen.filter(s => s.text && s.text.trim());
const withPercent = seen.filter(s => /^\d+%$/.test(s.percent || ''));
// The number and the fill come from the same figure, so they must agree.
const agrees = withPercent.every(s => {
  const shown = parseInt(s.percent, 10);
  const filled = Math.round(parseFloat(s.width) || 0);
  return Math.abs(shown - filled) <= 1;
});

const sprites = new Set(reports.map(r => r.sprite));
const last = reports[reports.length - 1];

const checks = [
  ['the screen said what it was loading', named.length > 0],
  ['the percentage was shown', withPercent.length > 0],
  ['the percentage matched the bar', agrees],
  ['the screen went away', after.loaderGone === true],
  ['the project actually opened', after.sprites.length >= 4],
  ['every asset was reported', reports.length === 22],
  ['each one named its sprite', reports.every(r => r.sprite)],
  ['each one named the asset', reports.every(r => r.name)],
  ['it covered every sprite', sprites.size === 5],
  ['costumes and sounds were told apart', reports.some(r => r.kind === 'costume') &&
      reports.some(r => r.kind === 'sound')],
  ['the names belong to their sprite', reports.every(r =>
      r.name.startsWith(r.sprite.toLowerCase()))],
  ['it counted up to the total', last && last.done === 22 && last.total === 22]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
console.log('sprites reported:', [...sprites].join(', '));
console.log('on screen:', named.slice(0, 3).map(s => `${s.percent} ${s.text}`).join(' | '));
for (const e of errs) console.log(e);
console.log(failed === 0 ? '\nloading screen working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
