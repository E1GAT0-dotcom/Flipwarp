#!/usr/bin/env node
// flipwarp-mcp: lets Claude Code read and write the project open in Flipwarp.
//
//   Claude Code  <-stdio->  this server  <-WebSocket->  the editor tab
//
// The server also serves the built editor (../build by default), so one
// address does everything: open http://127.0.0.1:8601/editor.html?mcp and the
// tab connects back here. The editor does the real work through the same code
// the Text button uses (src/lib/flipwarp/mcp-bridge.js); this side only passes
// requests across and turns the answers into something Claude can read.
//
// Everything on stdout belongs to the MCP protocol. Logging goes to stderr.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {GUIDE} from './guide.mjs';
import {PIECES, CONTRACT, pieceText, mergeText, piecesToAdd} from './library/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// One port ("8601"), or a range ("8611-8640") to take the first free one of,
// so several Claude Code chats can each have their own editor.
const PORTS = (() => {
    const [from, to] = (process.env.FLIPWARP_PORT || '8601').split('-').map(s => Number(s.trim()));
    const first = from || 8601;
    const last = to >= first ? Math.min(to, first + 200) : first;
    return Array.from({length: last - first + 1}, (_, i) => first + i);
})();
let port = PORTS[0];
const BUILD = path.resolve(process.env.FLIPWARP_BUILD || path.join(here, '..', 'build'));
// Web pages other than the editor must not be able to connect and pretend to
// be it. Local addresses are allowed; a hosted copy of the editor can be added
// here, comma separated.
const EXTRA_ORIGINS = (process.env.FLIPWARP_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
// This chat's own mark on the tabs it opens. A tab opened by an earlier chat
// that had the same port is refused instead of taking over this one.
const CHAT = randomBytes(4).toString('hex');
const editorUrl = () => `http://127.0.0.1:${port}/editor.html?mcp&chat=${CHAT}`;
// FLIPWARP_OPEN=1: open the editor as soon as Claude Code has connected.
const OPEN_AT_START = process.env.FLIPWARP_OPEN === '1';

const log = (...args) => console.error('[flipwarp-mcp]', ...args);

// --- the editor connection -------------------------------------------------

// The tab Claude is working in. It keeps the job until it closes, even if
// another tab opens: switching halfway through would have Claude writing into
// a different project from the one it just read. Other tabs wait their turn,
// newest first.
let editor = null;
const waiting = [];

const promote = () => {
    while (waiting.length) {
        const next = waiting.pop();
        if (next.readyState === next.OPEN) {
            editor = next;
            log('another editor tab took over');
            return;
        }
    }
    editor = null;
};
let nextId = 1;
const pending = new Map();

const allowedOrigin = origin => {
    if (!origin) return true; // not a browser
    if (EXTRA_ORIGINS.includes(origin)) return true;
    try {
        const {hostname} = new URL(origin);
        return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
    } catch (e) {
        return false;
    }
};

const ask = (method, params = {}, timeout = 30000) => new Promise((resolve, reject) => {
    if (!editor || editor.readyState !== editor.OPEN) {
        reject(new Error(`Flipwarp is not connected. Open ${editorUrl()} in a browser ` +
            '(or call open_editor), then try again.'));
        return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Flipwarp did not answer "${method}" within ${timeout / 1000}s.`));
    }, timeout);
    pending.set(id, {resolve, reject, timer});
    editor.send(JSON.stringify({id, method, params}));
});

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.map': 'application/json',
    '.hex': 'application/octet-stream',
    '.txt': 'text/plain; charset=utf-8'
};

const serveFile = (req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch (e) {
        res.writeHead(400).end();
        return;
    }
    if (pathname === '/') pathname = '/editor.html';
    const file = path.join(BUILD, pathname);
    // Nothing outside the build folder, however the address is spelled.
    if (!file.startsWith(BUILD + path.sep)) {
        res.writeHead(403).end();
        return;
    }
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, {'Content-Type': 'text/plain'}).end(
                fs.existsSync(BUILD) ? 'Not found' : `No Flipwarp build at ${BUILD}. Run npm run build first.`);
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });
        fs.createReadStream(file).pipe(res);
    });
};

const httpServer = http.createServer(serveFile);
const sockets = new WebSocketServer({noServer: true});

httpServer.on('upgrade', (req, socket, head) => {
    const {pathname} = new URL(req.url, 'http://x');
    if (pathname !== '/mcp' || !allowedOrigin(req.headers.origin)) {
        socket.destroy();
        return;
    }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws, req));
});

sockets.on('connection', ws => {
    ws.on('message', data => {
        let message;
        try {
            message = JSON.parse(data.toString());
        } catch (e) {
            return;
        }
        if (message.hello === 'flipwarp') {
            // A tab opened by hand has no mark and is welcome.
            if (message.chat && message.chat !== CHAT) {
                ws.send(JSON.stringify({refused: 'This Flipwarp tab belonged to a Claude chat that has ended. ' +
                    'You can close it.'}));
                ws.close();
                log('refused a tab from an earlier chat');
                return;
            }
            if (editor && editor.readyState === editor.OPEN) {
                waiting.push(ws);
                log('another editor tab connected; it waits until the first one closes');
            } else {
                editor = ws;
                log('editor connected');
            }
            return;
        }
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) {
            if (message.error.stack && !message.error.parse) log(`editor error: ${message.error.stack}`);
            const e = new Error(message.error.message);
            e.parse = message.error.parse;
            request.reject(e);
        } else {
            request.resolve(message.result);
        }
    });
    ws.on('close', () => {
        const at = waiting.indexOf(ws);
        if (at >= 0) waiting.splice(at, 1);
        if (editor === ws) {
            log('editor disconnected');
            // Whatever it was asked will never be answered now. Said at once,
            // rather than after a timeout, and not handed to the next tab: it
            // has a different project in it.
            for (const [id, request] of pending) {
                clearTimeout(request.timer);
                request.reject(new Error('The Flipwarp tab closed or reloaded before it answered. ' +
                    'Check the project with project_overview before going on.'));
                pending.delete(id);
            }
            promote();
        }
    });
});

let serving = false;
const tryPort = p => new Promise(resolve => {
    const onError = () => {
        httpServer.off('listening', onListening);
        resolve(false);
    };
    const onListening = () => {
        httpServer.off('error', onError);
        resolve(true);
    };
    httpServer.once('error', onError);
    httpServer.once('listening', onListening);
    httpServer.listen(p, '127.0.0.1');
});
// Another copy of this server (another Claude Code chat) may have a port
// already: take the next. With none free, this one still answers tools, it
// just cannot reach an editor.
const listening = (async () => {
    for (const p of PORTS) {
        if (await tryPort(p)) {
            port = p;
            serving = true;
            log(`serving ${BUILD} at http://127.0.0.1:${port}/`);
            return true;
        }
    }
    log(`cannot listen on port ${PORTS.length > 1 ? `${PORTS[0]}-${PORTS[PORTS.length - 1]}` : PORTS[0]}: ` +
        'in use by other copies of flipwarp-mcp');
    return false;
})();

