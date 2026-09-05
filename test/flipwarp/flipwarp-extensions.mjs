// Flipwarp's own extensions.
//
// The thing that makes them worth writing rather than pointing people at
// TurboWarp's is that their blocks convert to text. Everything under the other
// tabs works as blocks and refuses the Text button; these do not. So the test
// that matters is not that a block runs — it is that a script using one goes
// out as text and comes back as the same blocks.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const page = await browser.newPage({viewport: {width: 1300, height: 900}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForSelector('text=Costumes', {timeout: 60000});
await page.waitForTimeout(3000);

// --- the tab --------------------------------------------------------------
await page.click('[class*="gui_extension-button"]');
await page.waitForSelector('[class*="library_filter-bar-item"]', {timeout: 20000});
await page.waitForTimeout(1500);

const tabs = await page.$$eval('[class*="library_filter-bar-item"]',
    els => els.map(e => e.textContent.trim()));

await page.click('[class*="library_filter-bar-item"]:has-text("Flipwarp")');
await page.waitForTimeout(1200);
const onTab = await page.$$eval('[class*="library-item_featured-text"]',
    els => els.map(e => e.textContent.trim().slice(0, 40)));
const credit = await page.$$eval('[class*="library_tag-banner"], [class*="tagBanner"]',
    els => els.map(e => e.textContent).join(' '));


// --- the blocks actually work --------------------------------------------
const saved = await page.evaluate(async () => {
    const vm = window.vm;
    for (const file of ['save-slots.js', 'dialogue.js', 'record-replay.js']) {
        await vm.extensionManager.loadExtensionURL(
            new URL(`flipwarp-extensions/${file}`, document.baseURI).href);
    }

    // Extension blocks are wrapped by the runtime and may answer with a
    // promise, so every call is waited on whether it needed it or not.
    const call = async (opcode, args) => {
        const fn = vm.runtime.getOpcodeFunction(opcode);
        if (!fn) throw new Error(`no such block: ${opcode}`);
        return await fn(args, {target: vm.runtime.targets[1]});
    };

    // Save slots: put something away, read it back.
    await call('flipwarpSaveSlots_save', {VALUE: '42', NAME: 'score', SLOT: 'test slot'});
    const readBack = await call('flipwarpSaveSlots_load', {NAME: 'score', SLOT: 'test slot'});
    const listed = await call('flipwarpSaveSlots_namesIn', {SLOT: 'test slot'});
    await call('flipwarpSaveSlots_deleteSlot', {SLOT: 'test slot'});
    const gone = await call('flipwarpSaveSlots_slotExists', {SLOT: 'test slot'});

    // Dialogue: walk a two-step conversation and take the branch.
    await call('flipwarpDialogue_use', {
        TEXT: 'start: The gate is shut.\n  -> Knock. : knock\n  -> Leave. : end\n' +
            'knock: Nobody answers.\n  -> Leave. : end\nend: You walk away.'
    });
    const firstLine = await call('flipwarpDialogue_says', {});
    const replies = await call('flipwarpDialogue_replyCount', {});
    await call('flipwarpDialogue_choose', {N: 1});
    const secondLine = await call('flipwarpDialogue_says', {});
    const whereNow = await call('flipwarpDialogue_here', {});
    await call('flipwarpDialogue_choose', {N: 1});
    const atEnd = await call('flipwarpDialogue_isEnd', {});

    // A conversation with a reply pointing nowhere says so rather than
    // failing quietly during play.
    await call('flipwarpDialogue_use', {TEXT: 'start: Hi.\n  -> Bye. : nowhere'});
    const complaint = await call('flipwarpDialogue_problems', {});

    // Record and replay: press a key while recording, and check it was kept
    // and can be handed back as text. Replaying it is left to the browser
    // test below, because it needs real time to pass.
    await call('flipwarpRecordReplay_clear', {});
    await call('flipwarpRecordReplay_startRecording', {});
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    await new Promise(r => setTimeout(r, 120));
    document.dispatchEvent(new KeyboardEvent('keyup', {key: 'ArrowRight', bubbles: true}));
    await call('flipwarpRecordReplay_stopRecording', {});
    const recorded = await call('flipwarpRecordReplay_count', {});
    const asText = await call('flipwarpRecordReplay_asText', {});
    const stillRecording = await call('flipwarpRecordReplay_isRecording', {});

    // And that playing it back presses the key again, on the runtime this
    // time rather than on the page.
    await call('flipwarpRecordReplay_play', {});
    await new Promise(r => setTimeout(r, 60));
    const pressedDuringPlayback =
        vm.runtime.ioDevices.keyboard._keysPressed.includes('right arrow');
    await new Promise(r => setTimeout(r, 400));
    const releasedAfter = !vm.runtime.ioDevices.keyboard._keysPressed.includes('right arrow');

    const loaded = vm.extensionManager.isExtensionLoaded('flipwarpSaveSlots');
    return {loaded, readBack, listed, gone, firstLine, replies, secondLine, whereNow,
        atEnd, complaint, recorded, asText, stillRecording,
        pressedDuringPlayback, releasedAfter};
});

