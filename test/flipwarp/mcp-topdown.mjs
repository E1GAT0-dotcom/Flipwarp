// A top-down game, made through flipwarp-mcp the way Claude makes one, then
// played frame by frame: the proof for the topdown piece, as mcp-game.mjs is
// for the platformer. The player must stand still with no keys (no gravity),
// stop exactly against walls on all four sides, slide along a wall when
// walking into it at an angle, pick up coins, turn to face where it walks,
// and the camera must scroll both ways and stop at the edges of the map.
//
//   npm run build
//   node test/flipwarp/mcp-topdown.mjs
//   then open http://127.0.0.1:8601/editor.html?mcp (FLIPWARP_PORT to change it)
//
// DEMO_OUT=<file.sb3> keeps the game; SAVE_PICTURES=<folder> keeps screenshots.
import {start} from './mcp-client.mjs';

const {call, check, must, keep: keepAs, finish} = await start('flipwarp-topdown-test');
const keep = (label, r) => keepAs(`topdown-${label}`, r);

// 30 by 20 tiles of 24: bigger than the stage both ways, so the camera has to
// scroll in x and in y. Every number checked below follows from this map.
const ROWS = [
    '##############################',
    '#............................#',
    '#............................#',
    '#............................#',
    '#..................o.........#',
    '#............####............#',
    '#............................#',
    '#......................o.....#',
    '#............................#',
    '#............................#',
    '#............................#',
    '########.....................#',
    '#............................#',
    '#........#...................#',
    '#........#...................#',
    '#........#...................#',
    '#..P.ooo.#...................#',
    '#........#...................#',
    '#........#...................#',
    '##############################'
];
const T = 24;
const H = ROWS.length;
const HALF = 8;
// The P is at column 4, row 17: x from 72 to 96, y from 72 to 96.
const START = {x: 3.5 * T, y: ((H - 17) * T) + HALF};
// Column 10 is a wall from row 14 down; row 12 is a wall from column 1 to 8.
const RIGHT_STOP = (9 * T) - HALF;
const UP_STOP = ((H - 12) * T) - HALF;
// The outside walls.
const LEFT_STOP = T + HALF;
const DOWN_STOP = T + HALF;

// --- making it ------------------------------------------------------------------

await must('the level on the Stage', 'add_piece', {sprite: 'Stage', piece: 'level', settings: {ROWS}});
const grass = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">' +
    '<rect width="480" height="360" fill="#95d5b2"/>' +
    '<g fill="#74c69d"><circle cx="60" cy="50" r="4"/><circle cx="200" cy="120" r="4"/>' +
    '<circle cx="330" cy="70" r="4"/><circle cx="420" cy="250" r="4"/><circle cx="120" cy="290" r="4"/></g></svg>';
await must('a grass backdrop', 'add_costume', {sprite: 'Stage', name: 'grass', svg: grass});

const stone = {
    palette: {a: '#8d99ae', b: '#6c7a89', c: '#4a5568'},
    rows: ['aaaaabaaaaab', 'aaaaabaaaaab', 'aaaaabaaaaab', 'cccccccccccc', 'aabaaaaabaaa', 'aabaaaaabaaa',
        'aabaaaaabaaa', 'cccccccccccc', 'aaaaabaaaaab', 'aaaaabaaaaab', 'aaaaabaaaaab', 'cccccccccccc'],
    scale: 2
};
await must('a Tiles sprite', 'create_sprite', {name: 'Tiles', pixels: stone});
await must('its costume is named after the map character', 'rename_costume', {sprite: 'Tiles', costume: 1, name: '#'});
await must('the tiles piece', 'add_piece', {sprite: 'Tiles', piece: 'tiles'});

// Six frames, named the way the topdown piece asks for them.
const palette = {k: '#1d3557', h: '#6d4c41', s: '#f4c08a', e: '#1d3557', b: '#2a9d8f', l: '#264653'};
const legs1 = ['.kl..lk.', '.kk..kk.'];
const legs2 = ['.kl..kk.', '.kk.....'];
const frames = {
    down: ['..kkkk..', '.khhhhk.', '.kseesk.', '.kssssk.', 'kbbbbbbk', 'kbbbbbbk'],
    up: ['..kkkk..', '.khhhhk.', '.khhhhk.', '.khhhhk.', 'kbbbbbbk', 'kbbbbbbk'],
    side: ['..kkkk..', '.khhhhk.', '.khhsesk', '.khssssk', '..kbbbk.', '.kbbbbk.']
};
const art = (facing, legs) => ({palette, rows: [...frames[facing], ...legs], scale: 2});
await must('a Player sprite', 'create_sprite', {name: 'Player', pixels: art('down', legs1)});
await must('its first frame is down1', 'rename_costume', {sprite: 'Player', costume: 1, name: 'down1'});
for (const [name, facing, legs] of [['down2', 'down', legs2], ['up1', 'up', legs1], ['up2', 'up', legs2],
    ['side1', 'side', legs1], ['side2', 'side', legs2]]) {
    await must(`frame ${name}`, 'add_costume', {sprite: 'Player', name, pixels: art(facing, legs), select: false});
}
const sheet = await must('the frames side by side', 'costume_sheet', {sprite: 'Player'});
keep('frames', sheet);
const added = await must('the topdown piece', 'add_piece', {sprite: 'Player', piece: 'topdown'});
check(added.text.includes('topdown') && added.text.includes('collision'), 'it brought collision with it',
    added.text);

