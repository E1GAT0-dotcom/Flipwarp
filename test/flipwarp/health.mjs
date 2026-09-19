// The project health check.
//
// One project is built with a known fault of every kind in it, and the check
// is asked what it thinks. Knowing what is wrong beforehand is the whole
// point: a health check that finds things is easy, a health check that finds
// the right things and nothing else is the job.
//
// The second half matters as much as the first. Three of the checks are
// written to stay quiet when they cannot be sure, and the quiet cases are
// tested too: a sprite that switches costume by a variable must not have a
// single costume called unused, because from outside there is no telling
// which one that variable holds.
import {launchBrowser, SITE} from './launch.mjs';

const browser = await launchBrowser();
const errs = [];
const page = await browser.newPage({viewport: {width: 1280, height: 900}});
page.on('pageerror', e => errs.push(`PAGEERROR: ${e.message.slice(0, 160)}`));
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
await page.waitForTimeout(2500);

// --- a project with one of everything wrong with it ------------------------
await page.evaluate(() => {
    const vm = window.vm;
    const json = JSON.parse(vm.toJSON());
    const stage = json.targets.find(t => t.isStage);
    const sprite = json.targets.find(t => !t.isStage);
    sprite.name = 'Cat';

    // A variable nothing reads, and one that is used, so "unused" is not just
    // "every variable".
    stage.variables = {
        deadVar: ['score', 0],
        liveVar: ['lives', 3]
    };
    stage.lists = {deadList: ['notes', []]};
    // Broadcasts live on the stage whoever sends them, so the two here have
    // to be declared there or the project will not save.
    stage.broadcasts = {bc1: 'nobody hears this', bc2: 'never sent'};
    stage.blocks = {
        stageHat: {opcode: 'event_whenflagclicked', next: 'setLive', parent: null,
            inputs: {}, fields: {}, topLevel: true, shadow: false, x: 40, y: 40},
        setLive: {opcode: 'data_setvariableto', next: null, parent: 'stageHat',
            inputs: {VALUE: [1, [10, '3']]},
            fields: {VARIABLE: ['lives', 'liveVar']},
            topLevel: false, shadow: false}
    };
    sprite.blocks = {
        // 1. a stack with no hat: never runs
        loose: {opcode: 'motion_movesteps', next: 'loose2', parent: null,
            inputs: {STEPS: [1, [4, '10']]}, fields: {},
            topLevel: true, shadow: false, x: 40, y: 40},
        loose2: {opcode: 'motion_turnright', next: null, parent: 'loose',
            inputs: {DEGREES: [1, [4, '15']]}, fields: {},
            topLevel: false, shadow: false},

        // 2. blocks below a stop block: unreachable
        deadHat: {opcode: 'event_whenflagclicked', next: 'stopHere', parent: null,
            inputs: {}, fields: {}, topLevel: true, shadow: false, x: 40, y: 400},
        stopHere: {opcode: 'control_stop', next: 'afterStop', parent: 'deadHat',
            inputs: {}, fields: {STOP_OPTION: ['this script', null]},
            topLevel: false, shadow: false,
            mutation: {tagName: 'mutation', children: [], hasnext: 'true'}},
        afterStop: {opcode: 'motion_movesteps', next: null, parent: 'stopHere',
            inputs: {STEPS: [1, [4, '3']]}, fields: {}, topLevel: false, shadow: false},

        // 3. an empty if, and a repeat 0
        emptyHat: {opcode: 'event_whenflagclicked', next: 'emptyIf', parent: null,
            inputs: {}, fields: {}, topLevel: true, shadow: false, x: 40, y: 800},
        emptyIf: {opcode: 'control_if', next: 'zeroRepeat', parent: 'emptyHat',
            inputs: {}, fields: {}, topLevel: false, shadow: false},
        zeroRepeat: {opcode: 'control_repeat', next: null, parent: 'emptyIf',
            inputs: {TIMES: [1, [6, '0']], SUBSTACK: [2, 'insideRepeat']}, fields: {},
            topLevel: false, shadow: false},
        insideRepeat: {opcode: 'motion_movesteps', next: null, parent: 'zeroRepeat',
            inputs: {STEPS: [1, [4, '1']]}, fields: {}, topLevel: false, shadow: false},

        // 4. a broadcast nobody listens for, and a listener nobody sends to
        sendHat: {opcode: 'event_whenflagclicked', next: 'shout', parent: null,
            inputs: {}, fields: {}, topLevel: true, shadow: false, x: 400, y: 40},
        shout: {opcode: 'event_broadcast', next: null, parent: 'sendHat',
            inputs: {BROADCAST_INPUT: [1, [11, 'nobody hears this', 'bc1']]}, fields: {},
            topLevel: false, shadow: false},
        listenHat: {opcode: 'event_whenbroadcastreceived', next: 'listenMove', parent: null,
            inputs: {}, fields: {BROADCAST_OPTION: ['never sent', 'bc2']},
            topLevel: true, shadow: false, x: 400, y: 400},
        listenMove: {opcode: 'motion_movesteps', next: null, parent: 'listenHat',
            inputs: {STEPS: [1, [4, '2']]}, fields: {}, topLevel: false, shadow: false},

        // 5. a clone made, with nothing to catch it
        cloneHat: {opcode: 'event_whenflagclicked', next: 'makeClone', parent: null,
            inputs: {}, fields: {}, topLevel: true, shadow: false, x: 400, y: 800},
        makeClone: {opcode: 'control_create_clone_of', next: null, parent: 'cloneHat',
            inputs: {CLONE_OPTION: [1, 'cloneMenu']}, fields: {},
            topLevel: false, shadow: false},
        cloneMenu: {opcode: 'control_create_clone_of_menu', next: null, parent: 'makeClone',
            inputs: {}, fields: {CLONE_OPTION: ['_myself_', null]},
            topLevel: false, shadow: true},

        // 6. a custom block nobody calls, which is also empty
        defineIt: {opcode: 'procedures_definition', next: null, parent: null,
            inputs: {custom_block: [1, 'protoIt']}, fields: {},
            topLevel: true, shadow: false, x: 800, y: 40},
        protoIt: {opcode: 'procedures_prototype', next: null, parent: 'defineIt',
            inputs: {}, fields: {}, topLevel: false, shadow: true,
            mutation: {tagName: 'mutation', children: [], proccode: 'never called',
                argumentids: '[]', argumentnames: '[]', argumentdefaults: '[]',
                warp: 'false'}}
    };
    sprite.variables = {ownScore: ['score', 0]};
    return vm.loadProject(JSON.stringify(json));
});
await page.waitForTimeout(2500);

