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
    for (const file of ['save-slots.js', 'dialogue.js', 'record-replay.js',
        'near.js', 'pathfinding.js', 'tilemap.js']) {
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

    // Near: the point of it is not that it answers, but that it answers by
    // looking at a handful of sprites rather than at all of them.
    const me = vm.runtime.targets[1];
    me.setXY(0, 0);
    const clones = [];
    for (const [x, y] of [[20, 0], [-30, 10], [200, 200], [-210, -190], [35, -15]]) {
        const clone = me.makeClone();
        if (!clone) continue;
        vm.runtime.addTarget(clone);
        clone.setXY(x, y);
        clones.push(clone);
    }
    await call('flipwarpNear_rebuild', {});
    const noted = await call('flipwarpNear_noted', {});
    const close = await call('flipwarpNear_countNear', {RANGE: 50});
    const far = await call('flipwarpNear_countNear', {RANGE: 500});
    const nearestDistance = await call('flipwarpNear_nearestDistance', {RANGE: 500});
    const nothingNear = await call('flipwarpNear_anyNear', {RANGE: 5});

    // Pathfinding: a wall right across the stage with one door in it.
    await call('flipwarpPathfinding_setSquare', {SIZE: 24});
    await call('flipwarpPathfinding_clearWalls', {});
    for (let x = -240; x <= 240; x += 24) {
        if (x > 60 && x < 110) continue;
        await call('flipwarpPathfinding_blockAt', {X: x, Y: 0});
    }
    await call('flipwarpPathfinding_find', {FX: -200, FY: -100, TX: -200, TY: 100});
    const routeFound = await call('flipwarpPathfinding_found', {});
    const routeSteps = await call('flipwarpPathfinding_steps', {});
    let throughWall = false;
    for (let i = 1; i <= routeSteps; i++) {
        const x = await call('flipwarpPathfinding_stepX', {N: i});
        const y = await call('flipwarpPathfinding_stepY', {N: i});
        if (await call('flipwarpPathfinding_isBlocked', {X: x, Y: y})) throughWall = true;
    }
    // With the door bricked up there is no way through, and none around
    // either: a route that wandered off the side of the stage would make
    // every wall pointless.
    for (let x = 72; x < 110; x += 24) {
        await call('flipwarpPathfinding_blockAt', {X: x, Y: 0});
    }
    await call('flipwarpPathfinding_find', {FX: -200, FY: -100, TX: -200, TY: 100});
    const sealedFound = await call('flipwarpPathfinding_found', {});
    // Tilemap: a map written as lines, read back as a level.
    //
    //   ####@#
    //   #....#
    //   #.##.#
    //   #....#
    //   ######
    await call('flipwarpTilemap_setTileSize', {SIZE: 40});
    await call('flipwarpTilemap_load', {
        MAP: '####@#\n#....#\n#.##.#\n#....#\n######'
    });
    const mapColumns = await call('flipwarpTilemap_columns', {});
    const mapRows = await call('flipwarpTilemap_rowCount', {});
    const cornerTile = await call('flipwarpTilemap_tileAtColumnRow', {COL: 1, ROW: 1});
    const insideTile = await call('flipwarpTilemap_tileAtColumnRow', {COL: 2, ROW: 2});
    const wallCount = await call('flipwarpTilemap_countOf', {TILE: '#'});

    // The marked square, found by name, then stood on and asked about.
    const markX = await call('flipwarpTilemap_firstX', {TILE: '@'});
    const markY = await call('flipwarpTilemap_firstY', {TILE: '@'});
    me.setXY(markX, markY);
    const underMe = await call('flipwarpTilemap_tileUnderMe', {});

    // Six columns and five rows of forty steps is 240 by 200, centred, so the
    // top-left corner of the map is at (-120, 100). Column 1 row 1 — counting
    // from nothing — is therefore the middle of the square at (-60, 40), which
    // the map says is floor, and column 2 row 2 is (-20, 0), which it says is
    // one of the two blocks in the middle.
    const openHere = await call('flipwarpTilemap_isWallAt', {X: -60, Y: 40});
    const wallInTheMiddle = await call('flipwarpTilemap_isWallAt', {X: -20, Y: 0});

    // Sliding into a wall stops at it rather than passing through, and a
    // sprite thrown a long way at a thin wall must not tunnel past it.
    me.setXY(-60, 60);
    await call('flipwarpTilemap_slideBy', {DX: 0, DY: -400});
    const stoppedAt = {x: Math.round(me.x), y: Math.round(me.y)};
    const stoppedInsideWall = await call('flipwarpTilemap_isWallAt', {X: me.x, Y: me.y});

    // Written back out, a map that came in as text is the same text.
    const mapText = await call('flipwarpTilemap_asText', {});

    // And the walls handed straight to Pathfinding rather than looped over.
    await call('flipwarpTilemap_sendWallsToPathfinding', {});
    const pathSeesWall = await call('flipwarpPathfinding_isBlocked', {X: -20, Y: 0});
    const pathSeesOpen = await call('flipwarpPathfinding_isBlocked', {X: -60, Y: 40});

    for (const clone of clones) vm.runtime.disposeTarget(clone);

    const loaded = vm.extensionManager.isExtensionLoaded('flipwarpSaveSlots');
    return {loaded, readBack, listed, gone, firstLine, replies, secondLine, whereNow,
        atEnd, complaint, recorded, asText, stillRecording,
        pressedDuringPlayback, releasedAfter,
        noted, close, far, nearestDistance, nothingNear,
        routeFound, routeSteps, throughWall, sealedFound,
        mapColumns, mapRows, cornerTile, insideTile, wallCount,
        markX, markY, underMe, openHere, wallInTheMiddle,
        stoppedAt, stoppedInsideWall, mapText, pathSeesWall, pathSeesOpen};
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
    ['it lists all six', onTab.length >= 6, onTab],
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
    ['near notices every sprite there is', saved.noted === 6, saved.noted],
    ['and counts only the ones actually close', saved.close === 3, saved.close],
    ['and the ones further out when asked further out', saved.far === 5, saved.far],
    ['and measures the nearest', saved.nearestDistance === 20, saved.nearestDistance],
    ['and says no when nothing is near', saved.nothingNear === false, saved.nothingNear],
    ['a route is found through a door in a wall', saved.routeFound === true, saved],
    ['and it does not go through the wall', saved.throughWall === false, saved],
    ['bricking the door up leaves no route at all',
        saved.sealedFound === false, saved.sealedFound],
    ['the Text button does not refuse them', refused.length === 0, refused],
    ['their blocks are written out as text',
        /dialogue\.useConversation/.test(text) && /dialogue\.whatIsSaidHere/.test(text), text],
    ['and come back as the same blocks',
        blocksAfter === blocksBefore && stillThere, {blocksBefore, blocksAfter, stillThere}],
    ['a map read from text has the shape it was written in',
        saved.mapColumns === 6 && saved.mapRows === 5,
        {columns: saved.mapColumns, rows: saved.mapRows}],
    ['and the tiles are where they were written',
        saved.cornerTile === '#' && saved.insideTile === '.',
        {corner: saved.cornerTile, inside: saved.insideTile}],
    ['every wall is counted', saved.wallCount === 19, saved.wallCount],
    ['a marked square can be found and stood on',
        saved.underMe === '@', {x: saved.markX, y: saved.markY, under: saved.underMe}],
    ['open floor is not a wall', saved.openHere === false, saved.openHere],
    ['and the block in the middle is', saved.wallInTheMiddle === true, saved.wallInTheMiddle],
    ['a long fall stops on top of the floor rather than inside it',
        saved.stoppedInsideWall === false, saved.stoppedAt],
    ['the map written back out is the map that went in',
        saved.mapText === '####@#\n#....#\n#.##.#\n#....#\n######', saved.mapText],
    ['Pathfinding is given the walls', saved.pathSeesWall === true, saved.pathSeesWall],
    ['and not given the floor', saved.pathSeesOpen === false, saved.pathSeesOpen],
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
