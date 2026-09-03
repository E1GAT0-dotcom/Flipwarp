// Drives the built editor in a real browser: loads a project that uses core
// and extension blocks, flips to text, edits it, flips back, and checks the
// blocks that come back are the ones the text described.
import { launchBrowser, repoPath, SITE } from './launch.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (t.includes('ERR_TUNNEL') || t.includes('Failed to load resource')) return; // sandbox has no CDN
  errs.push(t.slice(0, 140));
});

await page.goto(`${SITE}/editor.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Costumes', { timeout: 60000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'shot-default.png' });
console.log('default project loaded');

const loaded = await page.evaluate(async () => {
  const vm = window.vm;
  const p = {
    targets: [
      { isStage: true, name: 'Stage', variables: { v1: ['score', 0] }, lists: {}, broadcasts: {},
        blocks: {}, comments: {}, currentCostume: 0,
        costumes: [{ name: 'backdrop1', dataFormat: 'svg', assetId: 'cd21514d0531fdffb22204e0ec5ed84a', md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg', rotationCenterX: 240, rotationCenterY: 180 }],
        sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null },
      { isStage: false, name: 'Sprite1', variables: {}, lists: {}, broadcasts: {},
        blocks: {
          a: { opcode: 'event_whenflagclicked', next: 'b', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 60, y: 60 },
          b: { opcode: 'pen_penDown', next: 'c', parent: 'a', inputs: {}, fields: {}, shadow: false, topLevel: false },
          c: { opcode: 'motion_movesteps', next: 'd', parent: 'b', inputs: { STEPS: [1, [4, '10']] }, fields: {}, shadow: false, topLevel: false },
          d: { opcode: 'data_setvariableto', next: null, parent: 'c', inputs: { VALUE: [1, [10, '5']] }, fields: { VARIABLE: ['score', 'v1'] }, shadow: false, topLevel: false }
        },
        comments: {}, currentCostume: 0,
        costumes: [{ name: 'costume1', dataFormat: 'svg', assetId: 'bcf454acf82e4504149f7ffe07081dbc', md5ext: 'bcf454acf82e4504149f7ffe07081dbc.svg', rotationCenterX: 48, rotationCenterY: 50 }],
        sounds: [], volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around' }
    ], monitors: [], extensions: ['pen'], meta: { semver: '3.0.0', vm: '11.0.0', agent: 'flipwarp test' }
  };
  await vm.loadProject(JSON.stringify(p));
  return 'ok';
});
console.log('test project with a pen block:', loaded);
await page.waitForTimeout(2500);

await page.click('button[aria-pressed]');
await page.waitForTimeout(1200);
const text = await page.$eval('textarea', t => t.value);
console.log('--- as text ---\n' + text);
await page.screenshot({ path: 'shot-text.png' });

// Edit, then flip back with the SAME button.
await page.fill('textarea', text.replace('move(10);', 'move(25);\n  pen.setPenSizeTo(7);'));
await page.click('button[aria-pressed]');
await page.waitForTimeout(3000);
await page.screenshot({ path: 'shot-applied.png' });

const after = await page.evaluate(() => {
  const t = window.vm.runtime.targets.filter(x => !x.isStage)[0];
  return Object.values(t.blocks._blocks).map(b => b.opcode).sort().join(', ');
});
console.log('blocks after flipping back:', after);

// A refusal must keep the panel open rather than throwing the edit away.
await page.click('button[aria-pressed]');
await page.waitForTimeout(900);
const t2 = await page.$eval('textarea', t => t.value);
await page.fill('textarea', t2 + '\n@at(0, 400)\nwhenGreenFlagClicked {\n  // nope\n}\n');
await page.click('button[aria-pressed]');
await page.waitForTimeout(1200);
const stillOpen = await page.$('textarea') !== null;
// TurboWarp keeps its crash-screen markup in the DOM at all times, so look
// for the panel's own refusal rather than the first element with "error" in
// its class name.
const errText = await page.evaluate(() => {
  const e = [...document.querySelectorAll('[class*="error-line"], [class*="errorLine"]')].pop();
  return e ? e.textContent.replace(/\s+/g, ' ').slice(0, 150) : '(no error shown)';
});
console.log('panel stayed open on a bad line:', stillOpen);
console.log('refusal:', errText);

console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none');
await browser.close();