// Driven through the panel rather than by calling the check directly, so
// what is tested is the thing that ships: the tab, the button, the list.
const openHealth = async () => {
    if (!await page.$('[class*="flipwarp-tools_window"]')) {
        await page.click('button:has-text("Tools")');
        await page.waitForTimeout(400);
    }
    await page.click('[class*="flipwarp-tools_tab"]:has-text("Project health")');
    await page.waitForTimeout(200);
};

const check = async () => {
    await openHealth();
    await page.click('[class*="flipwarp-tools_go"]');
    await page.waitForTimeout(800);
    return page.$$eval('[class*="flipwarp-tools_finding_"]', rows => rows.map(row => {
        const dot = row.querySelector('[class*="flipwarp-tools_dot"]');
        const grade = ['problem', 'warning', 'tidy']
            .find(g => dot && dot.className.includes(`_${g}`)) || '?';
        const box = row.querySelector('input[type=checkbox]');
        return {
            grade,
            fixable: Boolean(box && !box.disabled),
            title: (row.querySelector('[class*="flipwarp-tools_finding-title"]') || {}).textContent,
            detail: (row.querySelector('[class*="flipwarp-tools_finding-detail"]') || {}).textContent
        };
    }));
};

// The kind is not in the page, so findings are recognised by what they say.
// That is a fair test of the wording as well as the check.
const SAYS = {
    'loose-script': /never runs/,
    unreachable: /never be reached/,
    'empty-body': /An empty "/,
    'repeat-zero': /repeat 0/,
    'broadcast-unheard': /Nothing listens for/,
    'broadcast-unsent': /is never sent/,
    'clone-unhandled': /Clones of .* do nothing/,
    'unused-definition': /is never used/,
    'empty-definition': /custom block in .* is empty/,
    'unused-variable': /is never used/,
    'shadowed-name': /Two things are called/,
    'unused-costume': /never wears/
};
const kindsIn = list => Object.entries(SAYS)
    .filter(([, says]) => list.some(f => says.test(f.title || '')))
    .map(([kind]) => kind);

