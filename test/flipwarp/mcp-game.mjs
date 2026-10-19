// A whole platformer, made through flipwarp-mcp the way Claude makes one, then
// played frame by frame. This is where the ready-made pieces are proved: not
// that they parse, but that the player lands on the floor, bumps its head on
// the ceiling, stops at the wall, falls down the pit, picks up the coins, and
// that the enemies hurt from the side and squash from above.
//
//   npm run build
//   node test/flipwarp/mcp-game.mjs
//   then open http://127.0.0.1:8601/editor.html?mcp (FLIPWARP_PORT to change it)
//
// DEMO_OUT=<file.sb3> keeps the game; SAVE_PICTURES=<folder> keeps screenshots.
import {PIECES} from '../../mcp/library/index.mjs';
import {start} from './mcp-client.mjs';

const {call, check, must, keep: keepAs, finish} = await start('flipwarp-game-test');
const keep = (label, r) => keepAs(`game-${label}`, r);

// --- making it, as Claude would ----------------------------------------------

const workflow = await call('game_workflow');
check(workflow.text.includes('Making a game in Flipwarp') && !workflow.text.startsWith('---'),
    'the workflow is served without its front matter');
const pieces = await call('list_pieces');
check(pieces.text.includes('platformer:') && pieces.text.includes('How the pieces fit together'),
    'the pieces are listed with how they fit');

await must('the level on the Stage', 'add_piece', {sprite: 'Stage', piece: 'level'});
const sky = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">' +
    '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ecae6"/>' +
    '<stop offset="1" stop-color="#e0f4ff"/></linearGradient></defs><rect width="480" height="360" fill="url(#s)"/>' +
    '<circle cx="90" cy="260" r="120" fill="#cde8c5"/><circle cx="380" cy="280" r="150" fill="#b7dcae"/></svg>';
await must('a sky backdrop', 'add_costume', {sprite: 'Stage', name: 'sky', svg: sky});

const ground = {
    palette: {G: '#a7c957', g: '#6a994e', d: '#9c6b3c', D: '#7a4f28'},
    rows: ['GGGGGGGGGGGG', 'gGgggGgggGgg', 'gggggggggggg', 'dddddddddddd', 'ddDdddddDddd', 'dddddDdddddd',
        'dddddddddddd', 'dDdddddddDdd', 'dddddDdddddd', 'dddddddddddd', 'ddDddddDdddd', 'dddddddddddd'],
    scale: 2
};
await must('a Tiles sprite', 'create_sprite', {name: 'Tiles', pixels: ground});
await must('its costume is named after the map character', 'rename_costume', {sprite: 'Tiles', costume: 1, name: '#'});
const tiles = await must('the tiles piece', 'add_piece', {sprite: 'Tiles', piece: 'tiles'});
check(tiles.text.includes('fencing off'), 'adding it turned fencing off', tiles.text);

const hero = {
    palette: {k: '#1a1a2e', r: '#e63946', s: '#f4c08a', e: '#1a1a2e', b: '#457b9d'},
    rows: ['..kkkk..', '.krrrrk.', 'krrrrrrk', 'ksssesek', 'kssssssk', '.kkkkkk.', 'krrrrrrk', 'krrrrrrk',
        'kbbbbbbk', 'kbbkkbbk', 'kbk..kbk', 'kkk..kkk'],
    scale: 2
};
await must('a Player sprite', 'create_sprite', {name: 'Player', pixels: hero});
const player = await must('the platformer piece', 'add_piece', {sprite: 'Player', piece: 'platformer'});
check(player.text.includes('platformer') && player.text.includes('collision'), 'it brought collision with it',
    player.text);

const coin = {
    palette: {o: '#b07d00', y: '#ffd60a', Y: '#fff3b0'},
    rows: ['.oooo.', 'oyyyyo', 'oyYyyo', 'oyyYyo', 'oyyyyo', '.oooo.'],
    scale: 2
};
await must('a Coin sprite', 'create_sprite', {name: 'Coin', pixels: coin});
await must('the coins piece', 'add_piece', {sprite: 'Coin', piece: 'coins'});

const slime = {
    palette: {k: '#2b193d', p: '#9d4edd', w: '#ffffff'},
    rows: ['...kkkk...', '..kppppk..', '.kppppppk.', '.kpwppwppk', 'kppppppppk', 'kppkkkkppk', 'kppppppppk',
        'kppppppppk', '.kppppppk.', '.kpk..kpk.', '.kk....kk.', '..........'],
    scale: 2
};
await must('an Enemy sprite', 'create_sprite', {name: 'Enemy', pixels: slime});
await must('the enemy piece', 'add_piece', {sprite: 'Enemy', piece: 'enemy'});
await must('the default sprite goes', 'delete_sprite', {sprite: 'Sprite1'});

const twice = await call('add_piece', {sprite: 'Player', piece: 'platformer'});
check(twice.error && twice.text.includes('already has'), 'the same piece twice is refused', twice.text);

const health = await call('health_check');
check(!/\[problem\]/.test(health.text), 'the health check finds no problems', health.text);

