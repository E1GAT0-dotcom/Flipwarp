// flipwarp-mcp from end to end: a real MCP client starts the server, a real
// editor connects to it, and Claude's side of every step-1 tool is exercised
// against the real project.
//
//   npm run build
//   node test/flipwarp/mcp-end-to-end.mjs
//   then open http://127.0.0.1:8601/editor.html?mcp in a browser (FLIPWARP_PORT to change it)
//
// The script waits up to two minutes for the editor to connect.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.join(here, '..', '..', 'mcp');
// The SDK is installed in mcp/, not the editor's own node_modules.
const require = createRequire(path.join(mcpDir, 'package.json'));
const {Client} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {StdioClientTransport} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);

const client = new Client({name: 'flipwarp-test', version: '0'});
await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(mcpDir, 'server.mjs')],
    // The whole environment, so FLIPWARP_PORT reaches the server.
    env: {...process.env},
    stderr: 'inherit'
}));
const editorUrl = `http://127.0.0.1:${Number(process.env.FLIPWARP_PORT) || 8601}/editor.html?mcp`;

const call = async (name, args = {}) => {
    const r = await client.callTool({name, arguments: args});
    const out = r.content.map(c => c.text).join('\n');
    return {error: !!r.isError, text: out};
};

let failures = 0;
const step = async (label, name, args, expect) => {
    const r = await call(name, args);
    const ok = expect(r);
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok || process.env.VERBOSE) console.log(r.text.slice(0, 600).split('\n').map(l => `       ${l}`).join('\n'));
    return r;
};

const tools = await client.listTools();
console.log(`tools: ${tools.tools.map(t => t.name).join(', ')}`);

console.log(`waiting for the editor at ${editorUrl} ...`);
const until = Date.now() + 120000;
let connected = false;
while (Date.now() < until && !connected) {
    connected = !(await call('open_editor', {launch: false})).error;
    if (!connected) await new Promise(r => setTimeout(r, 1000));
}
if (!connected) {
    console.log('FAIL the editor never connected');
    process.exit(1);
}

await step('overview lists the default sprite', 'project_overview', {}, r => !r.error && r.text.includes('Sprite1'));
await step('reference has the guide and blocks', 'text_reference', {}, r => r.text.includes('## Blocks') &&
    r.text.includes('goToXY'));
await step('reference search', 'text_reference', {search: 'pen.'}, r => r.text.includes('pen.penDown'));
await step('create a sprite with an SVG', 'create_sprite', {
    name: 'Player',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#e33"/></svg>'
}, r => !r.error);
await step('a mistake is refused with its line', 'check_text', {
    sprite: 'Player',
    // In the second script, so the hidden @at line for each script above it
    // would push the number down if it were counted.
    text: 'whenGreenFlagClicked {\n  show();\n}\n\nwhenThisSpriteClicked {\n  if (1 != 2) { show(); }\n}'
}, r => r.error && r.text.includes('Line 6,') && r.text.includes('Try this'));

const game = `variable speed;
global variable score;
global broadcast gameOver as "game over";

whenGreenFlagClicked {
  goToXY(0, 0);
  speed = 5;
  score = 0;
  pen.penDown();
  forever {
    if (keyPressed("right arrow")) {
      changeX(speed);
    }
    if (touching("_edge_")) {
      broadcast(gameOver);
    }
  }
}

whenIReceive(gameOver) {
  sayFor("Ouch!", 2);
}`;
await step('check good text', 'check_text', {sprite: 'Player', text: game}, r => !r.error);
await step('write it (loads pen)', 'write_sprite', {sprite: 'Player', text: game},
    r => !r.error && r.text.includes('pen'));
await step('read it back', 'read_sprite', {sprite: 'Player'},
    r => r.text.includes('whenIReceive(gameOver)') && r.text.includes('pen.penDown();'));
await step('overview has the global and pen', 'project_overview', {},
    r => r.text.includes('"score"') && r.text.includes('"pen"'));
