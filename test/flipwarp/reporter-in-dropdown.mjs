// A reporter dropped into a dropdown slot, switchCostume(join("walk", n)).
// Scratch allows it and to-text always wrote it out, but the text could not be
// read back, so a sprite holding one converted to text and then refused to go
// back to blocks. Both directions have to hold now, and a project made in
// Scratch, whose hidden dropdown value is whatever it was before the reporter
// was dropped in, must still count as unchanged.
//
// Runs without a browser.
import {parse} from '../../src/lib/flipwarp/parse.js';
import {buildTarget} from '../../src/lib/flipwarp/build.js';
import {targetToText} from '../../src/lib/flipwarp/to-text.js';
import {canonTarget} from '../../src/lib/flipwarp/canon.js';

let failures = 0;
const check = (ok, what) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const ctx = {globals: {variables: {}, lists: {}}, broadcasts: {}};
const target = blocks => ({isStage: false, name: 'S', variables: {v1: ['n', 0]}, lists: {}, broadcasts: {},
    blocks, comments: {}});

const text = `variable n;

@at(0, 0)
whenGreenFlagClicked {
  switchCostume(join("walk", n));
  goTo(join("Sprite", n));
  createCloneOf(join("Enemy", n));
  if (keyPressed(join("", n))) {
    show();
  }
}`;

const built = buildTarget(parse(text, 'js'), target({}), ctx, 'js');
const blocks = built.blocks;
const costume = Object.values(blocks).find(b => b.opcode === 'looks_switchcostumeto');
const input = costume.inputs.COSTUME;
check(input[0] === 3 && blocks[input[1]].opcode === 'operator_join', 'the reporter sits in the slot');
check(blocks[input[2]] && blocks[input[2]].opcode === 'looks_costume' && blocks[input[2]].shadow,
    'the dropdown is kept underneath, as a shadow');

const back = targetToText(target(blocks), ctx, {style: 'js', indent: '  '}).text;
check(back.trim() === text.trim(), 'text comes back exactly as written');

// As Scratch saves it: the hidden dropdown still holds an old choice.
const fromScratch = JSON.parse(JSON.stringify(blocks));
fromScratch[input[2]].fields.COSTUME = ['costume2', null];
const read = targetToText(target(fromScratch), ctx, {style: 'js', indent: '  '}).text;
const rebuilt = buildTarget(parse(read, 'js'), target(fromScratch), ctx, 'js');
check(JSON.stringify(canonTarget(fromScratch, {})) === JSON.stringify(canonTarget(rebuilt.blocks, {})),
    'a project from Scratch with an old hidden choice counts as unchanged');

// A plain value that is not a choice still gets the dropdown message.
let refused = null;
try {
    buildTarget(parse('@at(0, 0)\nwhenGreenFlagClicked {\n  switchCostume(#ff0000);\n}', 'js'), target({}), ctx, 'js');
} catch (e) {
    refused = e.message;
}
check(refused && refused.includes('dropdown'), 'a colour in a costume slot is still refused');

if (failures) {
    console.log(`${failures} failure(s)`);
    process.exit(1);
}
console.log('reporters in dropdowns round trip');
