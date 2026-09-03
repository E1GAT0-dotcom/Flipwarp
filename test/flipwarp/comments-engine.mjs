// Comments, both directions.
//
// A comment is not decoration in Scratch: it is a real thing attached to a
// block or sitting on the canvas, with a place and a size. This checks that
// writing one as a # line produces the real thing, that reading it back gives
// the same text, and that a comment nobody touched keeps the box it had.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoPath } from './launch.mjs';

// The conversion engine is written as ES modules with a .js extension, in a
// project that is not marked as type:module, so node will not import those
// files as they stand. Copying them to a scratch folder under .mjs names —
// and pointing their imports at each other — lets this test use the engine
// itself rather than a second copy of it that could drift.
const mirror = fs.mkdtempSync(path.join(os.tmpdir(), 'flipwarp-engine-'));
for (const file of fs.readdirSync(repoPath('src', 'lib', 'flipwarp'))) {
  if (!file.endsWith('.js')) continue;
  const source = fs.readFileSync(repoPath('src', 'lib', 'flipwarp', file), 'utf8');
  fs.writeFileSync(path.join(mirror, file.replace(/\.js$/, '.mjs')),
    source.replace(/\.js'/g, ".mjs'"));
}
const load = name => import(path.join(mirror, `${name}.mjs`));

const { targetToText } = await load('to-text');
const { parse } = await load('parse');
const { buildTarget } = await load('build');
const { canonTarget } = await load('canon');

const ctx = {globals: {variables: {}, lists: {}}, broadcasts: {}};

const target = {
  name: 'Sprite1',
  isStage: false,
  variables: {},
  lists: {},
  blocks: {
    hat: {opcode: 'event_whenflagclicked', next: 'move', parent: null, inputs: {}, fields: {},
      shadow: false, topLevel: true, x: 40, y: 60},
    move: {opcode: 'motion_movesteps', next: 'say', parent: 'hat',
      inputs: {STEPS: [1, [4, '10']]}, fields: {}, shadow: false, topLevel: false},
    say: {opcode: 'looks_sayforsecs', next: null, parent: 'move',
      inputs: {MESSAGE: [1, [10, 'hi']], SECS: [1, [4, '2']]}, fields: {},
      shadow: false, topLevel: false}
  },
  comments: {
    c1: {blockId: 'move', x: 300, y: 60, width: 180, height: 90, minimized: false,
      text: 'ten is a nice number'},
    c2: {blockId: null, x: 500, y: 400, width: 220, height: 120, minimized: true,
      text: 'a note to self\nover two lines'}
  }
};

const results = [];
const check = (name, ok, extra) => {
  results.push([name, ok, extra]);
};

const {text} = targetToText(target, ctx);

check('the attached comment is written as a # line', /^\s*# ten is a nice number$/m.test(text));
check('it sits directly above its block',
  /# ten is a nice number\n\s*move\(10\);/.test(text));
check('the canvas comment is written too', text.includes('# a note to self'));
check('its second line is its own # line', text.includes('# over two lines'));
check('the canvas comment stands apart from the script',
  /# over two lines\n\n/.test(text));

const rebuilt = buildTarget(parse(text), target, ctx);
const comments = Object.values(rebuilt.comments);
const attached = comments.filter(c => c.blockId);
const loose = comments.filter(c => !c.blockId);

check('one comment came back attached', attached.length === 1);
check('with the same text', attached[0] && attached[0].text === 'ten is a nice number');
check('attached to a real block', attached[0] && !!rebuilt.blocks[attached[0].blockId]);
check('to the block it was on',
  attached[0] && rebuilt.blocks[attached[0].blockId].opcode === 'motion_movesteps');
check('one comment came back loose', loose.length === 1);
check('keeping both its lines',
  loose[0] && loose[0].text === 'a note to self\nover two lines');

// Untouched comments keep their box: a round trip must not move or resize
// anything the user did not edit.
check('the attached comment kept its box',
  attached[0] && attached[0].x === 300 && attached[0].y === 60 &&
  attached[0].width === 180 && attached[0].height === 90);
check('the canvas comment kept its box and stayed minimized',
  loose[0] && loose[0].x === 500 && loose[0].y === 400 && loose[0].minimized === true);

// The whole point: converting and converting back changes nothing.
check('the target is unchanged by the round trip',
  JSON.stringify(canonTarget(target.blocks, target.comments)) ===
  JSON.stringify(canonTarget(rebuilt.blocks, rebuilt.comments)));

// And an edited comment does count as a change.
const edited = text.replace('ten is a nice number', 'actually eleven would be better');
const afterEdit = buildTarget(parse(edited), target, ctx);
check('editing a comment counts as a change',
  JSON.stringify(canonTarget(target.blocks, target.comments)) !==
  JSON.stringify(canonTarget(afterEdit.blocks, afterEdit.comments)));
check('an edited comment gets a fresh box rather than stealing one',
  Object.values(afterEdit.comments).some(c =>
    c.text === 'actually eleven would be better' && c.width === 200));

// Text written by hand, with no comments in the project to match against.
const fresh = buildTarget(parse([
  '# a brand new note',
  '',
  '@at(0, 0)',
  '# and one on a block',
  'move(10);'
].join('\n')), {comments: {}}, ctx);
const freshComments = Object.values(fresh.comments);
check('a hand-written attached comment works',
  freshComments.some(c => c.blockId && c.text === 'and one on a block'));
check('a hand-written canvas comment works',
  freshComments.some(c => !c.blockId && c.text === 'a brand new note'));

// // is still refused, and now points at #.
let refusal = null;
try {
  parse('// nope\nmove(10);');
} catch (e) {
  refusal = e;
}
check('// is still refused', !!refusal);
check('and the refusal points at #', refusal && /#/.test(refusal.detail ? refusal.detail.fix : refusal.fix));

let failed = 0;
for (const [name, ok] of results) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.log('\n--- the text ---');
  console.log(text);
}
console.log(failed === 0 ? '\ncomments working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