await step('find across sprites', 'find', {query: 'gameOver'}, r => r.text.includes('Player'));
await step('health check runs', 'health_check', {}, r => !r.error);
await step('write the stage', 'write_sprite', {
    sprite: 'Stage',
    text: 'global variable score;\n\nwhenGreenFlagClicked {\n  score = 0;\n}'
}, r => !r.error);
await step('undo the stage', 'undo', {}, r => !r.error && r.text.includes('Stage'));
await step('stage is empty again', 'read_sprite', {sprite: 'Stage'}, r => !r.text.includes('whenGreenFlagClicked'));
await step('unknown sprite says what exists', 'read_sprite', {sprite: 'Nobody'},
    r => r.error && r.text.includes('Player'));
await step('turn on other extension text', 'set_extension_text', {enabled: true}, r => r.text.includes('on'));
await step('turn it off again', 'set_extension_text', {enabled: false}, r => r.text.includes('off'));

const file = path.join(os.tmpdir(), `flipwarp-mcp-test-${Date.now()}.sb3`);
await step('save to .sb3', 'save_project', {path: file}, r => !r.error && fs.statSync(file).size > 1000);
await step('rename', 'rename_sprite', {sprite: 'Player', name: 'Hero'}, r => r.text.includes('Hero'));
await step('load the saved file', 'load_project', {path: file}, r => !r.error && r.text.includes('Player'));
await step('it still reads', 'read_sprite', {sprite: 'Player'}, r => r.text.includes('pen.penDown();'));
await step('delete', 'delete_sprite', {sprite: 'Player'}, r => !r.error);
fs.unlinkSync(file);

// --- playing ---------------------------------------------------------------

const square = colour => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40">` +
    `<rect width="40" height="40" fill="${colour}"/></svg>`;
await step('make a player', 'create_sprite', {name: 'Runner', svg: square('#36c'), x: 0, y: 0}, r => !r.error);
await step('make a button', 'create_sprite', {name: 'Button', svg: square('#c33'), x: -150, y: 100},
    r => !r.error);
await step('make a ball', 'create_sprite', {name: 'Ball', svg: square('#3c3'), x: -230, y: -120}, r => !r.error);

await step('write the runner', 'write_sprite', {sprite: 'Runner', text: `global variable points;

whenGreenFlagClicked {
  goToXY(0, 0);
  points = 0;
  forever {
    if (keyPressed("right arrow")) {
      changeX(4);
    }
  }
}

whenKeyPressed("space") {
  points += 1;
}

whenKeyPressed("a") {
  askAndWait("name?");
  say(join("hi ", answer()));
}`}, r => !r.error);
await step('write the button', 'write_sprite', {sprite: 'Button', text: `whenGreenFlagClicked {
  goToXY(-150, 100);
  say("");
}

whenThisSpriteClicked {
  say("clicked!");
}`}, r => !r.error);
await step('write the ball', 'write_sprite', {sprite: 'Ball', text: `whenGreenFlagClicked {
  goToXY(-230, -120);
  forever {
    changeX(1);
  }
}`}, r => !r.error);

const stateOf = async () => JSON.parse((await call('get_state', {})).text);
const spriteIn = (s, name) => s.sprites.find(x => x.name === name);

await step('green flag', 'green_flag', {wait_ms: 300}, r => !r.error);
let s = await stateOf();
const hidden = s.visible === false;
if (hidden) console.log('note: the editor tab is hidden; timings will be loose');
console.log(`ok   state reads: running=${s.running}, runner at ${spriteIn(s, 'Runner').x}`);

await step('hold right arrow for a while', 'play', {steps: [
    {do: 'hold', keys: ['right arrow']},
    {do: 'wait', ms: 600},
    {do: 'release'},
    {do: 'state', sprites: ['Runner']}
]}, r => !r.error && r.text.includes('released all keys'));
s = await stateOf();
await step('the runner moved right', 'get_state', {sprites: ['Runner']},
    () => spriteIn(s, 'Runner').x > 20);

await step('space adds a point', 'press_keys', {keys: ['space']}, r => !r.error);
s = await stateOf();
await step('points is 1', 'get_state', {}, () => s.stage.globals.points === 1);