// --- turning answers into text --------------------------------------------

const text = s => ({content: [{type: 'text', text: s}]});
const json = value => text(JSON.stringify(value, null, 2));
const failure = s => ({content: [{type: 'text', text: s}], isError: true});

const describeParse = error => {
    const p = error.parse;
    if (!p) return error.message;
    return [
        `Line ${p.line}${p.column ? `, column ${p.column}` : ''}: ${error.message}`,
        p.text ? `    ${p.text}` : null,
        p.fix ? `Try this: ${p.fix}` : null
    ].filter(Boolean).join('\n');
};

// Every tool goes through this, so a disconnected editor or a refusal comes
// back as a readable error rather than a crash.
const tool = fn => async args => {
    try {
        return await fn(args);
    } catch (e) {
        return failure(describeParse(e));
    }
};

const connectedMessage = () => {
    const others = waiting.filter(ws => ws.readyState === ws.OPEN).length;
    return `Connected. The editor is at ${editorUrl()}` + (others ?
        `\n${others} other Flipwarp tab(s) are open too and are not being used. ` +
        'Close them if that is confusing.' : '');
};

const openInBrowser = url => {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] :
        process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, {detached: true, stdio: 'ignore'}).unref();
};

let openedAt = 0;
const launchEditor = () => {
    openedAt = Date.now();
    openInBrowser(editorUrl());
};

const waitForEditor = async ms => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        if (editor && editor.readyState === editor.OPEN) return true;
        await new Promise(r => setTimeout(r, 250));
    }
    return false;
};

// --- the tools -------------------------------------------------------------

const server = new McpServer({name: 'flipwarp', version: '0.1.0'}, {
    instructions: 'Flipwarp is a Scratch editor (a TurboWarp fork) where every sprite can be written as text. ' +
        'Before writing any code, call text_reference once to learn the text. Start with project_overview, ' +
        'read_sprite before changing a sprite, check_text to try text safely, write_sprite to apply it, ' +
        'then health_check. If the editor is not connected, call open_editor. When asked to make a game or a ' +
        'big feature, call game_workflow first and follow it: plan, draw, build from list_pieces, then play ' +
        'the game with the play tools and fix it until it works.'
});

// The game-making workflow is a Claude Code skill in the Flipwarp folder;
// served here too, so it is there whichever folder Claude Code was opened in.
const WORKFLOW_FILE = path.join(here, '..', '.claude', 'skills', 'flipwarp-game', 'SKILL.md');

server.registerTool('game_workflow', {
    title: 'How to make a game',
    description: 'The workflow for making a whole game in Flipwarp: planning, drawing, building from pieces, ' +
        'the rules that make Scratch games work, and playing it to test. Read it before starting a game.',
    inputSchema: {}
}, tool(async () => {
    const skill = fs.readFileSync(WORKFLOW_FILE, 'utf8').replace(/\r\n/g, '\n');
    return text(skill.replace(/^---\n[\s\S]*?\n---\n/, '').trim());
}));

const sprite = z.string().describe('Sprite name, or "Stage" for the stage');

server.registerTool('open_editor', {
    title: 'Open the Flipwarp editor',
    description: 'Says whether a Flipwarp tab is connected and, unless one is, opens the editor in the ' +
        'default browser and waits for it to connect.',
    inputSchema: {launch: z.boolean().optional().describe('Open a browser tab if none is connected (default true)')}
}, tool(async ({launch = true}) => {
    if (editor && editor.readyState === editor.OPEN) return text(connectedMessage());
    await listening;
    if (!serving) {
        return failure(`This server could not use port ${PORTS.join(', ')} (other copies of flipwarp-mcp ` +
            'have them). Set FLIPWARP_PORT to a free port, or a range like 8611-8640.');
    }
    if (!fs.existsSync(path.join(BUILD, 'editor.html'))) {
        return failure(`There is no Flipwarp build at ${BUILD}. Run "npm run build" in the Flipwarp folder first.`);
    }
    // A tab opened in the last half minute is still loading: wait for it
    // rather than opening another.
    const loading = Date.now() - openedAt < 30000;
    if (launch && !loading) launchEditor();
    const ok = await waitForEditor(launch || loading ? 30000 - (Date.now() - openedAt) : 1000);
    return ok ? text(connectedMessage()) :
        failure(`No editor connected yet. Open ${editorUrl()} in a browser.`);
}));