const found = await check();
const kinds = kindsIn(found);
const has = kind => kinds.includes(kind);
const countOf = kind => found.filter(f => SAYS[kind].test(f.title || '')).length;

// --- the quiet cases -------------------------------------------------------
// A sprite that picks its costume from a variable: the costume check has to
// give up on it entirely rather than guess.
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
await page.waitForTimeout(2500);
await page.evaluate(() => {
    const vm = window.vm;
    const json = JSON.parse(vm.toJSON());
    const sprite = json.targets.find(t => !t.isStage);
    sprite.variables = {pick: ['which costume', 1]};
    sprite.blocks = {
        pickHat: {opcode: 'event_whenflagclicked', next: 'wear', parent: null,
            inputs: {}, fields: {}, topLevel: true, shadow: false, x: 40, y: 40},
        wear: {opcode: 'looks_switchcostumeto', next: null, parent: 'pickHat',
            inputs: {COSTUME: [3, 'readPick', 'wearMenu']}, fields: {},
            topLevel: false, shadow: false},
        readPick: {opcode: 'data_variable', next: null, parent: 'wear', inputs: {},
            fields: {VARIABLE: ['which costume', 'pick']},
            topLevel: false, shadow: false},
        wearMenu: {opcode: 'looks_costume', next: null, parent: 'wear', inputs: {},
            fields: {COSTUME: ['costume1', null]},
            topLevel: false, shadow: true}
    };
    return vm.loadProject(JSON.stringify(json));
});
await page.waitForTimeout(2000);
const quiet = await check();
const quietKinds = kindsIn(quiet);

// --- and that fixing actually fixes ---------------------------------------
// A small project this time: one loose script, one good script, one variable
// nothing uses. Ticked in the panel, fixed with the panel's own button.
await page.goto(`${SITE}/editor.html`, {waitUntil: 'domcontentloaded'});
await page.waitForFunction(() => window.vm && window.vm.runtime, {timeout: 60000});
await page.waitForTimeout(2500);
await page.evaluate(() => {
    const vm = window.vm;
    const json = JSON.parse(vm.toJSON());
    json.targets.find(t => t.isStage).variables = {gone: ['unused thing', 0]};
    json.targets.find(t => !t.isStage).blocks = {
        loose: {opcode: 'motion_movesteps', next: 'loose2', parent: null,
            inputs: {STEPS: [1, [4, '10']]}, fields: {},
            topLevel: true, shadow: false, x: 40, y: 40},
        loose2: {opcode: 'motion_turnright', next: null, parent: 'loose',
            inputs: {DEGREES: [1, [4, '15']]}, fields: {}, topLevel: false, shadow: false},
        keepHat: {opcode: 'event_whenflagclicked', next: 'keepMove', parent: null,
            inputs: {}, fields: {}, topLevel: true, shadow: false, x: 400, y: 40},
        keepMove: {opcode: 'motion_movesteps', next: null, parent: 'keepHat',
            inputs: {STEPS: [1, [4, '5']]}, fields: {}, topLevel: false, shadow: false}
    };
    return vm.loadProject(JSON.stringify(json));
});
await page.waitForTimeout(2000);

