// "Export as code": a project as source code for another place to run it.
//
// The editor does the exporting, for the File menu and for Claude's
// export_project tool alike: it has the project's files and a browser to
// turn pictures into whatever a target needs. Each target is a front end
// (front.js, shared) and a writer of its own.

import {readProject} from './front.js';
import {writeWebGame} from './web.js';
import {writePythonGame} from './python.js';

export const TARGETS = {
    weblab: {
        title: 'Code.org Web Lab',
        description: 'HTML, CSS and JavaScript that runs the game in a web page'
    },
    python: {
        title: 'Python (pygame)',
        description: 'A Python program that runs the game in a window, with pygame'
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

const PAGE = (title, width, height) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<!-- ${title}: made in Flipwarp (Scratch) and exported as code. game.js has the game's scripts;
     scratch-runtime.js runs them the way Scratch does. -->
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

const HOW_TO = {
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
1. Start a new Web Lab project.
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

    // Each costume and sound file, under a readable name.
    const files = {};
    const out = [];
    const notes = [];
    const used = new Set(['index.html', 'style.css', 'scratch-runtime.js', 'game.js', 'readme.txt', 'main.py',
        'scratch_runtime.py']);
    const fileName = (owner, item, ext) => {
        const base = `${slug(owner)}-${slug(item)}`;
        let file = `${base}.${ext}`;
        let n = 2;
        while (used.has(file.toLowerCase())) file = `${base}-${n++}.${ext}`;
        used.add(file.toLowerCase());
        return file;
    };
    for (const t of parsed.targets) {
        const owner = t.isStage ? 'stage' : t.name;
        for (const costume of t.costumes) {
            if (files[costume.md5ext]) continue;
            const data = source[costume.md5ext];
            if (!data) continue;
            if (python && costume.dataFormat === 'svg' && options.rasterize) {
                try {
                    const png = await options.rasterize(data);
                    const file = fileName(owner, costume.name, 'png');
                    files[costume.md5ext] = {file, scale: png.scale};
                    out.push([file, png.data]);
                    continue;
                } catch (e) {
                    notes.push({where: owner, what: `the costume "${costume.name}" could not be drawn as a picture ` +
                        'pygame shows well, so it is kept as an SVG'});
                }
            }
            const file = fileName(owner, costume.name, costume.md5ext.split('.').pop());
            files[costume.md5ext] = python ? {file} : file;
            out.push([file, data]);
        }
        for (const sound of t.sounds) {
            if (files[sound.md5ext]) continue;
            const data = source[sound.md5ext];
            if (!data) continue;
            const file = fileName(owner, sound.name, sound.md5ext.split('.').pop());
            files[sound.md5ext] = python ? {file} : file;
            out.push([file, data]);
        }
    }

    const written = python ? writePythonGame(parsed, files, name) : writeWebGame(parsed, files, name);
    notes.push(...written.notes);
    const report = notes.length ?
        `\nWhat did not come across\n------------------------\n` +
            `${notes.map(n => `- ${n.where}: ${n.what}`).join('\n')}\n` :
        '\nEverything in the project came across.\n';
    const runtime = String(runtimes[target] || '').replace(/^\/\* eslint-disable \*\/\r?\n/, '');
    if (python) {
        out.unshift(
            ['main.py', textBytes(written.code)],
            ['scratch_runtime.py', textBytes(runtime)],
            ['README.txt', textBytes(HOW_TO.python(name) + report)]
        );
    } else {
        const escaped = name.replace(/[<>&"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'}[c]));
        out.unshift(
            ['index.html', textBytes(PAGE(escaped, parsed.options.width, parsed.options.height))],
            ['style.css', textBytes(STYLE)],
            ['scratch-runtime.js', textBytes(runtime)],
            ['game.js', textBytes(written.code)],
            ['README.txt', textBytes(HOW_TO.weblab(name) + report)]
        );
    }
    return {files: out, notes, folder: `${slug(name)}-${target}`};
};