await step('click the button', 'click', {x: -150, y: 100}, r => !r.error);
await new Promise(r => setTimeout(r, 200));
s = await stateOf();
await step('the button says clicked', 'get_state', {},
    () => JSON.stringify(spriteIn(s, 'Button').saying) === '{"say":"clicked!"}');

await step('a bad key name is refused', 'press_keys', {keys: ['jump']},
    r => r.error && r.text.includes('not a key Scratch knows'));

await step('pause', 'pause', {}, r => r.text.includes('"frozen": true'));
const x1 = spriteIn(await stateOf(), 'Ball').x;
await step('step 10 frames', 'step_frames', {frames: 10}, r => r.text.includes('ran 10 frame'));
const x2 = spriteIn(await stateOf(), 'Ball').x;
await step(`the ball moved exactly 10 (${x1} -> ${x2})`, 'get_state', {}, () => x2 - x1 === 10);
await step('a paused project still has a picture', 'screenshot', {grid: true},
    r => !r.error && r.text.includes('480x360'));
// The same with a key held: exact, whether or not the tab is visible.
await step('hold right arrow while paused', 'hold_keys', {keys: ['right arrow']}, r => !r.error);
const r1 = spriteIn(await stateOf(), 'Runner').x;
await step('step 30 frames', 'step_frames', {frames: 30}, r => r.text.includes('ran 30 frame'));
const r2 = spriteIn(await stateOf(), 'Runner').x;
await step(`the runner moved exactly 120 (${r1} -> ${r2})`, 'get_state', {}, () => r2 - r1 === 120);
await step('let go', 'release_keys', {}, r => r.text.includes('all keys'));
await step('resume', 'resume', {}, r => r.text.includes('"frozen": false'));

await step('ask a question', 'press_keys', {keys: ['a']}, r => !r.error);
await new Promise(r => setTimeout(r, 300));
s = await stateOf();
await step('the question shows in state', 'get_state', {}, () => s.question === 'name?');
await step('answer it', 'answer_question', {text: 'Bob'}, r => !r.error);
await new Promise(r => setTimeout(r, 300));
s = await stateOf();
await step('the answer is used', 'get_state', {},
    () => JSON.stringify(spriteIn(s, 'Runner').saying) === '{"say":"hi Bob"}' && s.question === null);
await step('answering with no question is refused', 'answer_question', {text: 'x'}, r => r.error);

await step('move the mouse', 'move_mouse', {x: 100, y: -50}, r => !r.error);
s = await stateOf();
await step('the mouse is there', 'get_state', {}, () => Math.abs(s.mouse.x - 100) < 0.5 && Math.abs(s.mouse.y + 50) < 0.5);

const shot = await client.callTool({name: 'wait', arguments: {ms: 100, screenshot: true}});
const picture = shot.content.find(c => c.type === 'image');
const okPicture = picture && picture.mimeType === 'image/png' &&
    Buffer.from(picture.data, 'base64').subarray(1, 4).toString() === 'PNG';
if (!okPicture) failures++;
console.log(`${okPicture ? 'ok  ' : 'FAIL'} wait returns a real PNG`);

// --- drawing -----------------------------------------------------------------

// SAVE_PICTURES=<folder> keeps every picture a tool answers with, to look at.
const picturesTo = process.env.SAVE_PICTURES;
const imageIn = async (label, name, args) => {
    const r = await client.callTool({name, arguments: args});
    const img = r.content.find(c => c.type === 'image');
    const ok = !r.isError && img && Buffer.from(img.data, 'base64').subarray(1, 4).toString() === 'PNG';
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) console.log(`       ${r.content.filter(c => c.type === 'text').map(c => c.text).join(' ')}`);
    if (img && picturesTo) {
        fs.mkdirSync(picturesTo, {recursive: true});
        fs.writeFileSync(path.join(picturesTo, `${label.replace(/[^a-z0-9]+/gi, '-')}.png`),
            Buffer.from(img.data, 'base64'));
    }
    return r.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
};

