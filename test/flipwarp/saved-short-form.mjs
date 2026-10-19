// A variable or list dropped into a slot is saved in short form, [12, name,
// id] or [13, name, id], and the text builds the block it stands for. The two
// must compare as the same, or every sprite that uses a variable in a slot
// looks edited after a round trip that changed nothing: the "nothing changed"
// path is lost, and an undo step is spent on nothing.
//
// Runs without a browser.
import {parse} from '../../src/lib/flipwarp/parse.js';
import {buildTarget} from '../../src/lib/flipwarp/build.js';
import {targetToText} from '../../src/lib/flipwarp/to-text.js';
import {canonTarget} from '../../src/lib/flipwarp/canon.js';
import {splitPositions, restorePositions} from '../../src/lib/flipwarp/positions.js';

// As Scratch saves it: "say (score)" and "say (item 1 of history)" with the
// variable and the list in short form.
const saved = {
    isStage: false,
    name: 'S',
    variables: {v1: ['score', 0]},
    lists: {l1: ['history', []]},
    broadcasts: {},
    comments: {},
    blocks: {
        hat: {opcode: 'event_whenflagclicked', next: 'say1', parent: null, inputs: {}, fields: {}, shadow: false,
            topLevel: true, x: 0, y: 0},
        say1: {opcode: 'looks_say', next: 'say2', parent: 'hat', inputs: {MESSAGE: [3, [12, 'score', 'v1'], [10, 'Hello!']]},
            fields: {}, shadow: false, topLevel: false},
        say2: {opcode: 'looks_say', next: null, parent: 'say1',
            inputs: {MESSAGE: [3, [13, 'history', 'l1'], [10, '']]}, fields: {}, shadow: false, topLevel: false}
    }
};

const ctx = {globals: {variables: {}, lists: {}}, broadcasts: {}};
const {text, positions} = splitPositions(targetToText(saved, ctx, {style: 'js', indent: '  '}).text);
const rebuilt = buildTarget(parse(restorePositions(text, positions), 'js'), saved, ctx, 'js');
const same = JSON.stringify(canonTarget(saved.blocks, saved.comments)) ===
    JSON.stringify(canonTarget(rebuilt.blocks, rebuilt.comments));

console.log(`${same ? 'ok  ' : 'FAIL'} a sprite saved with variables in short form round trips unchanged`);
if (!same) process.exit(1);
console.log('short-form variables compare as the blocks they stand for');