server.registerTool('text_reference', {
    title: 'How to write Flipwarp text',
    description: 'The rules of the text and every block it knows. Read this before writing code. ' +
        'Pass search to list only blocks whose name or opcode contains it.',
    inputSchema: {search: z.string().optional().describe('Only blocks matching this, e.g. "costume" or "pen."')}
}, tool(async ({search}) => {
    let blocks = [];
    let note = '';
    try {
        blocks = await ask('blockList');
    } catch (e) {
        note = `\n(The block list needs the editor connected: ${e.message})\n`;
    }
    const q = search ? search.toLowerCase() : null;
    const shown = blocks.filter(b => !q || b.name.toLowerCase().includes(q) || b.opcode.toLowerCase().includes(q));
    const line = b => {
        if (b.infix) return `a ${b.infix} b`;
        const args = b.args.map(a => (b.fields.includes(a) ? `"${a}"` : a)).join(', ');
        return `${b.name}(${args})${b.body ? ' { ... }' : ''}${b.kind === 'hat' ? ' { ... }   (hat)' : ''}` +
            `${b.kind === 'reporter' ? '   -> value' : ''}${b.kind === 'boolean' ? '   -> true/false' : ''}` +
            `${b.fromOtherExtension ? '   [other extension]' : ''}`;
    };
    const groups = new Map();
    for (const b of shown) {
        const group = b.opcode.split('_')[0];
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(line(b));
    }
    const list = [...groups].map(([g, lines]) => `### ${g}\n${lines.join('\n')}`).join('\n\n');
    const head = search ? '' : `${GUIDE}\n`;
    return text(`${head}${note}\n## Blocks${search ? ` matching "${search}"` : ''}\n` +
        '(Quoted arguments are dropdowns: always a string.)\n\n' +
        `${list || '(none)'}`);
}));

server.registerTool('project_overview', {
    title: 'Project overview',
    description: 'Every sprite with its position, costumes, sounds, variables and script count; the stage ' +
        'with its backdrops and global variables; loaded extensions.',
    inputSchema: {}
}, tool(async () => json(await ask('overview'))));

server.registerTool('read_sprite', {
    title: 'Read a sprite as text',
    description: 'All of a sprite\'s scripts as Flipwarp text. Opens that sprite in the editor.',
    inputSchema: {sprite}
}, tool(async args => {
    const r = await ask('readSprite', args);
    if (r.unreadable) return failure(`${r.sprite} has no text form: ${r.unreadable}`);
    return text(r.text.trim() ? r.text : `(${r.sprite} has no scripts yet)`);
}));

server.registerTool('check_text', {
    title: 'Check text without applying it',
    description: 'Parses text for a sprite and says whether it would be accepted, changing nothing.',
    inputSchema: {sprite, text: z.string().describe('The whole sprite, as Flipwarp text')}
}, tool(async args => {
    const r = await ask('checkText', args);
    if (!r.ok) return failure(describeParse({message: r.error.message, parse: r.error.parse}));
    return text(r.unchanged ? 'Accepted. It is the same as what the sprite has now.' :
        `Accepted: ${r.blocks} blocks.`);
}));

server.registerTool('write_sprite', {
    title: 'Write a sprite',
    description: 'Replaces ALL of a sprite\'s scripts with the given text. Nothing changes if the text has ' +
        'a mistake. Stops the project first. Can be undone with undo.',
    inputSchema: {sprite, text: z.string().describe('The whole sprite, as Flipwarp text')}
}, tool(async args => {
    const r = await ask('writeSprite', args, 60000);
    if (!r.ok) {
        return failure(`Nothing was changed.\n${describeParse({message: r.error.message, parse: r.error.parse})}`);
    }
    if (!r.changed) return text('Accepted, but it is the same as before, so nothing changed.');
    const loaded = r.extensionsLoaded && r.extensionsLoaded.length ?
        ` Loaded extension(s): ${r.extensionsLoaded.join(', ')}.` : '';
    const what = r.summary ? ` Changed: ${r.summary}.` : '';
    return text(`Written: ${args.sprite} now has ${r.blocks} blocks.${what}${loaded} ` +
        `(${r.undoSteps} undo step(s) available)`);
}));

server.registerTool('undo', {
    title: 'Undo the last write',
    description: 'Puts back the sprite changed by the most recent write_sprite.',
    inputSchema: {}
}, tool(async () => {
    const r = await ask('undo');
    if (!r.ok) return failure(r.error ? r.error.message : 'Could not undo.');
    return text(`Restored ${r.sprite}. ${r.undoSteps} undo step(s) left.`);
}));

server.registerTool('find', {
    title: 'Search the whole project',
    description: 'Every line of text in every sprite containing the query.',
    inputSchema: {
        query: z.string(),
        caseSensitive: z.boolean().optional(),
        wholeWord: z.boolean().optional()
    }
}, tool(async args => json(await ask('find', args))));

server.registerTool('health_check', {
    title: 'Project health check',
    description: 'What is probably wrong with the project: scripts with no hat, messages nobody receives, ' +
        'variables nothing reads, unused costumes. Graded problem / warning / tidy.',
    inputSchema: {}
}, tool(async () => {
    const {findings} = await ask('health');
    if (!findings.length) return text('Nothing found. The project looks healthy.');
    return text(findings.map(f => `[${f.grade}] ${f.id} ${f.sprite || ''}${f.script >= 0 ? ` script ${f.script + 1}` : ''}: ` +
        `${f.title}${f.detail ? ` - ${f.detail}` : ''}${f.fix ? ' (fixable)' : ''}`).join('\n'));
}));

