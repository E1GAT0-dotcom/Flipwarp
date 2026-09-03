// Checks the second batch of PenguinMod hooks, by loading a small extension
// that uses each one exactly the way their gallery extensions use it.
//
// The extension is loaded unsandboxed from a data: URL, which is how the real
// ones load, so this exercises the same path: the shared Scratch object, the
// runtime, and the extension manager.
import { launchBrowser, repoPath, SITE } from './launch.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 160)));

await page.goto(`${SITE}/editor.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Costumes', { timeout: 60000 });
await page.waitForTimeout(3000);

const result = await page.evaluate(async () => {
  const vm = window.vm;
  const sm = vm.securityManager;
  sm.canLoadExtensionFromProject = () => true;
  sm.canFetch = () => true;
  sm.getSandboxMode = () => 'unsandboxed';

  // The same shapes the gallery uses: Scratch.gui.getBlockly().then(...),
  // vm.runtime.registerSerializer, runtime.extensionManager.loadExtensionIdSync,
  // ArgumentType.VARIABLE, BlockType.OUTPUT, registerCompiledExtensionBlocks.
  const source = `(function (Scratch) {
    const out = {};
    out.gui = typeof Scratch.gui === 'object' && typeof Scratch.gui.getBlockly === 'function';
    out.variableArg = Scratch.ArgumentType.VARIABLE;
    out.outputType = Scratch.BlockType.OUTPUT;
    out.octagonal = Scratch.BlockShape.OCTAGONAL;
    const vm = Scratch.vm;
    vm.runtime.registerSerializer('flipwarpTestType', v => [v.n], v => ({n: v[0]}));
    out.serializer = !!vm.runtime.getSerializer('flipwarpTestType');
    vm.runtime.registerCompiledExtensionBlocks('flipwarpTest', {ir: {}, js: {}});
    vm.runtime.extensionManager.loadExtensionIdSync('pen');
    out.penLoaded = vm.extensionManager.isExtensionLoaded('pen');
    Scratch.gui.getBlockly().then(SB => {
      window.__flipwarpBlockly = !!(SB && SB.Blocks && SB.FieldTextInput);
    });
    class FlipwarpTest {
      getInfo () {
        return {
          id: 'flipwarpTest',
          name: 'Flipwarp Test',
          blocks: [{
            opcode: 'setVar',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set [VARIABLE] to [VALUE]',
            arguments: {
              VARIABLE: {type: Scratch.ArgumentType.VARIABLE},
              VALUE: {type: Scratch.ArgumentType.STRING, defaultValue: '0'}
            }
          }, {
            opcode: 'anon',
            blockType: Scratch.BlockType.OUTPUT,
            blockShape: Scratch.BlockShape.SQUARE,
            text: 'anonymous function'
          }]
        };
      }
      setVar () {}
      anon () { return ''; }
    }
    window.__flipwarpProbe = out;
    Scratch.extensions.register(new FlipwarpTest());
  })(Scratch);`;

  const url = `data:application/javascript,${encodeURIComponent(source)}`;
  let loadError = null;
  try {
    await vm.extensionManager.loadExtensionURL(url);
  } catch (e) {
    loadError = e.message;
  }
  await new Promise(r => setTimeout(r, 1500));

  return {
    loadError,
    probe: window.__flipwarpProbe || null,
    blocklyReal: window.__flipwarpBlockly === true,
    registered: vm.extensionManager.isExtensionLoaded('flipwarpTest'),
    compiledRecorded: !!(vm.runtime.compiledExtensionBlocks &&
      vm.runtime.compiledExtensionBlocks.flipwarpTest)
  };
});

await browser.close();

const p = result.probe || {};
const checks = [
  ['extension loaded', result.registered === true],
  ['no load error', result.loadError === null],
  ['Scratch.gui.getBlockly present', p.gui === true],
  ['getBlockly resolves with the editor\'s real Blockly', result.blocklyReal === true],
  ['ArgumentType.VARIABLE falls back to string', p.variableArg === 'string'],
  ['BlockType.OUTPUT falls back to reporter', p.outputType === 'reporter'],
  ['BlockShape.OCTAGONAL present', p.octagonal !== undefined],
  ['registerSerializer keeps the registration', p.serializer === true],
  ['runtime.extensionManager loads a built-in', p.penLoaded === true],
  ['registerCompiledExtensionBlocks accepted', result.compiledRecorded === true]
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
if (result.loadError) console.log('load error:', result.loadError);
for (const e of errs) console.log(e);
console.log(failed === 0 ? '\nall batch-2 hooks working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