// --- playing it --------------------------------------------------------------

const state = async () => JSON.parse((await call('get_state', {})).text);
const sprite = (s, name) => s.sprites.find(x => x.name === name);
const vars = async name => sprite(await state(), name).variables;
const step = frames => call('step_frames', {frames});
const set = (name, value) => call('set_variable', {sprite: 'Player', name, value});

await must('green flag', 'green_flag');
await must('pause', 'pause');
await step(30);
let p = await vars('Player');
check(p.px === 60 && p.py === 60 && Number(p.onGround) === 1, `the player starts on the floor at the P (${p.px}, ${p.py})`);

const rows = PIECES.level.params.ROWS.default;
const count = ch => rows.join('').split(ch).length - 1;
let s = await state();
check(sprite(s, 'Coin').clones === count('o'), `a coin for every "o" (${sprite(s, 'Coin').clones})`);
check(sprite(s, 'Enemy').clones === count('e'), `an enemy for every "e" (${sprite(s, 'Enemy').clones})`);
keep('start', await call('screenshot', {}));

await call('hold_keys', {keys: ['right arrow']});
await step(60);
await call('release_keys', {});
await step(20);
s = await state();
p = sprite(s, 'Player').variables;
check(p.px > 250 && p.py === 60, `running right along the floor (px ${Math.round(p.px)})`);
check(s.stage.globals.score === 3, `picked up the three coins on the way (score ${s.stage.globals.score})`);
check(s.stage.globals.viewX > 240, `the camera scrolled (viewX ${s.stage.globals.viewX})`);
check(Math.abs(p.vx) < 0.1, 'and stopped when the key was let go');
keep('ran-right', await call('screenshot', {}));

// Under the low platform: the head stops at its underside, 96 - 12.
await set('px', 350);
await set('py', 60);
await step(5);
await call('hold_keys', {keys: ['up arrow']});
let peak = 0;
for (let i = 0; i < 20; i++) {
    await step(1);
    peak = Math.max(peak, (await vars('Player')).py);
}
await call('release_keys', {});
await step(40);
p = await vars('Player');
check(peak === 84, `a jump under the platform bumps its head exactly there (peak ${peak})`);
check(p.py === 60, 'and lands back on the floor');

// In the open: about three and a half tiles.
await set('px', 150);
await step(5);
await call('hold_keys', {keys: ['up arrow']});
peak = 0;
for (let i = 0; i < 25; i++) {
    await step(1);
    peak = Math.max(peak, (await vars('Player')).py);
}
await call('release_keys', {});
await step(40);
check(peak > 130 && peak < 160, `a full jump in the open goes about 3.5 tiles (peak ${Math.round(peak)})`);

// A tap is a short hop.
await step(10);
await call('hold_keys', {keys: ['up arrow']});
await step(2);
await call('release_keys', {});
peak = 0;
for (let i = 0; i < 20; i++) {
    await step(1);
    peak = Math.max(peak, (await vars('Player')).py);
}
await step(30);
check(peak > 70 && peak < 110, `a tap of jump is a short hop (peak ${Math.round(peak)})`);

// The left edge of the map is a wall.
await set('px', 100);
await call('hold_keys', {keys: ['left arrow']});
await step(60);
await call('release_keys', {});
p = await vars('Player');
check(p.px === 8, `the left edge stops the player exactly (px ${p.px})`);

// The pit, then back to the start.
await set('px', 468);
await set('py', 80);
await step(60);
p = await vars('Player');
check(p.px === 60 && p.py === 60, `falling down the pit starts again (${p.px}, ${p.py})`);

// Enemies: from the side it hurts.
s = await state();
let enemy = sprite(s, 'Enemy').cloneList[0].variables;
await set('px', enemy.wx + (enemy.dir * 30));
await set('py', enemy.wy);
await step(30);
p = await vars('Player');
check(p.px === 60, `walking into an enemy sends the player back (px ${p.px})`);

// From above it squashes, and the player bounces.
await step(10);
s = await state();
const before = sprite(s, 'Enemy').clones;
enemy = sprite(s, 'Enemy').cloneList[0].variables;
await set('px', enemy.wx);
await set('py', enemy.wy + 30);
await set('vy', -4);
let bounced = false;
for (let i = 0; i < 4; i++) {
    await step(1);
    if ((await vars('Player')).vy > 4) bounced = true;
}
s = await state();
check(sprite(s, 'Enemy').clones === before - 1, `landing on an enemy squashes it (${before} -> ${sprite(s, 'Enemy').clones})`);
check(bounced, 'and the player bounces off it');

keep('end', await call('screenshot', {}));
await call('resume');
await call('stop');
const logs = await call('get_logs', {});
check(!logs.text.includes('[error]') && !/react/i.test(logs.text), 'no errors in the page, and no editor noise', logs.text);

if (process.env.DEMO_OUT) {
    const saved = await call('save_project', {path: process.env.DEMO_OUT});
    check(!saved.error, `saved the game to ${process.env.DEMO_OUT}`, saved.text);
}

await finish('the pieces make a game that plays');