server.registerTool('fix_health', {
    title: 'Fix health findings',
    description: 'Applies the automatic fix for the given finding ids from health_check (only ones marked fixable).',
    inputSchema: {ids: z.array(z.string())}
}, tool(async args => json(await ask('fixHealth', args))));

// --- drawings ----------------------------------------------------------------
//
// A costume can be drawn three ways, and every tool that takes one takes all
// three: an SVG document, pixel art as text, or an image file on this
// computer (read here and sent across, since the editor cannot read files).

const pixelsSchema = z.object({
    palette: z.record(z.string(), z.string()).describe('One character -> "#rrggbb" (or "#rrggbbaa", or ' +
        '"transparent"). "." and " " are see-through unless given.'),
    rows: z.union([z.array(z.string()), z.string()]).describe('One string per row, all the same width, ' +
        'top row first'),
    scale: z.number().optional().describe('Stage steps per pixel, 1 to 32 (default 4)'),
    format: z.enum(['svg', 'png']).optional().describe('svg (default) stays sharp at any size; png is a bitmap')
});

const drawing = {
    svg: z.string().optional().describe('A whole SVG document with width and height. The middle of the ' +
        'drawing is where the sprite turns, unless center says otherwise.'),
    pixels: pixelsSchema.optional().describe('Pixel art written as text'),
    file: z.string().optional().describe('Path to a .svg, .png or .jpg on this computer')
};

const drawingFrom = ({svg, pixels, file}) => {
    if (!file) return {svg, pixels};
    const data = fs.readFileSync(path.resolve(file));
    const ext = path.extname(file).toLowerCase();
    if (ext === '.svg') return {svg: data.toString('utf8')};
    if (ext === '.png') return {png: data.toString('base64')};
    if (ext === '.jpg' || ext === '.jpeg') return {jpg: data.toString('base64')};
    throw new Error(`${file} is not an .svg, .png or .jpg.`);
};

const pictureOf = (lines, png) => ({
    content: [{type: 'text', text: lines}, {type: 'image', data: png, mimeType: 'image/png'}]
});

const describeCostume = c => `"${c.name}" (costume ${c.number}, ${c.width}x${c.height} steps, ` +
    `turns around ${Math.round(c.center.x)},${Math.round(c.center.y)} of the drawing)`;

server.registerTool('create_sprite', {
    title: 'Create a sprite',
    description: 'Adds a new sprite with a first costume from svg, pixels or file (or a plain circle), ' +
        'and shows that costume.',
    inputSchema: {
        name: z.string(),
        ...drawing,
        x: z.number().optional(),
        y: z.number().optional()
    }
}, tool(async ({name, x, y, ...rest}) => {
    const r = await ask('createSprite', {name, x, y, ...drawingFrom(rest)});
    const {png} = await ask('costumeSheet', {sprite: r.name});
    return pictureOf(`Created sprite "${r.name}".`, png);
}));

server.registerTool('delete_sprite', {
    title: 'Delete a sprite',
    description: 'Removes a sprite and everything in it. Not covered by undo.',
    inputSchema: {sprite}
}, tool(async args => json(await ask('deleteSprite', args))));

server.registerTool('rename_sprite', {
    title: 'Rename a sprite',
    description: 'Renames a sprite. Blocks that refer to it by name in other sprites are updated by Scratch.',
    inputSchema: {sprite, name: z.string()}
}, tool(async args => json(await ask('renameSprite', args))));

server.registerTool('tidy_scripts', {
    title: 'Tidy a sprite\'s scripts',
    description: 'Lays out all of a sprite\'s scripts again so none overlap: events down the left, custom ' +
        'block definitions down the right. write_sprite already places new scripts this way; this is for ' +
        'sprites whose scripts piled up before.',
    inputSchema: {sprite}
}, tool(async args => {
    const {scripts} = await ask('tidyScripts', args);
    const events = scripts.filter(s => !s.definition).length;
    return text(`Tidied ${args.sprite}: ${events} script(s) on the left, ${scripts.length - events} custom ` +
        'block(s) on the right, none overlapping.');
}));

server.registerTool('narrate', {
    title: 'Say what you are doing',
    description: 'Shows a short note to the person watching the editor, at the top of the activity strip, ' +
        'until the next one. Use it at each step of a bigger job: "Building the door logic: a door opens ' +
        'while someone stands on its plate." One or two sentences, plain words.',
    inputSchema: {text: z.string().max(300)}
}, tool(async args => {
    await ask('narrate', args);
    return text('Shown.');
}));

server.registerTool('select_sprite', {
    title: 'Show a sprite in the editor',
    description: 'Opens a sprite in the editor so the person watching can see it.',
    inputSchema: {sprite}
}, tool(async args => json(await ask('selectSprite', args))));

server.registerTool('set_extension_text', {
    title: 'Text for other extensions',
    description: 'Turns on or off text forms for blocks of extensions that are not Scratch\'s or Flipwarp\'s ' +
        '(TurboWarp gallery, PenguinMod, URLs). Same as the setting in Advanced > Flipwarp.',
    inputSchema: {enabled: z.boolean()}
}, tool(async args => {
    const r = await ask('setExtensionText', args);
    return text(`Text for other extensions is ${r.otherExtensionText ? 'on' : 'off'}` +
        `${r.otherExtensionText ? `: ${r.blocks} block(s) from loaded extensions have a text form.` : '.'}`);
}));