// --- and they convert to text --------------------------------------------
// Out of the picker first: it is a dialog, and it covers the Text button.
await page.keyboard.press('Escape');
await page.waitForTimeout(1200);

await page.evaluate(() => {
    const vm = window.vm;
    const json = JSON.parse(vm.toJSON());
    const target = json.targets.find(t => !t.isStage);
    target.blocks = {
        hat: {opcode: 'event_whenflagclicked', next: 'use', parent: null, inputs: {}, fields: {},
            topLevel: true, shadow: false, x: 40, y: 40},
        use: {opcode: 'flipwarpDialogue_use', next: 'say', parent: 'hat',
            inputs: {TEXT: [1, [10, 'start: Hello.']]}, fields: {},
            topLevel: false, shadow: false},
        say: {opcode: 'looks_say', next: null, parent: 'use',
            inputs: {MESSAGE: [3, 'says', [10, 'hi']]}, fields: {},
            topLevel: false, shadow: false},
        says: {opcode: 'flipwarpDialogue_says', next: null, parent: 'say',
            inputs: {}, fields: {}, topLevel: false, shadow: false}
    };
    return vm.loadProject(JSON.stringify(json));
});
await page.waitForTimeout(2500);

const blocksBefore = await page.evaluate(() =>
    Object.values(JSON.parse(window.vm.toJSON()).targets.find(t => !t.isStage).blocks)
        .filter(b => !b.shadow).length);

await page.click('button:has-text("Text")');
await page.waitForTimeout(2000);
const text = await page.$eval('textarea', el => el.value);
const refused = await page.$$eval('[class*="flipwarp-panel_error"]', els => els.map(e => e.textContent));
await page.click('button:has-text("Blocks")');
await page.waitForTimeout(2500);

const blocksAfter = await page.evaluate(() =>
    Object.values(JSON.parse(window.vm.toJSON()).targets.find(t => !t.isStage).blocks)
        .filter(b => !b.shadow).length);
const stillThere = await page.evaluate(() =>
    Object.values(JSON.parse(window.vm.toJSON()).targets.find(t => !t.isStage).blocks)
        .some(b => b.opcode === 'flipwarpDialogue_use'));

await page.screenshot({path: '/tmp/flipwarp-extensions.png'});
await browser.close();

const checks = [
    ['there is a Flipwarp tab', tabs.includes('Flipwarp'), tabs],
    ['it lists all three', onTab.length >= 3, onTab],
    ['and says who made them', /E1GAT0_/.test(credit), credit.slice(0, 120)],
    ['an extension served from this site loads', saved.loaded === true, saved.loaded],
    ['a slot remembers what was put in it', saved.readBack === '42', saved],
    ['and can be asked what it holds', saved.listed === 'score', saved],
    ['and can be deleted', saved.gone === false, saved],
    ['a conversation starts at its first part',
        saved.firstLine === 'The gate is shut.', saved],
    ['with its replies counted', saved.replies === 2, saved],
    ['choosing one moves to where it leads',
        saved.secondLine === 'Nobody answers.' && saved.whereNow === 'knock', saved],
    ['and the last part is the end', saved.atEnd === true, saved],
    ['a reply that leads nowhere is complained about',
        /nowhere/.test(saved.complaint), saved.complaint],
    ['a recording keeps what was pressed', saved.recorded >= 2, saved.recorded],
    ['and stops when told to', saved.stillRecording === false, saved.stillRecording],
    ['and can be handed out as text', /ArrowRight/.test(saved.asText), saved.asText],
    ['playing it back presses the key again',
        saved.pressedDuringPlayback === true, saved.pressedDuringPlayback],
    ['and lets go of it at the end', saved.releasedAfter === true, saved.releasedAfter],
    ['the Text button does not refuse them', refused.length === 0, refused],
    ['their blocks are written out as text',
        /dialogue\.useConversation/.test(text) && /dialogue\.whatIsSaidHere/.test(text), text],
    ['and come back as the same blocks',
        blocksAfter === blocksBefore && stillThere, {blocksBefore, blocksAfter, stillThere}],
    ['the editor raised no errors', errs.length === 0, errs]
];

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra)}`);
    }
}
console.log('\ntext:\n' + text);
console.log(failed === 0 ? '\nflipwarp extensions working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