const coin = {
    palette: {o: '#b07d00', y: '#ffd60a', Y: '#fff3b0'},
    rows: ['.oooo.', 'oyyyyo', 'oyYyyo', 'oyyYyo', 'oyyyyo', '.oooo.'],
    scale: 2
};
await must('a Coin sprite', 'create_sprite', {name: 'Coin', pixels: coin});
await must('the coins piece', 'add_piece', {sprite: 'Coin', piece: 'coins'});
await must('the default sprite goes', 'delete_sprite', {sprite: 'Sprite1'});

const health = await call('health_check');
check(!/\[problem\]/.test(health.text), 'the health check finds no problems', health.text);

// --- playing it --------------------------------------------------------------

const state = async () => JSON.parse((await call('get_state', {})).text);
const sprite = (s, name) => s.sprites.find(x => x.name === name);
const step = frames => call('step_frames', {frames});
const set = (name, value) => call('set_variable', {sprite: 'Player', name, value});
const player = async () => sprite(await state(), 'Player');
const hold = keys => call('hold_keys', {keys});
const letGo = () => call('release_keys', {});
// Back to the start, standing still.
const reset = async () => {
    await set('px', START.x);
    await set('py', START.y);
    await set('vx', 0);
    await set('vy', 0);
    await step(2);
};

await must('green flag', 'green_flag');
await must('pause', 'pause');
await step(30);
let p = await player();
check(p.variables.px === START.x && p.variables.py === START.y,
    `the player starts at the P (${p.variables.px}, ${p.variables.py})`);
await step(30);
p = await player();
check(p.variables.py === START.y && Number(p.variables.vy) === 0, 'with no keys it stays put: no gravity');
const coins = (ROWS.join('').match(/o/g) || []).length;
check(sprite(await state(), 'Coin').clones === coins, `a coin for every "o" (${coins})`);
keep('start', await call('screenshot', {}));

// Right: along the row of coins and into the wall.
await hold(['right arrow']);
await step(60);
p = await player();
check(p.costume.startsWith('side') && p.direction === 90, `walking right faces right (${p.costume}, ${p.direction})`);
await letGo();
await step(20);
let s = await state();
p = sprite(s, 'Player');
check(p.variables.px === RIGHT_STOP && p.variables.py === START.y,
    `the wall stops it exactly (px ${p.variables.px}, expected ${RIGHT_STOP})`);
check(s.stage.globals.score === 3, `it picked up the three coins on the way (score ${s.stage.globals.score})`);

// Up and right at once against that wall: it slides up along it.
await hold(['right arrow', 'up arrow']);
await step(10);
await letGo();
p = await player();
check(p.variables.px === RIGHT_STOP && p.variables.py > START.y + 15,
    `walking into the wall at an angle slides along it (${p.variables.px}, ${Math.round(p.variables.py)})`);
await step(20);
keep('at-the-wall', await call('screenshot', {}));

// Up into the wall above.
await reset();
await hold(['up arrow']);
await step(60);
p = await player();
check(p.costume.startsWith('up'), `walking up shows the back (${p.costume})`);
await letGo();
await step(20);
p = await player();
check(p.variables.py === UP_STOP && p.variables.px === START.x,
    `the wall above stops it exactly (py ${p.variables.py}, expected ${UP_STOP})`);

// Left into the outside wall.
await reset();
await hold(['left arrow']);
await step(40);
p = await player();
check(p.direction === -90, `walking left faces left (${p.direction})`);
await letGo();
await step(20);
p = await player();
check(p.variables.px === LEFT_STOP, `the left wall stops it exactly (px ${p.variables.px}, expected ${LEFT_STOP})`);

// Down into the outside wall.
await reset();
await hold(['down arrow']);
await step(40);
p = await player();
check(p.costume.startsWith('down'), `walking down shows the front (${p.costume})`);
await letGo();
await step(20);
p = await player();
check(p.variables.py === DOWN_STOP, `the bottom wall stops it exactly (py ${p.variables.py}, expected ${DOWN_STOP})`);

// Diagonal in the open: both ways at once.
await set('px', 400);
await set('py', 240);
await step(2);
await hold(['right arrow', 'up arrow']);
await step(15);
await letGo();
p = await player();
check(p.variables.px > 420 && p.variables.py > 260,
    `walking diagonally moves both ways (${Math.round(p.variables.px)}, ${Math.round(p.variables.py)})`);

// The camera, from the start (bottom left) to the top right of the map.
await reset();
await step(60);
s = await state();
check(s.stage.globals.viewX === 240 && s.stage.globals.viewY === 180,
    `at the start the camera stops at the bottom left of the map (${s.stage.globals.viewX}, ${s.stage.globals.viewY})`);
await set('px', 600);
await set('py', 400);
await step(60);
s = await state();
const maxX = (ROWS[0].length * T) - 240;
const maxY = (H * T) - 180;
check(s.stage.globals.viewX === maxX && s.stage.globals.viewY === maxY,
    `at the top right it scrolls both ways and stops at the edges (${s.stage.globals.viewX}, ` +
    `${s.stage.globals.viewY}, expected ${maxX}, ${maxY})`);
p = sprite(s, 'Player');
check(p.x === 600 - maxX && p.y === 400 - maxY, `the player is drawn where the camera says (${p.x}, ${p.y})`);
keep('top-right', await call('screenshot', {}));

await call('resume');
await call('stop');
const logs = await call('get_logs', {});
check(!logs.text.includes('[error]'), 'no errors in the page', logs.text);

if (process.env.DEMO_OUT) {
    const saved = await call('save_project', {path: process.env.DEMO_OUT});
    check(!saved.error, `saved the game to ${process.env.DEMO_OUT}`, saved.text);
}

await finish('the topdown piece makes a game that plays');
