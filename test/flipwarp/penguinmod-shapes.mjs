import { launchBrowser, repoPath, SITE } from './launch.mjs';
const b = await launchBrowser();
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0,120)));
await p.goto(`${SITE}/editor.html`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('text=Costumes', { timeout: 60000 });
await p.waitForTimeout(2500);
await p.evaluate(() => {
  const sm = window.vm.securityManager;
  sm.getSandboxMode = () => 'unsandboxed';
  sm.canLoadExtensionFromProject = () => true;
  sm.canFetch = () => true;
});
const res = await p.evaluate(async () => {
  try {
    await window.vm.extensionManager.loadExtensionURL(`${SITE}/Test/shapes.js`);
    return {ok: true, probe: window.__shapeProbe};
  } catch (e) { return {ok: false, error: e.message}; }
});
console.log('extension using PenguinMod shapes loaded:', res.ok);
console.log('what it saw:', JSON.stringify(res.probe || res.error));
await b.close();