const robot = (armUp, eye) => `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="60" viewBox="0 0 48 60">
<rect x="10" y="14" width="28" height="30" rx="4" fill="#7a8cff" stroke="#1a1a2e" stroke-width="2"/>
<rect x="14" y="2" width="20" height="14" rx="3" fill="#a6b2ff" stroke="#1a1a2e" stroke-width="2"/>
<circle cx="${eye}" cy="9" r="2.5" fill="#1a1a2e"/>
<rect x="38" y="${armUp ? 8 : 18}" width="6" height="16" rx="3" fill="#7a8cff" stroke="#1a1a2e" stroke-width="2"/>
<rect x="14" y="44" width="7" height="14" fill="#5a6ad8" stroke="#1a1a2e" stroke-width="2"/>
<rect x="27" y="44" width="7" height="14" fill="#5a6ad8" stroke="#1a1a2e" stroke-width="2"/>
</svg>`;
const slime = {
    palette: {k: '#1b2a1b', g: '#4caf50', l: '#8bd48e', w: '#ffffff'},
    rows: [
        '....kkkkkk....',
        '..kkggggggkk..',
        '.kgglggggggk..',
        '.kglwkggwkggk.',
        'kgggkkggkkgggk',
        'kggggggggggggk',
        'kggggkkkkggggk',
        '.kkkkkkkkkkkk.'
    ],
    scale: 4
};

let said = await imageIn('preview an svg', 'preview_drawing', {svg: robot(false, 28)});
await step('the preview gives the size', 'preview_drawing', {svg: robot(false, 28)},
    r => r.text.includes('48x60 steps') && said.includes('48x60'));
said = await imageIn('preview pixel art', 'preview_drawing', {pixels: slime});
await step('pixel size is art x scale', 'preview_drawing', {pixels: slime}, r => r.text.includes('56x32'));
await step('a bad pixel is refused with its place', 'preview_drawing', {
    pixels: {palette: {k: '#000'}, rows: ['kk', 'kx']}
}, r => r.error && r.text.includes('Row 2, column 2'));
await step('a broken svg is refused', 'preview_drawing', {svg: '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="5"><rect'},
    r => r.error && r.text.includes('not well formed'));

await imageIn('create a pixel sprite', 'create_sprite', {name: 'Slime', pixels: slime, x: 100, y: -100});
await imageIn('create an svg sprite', 'create_sprite', {name: 'Robot', svg: robot(false, 28), x: -100, y: -100});
await imageIn('add an animation frame', 'add_costume', {sprite: 'Robot', name: 'wave', svg: robot(true, 28)});
await imageIn('add a frame without switching', 'add_costume',
    {sprite: 'Robot', name: 'blink', svg: robot(false, 30), select: false});
