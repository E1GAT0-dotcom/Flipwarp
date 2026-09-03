// Comments in the real editor: type a # line, flip back, and see a real
// Scratch comment on the workspace — the kind you can drag and resize.
import { launchBrowser, repoPath, SITE } from './launch.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 160)));

await page.goto(`${SITE}/editor.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Costumes', { timeout: 60000 });
await page.waitForTimeout(2500);

// Start from a script, so there is something for a comment to attach to.
await page.evaluate(() => {
  const target = window.vm.editingTarget;
  window.vm.stopAll();
  target.blocks._blocks = {};
  target.blocks._scripts = [];
  const blocks = {
    hat: {id: 'hat', opcode: 'event_whenflagclicked', next: 'move', parent: null,
      inputs: {}, fields: {}, shadow: false, topLevel: true, x: 40, y: 60},
    move: {id: 'move', opcode: 'motion_movesteps', next: null, parent: 'hat',
      inputs: {STEPS: {name: 'STEPS', block: 'steps', shadow: 'steps'}},
      fields: {}, shadow: false, topLevel: false},
    steps: {id: 'steps', opcode: 'math_number', next: null, parent: 'move',
      inputs: {}, fields: {NUM: {name: 'NUM', value: '10'}}, shadow: true, topLevel: false}
  };
  for (const b of Object.values(blocks)) target.blocks._blocks[b.id] = b;
  target.blocks._scripts = ['hat'];
  target.comments = {};
  window.vm.emitWorkspaceUpdate();
});
await page.waitForTimeout(800);

// The panel covers the editor, so the toggle is clicked by its own class
// rather than by its label — "Blocks" also appears in the palette behind it.
const TOGGLE = '[class*="flipwarp-panel_toggle-button"]';
const AREA = '[class*="flipwarp-panel"] textarea';
const toggle = async () => {
  const wasOpen = await page.$(AREA) !== null;
  await page.click(TOGGLE);
  if (wasOpen) {
    try {
      await page.waitForSelector(AREA, {state: 'detached', timeout: 8000});
    } catch (e) {
      const why = await page.$eval('[class*="flipwarp-panel_error"]', el => el.textContent)
          .catch(() => '(no error shown)');
      throw new Error(`the panel refused to close: ${why}`);
    }
  }
  else await page.waitForSelector(AREA, {timeout: 15000});
  await page.waitForTimeout(600);
};

await toggle();
const shown = await page.$eval(AREA, e => e.value);

// Write both kinds of comment.
const edited = shown
  .replace('move(10);', '# how far to go\nmove(10);')
  .replace(/^/, '# a note on the canvas\n\n');

await page.evaluate(text => {
  const area = document.querySelector('[class*="flipwarp-panel"] textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, text);
  area.dispatchEvent(new Event('input', {bubbles: true}));
}, edited);
await page.waitForTimeout(500);
await toggle();
await page.waitForTimeout(600);

const after = await page.evaluate(() => {
  const comments = Object.values(window.vm.editingTarget.comments || {});
  return {
    texts: comments.map(c => c.text),
    attached: comments.filter(c => c.blockId).length,
    loose: comments.filter(c => !c.blockId).length,
    onRealBlocks: comments.filter(c => c.blockId)
        .every(c => !!window.vm.editingTarget.blocks.getBlock(c.blockId)),
    // The workspace draws comments as their own elements; if the editor did
    // not hear about them, nothing would be on screen.
    // scratch-blocks draws each comment as its own box on the canvas.
    drawn: document.querySelectorAll('.scratchCommentBody').length
  };
});

// And back to text once more: what was written must read back the same.
await toggle();
const secondRead = await page.$eval(AREA, e => e.value);
await toggle();
await browser.close();

const checks = [
  ['the attached comment became a real comment', after.attached === 1],
  ['the canvas comment became a real comment', after.loose === 1],
  ['the attached one is on a block that exists', after.onRealBlocks === true],
  ['both texts survived', after.texts.includes('how far to go') &&
      after.texts.includes('a note on the canvas')],
  ['the workspace drew them', after.drawn >= 2],
  ['they read back as # lines', /# how far to go/.test(secondRead) &&
      /# a note on the canvas/.test(secondRead)],
  ['the attached one still sits above its block',
      /# how far to go\n\s*move\(10\);/.test(secondRead)]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
if (failed) console.log('second read:\n' + secondRead);
for (const e of errs) console.log(e);
console.log(failed === 0 ? '\ncomments working in the editor' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