server.registerTool('save_project', {
    title: 'Save the project',
    description: 'Saves the project open in the editor as an .sb3 file on this computer.',
    inputSchema: {path: z.string().describe('Where to write the .sb3 file')}
}, tool(async ({path: file}) => {
    const r = await ask('saveProject', {}, 120000);
    const out = path.resolve(file);
    fs.mkdirSync(path.dirname(out), {recursive: true});
    fs.writeFileSync(out, Buffer.from(r.base64, 'base64'));
    return text(`Saved ${r.bytes} bytes to ${out}`);
}));

server.registerTool('load_project', {
    title: 'Open a project',
    description: 'Opens an .sb3 file from this computer in the editor, replacing the project that is open. ' +
        'Save first if it matters.',
    inputSchema: {path: z.string().describe('The .sb3 file to open')}
}, tool(async ({path: file}) => {
    const data = fs.readFileSync(path.resolve(file));
    return json(await ask('loadProject', {base64: data.toString('base64')}, 120000));
}));

// --- playing and testing ---------------------------------------------------
//
// The editor does single moments (key down, key up, take a picture); the
// waiting between them happens here, where a timer is not slowed down by the
// browser. The project itself still runs at whatever speed the tab gets: a
// hidden tab runs it slowly, and every result says so when that happens.

const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, Math.min(ms, 60000))));

const image = shot => ({type: 'image', data: shot.png, mimeType: 'image/png'});

const hiddenWarning = visible => (visible === false ?
    '\nWarning: the editor tab is hidden, so the browser runs the project slowly (about one frame a ' +
    'second) and waits are not real game time. Use pause + step_frames, which run exact frames at full ' +
    'speed even when hidden, or ask the person to keep the Flipwarp tab visible.' : '');

const compactState = s => JSON.stringify(s, null, 1);

// One step of a play sequence. Returns text lines and pictures for the result.
const runStep = async step => {
    switch (step.do) {
    case 'green_flag': {
        const r = await ask('greenFlag');
        return {lines: [`green flag${r.frozen ? ' (the project is paused: use resume or step)' : ''}`],
            visible: r.visible};
    }
    case 'stop':
        await ask('stop');
        return {lines: ['stopped']};
    case 'wait':
        await sleep(step.ms);
        return {lines: [`waited ${step.ms}ms`]};
    case 'press':
        await ask('keys', {down: step.keys});
        await sleep(step.ms || 150);
        await ask('keys', {up: step.keys});
        return {lines: [`pressed ${step.keys.join(' + ')} for ${step.ms || 150}ms`]};
    case 'hold': {
        const r = await ask('keys', {down: step.keys});
        return {lines: [`holding ${r.keysHeld.join(', ')}`]};
    }
    case 'release':
        if (step.keys && step.keys.length) await ask('keys', {up: step.keys});
        else await ask('releaseKeys');
        return {lines: [`released ${step.keys && step.keys.length ? step.keys.join(', ') : 'all keys'}`]};
    case 'click':
        await ask('mouse', {x: step.x, y: step.y});
        await ask('mouse', {x: step.x, y: step.y, down: true});
        await sleep(step.ms || 100);
        await ask('mouse', {x: step.x, y: step.y, down: false});
        return {lines: [`clicked (${step.x}, ${step.y})`]};
    case 'mouse': {
        const args = {x: step.x, y: step.y};
        if (typeof step.down === 'boolean') args.down = step.down;
        await ask('mouse', args);
        return {lines: [`mouse at (${step.x}, ${step.y})${typeof step.down === 'boolean' ?
            (step.down ? ', button down' : ', button up') : ''}`]};
    }
    case 'step': {
        const r = await ask('stepFrames', {frames: step.frames || 1}, 70000);
        return {lines: [`ran ${r.frames} frame(s), now paused`]};
    }
    case 'screenshot': {
        const shot = await ask('screenshot', {grid: !!step.grid, scale: step.scale || 1});
        return {lines: [`screenshot ${shot.width}x${shot.height}`], images: [image(shot)], visible: shot.visible};
    }
    case 'state': {
        const s = await ask('state', {sprites: step.sprites});
        return {lines: [`state: ${compactState(s)}`], visible: s.visible};
    }
    default:
        throw new Error(`Unknown step "${step.do}".`);
    }
};

const runSteps = async steps => {
    const lines = [];
    const images = [];
    let visible = true;
    for (const [i, step] of steps.entries()) {
        try {
            const r = await runStep(step);
            lines.push(...r.lines);
            if (r.images) images.push(...r.images);
            if (r.visible === false) visible = false;
        } catch (e) {
            lines.push(`step ${i + 1} (${step.do}) failed: ${e.message}`);
            // A key left held by a sequence that stopped halfway would keep
            // the sprite running into the wall.
            await ask('releaseKeys').catch(() => {});
            return {content: [{type: 'text', text: lines.join('\n')}, ...images], isError: true};
        }
    }
    return {content: [{type: 'text', text: lines.join('\n') + hiddenWarning(visible)}, ...images]};
};

const key = z.string().describe('A key as keyPressed names it: "space", "right arrow", "a", "enter"');
const xy = {x: z.number().describe('Scratch x, -240 to 240'), y: z.number().describe('Scratch y, -180 to 180')};

server.registerTool('green_flag', {
    title: 'Click the green flag',
    description: 'Starts the project as the green flag does. Optionally waits and returns a screenshot.',
    inputSchema: {
        wait_ms: z.number().optional().describe('Wait this long after starting'),
        screenshot: z.boolean().optional().describe('Return a screenshot at the end')
    }
}, tool(async ({wait_ms: ms, screenshot}) => runSteps([
    {do: 'green_flag'},
    ...(ms ? [{do: 'wait', ms}] : []),
    ...(screenshot ? [{do: 'screenshot'}] : [])
])));

