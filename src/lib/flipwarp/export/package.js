// "Export as code": a project as source code for another place to run it.
//
// The editor does the exporting, for the File menu and for Claude's
// export_project tool alike: it has the project's files and a browser to
// turn pictures into whatever a target needs. Each target is a front end
// (front.js, shared) and a writer of its own.

import {readProject} from './front.js';
import {writeWebGame} from './web.js';
import {writePythonGame} from './python.js';
import {writeGameLabGame} from './gamelab.js';
import {startHere} from './helper.js';
import {stripJs, stripPython, stripCss} from './strip.js';
import {jsUnits, pyUnits, packSource, fingerprintUnits, fingerprint} from './source.js';

export const TARGETS = {
    weblab: {
        title: 'Code.org Web Lab',
        description: 'HTML, CSS and JavaScript that runs the game in a web page'
    },
    python: {
        title: 'Python (pygame)',
        description: 'A Python program that runs the game in a window, with pygame'
    },
    gamelab: {
        title: 'Code.org Game Lab',
        description: 'Game Lab JavaScript, with the costumes\' pictures inside the code'
    }
};

const textBytes = text => new TextEncoder().encode(text);

// Files in an export are named for what they are: "player-walk1.svg".
const slug = text => String(text).toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 40) || 'item';

// Pictures and sounds up to this size go inside a one-file Web Lab page.
const SINGLE_FILE_LIMIT = 5 * 1024 * 1024;
// Game Lab will not save a program much over 4 MB (tried: 4 MB saves, 5 MB is refused),
// so code.js, with the pictures inside it, is kept under this.
const GAMELAB_CODE_LIMIT = 4300000;
// How the pictures are shrunk to fit, a step at a time until they do: pixels per
// costume unit (Game Lab shows the stage at 5/6 of Scratch's size) and WebP quality.
const GAMELAB_STEPS = [
    {perUnit: 1, quality: 0.9},
    {perUnit: 5 / 6, quality: 0.8},
    {perUnit: 5 / 6, quality: 0.65},
    {perUnit: 0.7, quality: 0.6}
];

