// Text for the blocks of extensions that are not Scratch's or Flipwarp's: made
// from the extension's own definitions, and the round trip has to hold for
// them exactly as it does for Scratch's, or turning the setting on can lose
// somebody's work.
//
// Runs without a browser. The extension is described the way the VM hands it
// over in runtime._blockInfo.
import {parse} from '../../src/lib/flipwarp/parse.js';
import {buildTarget} from '../../src/lib/flipwarp/build.js';
import {targetToText} from '../../src/lib/flipwarp/to-text.js';
import {canonTarget} from '../../src/lib/flipwarp/canon.js';
import {defsForCategory} from '../../src/lib/flipwarp/runtime-extensions.js';
import {addBlocks, removeBlocks, BLOCKS, BY_NAME, MENU_BLOCKS} from '../../src/lib/flipwarp/phrasebook.js';
import {INPUT_SHADOWS} from '../../src/lib/flipwarp/input-shadows.js';

let failures = 0;
const check = (ok, what) => {
    if (!ok) {
        failures++;
        console.log(`FAIL ${what}`);
    }
};

const category = {
    id: 'lmsutils',
    menuInfo: {
        keys: {acceptReporters: true, items: ['a', 'b']},
        mode: {items: ['on', 'off']}
    },
    blocks: [
        {info: {opcode: 'clamp', blockType: 'reporter', text: 'clamp [N] between [A] and [B]',
            arguments: {N: {type: 'number'}, A: {type: 'number'}, B: {type: 'number'}}}},
        {info: {opcode: 'isOdd', blockType: 'Boolean', text: 'is [N] odd?', arguments: {N: {type: 'number'}}}},
        {info: {opcode: 'whenKey', blockType: 'hat', text: 'when [KEY] key hit',
            arguments: {KEY: {type: 'string', menu: 'keys'}}}},
        {info: {opcode: 'setMode', blockType: 'command', text: '[IMG] set mode [MODE]',
            arguments: {IMG: {type: 'image'}, MODE: {type: 'string', menu: 'mode'}}}},
        {info: {opcode: 'repeatFor', blockType: 'loop', text: 'repeat for [T] seconds',
            arguments: {T: {type: 'number'}}}},
        {info: {opcode: 'twoBranch', blockType: 'conditional', branchCount: 2, text: 'if [C] then else',
            arguments: {C: {type: 'Boolean'}}}},
        {info: {}, xml: '<sep/>'},
        {info: {opcode: 'heading', blockType: 'label', text: 'Utilities'}}
    ]
};

const {defs, shadows, skipped} = defsForCategory(category, new Set());
check(Object.keys(defs).length === 5, `five blocks get a text form, got ${Object.keys(defs).length}`);
check(skipped.length === 1 && skipped[0] === 'lmsutils_twoBranch', 'a block with two bodies is left out');
check(defs.lmsutils_setMode && defs.lmsutils_setMode.args.join() === 'MODE', 'a picture is not a slot');
check(defs.lmsutils_whenKey && defs.lmsutils_whenKey.menu.KEY === 'lmsutils_menu_keys',
    'a menu that accepts reporters is an input');
check(defs.lmsutils_setMode && defs.lmsutils_setMode.fields[0] === 'MODE', 'a plain menu is a field');

// A name a core block already has is not taken over.
const clash = defsForCategory({id: 'x', blocks: []}, new Set());
check(Object.keys(clash.defs).length === 0, 'an empty extension gives nothing');
check(addBlocks({fake_move: {kind: 'statement', name: 'move', args: []}}).length === 0,
    'a block name already used is refused');

const added = addBlocks(defs);
Object.assign(INPUT_SHADOWS, shadows);
check(added.length === 5, 'all five are added');
check(MENU_BLOCKS.has('lmsutils_menu_keys'), 'the menu is known');

const text = `@at(0, 0)
lmsutils.whenKeyHit("a") {
  lmsutils.setMode("on");
  lmsutils.repeatForSeconds(2) {
    setX(lmsutils.clampBetweenAnd(mouseX(), -100, 100));
    if (lmsutils.isOdd(3)) {
      show();
    }
  }
}`;
const target = {isStage: false, name: 'S', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}};
const ctx = {globals: {variables: {}, lists: {}}, broadcasts: {}};
const built = buildTarget(parse(text, 'js'), target, ctx, 'js');
const back = targetToText({...target, blocks: built.blocks, comments: {}}, ctx, {style: 'js', indent: '  '}).text;
check(back.trim() === text.trim(), `text comes back as written:\n${back}`);
const again = buildTarget(parse(back, 'js'), target, ctx, 'js');
check(JSON.stringify(canonTarget(built.blocks, {})) === JSON.stringify(canonTarget(again.blocks, {})),
    'the blocks come back the same');

// Every other style has to read them too.
const snake = targetToText({...target, blocks: built.blocks, comments: {}}, ctx, {style: 'python', indent: '  '}).text;
check(/lmsutils\./.test(snake), 'the python style writes them');

removeBlocks();
check(!BLOCKS.lmsutils_clamp && !BY_NAME.has('lmsutils.clampBetweenAnd'), 'turning it off takes them out');
check(!MENU_BLOCKS.has('lmsutils_menu_keys'), 'and their menus');
check(MENU_BLOCKS.has('pen_menu_colorParam'), 'but not Scratch\'s');
let refused = null;
try {
    targetToText({...target, blocks: built.blocks, comments: {}}, ctx, {style: 'js'});
} catch (e) {
    refused = e.message;
}
check(refused && refused.includes('Text for other extensions'), 'the refusal says how to turn it on');

if (failures) {
    console.log(`${failures} failure(s)`);
    process.exit(1);
}
console.log('text for other extensions round trips, and comes out again cleanly');
