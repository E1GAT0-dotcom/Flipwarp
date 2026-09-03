// Checks the hooks PenguinMod extensions rely on are present and firing.
//
// This tests the hooks directly rather than by loading an extension: loading
// one from a URL raises the security prompt, which has no answer in an
// automated browser, and the real gallery is not reachable from here anyway.
// Loading a real extension has to be tested by hand.
import { launchBrowser, repoPath, SITE } from './launch.mjs';

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 140)));

await page.goto(`${SITE}/editor.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('text=Costumes', { timeout: 60000 });
await page.waitForTimeout(3000);

// Loading an extension from a URL normally asks the user first. This is a
// test, so answer yes on its behalf rather than leaving it waiting.
await page.evaluate(() => {
  const sm = window.vm.securityManager;
  if (sm) {
    sm.canLoadExtensionFromProject = () => true;
    sm.canFetch = () => true;
    sm.canOpenWindow = () => true;
    sm.canRedirect = () => true;
  }
});

const result = await page.evaluate(async () => {
  const vm = window.vm;
  const seen = {step: 0, paused: 0, unpaused: 0};
  vm.runtime.on('RUNTIME_STEP_START', () => seen.step++);
  vm.runtime.on('RUNTIME_PAUSED', () => seen.paused++);
  vm.runtime.on('RUNTIME_UNPAUSED', () => seen.unpaused++);
  vm.greenFlag();
  await new Promise(r => setTimeout(r, 1200));
  return {seen, installed: !!vm.runtime.__flipwarpCompatInstalled};
});
console.log('compatibility hooks installed:', result.installed);
console.log('RUNTIME_STEP_START fired', result.seen.step, 'times in 1.2s (should be roughly 30-60)');
console.log('RUNTIME_STEP_START reaching listeners:', result.seen.step > 0);

console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');
await browser.close();