const small = await check();
// Tick everything the panel says it can put right.
await page.click('[class*="flipwarp-tools_step"][title="Tick everything that can be fixed"]');
await page.waitForTimeout(300);
const fixButton = await page.$('[class*="flipwarp-tools_apply"]');
if (fixButton) await fixButton.click();
await page.waitForTimeout(1200);

const afterFix = await page.$$eval('[class*="flipwarp-tools_finding_"]',
    rows => rows.map(r => (r.querySelector('[class*="flipwarp-tools_finding-title"]') || {}).textContent));
const fixStatus = await page.$eval('[class*="flipwarp-tools_status"]', el => el.textContent);
const world = await page.evaluate(() => {
    const json = JSON.parse(window.vm.toJSON());
    const blocks = json.targets.find(t => !t.isStage).blocks;
    const ops = Object.values(blocks).filter(b => !b.shadow).map(b => b.opcode);
    return {
        ops,
        keptTheGoodScript: ops.includes('event_whenflagclicked') &&
            ops.filter(o => o === 'motion_movesteps').length === 1,
        tookTheLooseOne: !ops.includes('motion_turnright'),
        variablesLeft: Object.keys(json.targets.find(t => t.isStage).variables).length
    };
});

await browser.close();

const checks = [
    ['a stack with no hat is a problem',
        has('loose-script') &&
        found.find(f => SAYS['loose-script'].test(f.title || '')).grade === 'problem',
        found.map(f => [f.title, f.grade])],
    ['blocks under a stop block are unreachable', has('unreachable'), kinds],
    ['an empty if is worth a look', has('empty-body'), kinds],
    ['a repeat 0 is worth a look', has('repeat-zero'), kinds],
    ['a broadcast nobody hears is a problem', has('broadcast-unheard'), kinds],
    ['a listener nothing sends to is a problem', has('broadcast-unsent'), kinds],
    ['clones with nothing to catch them are flagged', has('clone-unhandled'), kinds],
    ['a custom block nobody calls is flagged', has('unused-definition'), kinds],
    ['an empty custom block is flagged', has('empty-definition'), kinds],
    ['a variable nothing uses is flagged', has('unused-variable'), kinds],
    ['a list nothing uses is flagged too',
        countOf('unused-variable') >= 2,
        found.filter(f => f.kind === 'unused-variable').map(f => f.title)],
    ['a variable that IS used is left alone',
        !found.some(f => /"lives"/.test(f.title)),
        found.map(f => f.title)],
    ['two things with the same name are flagged', has('shadowed-name'), kinds],
    ['problems come before tidying',
        found.every((f, i) => i === 0 ||
            ['problem', 'warning', 'tidy'].indexOf(found[i - 1].grade) <=
            ['problem', 'warning', 'tidy'].indexOf(f.grade)),
        found.map(f => f.grade)],
    ['some findings can be fixed and some cannot',
        found.some(f => f.fixable) && found.some(f => !f.fixable),
        found.map(f => [f.title, f.fixable])],
    ['a sprite choosing its costume by variable has none called unused',
        !quietKinds.includes('unused-costume'),
        quiet.map(f => f.title)],
    ['the small project shows both faults',
        small.length >= 2 && small.every(f => f.fixable), small],
    ['the panel says what it fixed', /Fixed \d+/.test(fixStatus), fixStatus],
    ['the loose script is gone', world.tookTheLooseOne === true, world],
    ['the good script is untouched', world.keptTheGoodScript === true, world],
    ['the unused variable is gone', world.variablesLeft === 0, world],
    ['and the list is checked again afterwards, and is empty',
        afterFix.length === 0, afterFix],
    ['no errors', errs.length === 0, errs]
];

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra).slice(0, 400)}`);
    }
}
console.log(failed === 0 ? '\nhealth check working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
