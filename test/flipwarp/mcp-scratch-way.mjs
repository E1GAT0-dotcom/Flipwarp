// The Scratch-way checks and the rename tool, in a real editor.
//
// Start it, then open the editor address it prints (FLIPWARP_PORT picks the
// port). A project built with the habits the checks are for must be pointed
// at, and one built well must not; rename must change every use and refuse
// what would break the project.
import {start} from './mcp-client.mjs';

const {call, check, must, finish} = await start('scratch way test');
const health = async () => (await call('health_check')).text;
const idOf = (text, words) => {
    const line = text.split('\n').find(l => l.includes(words));
    return line ? line.split(' ')[1] : null;
};

// --- the habits ------------------------------------------------------------

await must('a menu drawn with the pen every frame', 'create_sprite', {name: 'Menu'});
await must('write it', 'write_sprite', {sprite: 'Menu', text: `whenGreenFlagClicked {
  forever {
    drawMenu();
  }
}

define fast drawMenu() {
  pen.eraseAll();
  pen.stamp();
}`});
await must('a tile map that redraws only when the camera moves', 'create_sprite', {name: 'World'});
await must('write it', 'write_sprite', {sprite: 'World', text: `variable lastX;

whenGreenFlagClicked {
  forever {
    if (!(mouseX() == lastX)) {
      pen.eraseAll();
      pen.stamp();
      lastX = mouseX();
    }
  }
}`});
await must('trails erased every frame', 'create_sprite', {name: 'Trail'});
await must('write it', 'write_sprite', {sprite: 'Trail', text: `whenGreenFlagClicked {
  forever {
    pen.eraseAll();
    pen.penDown();
  }
}`});
const body = Array.from({length: 310}, () => '  n += 1;').join('\n');
const shortNames = ['ab', 'cd', 'ef', 'gh', 'ijk', 'lmn', 'op', 'qr', 'st', 'uv'];
await must('a giant custom block, a fast one that waits, short names', 'write_sprite', {sprite: 'Sprite1',
    text: `${shortNames.map(n => `global variable ${n};`).join('\n')}
variable n;

whenGreenFlagClicked {
  ${shortNames.map(n => `${n} = 1;`).join('\n  ')}
  huge();
  pauseThenGo();
}

define fast huge() {
${body}
}

define fast pauseThenGo() {
  wait(1);
  say("go");
}`});

let h = await health();
check(/Menu: Menu redraws menus or text with the pen every frame/.test(h), 'the pen menu is pointed at', h);
check(!/World[^\n]*pen/.test(h), 'a redraw behind an if is not', h);
check(/Trail: Trail erases and redraws the pen every frame/.test(h), 'trails erased every frame are mentioned', h);
check(/"huge" in Sprite1 is 310 blocks long/.test(h), 'the giant custom block is pointed at', h);
check(/"pauseThenGo" in Sprite1 runs without screen refresh and waits[^\n]*\(fixable\)/.test(h),
    'the fast block that waits is pointed at, and fixable', h);
check(/names are too short to read/.test(h), 'the short names are pointed at', h);

const fastId = idOf(h, 'runs without screen refresh and waits');
await must('fix the fast block that waits', 'fix_health', {ids: [fastId]});
const sprite1 = (await call('read_sprite', {sprite: 'Sprite1'})).text;
check(/define pauseThenGo\(\)/.test(sprite1) && !/define fast pauseThenGo/.test(sprite1), 'it is no longer fast',
    sprite1.slice(-300));
check(!/runs without screen refresh and waits/.test(await health()), 'and the finding has gone');

// --- rename ------------------------------------------------------------------

await must('a little game to rename things in', 'write_sprite', {sprite: 'Sprite1', text: `global variable bvx;
global list pts;
global broadcast go;
variable q;

whenGreenFlagClicked {
  bvx = 5;
  q = 2;
  addToList(pts, "x");
  jmp(10);
  broadcast(go);
}

define fast jmp(a0) {
  changeY(a0);
  bvx += a0;
}`});
await must('the other end of the message', 'write_sprite', {sprite: 'Trail', text: `global variable bvx;
global broadcast go;

whenIReceive(go) {
  say(bvx);
}`});

await must('rename a variable for all sprites', 'rename', {kind: 'variable', from: 'bvx', to: 'ballSpeedX'});
await must('rename a sprite\'s own variable', 'rename', {kind: 'variable', sprite: 'Sprite1', from: 'q', to: 'quality'});
await must('rename a list', 'rename', {kind: 'list', from: 'pts', to: 'points'});
await must('rename a message', 'rename', {kind: 'message', from: 'go', to: 'start game'});
await must('rename a custom block', 'rename', {kind: 'block', sprite: 'Sprite1', from: 'jmp', to: 'jump'});
await must('rename an input', 'rename', {kind: 'input', sprite: 'Sprite1', block: 'jump', from: 'a0', to: 'height'});

const a = (await call('read_sprite', {sprite: 'Sprite1'})).text;
const b = (await call('read_sprite', {sprite: 'Trail'})).text;
check(/ballSpeedX = 5;/.test(a) && /ballSpeedX \+= height;/.test(a) && !/bvx/.test(a), 'the variable everywhere', a);
check(/say\(ballSpeedX\)/.test(b), 'in the other sprite too', b);
check(/quality = 2;/.test(a), 'the sprite\'s own variable', a);
check(a.includes('addToList(points, "x");'), 'the list', a);
check(/broadcast\(startGame\)|broadcast\([^)]*start game/.test(a) && /whenIReceive\(startGame\)|start game/.test(b),
    'the message, at both ends', `${a}\n---\n${b}`);
check(/jump\(10\);/.test(a) && /define fast jump\(height\)/.test(a) && /changeY\(height\)/.test(a),
    'the custom block, its call and its input', a);

let r = await call('rename', {kind: 'variable', from: 'ballSpeedX', to: 'points'});
check(!r.error, 'a variable may share a name with a list', r.text);
r = await call('rename', {kind: 'variable', sprite: 'Sprite1', from: 'quality', to: 'points'});
check(r.error && /already exists/.test(r.text), 'a name that is taken is refused', r.text);
r = await call('rename', {kind: 'block', sprite: 'Sprite1', from: 'jump', to: 'leap %b'});
check(r.error && /different inputs/.test(r.text), 'a custom block with different inputs is refused', r.text);
r = await call('rename', {kind: 'variable', from: 'nothing', to: 'x'});
check(r.error && /There is no variable called "nothing"/.test(r.text), 'a name that is not there is refused', r.text);

await must('it still runs', 'green_flag');
r = await call('get_logs');
check(/No errors/.test(r.text), 'with no errors', r.text);
await call('stop');

await finish('scratch way: all passed');