server.registerTool('stop', {
    title: 'Click the stop sign',
    description: 'Stops every script and lets go of any keys held.',
    inputSchema: {}
}, tool(async () => runSteps([{do: 'stop'}])));

server.registerTool('press_keys', {
    title: 'Press keys',
    description: 'Holds keys down together for a moment, then lets go, like a person tapping or holding them.',
    inputSchema: {
        keys: z.array(key).min(1),
        ms: z.number().optional().describe('How long to hold them (default 150)'),
        screenshot: z.boolean().optional().describe('Return a screenshot after letting go')
    }
}, tool(async ({keys, ms, screenshot}) => runSteps([
    {do: 'press', keys, ms},
    ...(screenshot ? [{do: 'screenshot'}] : [])
])));

server.registerTool('hold_keys', {
    title: 'Hold keys down',
    description: 'Puts keys down and leaves them down until release_keys or stop. Use with wait to hold ' +
        'a key for a while.',
    inputSchema: {keys: z.array(key).min(1)}
}, tool(async ({keys}) => runSteps([{do: 'hold', keys}])));

server.registerTool('release_keys', {
    title: 'Let go of keys',
    description: 'Lets go of the given keys, or of every key held if none are given.',
    inputSchema: {keys: z.array(key).optional()}
}, tool(async ({keys}) => runSteps([{do: 'release', keys}])));

server.registerTool('click', {
    title: 'Click the stage',
    description: 'Moves the mouse to a point on the stage, in Scratch coordinates, and clicks. ' +
        'Clicking a sprite runs its "when this sprite clicked" scripts.',
    inputSchema: {
        ...xy,
        ms: z.number().optional().describe('How long to hold the button (default 100)'),
        screenshot: z.boolean().optional()
    }
}, tool(async ({x, y, ms, screenshot}) => runSteps([
    {do: 'click', x, y, ms},
    ...(screenshot ? [{do: 'screenshot'}] : [])
])));

server.registerTool('move_mouse', {
    title: 'Move the mouse',
    description: 'Moves the mouse over the stage, optionally pressing or releasing the button ' +
        '(for dragging, or for mouseDown()).',
    inputSchema: {...xy, down: z.boolean().optional().describe('true to press the button, false to release it')}
}, tool(async ({x, y, down}) => runSteps([{do: 'mouse', x, y, down}])));

server.registerTool('wait', {
    title: 'Let the project run',
    description: 'Waits while the project runs, then optionally returns a screenshot and/or the state.',
    inputSchema: {
        ms: z.number().describe('How long, up to 60000'),
        screenshot: z.boolean().optional(),
        state: z.boolean().optional()
    }
}, tool(async ({ms, screenshot, state}) => runSteps([
    {do: 'wait', ms},
    ...(screenshot ? [{do: 'screenshot'}] : []),
    ...(state ? [{do: 'state'}] : [])
])));

server.registerTool('screenshot', {
    title: 'Look at the stage',
    description: 'A picture of the stage at its own size, so pixel (px, py) is Scratch ' +
        'x = px - 240, y = 180 - py. grid draws labelled lines every 60 steps.',
    inputSchema: {
        grid: z.boolean().optional(),
        scale: z.number().optional().describe('0.25 to 2, default 1')
    }
}, tool(async ({grid, scale}) => runSteps([{do: 'screenshot', grid, scale}])));

server.registerTool('get_state', {
    title: 'What the project is doing',
    description: 'Whether it is running, the timer, any question being asked, the mouse, every sprite\'s ' +
        'position, costume, size, speech bubble and variables, clones, and global variables.',
    inputSchema: {
        sprites: z.array(z.string()).optional().describe('Only these sprites'),
        clones: z.boolean().optional().describe('List each clone (default true)')
    }
}, tool(async args => json(await ask('state', args))));

server.registerTool('pause', {
    title: 'Pause the project',
    description: 'Freezes every frame without stopping the scripts, so the stage can be looked at. ' +
        'Use step_frames to move on exactly, resume to carry on.',
    inputSchema: {}
}, tool(async () => json(await ask('freeze', {frozen: true}))));

server.registerTool('resume', {
    title: 'Resume the project',
    description: 'Unfreezes a paused project.',
    inputSchema: {}
}, tool(async () => json(await ask('freeze', {frozen: false}))));

server.registerTool('step_frames', {
    title: 'Run some frames',
    description: 'Runs exactly this many frames, then pauses. Good for checking physics frame by frame.',
    inputSchema: {
        frames: z.number().describe('1 to 600'),
        screenshot: z.boolean().optional()
    }
}, tool(async ({frames, screenshot}) => runSteps([
    {do: 'step', frames},
    ...(screenshot ? [{do: 'screenshot'}] : [])
])));

server.registerTool('answer_question', {
    title: 'Answer an ask block',
    description: 'Types an answer into the box an "ask and wait" block shows, and submits it.',
    inputSchema: {text: z.string()}
}, tool(async args => json(await ask('answer', args))));

server.registerTool('get_logs', {
    title: 'Errors and warnings',
    description: 'Errors and warnings the editor page has printed, such as a script the compiler could not run.',
    inputSchema: {clear: z.boolean().optional().describe('Empty the list after reading')}
}, tool(async args => {
    const {logs} = await ask('logs', args);
    if (!logs.length) return text('No errors or warnings.');
    return text(logs.map(l => `[${l.level}] ${l.text}`).join('\n\n'));
}));

