import { launchBrowser, repoPath, SITE } from './launch.mjs';
const b = await launchBrowser();
const p = await b.newPage();
await p.goto(`${SITE}/editor.html`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('text=Costumes', { timeout: 60000 });
await p.waitForTimeout(2500);
const r = await p.evaluate(async () => {
  const seen = [];
  ['variableCreate','variableChange','variableDelete'].forEach(e =>
    window.vm.runtime.on(e, d => seen.push(e + ':' + (d && d.name))));
  const stage = window.vm.runtime.getTargetForStage();
  stage.createVariable('probe-id', 'probe var', '');
  stage.renameVariable('probe-id', 'renamed var');
  stage.deleteVariable('probe-id');
  await new Promise(r => setTimeout(r, 200));
  return seen;
});
console.log('variable events seen:', JSON.stringify(r));
await b.close();