const tinyPng = path.join(os.tmpdir(), `flipwarp-mcp-${Date.now()}.png`);
// A 12x12 red square with a see-through corner, written out by hand so the
// test needs no image library.
const makePng = (w, h, pixel) => {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(body));
        return Buffer.concat([len, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(h, 4);
    header[8] = 8; // bits per channel
    header[9] = 6; // RGBA
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) Buffer.from(pixel(x, y)).copy(raw, (y * ((w * 4) + 1)) + 1 + (x * 4));
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
fs.writeFileSync(tinyPng, makePng(12, 12, (x, y) => (x < 4 && y < 4 ? [0, 0, 0, 0] : [220, 40, 40, 255])));
await imageIn('add a costume from a png file', 'add_costume',
    {sprite: 'Robot', name: 'dot', file: tinyPng, select: false});
fs.unlinkSync(tinyPng);
await imageIn('add a png pixel costume', 'add_costume',
    {sprite: 'Slime', name: 'squash', pixels: {...slime, format: 'png'}, select: false});
// Sizes are what the stage shows, whatever the drawing was made from.
await step('pixel art is its art size times its scale', 'list_costumes', {sprite: 'Slime'},
    r => (r.text.match(/56x32 steps/g) || []).length === 2);
await step('a png is one step per pixel', 'list_costumes', {sprite: 'Robot'},
    r => r.text.includes('"dot" (costume 4, 12x12 steps, turns around 6,6'));
// Scratch sizes an SVG by its viewBox; a drawing whose width and height say
// otherwise is fitted to what width and height say.
const bigRobot = robot(false, 28).replace('width="48" height="60"', 'width="96" height="120"');
await step('an svg previews at its width and height', 'preview_drawing', {svg: bigRobot},
    r => r.text.includes('96x120'));
await step('and goes in at that size', 'add_costume', {sprite: 'Robot', name: 'big', svg: bigRobot, select: false},
    r => r.text.includes('96x120 steps'));
await step('an svg with no size is refused', 'preview_drawing',
    {svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>'},
    r => r.error && r.text.includes('needs a size'));
await step('drop the big one again', 'delete_costume', {sprite: 'Robot', costume: 'big'}, r => !r.error);
await step('the costumes are listed, wave current', 'list_costumes', {sprite: 'Robot'},
    r => r.text.includes('* "wave"') && r.text.includes('"blink" (costume 3') && r.text.includes('"dot" (costume 4'));

await step('a script switches by name', 'write_sprite', {sprite: 'Robot', text: `whenGreenFlagClicked {
  switchCostume("blink");
}`}, r => !r.error);
await imageIn('redraw a frame in place', 'replace_costume',
    {sprite: 'Robot', costume: 'blink', svg: robot(false, 22)});
await step('it kept its name and number', 'list_costumes', {sprite: 'Robot'},
    r => r.text.includes('"blink" (costume 3') && (r.text.match(/costume \d/g) || []).length === 4);
// The Slime is not the sprite open in the editor (the Robot is): the folders
// addon once made this fail.
await imageIn('redraw a frame of a sprite not open in the editor', 'replace_costume', {
    sprite: 'Slime', costume: 'squash', pixels: {...slime, rows: [...slime.rows.slice(2), '.'.repeat(14), '.'.repeat(14)]}
});
await step('the slime kept its costumes', 'list_costumes', {sprite: 'Slime'},
    r => r.text.includes('"squash" (costume 2') && (r.text.match(/costume \d/g) || []).length === 2);
await step('run it', 'green_flag', {wait_ms: 300}, r => !r.error);
s = await stateOf();
await step('the script still finds the redrawn costume', 'get_state', {},
    () => spriteIn(s, 'Robot').costume === 'blink');
await step('stop again', 'stop', {}, r => !r.error);

await step('a turning point can be set', 'add_costume',
    {sprite: 'Robot', name: 'pivot', svg: robot(false, 28), center: {x: 24, y: 58}, select: false},
    r => r.text.includes('turns around 24,58'));
await step('rename', 'rename_costume', {sprite: 'Robot', costume: 'dot', name: 'spot'},
    r => r.text.includes('"spot"'));
await step('delete', 'delete_costume', {sprite: 'Robot', costume: 'spot'},
    r => !r.error && !JSON.parse(r.text).left.includes('spot'));
await step('switch', 'switch_costume', {sprite: 'Robot', costume: 1}, r => r.text.includes('Robot'));
await step('a costume that is not there says what is', 'switch_costume', {sprite: 'Robot', costume: 'nope'},
    r => r.error && r.text.includes('"wave"'));
await imageIn('look at all the frames', 'costume_sheet', {sprite: 'Robot'});
await imageIn('a backdrop on the stage', 'add_costume', {
    sprite: 'Stage',
    name: 'sky',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">' +
        '<rect width="480" height="360" fill="#bde0fe"/><rect y="300" width="480" height="60" fill="#6a994e"/></svg>'
});
await imageIn('everything on the stage', 'screenshot', {});
const lonely = await call('create_sprite', {name: 'Lonely'});
await step('the last costume cannot be deleted', 'delete_costume', {sprite: 'Lonely', costume: 1},
    r => !lonely.error && r.error && r.text.includes('at least one'));

await step('logs can be read', 'get_logs', {clear: true}, r => !r.error);
await step('stop', 'stop', {}, r => !r.error);
s = await stateOf();
await step('nothing left running or held', 'get_state', {}, () => s.keysHeld.length === 0);

await client.close();
if (failures) {
    console.log(`${failures} step(s) failed`);
    process.exit(1);
}
console.log('flipwarp-mcp works from end to end');
process.exit(0);