const stepSchema = z.object({
    do: z.enum(['green_flag', 'stop', 'wait', 'press', 'hold', 'release', 'click', 'mouse', 'step',
        'screenshot', 'state']),
    keys: z.array(key).optional().describe('press, hold, release'),
    ms: z.number().optional().describe('wait; press and click: how long to hold'),
    x: z.number().optional().describe('click, mouse'),
    y: z.number().optional().describe('click, mouse'),
    down: z.boolean().optional().describe('mouse: press or release the button'),
    frames: z.number().optional().describe('step'),
    grid: z.boolean().optional().describe('screenshot'),
    scale: z.number().optional().describe('screenshot'),
    sprites: z.array(z.string()).optional().describe('state: only these sprites')
});

server.registerTool('play', {
    title: 'Play a sequence',
    description: 'Runs a list of steps in order, like a person playing, and returns every screenshot ' +
        'and state it was asked for. For example: green_flag, hold right arrow, wait 1000, press space, ' +
        'wait 500, screenshot, release, state. Keys still held when a step fails are let go.',
    inputSchema: {steps: z.array(stepSchema).min(1).max(100)}
}, tool(async ({steps}) => runSteps(steps)));

// --- costumes --------------------------------------------------------------

const costumeRef = z.union([z.string(), z.number()]).describe('Costume name, or its number counting from 1');
const center = z.object({x: z.number(), y: z.number()}).optional()
    .describe('Where the sprite turns and where goToXY puts it, in the drawing\'s own units ' +
        '(SVG units or image pixels) from its top left. Default: the middle.');

server.registerTool('preview_drawing', {
    title: 'Look at a drawing',
    description: 'Draws svg, pixels or a file without adding it to the project: zoomed in, and at the size ' +
        'it would be on the stage. Use it to check and fix a drawing before adding it.',
    inputSchema: drawing
}, tool(async args => {
    const r = await ask('previewImage', drawingFrom(args));
    return pictureOf(`${r.width}x${r.height} steps on the stage at size 100.`, r.png);
}));

server.registerTool('add_costume', {
    title: 'Add a costume',
    description: 'Adds a costume to a sprite (or a backdrop to "Stage") from svg, pixels or file, makes it ' +
        'the current one unless select is false, and shows it. Add animation frames one after another.',
    inputSchema: {
        sprite,
        name: z.string().optional(),
        ...drawing,
        center,
        select: z.boolean().optional()
    }
}, tool(async ({sprite: name, name: costumeName, center: c, select, ...rest}) => {
    const r = await ask('addCostume', {sprite: name, name: costumeName, center: c, select, ...drawingFrom(rest)});
    return pictureOf(`Added ${describeCostume(r.costume)} to ${name}.`, r.png);
}));

server.registerTool('replace_costume', {
    title: 'Redraw a costume',
    description: 'Replaces a costume\'s drawing in place, keeping its name and number so scripts that ' +
        'switch to it still work, and shows the result. The way to fix a drawing.',
    inputSchema: {sprite, costume: costumeRef, ...drawing, center}
}, tool(async ({sprite: name, costume, center: c, ...rest}) => {
    const r = await ask('replaceCostume', {sprite: name, costume, center: c, ...drawingFrom(rest)});
    return pictureOf(`Redrew ${describeCostume(r.costume)} in ${name}.`, r.png);
}));

server.registerTool('list_costumes', {
    title: 'List costumes',
    description: 'A sprite\'s costumes (or the stage\'s backdrops): names, numbers, sizes, turning points, ' +
        'which is current.',
    inputSchema: {sprite}
}, tool(async args => {
    const {costumes} = await ask('costumes', args);
    return text(costumes.map(c => `${c.current ? '*' : ' '} ${describeCostume(c)} [${c.format}]`).join('\n'));
}));

server.registerTool('costume_sheet', {
    title: 'Look at costumes',
    description: 'A picture of a sprite\'s costumes side by side, labelled, with a red cross where each ' +
        'turns. Use it to check animation frames match each other.',
    inputSchema: {sprite, costumes: z.array(costumeRef).optional().describe('Only these (up to 24)')}
}, tool(async args => {
    const {png} = await ask('costumeSheet', args);
    return pictureOf(`Costumes of ${args.sprite}:`, png);
}));

server.registerTool('rename_costume', {
    title: 'Rename a costume',
    description: 'Renames a costume. Scripts that switch to it by its old name will need changing too.',
    inputSchema: {sprite, costume: costumeRef, name: z.string()}
}, tool(async args => {
    const r = await ask('renameCostume', args);
    return text(`Now ${describeCostume(r.costume)}.`);
}));

server.registerTool('delete_costume', {
    title: 'Delete a costume',
    description: 'Removes a costume. A sprite keeps at least one.',
    inputSchema: {sprite, costume: costumeRef}
}, tool(async args => json(await ask('deleteCostume', args))));

server.registerTool('switch_costume', {
    title: 'Switch costume',
    description: 'Sets which costume a sprite is wearing now (and so in the saved project).',
    inputSchema: {sprite, costume: costumeRef}
}, tool(async args => json(await ask('setCostume', args))));

// --- ready-made pieces -----------------------------------------------------

const settingsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.array(z.string())])).optional()
    .describe('Settings to change from their defaults, e.g. {"JUMP": 15} or {"ROWS": ["P..#", "####"]}');

