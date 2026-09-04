// Making a sound smaller: the mono fix, the panel, and that what comes out
// is really smaller and really still the sound.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const page = await browser.newPage({viewport: {width: 1300, height: 900}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);

// A stereo sound with the two channels deliberately different: the left is
// quiet, the right is loud. Keeping only the left — which is what Scratch
// does — would lose almost all of it.
await page.evaluate(async () => {
    const vm = window.vm;
    const t = vm.editingTarget;
    const rate = 44100;
    const n = rate * 2;
    const ctx = vm.runtime.audioEngine.audioContext;
    const buffer = ctx.createBuffer(2, n, rate);
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    for (let i = 0; i < n; i++) {
        const s = Math.sin((2 * Math.PI * 440 * i) / rate);
        L[i] = s * 0.05;   // barely there
        R[i] = s * 0.95;   // nearly all of it
    }
    // Written as a plain wav so the VM has a real asset to work from.
    const bytes = 44 + (n * 2 * 2);
    const file = new ArrayBuffer(bytes);
    const view = new DataView(file);
    const str = (at, t2) => {
        for (let i = 0; i < t2.length; i++) view.setUint8(at + i, t2.charCodeAt(i));
    };
    str(0, 'RIFF'); view.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 2, true); view.setUint32(24, rate, true);
    view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, n * 4, true);
    let at = 44;
    for (let i = 0; i < n; i++) {
        view.setInt16(at, L[i] * 32767, true); at += 2;
        view.setInt16(at, R[i] * 32767, true); at += 2;
    }
    // Made the way the editor makes one: a real asset in storage, not a
    // loose blob. Without that the VM has nothing to decode.
    const storage = vm.runtime.storage;
    const asset = storage.createAsset(
        storage.AssetType.Sound,
        storage.DataFormat.WAV,
        new Uint8Array(file),
        null,
        true
    );
    await vm.addSound({
        name: 'stereo test',
        md5: `${asset.assetId}.${asset.dataFormat}`,
        asset,
        dataFormat: 'wav',
        rate,
        sampleCount: n
    }, t.id);
    vm.emitTargetsUpdate();
});
await page.waitForTimeout(2000);
await page.click('text=Sounds');
await page.waitForTimeout(2000);

// Open the last sound (the one just added).
const soundItems = await page.$$('[class*="selector_list-item"]');
await soundItems[soundItems.length - 1].click();
await page.waitForTimeout(1500);

const info = () => page.evaluate(() => {
    const t = window.vm.editingTarget;
    const i = t.getSounds().length - 1;
    const b = window.vm.getSoundBuffer(i);
    const s = t.getSounds()[i];
    return {
        channels: b.numberOfChannels,
        rate: b.sampleRate,
        bytes: s.asset ? s.asset.data.byteLength : 0,
        format: s.dataFormat,
        // How loud it is: the mono bug would leave this near 0.05, a proper
        // mix leaves it near 0.5.
        peak: Math.max(...Array.from(b.getChannelData(0).slice(0, 4000)).map(Math.abs))
    };
});

const before = await info();

// --- the mono fix -------------------------------------------------------
// Applying any effect is what makes Scratch mix the sound down, so that is
// where the bug bit. Reverse changes no volume, so what comes back tells us
// which channels went into the mix: the loud one alone would leave the peak
// near 0.95, the quiet one alone near 0.05, and a proper mix near 0.5.
// Reverse specifically: it changes no volume and no length, so the peak
// afterwards is purely a question of which channels went into the mix.
const reverse = await page.$('[class*="sound-editor_effect-button"]:has-text("Reverse")');
let afterEffectPeak = null;
if (reverse) {
    await reverse.click();
    await page.waitForTimeout(2000);
    afterEffectPeak = await page.evaluate(() => {
        const t = window.vm.editingTarget;
        const b = window.vm.getSoundBuffer(t.getSounds().length - 1);
        return Math.max(...Array.from(b.getChannelData(0).slice(0, 4000)).map(Math.abs));
    });
}

const shrinkButton = await page.$('[class*="sound-editor_shrink-button"]');
await shrinkButton.click();
await page.waitForTimeout(800);

const panelOpen = await page.$('[class*="sound-shrink_window"]');
const shownBefore = await page.$eval('[class*="sound-shrink_sizes"]', el => el.textContent);

// --- choose compressed + a lower rate ------------------------------------
const selects = await page.$$('[class*="sound-shrink_select"]');
await selects[0].selectOption('adpcm');
await page.waitForTimeout(400);
await selects[1].selectOption('22050');
await page.waitForTimeout(500);
const shownAfter = await page.$eval('[class*="sound-shrink_sizes"]', el => el.textContent);

await page.click('[class*="sound-shrink_apply"]');
await page.waitForTimeout(3000);

const after = await info();
const panelGone = await page.$('[class*="sound-shrink_window"]');

// And that it still plays — the VM has to be able to read back what we wrote.
const playsBack = await page.evaluate(async () => {
    const t = window.vm.editingTarget;
    const i = t.getSounds().length - 1;
    const b = window.vm.getSoundBuffer(i);
    const peak = Math.max(...Array.from(b.getChannelData(0).slice(0, 4000)).map(Math.abs));
    return {length: b.length, peak};
});

await page.screenshot({path: '/tmp/sound-shrink.png'});
await browser.close();

const checks = [
    ['the sound came in as stereo', before.channels === 2, before],
    ['editing mixes both channels rather than keeping the quiet one',
        afterEffectPeak !== null && afterEffectPeak > 0.4,
        `peak ${afterEffectPeak === null ? 'n/a' : afterEffectPeak.toFixed(3)} ` +
        '(0.05 would mean the right channel was thrown away, 0.5 is a proper mix)'],
    ['the shrink panel opens', panelOpen !== null],
    ['it shows the size now', /KB|MB/.test(shownBefore), shownBefore],
    ['choosing compressed shows a smaller size', shownAfter !== shownBefore, {shownBefore, shownAfter}],
    ['it says how much smaller', /% smaller/.test(shownAfter), shownAfter],
    ['the sound really got smaller', after.bytes < before.bytes,
        `${(before.bytes / 1024).toFixed(0)} KB -> ${(after.bytes / 1024).toFixed(0)} KB`],
    ['about four times smaller or better', before.bytes / after.bytes > 3.5,
        `${(before.bytes / after.bytes).toFixed(1)}x`],
    ['the sample rate came down', after.rate === 22050, after.rate],
    ['it is one channel now', after.channels === 1, after.channels],
    ['and it still plays', playsBack.length > 1000 && playsBack.peak > 0.2, playsBack],
    ['the panel closes when kept', panelGone === null],
    ['no errors', errs.length === 0, errs]
];

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra !== undefined ? `  (${JSON.stringify(extra)})` : ''}`);
    if (!ok) failed++;
}
console.log(failed === 0 ? '\nsound shrink working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