const MIME_TYPES = {svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp',
    wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg'};
const base64 = data => {
    let binary = '';
    for (let i = 0; i < data.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
    }
    return btoa(binary);
};
const dataUrl = (file, data) => `data:${MIME_TYPES[file.split('.').pop()
    .toLowerCase()] || 'application/octet-stream'};base64,${base64(data)}`;
// Script text inside the page: "</script" in it would end the script early.
const inScript = text => String(text).replace(/<\/script/gi, '<\\/script');

/**
 * Everything in one index.html: the style, the runtime, the pictures and sounds (as data), and the game.
 * @param {string} title the page title, HTML-escaped
 * @param {object} options the project's options (stage size)
 * @param {string} runtime scratch-runtime.js
 * @param {string} game game.js
 * @param {Array<[string, Uint8Array]>} assets the pictures and sounds
 * @returns {string} the page
 */
const singlePage = (title, options, runtime, game, assets) => {
    const table = assets.map(([file, data]) => `  ${JSON.stringify(file)}: "${dataUrl(file, data)}"`).join(',\n');
    return PAGE(title, options.width, options.height)
        .replace('<link rel="stylesheet" href="style.css">', `<style>\n${stripCss(STYLE)}</style>`)
        .replace('<script src="scratch-runtime.js"></script>\n<script src="game.js"></script>',
            `<script>\n${inScript(runtime)}</script>\n` +
            `<script>\nwindow.SCRATCH_ASSETS = {\n${table}\n};\n</script>\n` +
            `<script>\n${inScript(game)}</script>`);
};

// Web Lab takes uploads up to about 5 MB (tried: 4.4 MB is taken, 5.1 MB refused).
const PACK_LIMIT = 4500000;

/**
 * The pictures and sounds packed into a few files, for Web Lab: it will not take
 * sounds as uploads, and uploads each file slowly. A pack is "FWPK", the index's
 * length (4 bytes, little-endian), the index as JSON ([file, type, offset, length]
 * each), then the files. Named .png so Web Lab takes them; they are not pictures.
 * @param {Array<[string, Uint8Array]>} assets the pictures and sounds
 * @returns {Array<[string, Uint8Array]>} the packs, game-assets-1.png and on
 */
const makePacks = assets => {
    // Biggest first, each into the first pack with room: the fewest packs to upload.
    const groups = [];
    for (const [file, data] of assets.slice().sort((a, b) => b[1].length - a[1].length)) {
        const entry = JSON.stringify([file, MIME_TYPES[file.split('.').pop()
            .toLowerCase()] || 'application/octet-stream', 0, data.length]).length + 12;
        let group = groups.find(g => g.size + data.length + entry <= PACK_LIMIT);
        if (!group) {
            group = {items: [], size: 64};
            groups.push(group);
        }
        group.items.push([file, data]);
        group.size += data.length + entry;
    }
    return groups.map((g, n) => {
        let offset = 0;
        const index = g.items.map(([file, data]) => {
            const item = [file, MIME_TYPES[file.split('.').pop()
                .toLowerCase()] || 'application/octet-stream', offset, data.length];
            offset += data.length;
            return item;
        });
        const indexBytes = textBytes(JSON.stringify(index));
        const pack = new Uint8Array(8 + indexBytes.length + offset);
        pack.set(textBytes('FWPK'), 0);
        new DataView(pack.buffer).setUint32(4, indexBytes.length, true);
        pack.set(indexBytes, 8);
        let at = 8 + indexBytes.length;
        for (const [, data] of g.items) {
            pack.set(data, at);
            at += data.length;
        }
        return [`game-assets-${n + 1}.png`, pack];
    });
};

/**
 * One index.html whose pictures and sounds are in packs uploaded beside it.
 * @param {string} title the page title, HTML-escaped
 * @param {object} options the project's options (stage size)
 * @param {string} runtime scratch-runtime.js
 * @param {string} game game.js
 * @param {Array<string>} packs the packs' file names
 * @returns {string} the page
 */
const packedPage = (title, options, runtime, game, packs) => PAGE(title, options.width, options.height)
    .replace('<link rel="stylesheet" href="style.css">', `<style>\n${stripCss(STYLE)}</style>`)
    .replace('<script src="scratch-runtime.js"></script>\n<script src="game.js"></script>',
        `<script>\n${inScript(runtime)}</script>\n` +
        `<script type="text/plain" id="scratch-game">\n${inScript(game)}</script>\n` +
        `<script>\nstartPackedGame(${JSON.stringify(packs)}, "scratch-game");\n</script>`);

const PAGE = (title, width, height) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<main id="game" class="player">
  <div class="controls">
    <button class="green-flag" title="Start">&#9873; Start</button>
    <button class="stop" title="Stop">&#9632; Stop</button>
    <span class="title">${title}</span>
  </div>
  <div class="stage-wrap">
    <canvas class="stage" width="${width}" height="${height}" tabindex="0"></canvas>
    <div class="overlay"></div>
    <div class="start-screen"><span>&#9654; Click to play</span></div>
    <div class="loading">Loading...</div>
    <div class="prompt" style="display: none">
      <div class="prompt-question"></div>
      <div class="prompt-row"><input type="text" aria-label="Your answer"><button>&#10003;</button></div>
    </div>
  </div>
</main>
<script src="scratch-runtime.js"></script>
<script src="game.js"></script>
</body>
</html>
`;

const STYLE = `/* The page around the game: buttons above, the stage below. */
body {
  margin: 0;
  background: #e8edf1;
  font-family: Helvetica, Arial, sans-serif;
  color: #575e75;
}
.player {
  max-width: 1440px;
  margin: 0 auto;
  padding: 8px;
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.controls button {
  border: 1px solid #c6cdd4;
  border-radius: 6px;
  background: #fff;
  padding: 6px 12px;
  font-size: 14px;
  cursor: pointer;
}
.green-flag { color: #3d8c40; }
.stop { color: #c0392b; }
.title { font-weight: bold; }
.stage-wrap {
  position: relative;
  width: 100%;
}
canvas.stage {
  display: block;
  border-radius: 8px;
  background: #fff;
  outline: none;
  touch-action: none;
}
.overlay {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  overflow: hidden;
}
.start-screen, .loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: #fff;
  background: rgba(0, 0, 0, 0.35);
  border-radius: 8px;
  cursor: pointer;
}
.loading { cursor: default; background: rgba(0, 0, 0, 0.55); }
.prompt {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  background: #fff;
  border: 2px solid #d9d9d9;
  border-radius: 8px;
  padding: 8px;
}
.prompt-question { font-weight: bold; margin-bottom: 6px; }
.prompt-row { display: flex; gap: 6px; }
.prompt-row input { flex: 1; font-size: 14px; padding: 4px 8px; border: 1px solid #c6cdd4; border-radius: 12px; }
.prompt-row button { border: none; background: #855cd6; color: #fff; border-radius: 50%; width: 28px; cursor: pointer; }
.monitor {
  position: absolute;
  font-size: calc(12px * var(--k, 1));
  background: #e6f0ff;
  border: 1px solid #c6cdd4;
  border-radius: calc(4px * var(--k, 1));
  padding: calc(2px * var(--k, 1)) calc(5px * var(--k, 1));
  pointer-events: auto;
  white-space: nowrap;
}
.monitor-label { font-weight: bold; margin-right: calc(5px * var(--k, 1)); }
.monitor-value {
  display: inline-block;
  min-width: calc(30px * var(--k, 1));
  text-align: center;
  background: #ff8c1a;
  color: #fff;
  border-radius: calc(4px * var(--k, 1));
  padding: 0 calc(5px * var(--k, 1));
}
.monitor-large { padding: 0; border: none; background: none; }
.monitor-large .monitor-value { font-size: calc(16px * var(--k, 1)); padding: calc(2px * var(--k, 1)) calc(8px * var(--k, 1)); }
.monitor-slider input { display: block; width: 100%; }
.monitor-list { display: flex; flex-direction: column; padding: 0; }
.monitor-list .monitor-label { text-align: center; padding: calc(2px * var(--k, 1)); }
.list-items { flex: 1; overflow: auto; background: #fff; }
.list-row { display: flex; gap: calc(4px * var(--k, 1)); padding: calc(1px * var(--k, 1)) calc(3px * var(--k, 1)); }
.list-index { font-weight: bold; }
.list-item { background: #fc662c; color: #fff; border-radius: 3px; padding: 0 4px; flex: 1; overflow: hidden; }
.list-length { text-align: center; padding: calc(2px * var(--k, 1)); }
`;

const BACK = `
Back into Flipwarp
------------------
In Flipwarp, File > Import from Code.org brings this back as the Scratch project it was made from,
with any changes you made to the code. Choose the code (or this whole folder, zipped) and any
pictures and sounds you uploaded.
`;

const HOW_TO = {
    gamelab: (title, embedded, uploads) => `${title}, exported for Code.org Game Lab
${'='.repeat(title.length + 32)}

Open START-HERE.html: it has a button that copies the code, ready to paste.

What is here
------------
code.js       the whole program: the Scratch runtime first, then the game's sprites and scripts${
    embedded ? `,\n              and last ${uploads ? 'most of ' : ''}the costumes' pictures, written out as text` : ''}
${uploads ? `*.png         ${embedded ? 'the pictures too big to go inside the code' :
        'one picture for each costume and backdrop'}: Game Lab calls them animations\n` : ''
}*.mp3         the sounds

Putting it in Game Lab
----------------------
1. Start a new Game Lab project, and switch the code area to text (the "Show Text" button).
2. Select all the code there, delete it, and paste in everything from code.js.${uploads ? `
3. Open the Animation tab and upload every .png from this folder. Keep their names:
   the code asks for each animation by its file name without ".png".` : `
   The pictures are inside the code: there is nothing to upload in the Animation tab.`}
${uploads ? '4' : '3'}. Sounds: Game Lab plays MP3 files you upload (in the gear-shaped Asset Manager, or
   from playSound's "Choose..." button). Upload each .mp3 here with the same name.
   Code.org does not let code carry sounds; without them the game plays silently.
${uploads ? '5' : '4'}. Press Run, then click the stage to start (that is the green flag).

Game Lab will not save a program much over 4 MB, so the pictures inside the code are
drawn at the size Game Lab shows them and saved as WebP, which is much smaller than PNG.

What is different in Game Lab
-----------------------------
- Game Lab's screen is 400 by 400, so Scratch's 480 by 360 stage is shrunk to fit,
  with bars above and below.
- "Touching" uses each costume's outline box, turned with the sprite, not its exact
  pixels: Game Lab cannot read a picture's pixels.
- Game Lab cannot ask for typed answers, change a sound's volume, pitch or pan, or draw
  the color, brightness, fisheye, whirl, pixelate and mosaic effects (ghost works).
- Game Lab runs older JavaScript (no generators), so each script is a small "state
  machine": numbered steps in a switch, saving which step comes next each time it would
  let other scripts have a turn. Code with no waits in it is ordinary code.
- Game Lab runs programs slower than a browser does, so very busy games can lag.
`,
    python: title => `${title}, exported as Python
${'='.repeat(title.length + 20)}

What is here
------------
main.py             the game itself: every script, as Python
scratch_runtime.py  runs the game the way Scratch does (sprites, clones, the pen, sounds...)
the rest            the costumes, backdrops and sounds, named for what they are

Running it
----------
1. Install Python 3 (python.org) and then pygame:   pip install pygame
2. In this folder:                                    python main.py

The game starts as soon as the window opens, as if the green flag were clicked.
F5 starts it again, Esc stops it, and the window's close button quits.

It also runs on Replit and in other online Python editors that have pygame.
Code.org's Python Lab cannot run it: Python Lab has no pygame.

How the code works
------------------
Each Scratch script is a function in main.py, with its hat written above it
(@Player.when_flag_clicked). Where Scratch lets other scripts have a turn (each
time round a loop, during a wait), the script says "yield", and the runtime moves
on to the next script; once something on the stage has changed, it draws the
frame. That is how many scripts run "at once", as in Scratch.
`,
    weblabSingle: title => `${title}, exported for Code.org Web Lab
${'='.repeat(title.length + 30)}

Open START-HERE.html: it has a button that copies the game, ready to paste.

What is here
------------
index.html        the whole game in one page: the style, the runtime that runs it the way
                  Scratch does, the pictures and sounds, and the game's own scripts
START-HERE.html   the steps, with a Copy button

Putting it in Web Lab
---------------------
1. Start a new "Web Lab (new)" project: studio.code.org/projects/weblab2/new. The old Web Lab
   removes all JavaScript, so the game cannot run there.
2. Open its index.html, select everything, and paste in this index.html instead.
3. Run it, then click the stage or Start. There is nothing to upload: the pictures and
   sounds are inside the page.

To play it on your own computer, open index.html in a browser.

How the code works
------------------
In index.html, the script after the pictures and sounds is the game: each Scratch script
is a function. Where Scratch lets other scripts have a turn (each time round a loop,
during a wait), the script says "yield", and the runtime moves on to the next script;
once something on the stage has changed, it draws the frame. That is how many scripts
run "at once", as in Scratch.
`,
    weblabPacked: (title, packs) => `${title}, exported for Code.org Web Lab
${'='.repeat(title.length + 30)}

Open START-HERE.html: it has a button that copies the game, ready to paste.

What is here
------------
index.html        the whole game in one page: the style, the runtime that runs it the way
                  Scratch does, and the game's own scripts
${packs.map(p => `${p.padEnd(18)}the game's pictures and sounds, packed together`).join('\n')}
START-HERE.html   the steps, with a Copy button

The game's pictures and sounds are too big to go inside the page, so they are packed
into ${packs.length === 1 ? 'one file' : `${packs.length} files`} named .png. They are not really pictures: Web Lab will not take
sounds as uploads, and uploading hundreds of files one by one is slow, so the page
reads the packs and unpacks them when it starts.

Putting it in Web Lab
---------------------
1. Start a new "Web Lab (new)" project: studio.code.org/projects/weblab2/new. The old Web Lab
   removes all JavaScript, so the game cannot run there.
2. Open its index.html, select everything, and paste in this index.html instead.
3. In the Files list click +, then Upload, and choose ${packs.length === 1 ? packs[0] :
        `all of ${packs.join(', ')} at once`}.
   Keep the names.
4. Run it, then click the stage or Start.

Opened straight from a file, the browser will not let the page read the packs: play it in
Web Lab, or serve this folder from a web server (for example: python -m http.server).
`,
    weblab: title => `${title}, exported for Code.org Web Lab
${'='.repeat(title.length + 30)}

What is here
------------
index.html          the page: Start and Stop buttons and the stage
style.css           how the page looks
scratch-runtime.js  runs the game the way Scratch does (sprites, clones, the pen, sounds...)
game.js             the game itself: every script, as JavaScript
the rest            the costumes, backdrops and sounds, named for what they are

Putting it in Web Lab
---------------------
1. Start a new "Web Lab (new)" project: studio.code.org/projects/weblab2/new. The old Web Lab
   removes all JavaScript, so the game cannot run there.
2. Replace index.html and style.css with the ones here (open each, copy all, paste).
3. Add two new files named scratch-runtime.js and game.js, and paste these in.
4. Upload every picture and sound file from this folder (keep the same names).
5. Run it, then click the stage or Start.

To try it on your own computer instead, open index.html in a browser. Opened straight
from a file, "touching" checks use rectangles rather than the drawings' exact shapes;
served from a website (Web Lab, or any web server) they are exact.

How the code works
------------------
Each Scratch script is a function in game.js. Where Scratch lets other scripts have
a turn (each time round a loop, during a wait), the script says "yield", and the
runtime moves on to the next script; once something on the stage has changed, it
draws the frame. That is how many scripts run "at once", as in Scratch.
`
};

// The size of a picture, without a browser: from the SVG's width and height,
// or a PNG's header. Used when the editor's measuring is not there (tests).
const plainSize = (data, format) => {
    if (format === 'svg') {
        const text = new TextDecoder().decode(data.slice(0, 2000));
        const tag = (text.match(/<svg[^>]*>/) || [''])[0];
        const w = parseFloat((tag.match(/\swidth="([\d.]+)/) || [])[1]) || 100;
        const h = parseFloat((tag.match(/\sheight="([\d.]+)/) || [])[1]) || 100;
        return [w, h];
    }
    if (format === 'png' && data.length > 24) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        return [view.getUint32(16), view.getUint32(20)];
    }
    return [100, 100];
};

/**
 * A costume as Game Lab will have it: a PNG (or JPG), its size in costume units,
 * its turning resolution, and the box of its drawn pixels.
 * @param {object} costume from readProject
 * @param {Uint8Array} data the costume's file
 * @param {object} options {rasterize, measure}, from the editor
 * @returns {Promise<object>} {data, ext, measure: {width, height, resolution, box}, note}
 */
const gameLabPicture = async (costume, data, options) => {
    let picture = data;
    let ext = costume.dataFormat;
    let resolution = costume.bitmapResolution || 1;
    let note = null;
    if (costume.dataFormat === 'svg') {
        if (options.rasterize) {
            const png = await options.rasterize(data);
            picture = png.data;
            ext = 'png';
            resolution = png.scale;
        } else {
            note = `the costume "${costume.name}" is an SVG; Game Lab needs it as a PNG`;
        }
    }
    let measured = picture !== data && options.lastDrawn ? options.lastDrawn(picture) : null;
    if (!measured && options.measure) {
        try {
            measured = await options.measure(picture, ext);
        } catch (e) {
            measured = null;
        }
    }
    if (!measured) {
        const [w, h] = plainSize(picture, ext);
        measured = {width: w, height: h, box: [0, 0, w, h]};
    }
    return {
        data: picture,
        ext,
        note,
        measure: {
            width: measured.width / resolution,
            height: measured.height / resolution,
            resolution,
            // The drawn pixels' edges, in from by half a costume unit, as Scratch measures.
            box: [(measured.box[0] / resolution) + 0.5, (measured.box[1] / resolution) + 0.5,
                (measured.box[2] / resolution) - 0.5, (measured.box[3] / resolution) - 0.5]
        }
    };
};

// Run fn over items, at most limit at once.
const runLimited = async (items, limit, fn) => {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const item = items[next++];
            await fn(item);
        }
    };
    const workers = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
    await Promise.all(workers);
};

/**
 * Export a project from its files: project.json and its costumes and sounds.
 * @param {object} source file name -> Uint8Array, as in an .sb3
 * @param {string} target a key of TARGETS
 * @param {string} title the project's name
 * @param {object} runtimes target -> the runtime file's text (scratch-runtime.js, scratch_runtime.py)
 * @param {object} [options] {rasterize(svgBytes) -> Promise<{data: Uint8Array, scale: number}>}: draws an SVG
 *     costume as a PNG, for targets that cannot show SVGs well (Python)
 * @returns {Promise<{files: Array<[string, Uint8Array]>, notes: Array, folder: string}>} the export
 */
export const buildExport = async (source, target, title, runtimes, options = {}) => {
    if (!TARGETS[target]) throw new Error(`Flipwarp cannot export to "${target}".`);
    const name = String(title || 'Project').replace(/\.sb3$/i, '')
        .trim() || 'Project';
    const project = JSON.parse(new TextDecoder().decode(source['project.json']));
    const parsed = readProject(project);
    const python = target === 'python';
    const gamelab = target === 'gamelab';
    const glCostumes = {};
    const glSounds = {};
    const glSoundFiles = {};

    // Each costume and sound file, under a readable name.
    const files = {};
    const out = [];
    const notes = [];
    const used = new Set(['index.html', 'style.css', 'scratch-runtime.js', 'game.js', 'readme.txt', 'main.py',
        'start-here.html', 'code.js',
        'scratch_runtime.py']);
    const fileName = (owner, item, ext) => {
        const base = `${slug(owner)}-${slug(item)}`;
        let file = `${base}.${ext}`;
        let n = 2;
        while (used.has(file.toLowerCase())) file = `${base}-${n++}.${ext}`;
        used.add(file.toLowerCase());
        return file;
    };
    // The costumes that need drawing (SVGs as PNGs) or measuring are done
    // first, a few at a time, then named and added in the project's order.
    const progress = (label, done, total) => {
        if (options.progress) options.progress({label, done, total});
    };
    const jobs = [];
    const seen = new Set();
    for (const t of parsed.targets) {
        const owner = t.isStage ? 'stage' : t.name;
        for (const costume of t.costumes) {
            if (seen.has(costume.md5ext) || !source[costume.md5ext]) continue;
            seen.add(costume.md5ext);
            jobs.push({owner, costume, data: source[costume.md5ext]});
        }
    }
    const needsWork = job => gamelab || (python && job.costume.dataFormat === 'svg' && options.rasterize);
    const working = jobs.filter(needsWork);
    let finished = 0;
    await runLimited(working, 4, async job => {
        if (gamelab) {
            job.picture = await gameLabPicture(job.costume, job.data, options);
        } else {
            try {
                job.png = await options.rasterize(job.data);
            } catch (e) {
                job.failed = true;
            }
        }
        finished++;
        progress(`Drawing the costumes: ${finished} of ${working.length}`, finished, working.length);
    });
    // Game Lab: each costume's picture, chosen below to go inside code.js or be uploaded.
    const glJobs = [];
    const glPictures = [];
    for (const job of jobs) {
        const {owner, costume, data} = job;
        if (gamelab) {
            const picture = job.picture;
            job.file = fileName(owner, costume.name, picture.ext);
            job.animation = job.file.replace(/\.[^.]+$/, '');
            glCostumes[costume.md5ext] = {...picture.measure, animation: job.animation};
            glJobs.push(job);
            if (picture.note) notes.push({where: owner, what: picture.note});
            continue;
        }
        if (job.png) {
            const file = fileName(owner, costume.name, 'png');
            files[costume.md5ext] = {file, scale: job.png.scale};
            out.push([file, job.png.data]);
            continue;
        }
        if (job.failed) {
            notes.push({where: owner, what: `the costume "${costume.name}" could not be drawn as a picture ` +
                'pygame shows well, so it is kept as an SVG'});
        }
        const file = fileName(owner, costume.name, costume.md5ext.split('.').pop());
        files[costume.md5ext] = python ? {file} : file;
        out.push([file, data]);
    }
    for (const t of parsed.targets) {
        const owner = t.isStage ? 'stage' : t.name;
        for (const sound of t.sounds) {
            if (files[sound.md5ext] || glSounds[sound.md5ext]) continue;
            const data = source[sound.md5ext];
            if (!data) continue;
            if (gamelab) {
                // Game Lab plays MP3s: a sound that is not one is made one, if the editor can.
                let mp3 = sound.dataFormat === 'mp3' ? data : null;
                if (!mp3 && options.toMp3) {
                    progress(`Making the sounds MP3s: ${sound.name}`, 1, 1);
                    try {
                        mp3 = await options.toMp3(sound.md5ext, data);
                    } catch (e) {
                        mp3 = null;
                    }
                }
                const file = fileName(owner, sound.name, mp3 ? 'mp3' : sound.md5ext.split('.').pop());
                glSounds[sound.md5ext] = file.replace(/\.[^.]+$/, '.mp3');
                glSoundFiles[sound.md5ext] = file;
                out.push([file, mp3 || data]);
                if (!mp3) {
                    notes.push({where: owner, what: `the sound "${sound.name}" could not be made an MP3: convert ` +
                        `${file} to ${glSounds[sound.md5ext]} before uploading it`});
                }
                continue;
            }
            const file = fileName(owner, sound.name, sound.md5ext.split('.').pop());
            files[sound.md5ext] = python ? {file} : file;
            out.push([file, data]);
        }
    }
    // The project, carried inside the code for Import from Code.org. SVG costumes
    // that the export turns into pictures are carried as they were, while they
    // are small enough not to crowd out the pictures (in Game Lab).
    const svgOriginals = {};
    const converted = gamelab ? jobs.filter(j => j.costume.dataFormat === 'svg') :
        python ? jobs.filter(j => j.png) : [];
    const svgTotal = converted.reduce((sum, j) => sum + j.data.length, 0);
    if (!gamelab || svgTotal <= 600000) {
        for (const j of converted) svgOriginals[j.costume.md5ext] = new TextDecoder().decode(j.data);
    }
    const sourceOf = (assets, units, code) => ({v: 1, target, title: name, project, units, code, assets});
    if (gamelab) {
        // As many pictures as fit go inside code.js: shrunk a step at a time until
        // they all fit, then, if they still do not, the biggest are left to upload.
        const runtimeSize = String(runtimes.gamelab || '').length;
        const draft = writeGameLabGame(parsed, glCostumes, glSounds, name);
        const codeSize = draft.code.length;
        const assetGuess = {};
        for (const md5 of Object.keys(svgOriginals)) assetGuess[md5] = {t: svgOriginals[md5]};
        const sourceSize = (await packSource(sourceOf(assetGuess, [], ''))).length +
            (draft.units.length * 120) + (jobs.length * 80) + 2000;
        // Room for the pictures, less a margin for the costumes' new sizes and the
        // costumePictures function round them, and the project carried with them.
        const room = GAMELAB_CODE_LIMIT - runtimeSize - codeSize - sourceSize - 60000;
        const cost = job => (Math.ceil(job.embed.data.length / 3) * 4) + job.animation.length + 40;
        const candidates = glJobs.filter(job => job.picture.ext !== 'svg');
        const chosen = new Set();
        if (options.singleFile !== false && room > 0 && candidates.length) {
            if (options.compact) {
                for (let step = 0; step < GAMELAB_STEPS.length; step++) {
                    const {perUnit, quality} = GAMELAB_STEPS[step];
                    let shrunk = 0;
                    await runLimited(candidates, 4, async job => {
                        try {
                            job.embed = await options.compact(job.picture.data, job.picture.ext,
                                perUnit / job.picture.measure.resolution, quality);
                        } catch (e) {
                            job.embed = null;
                        }
                        shrunk++;
                        progress(`Fitting the pictures inside the code${step ? ` (try ${step + 1})` : ''}: ` +
                            `${shrunk} of ${candidates.length}`, shrunk, candidates.length);
                    });
                    const total = candidates.reduce((sum, job) => sum + (job.embed ? cost(job) : 0), 0);
                    if (total <= room) break;
                }
            } else {
                for (const job of candidates) job.embed = {data: job.picture.data, ext: job.picture.ext, scale: 1};
            }
            // Smallest first, so the fewest pictures are left to upload.
            let used = 0;
            for (const job of candidates.filter(j => j.embed).sort((a, b) => cost(a) - cost(b))) {
                if (used + cost(job) > room) break;
                used += cost(job);
                chosen.add(job);
            }
        }
        for (const job of glJobs) {
            if (chosen.has(job)) {
                glPictures.push([job.animation, dataUrl(`picture.${job.embed.ext}`, job.embed.data)]);
                const resolution = job.picture.measure.resolution * job.embed.scale;
                glCostumes[job.costume.md5ext].resolution = Math.round(resolution * 1e6) / 1e6;
                job.embedded = true;
            } else {
                out.push([job.file, job.picture.data]);
            }
        }
    }
    progress('Writing the code', 1, 1);

    const written = gamelab ? writeGameLabGame(parsed, glCostumes, glSounds, name) :
        python ? writePythonGame(parsed, files, name) : writeWebGame(parsed, files, name);
    notes.push(...written.notes);
    const report = notes.length ?
        `\nWhat did not come across\n------------------------\n` +
            `${notes.map(n => `- ${n.where}: ${n.what}`).join('\n')}\n` :
        '\nEverything in the project came across.\n';
    // The exported code has no comments in it: the runtime's and the game's are taken out.
    const strip = python ? stripPython : stripJs;
    const runtime = strip(String(runtimes[target] || ''));
    const gameCode = strip(written.code);
    // Where each costume and sound went: a file of the export as it was ({f}),
    // the same picture at another scale ({f, r} or, inside Game Lab's code, {a, r}),
    // or the SVG itself, carried here ({t}).
    const assetMap = {};
    for (const job of jobs) {
        const md5 = job.costume.md5ext;
        if (svgOriginals[md5]) assetMap[md5] = {t: svgOriginals[md5]};
        else if (gamelab) {
            const r = glCostumes[md5].resolution;
            if (job.embedded) assetMap[md5] = {a: job.animation, r};
            else assetMap[md5] = job.picture.data === job.data ? {f: job.file} : {f: job.file, r};
        } else if (files[md5]) {
            const f = files[md5];
            assetMap[md5] = typeof f === 'string' ? {f} : f.scale ? {f: f.file, r: f.scale} : {f: f.file};
        }
    }
    for (const t of parsed.targets) {
        for (const sound of t.sounds) {
            const md5 = sound.md5ext;
            if (assetMap[md5]) continue;
            const f = gamelab ? glSoundFiles[md5] : files[md5] && (files[md5].file || files[md5]);
            if (f) assetMap[md5] = {f};
        }
    }
    const units = fingerprintUnits(written.units, python ? pyUnits(gameCode) : jsUnits(gameCode)) || [];
    const packed = await packSource(sourceOf(assetMap, units, fingerprint(gameCode)));
    const carried = python ? `\nFLIPWARP_SOURCE = "${packed}"\n` :
        gamelab ? `\nvar FLIPWARP_SOURCE = "${packed}";\n` : `\nwindow.FLIPWARP_SOURCE = "${packed}";\n`;
    const uploadsOf = list => list.map(([file]) => ({name: file,
        kind: /\.(png|jpe?g|gif|svg)$/i.test(file) ? 'picture' : 'sound'}));
    if (gamelab) {
        // The pictures, last: a function, so the code above can use them before this line is reached.
        const picturesCode = glPictures.length ?
            '\nfunction costumePictures() {\n    return {\n' +
            `${glPictures.map(([animation, url]) => `        ${JSON.stringify(animation)}: "${url}"`).join(',\n')}\n` +
            '    };\n}\n' : '';
        const code = `${runtime}\n${gameCode}${picturesCode}${carried}`;
        const assets = out.slice();
        const pictureUploads = uploadsOf(assets).filter(u => u.kind === 'picture');
        const soundUploads = uploadsOf(assets).filter(u => u.kind === 'sound');
        const soundsStep = soundUploads.length ?
            `Sounds: upload ${soundUploads.length === 1 ? 'the sound' : `the ${soundUploads.length} sounds`} ` +
                'as MP3s in the gear-shaped Asset Manager above the toolbox (or a playSound block\'s "Choose..." ' +
                'button), keeping the names. Code.org does not let code carry sounds, so these are the only ' +
                'uploads; the game plays without them, just silently.{sounds}' :
            'There are no sounds to add.';
        const soundList = soundUploads.length ? `<ul class="sounds">${soundUploads
            .map(u => `<li>${u.name.replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`)}</li>`).join('')}</ul>` : '';
        out.unshift(
            ['START-HERE.html', textBytes(startHere({
                title: name,
                where: 'Code.org Game Lab',
                copies: [{label: 'the code', name: 'code.js', text: code}],
                uploads: pictureUploads,
                steps: [
                    '<a class="open" href="https://studio.code.org/projects/gamelab/new" target="_blank">Open a new ' +
                        'Game Lab project</a> and press <b>Show Text</b> above the code, so the code area is text.',
                    'Click in the code area, select everything (Ctrl+A or Cmd+A) and delete it, then paste the game ' +
                        `in:{copy:0}${glPictures.length && !pictureUploads.length ? 'The costumes\' pictures are ' +
                        'inside the code: there is nothing to upload in the Animation tab.' : ''}${
                        glPictures.length && pictureUploads.length ? `${glPictures.length} of the pictures are ` +
                        `inside the code; the other ${pictureUploads.length} would make it too big for Game Lab ` +
                        'to save, so they are uploaded next.' : ''}`,
                    ...(pictureUploads.length ? ['Open the <b>Animation</b> tab and upload ' +
                        `${glPictures.length ? 'these pictures' : 'these pictures (Game Lab cannot save code ' +
                        'with them inside it)'}. Keep their names: the code asks for each by its name ` +
                        'without ".png".{uploads}'] : []),
                    soundsStep.replace('{sounds}', soundList),
                    'Press <b>Run</b>, then click the stage to start (that is the green flag).'
                ]
            }))],
            ['code.js', textBytes(code)],
            ['README.txt', textBytes(HOW_TO.gamelab(name, glPictures.length > 0, pictureUploads.length > 0) + BACK + report)]
        );
    } else if (python) {
        out.unshift(
            ['main.py', textBytes(gameCode + carried)],
            ['scratch_runtime.py', textBytes(runtime)],
            ['README.txt', textBytes(HOW_TO.python(name) + BACK + report)]
        );
    } else {
        const escaped = name.replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[c]));
        const assets = out.slice();
        const assetBytes = assets.reduce((sum, [, data]) => sum + data.length, 0);
        // Small enough to carry everything inside one page: nothing to upload.
        if (options.singleFile !== false && assetBytes <= SINGLE_FILE_LIMIT) {
            const page = singlePage(escaped, parsed.options, runtime, gameCode + carried, assets);
            out.length = 0;
            out.push(
                ['START-HERE.html', textBytes(startHere({
                    title: name,
                    where: 'Code.org Web Lab',
                    copies: [{label: 'the page', name: 'index.html', text: page}],
                    uploads: [],
                    steps: [
                        '<a class="open" href="https://studio.code.org/projects/weblab2/new" target="_blank">Open a ' +
                            'new "Web Lab (new)" project</a> (the old Web Lab removes JavaScript, so the game ' +
                            'cannot run there).',
                        'Open its <b>index.html</b>, select everything (Ctrl+A or Cmd+A) and delete it, then paste ' +
                            'the game in:{copy:0}',
                        'Run it, then click the stage (or Start). The pictures and sounds are inside the page: ' +
                            'there is nothing to upload.'
                    ]
                }))],
                ['index.html', textBytes(page)],
                ['README.txt', textBytes(HOW_TO.weblabSingle(name) + BACK + report)]
            );
        } else if (options.singleFile !== false) {
            // Too big for one page: the pictures and sounds in a few packs to upload at once.
            const packs = makePacks(assets);
            const page = packedPage(escaped, parsed.options, runtime, gameCode + carried, packs.map(([file]) => file));
            const many = packs.length > 1;
            const packList = `<ul class="sounds">${packs.map(([file, data]) =>
                `<li>${file} (${Math.max(1, Math.round(data.length / 1024 / 1024 * 10) / 10)} MB)</li>`).join('')}</ul>`;
            const totalMB = packs.reduce((sum, [, data]) => sum + data.length, 0) / 1024 / 1024;
            if (totalMB > 19) {
                notes.push({where: 'Project', what: `the pictures and sounds come to ${Math.round(totalMB)} MB, ` +
                    'more than a Web Lab project holds (20 MB in all)'});
            }
            out.length = 0;
            out.push(
                ['START-HERE.html', textBytes(startHere({
                    title: name,
                    where: 'Code.org Web Lab',
                    copies: [{label: 'the page', name: 'index.html', text: page}],
                    uploads: [],
                    steps: [
                        '<a class="open" href="https://studio.code.org/projects/weblab2/new" target="_blank">Open a ' +
                            'new "Web Lab (new)" project</a> (the old Web Lab removes JavaScript, so the game ' +
                            'cannot run there).',
                        'Open its <b>index.html</b>, select everything (Ctrl+A or Cmd+A) and delete it, then paste ' +
                            'the game in:{copy:0}',
                        `<b>You must upload ${many ? `these ${packs.length} files` : 'this file'}</b>: ` +
                            `${many ? 'they hold' : 'it holds'} all the game's pictures and sounds, and the game ` +
                            'will not start without them. In the <b>Files</b> list click <b>+</b>, then ' +
                            `<b>Upload</b>, and choose ${many ? 'all of them at once (click the first, then ' +
                                'Shift+click the last)' : 'it'}. Keep the ${many ? 'names' : 'name'}.${packList}` +
                            `${many ? 'They end' : 'It ends'} in .png so Web Lab will take ${many ? 'them' : 'it'}, ` +
                            `but ${many ? 'they are not pictures: they are' : 'it is not a picture: it is'} every ` +
                            'picture and sound packed together, because Web Lab will not take sounds as uploads, ' +
                            'and a few uploads are much quicker than hundreds.',
                        'Run it, then click the stage (or Start).'
                    ]
                }))],
                ['index.html', textBytes(page)],
                ...packs,
                ['README.txt', textBytes(HOW_TO.weblabPacked(name, packs.map(([file]) => file)) + BACK + report)]
            );
        } else {
            const pageText = PAGE(escaped, parsed.options.width, parsed.options.height);
            out.unshift(
                ['START-HERE.html', textBytes(startHere({
                    title: name,
                    where: 'Code.org Web Lab',
                    copies: [
                        {label: 'index.html', name: 'index.html', text: pageText},
                        {label: 'style.css', name: 'style.css', text: stripCss(STYLE)},
                        {label: 'scratch-runtime.js', name: 'scratch-runtime.js', text: runtime},
                        {label: 'game.js', name: 'game.js', text: gameCode + carried}
                    ],
                    uploads: uploadsOf(assets),
                    steps: [
                        '<a class="open" href="https://studio.code.org/projects/weblab2/new" target="_blank">Open a ' +
                            'new "Web Lab (new)" project</a> (the old Web Lab removes JavaScript, so the game ' +
                            'cannot run there).',
                        'Replace its index.html and style.css with these:{copy:0}{copy:1}',
                        'Add two new files with these names and paste these in:{copy:2}{copy:3}',
                        'Upload these pictures and sounds, keeping their names:{uploads}',
                        'Run it, then click the stage (or Start).'
                    ],
                    note: 'This game\'s pictures and sounds are too big to fit inside one page, so they are ' +
                        'separate files to upload.'
                }))],
                ['index.html', textBytes(pageText)],
                ['style.css', textBytes(stripCss(STYLE))],
                ['scratch-runtime.js', textBytes(runtime)],
                ['game.js', textBytes(gameCode + carried)],
                ['README.txt', textBytes(HOW_TO.weblab(name) + BACK + report)]
            );
        }
    }
    return {files: out, notes, folder: `${slug(name)}-${target}`};
};