server.registerTool('list_pieces', {
    title: 'Ready-made game pieces',
    description: 'The library of tested pieces for the hard parts of a game: level maps, tile collision, tile ' +
        'drawing, platformer and top-down players with a scrolling camera, collectibles, enemies. Read this ' +
        'before writing those by hand.',
    inputSchema: {}
}, tool(async () => {
    const lines = Object.entries(PIECES).map(([name, p]) => {
        const settings = Object.entries(p.params).map(([k, s]) => `    ${k} = ${s.kind === 'rows' ?
            `(${s.default.length} rows)` : JSON.stringify(s.default)}: ${s.description}`);
        return [`${name}: ${p.title}. ${p.description}`,
            `  Goes on: ${p.sprite === 'any' ? 'any sprite' : p.sprite === 'Stage' ? 'the Stage' :
                `a sprite (e.g. "${p.sprite}")`}${p.requires ? `; brings ${p.requires.join(', ')} with it` : ''}`,
            ...(settings.length ? ['  Settings:', ...settings] : [])].join('\n');
    });
    return text(`${lines.join('\n\n')}\n\n${CONTRACT}\n\nA typical platformer: level on the Stage, tiles on a ` +
        '"Tiles" sprite, platformer on "Player", coins on "Coin", enemy on "Enemy". Then draw their costumes.');
}));

server.registerTool('get_piece', {
    title: 'Read a piece',
    description: 'The Flipwarp text of a piece with its settings filled in, to read, or to change before ' +
        'writing it yourself. add_piece is the usual way to put one in.',
    inputSchema: {piece: z.string(), settings: settingsSchema}
}, tool(async ({piece, settings}) => {
    const requires = PIECES[piece] && PIECES[piece].requires ? PIECES[piece].requires : [];
    return text(`${pieceText(piece, settings || {})}${requires.length ?
        `\n# This piece also needs: ${requires.join(', ')} (get_piece those too).` : ''}`);
}));

server.registerTool('add_piece', {
    title: 'Add a piece to a sprite',
    description: 'Adds a ready-made piece (and the pieces it needs) to a sprite, keeping everything the sprite ' +
        'already has, and turns on the game options it needs. Create the sprite first.',
    inputSchema: {sprite, piece: z.string(), settings: settingsSchema}
}, tool(async ({sprite: name, piece, settings}) => {
    const spec = PIECES[piece];
    if (!spec) throw new Error(`There is no piece "${piece}". There are: ${Object.keys(PIECES).join(', ')}.`);
    const onStage = String(name).toLowerCase() === 'stage';
    if (spec.sprite === 'Stage' && !onStage) throw new Error(`The ${piece} piece goes on the Stage.`);
    if (spec.sprite !== 'Stage' && spec.sprite !== 'any' && onStage) {
        throw new Error(`The ${piece} piece goes on a sprite, not the Stage.`);
    }
    const now = await ask('readSprite', {sprite: name});
    if (now.unreadable) throw new Error(`${name} has no text form, so a piece cannot be added: ${now.unreadable}`);
    const {texts, added} = piecesToAdd(piece, settings || {}, now.text);
    const merged = mergeText(now.text, texts);
    const r = await ask('writeSprite', {sprite: name, text: merged}, 60000);
    if (!r.ok) {
        throw new Error(`The piece did not fit: ${describeParse({message: r.error.message, parse: r.error.parse})}` +
            '\nNothing was changed. get_piece shows its text, to fit it in by hand.');
    }
    const lines = [`Added ${added.join(' + ')} to ${name}: it now has ${r.blocks} blocks.`];
    if (spec.options) {
        const o = await ask('gameOptions', spec.options);
        lines.push(`Game options: fencing ${o.fencing ? 'on' : 'off'} (stored in the project).`);
    }
    if (piece !== 'level' && piece !== 'collision') {
        const stage = await ask('readSprite', {sprite: 'Stage'});
        if (!stage.text || !stage.text.includes('readLevel')) {
            lines.push('Not there yet: the level piece on the Stage, which every other piece needs.');
        }
    }
    const notes = pieceText(piece, settings || {}).split('\n')
        .filter(l => l.startsWith('#'))
        .map(l => l.replace(/^#\s?/, ''));
    const header = [];
    for (const l of notes) {
        if (!l.trim() && header.length) break;
        header.push(l);
    }
    lines.push('', header.join(' ').replace(/\s+/g, ' ').trim());
    return text(lines.join('\n'));
}));

server.registerTool('set_game_options', {
    title: 'How the project runs',
    description: 'TurboWarp\'s run settings, stored in the project so it runs the same everywhere: framerate ' +
        '(30 is Scratch\'s; the pieces are tuned for it), fencing (off lets sprites go off the edge, which ' +
        'scrolling games need), interpolation (smoother motion; not with pen-drawn tiles), high-quality pen, ' +
        'infinite clones.',
    inputSchema: {
        framerate: z.number().optional(),
        fencing: z.boolean().optional(),
        interpolation: z.boolean().optional(),
        high_quality_pen: z.boolean().optional(),
        infinite_clones: z.boolean().optional()
    }
}, tool(async a => json(await ask('gameOptions', {
    framerate: a.framerate,
    fencing: a.fencing,
    interpolation: a.interpolation,
    highQualityPen: a.high_quality_pen,
    infiniteClones: a.infinite_clones
}))));

server.registerTool('set_variable', {
    title: 'Set a variable',
    description: 'Sets a variable (or list) while the project runs, to set up a test: move the player next ' +
        'to an enemy, put the score near a win. A sprite\'s own variable, or a global one.',
    inputSchema: {
        sprite: z.string().optional().describe('Whose variable; leave out for a global'),
        name: z.string(),
        value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
    }
}, tool(async args => json(await ask('setVariable', args))));

if (OPEN_AT_START) {
    server.server.oninitialized = async () => {
        if (!await listening || !fs.existsSync(path.join(BUILD, 'editor.html'))) return;
        if (!editor) launchEditor();
    };
}

await server.connect(new StdioServerTransport());
log('ready');
