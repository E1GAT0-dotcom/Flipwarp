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
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {openFlags, resolveFlag} from './flags.mjs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {WebSocketServer} from 'ws';
import {z} from 'zod';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';

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
    pending.set(id, {resolve, reject, timer, method, socket: editor});
    // Why Claude is doing it, for the person watching; an older editor tab
    // ignores it.
    editor.send(JSON.stringify({id, method, params, why: currentWhy}));
});

// --- what the person watching sees -------------------------------------------
//
// Several chats can be working at once, each with its own server and tab. Each
// gets a colour (from its port) and a name (its game's), shown on its tab and
// in the control room, a page any of the servers shows with a card for every
// chat. Each server keeps a small status file in a shared folder for it.
//
// Messages to the tab ({notify}) are one way and an older tab ignores them, so
// a chat on a new server still works with a tab from before, and the other way
// round.

let currentWhy = null;
// Which build of the editor is on disk now, to compare with the one a tab loaded.
const currentBuild = () => {
    try {
        return String(Math.round(fs.statSync(path.join(BUILD, 'editor.html')).mtimeMs));
    } catch (e) {
        return null;
    }
};
// Filled in once the tools are loaded, below.
let staleNoteHook = () => [];
let resetStale = () => {};
const CHAT_COLORS = ['#3a86ff', '#ff5d8f', '#2ec4b6', '#ffbe0b', '#8338ec', '#fb5607', '#06d6a0', '#e63946'];
// A colour no other running chat has, chosen once, so their tabs and cards
// can be told apart.
let myColor = null;
const chatColor = () => {
    if (!myColor && serving) {
        // eslint-disable-next-line no-use-before-define
        const used = new Set(readSessions().filter(s => s.port !== port)
            .map(s => s.color));
        myColor = CHAT_COLORS.find(c => !used.has(c)) || CHAT_COLORS[port % CHAT_COLORS.length];
    }
    return myColor || CHAT_COLORS[port % CHAT_COLORS.length];
};
const watch = {
    name: null, plan: null, progress: null, lastAction: null, thumb: null, frameMs: null, hidden: null,
    takenOver: false, idlePaused: false, notes: []
};
const identity = () => ({color: chatColor(), name: watch.name, port, control: `http://127.0.0.1:${port}/control`});
const notifyEditor = (kind, payload = {}) => {
    if (editor && editor.readyState === editor.OPEN) editor.send(JSON.stringify({notify: kind, ...payload}));
};

const SESSIONS = path.join(os.tmpdir(), 'flipwarp-sessions');
const statusFile = () => path.join(SESSIONS, `${port}.json`);
let statusTimer = null;
const writeStatus = () => {
    if (!serving || statusTimer) return;
    statusTimer = setTimeout(() => {
        statusTimer = null;
        try {
            fs.mkdirSync(SESSIONS, {recursive: true});
            fs.writeFileSync(statusFile(), JSON.stringify({
                port, pid: process.pid, editorUrl: editorUrl(), ...identity(),
                connected: Boolean(editor && editor.readyState === editor.OPEN),
                takenOver: watch.takenOver, idlePaused: watch.idlePaused, plan: watch.plan,
                progress: watch.progress, lastAction: watch.lastAction, thumb: watch.thumb,
                frameMs: watch.frameMs, hidden: watch.hidden, notesWaiting: watch.notes.length,
                lastSeen: Date.now()
            }));
        } catch (e) {
            // The control room misses one update; nothing else depends on it.
        }
    }, 300);
};
const removeStatus = () => {
    try {
        if (serving) fs.rmSync(statusFile(), {force: true});
    } catch (e) {
        // already gone
    }
};
setInterval(writeStatus, 5000).unref();

const pidAlive = pid => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e.code === 'EPERM';
    }
};
const readSessions = () => {
    let names = [];
    try {
        names = fs.readdirSync(SESSIONS).filter(n => n.endsWith('.json'));
    } catch (e) {
        return [];
    }
    const out = [];
    for (const n of names) {
        try {
            const s = JSON.parse(fs.readFileSync(path.join(SESSIONS, n), 'utf8'));
            if (Date.now() - s.lastSeen > 20000 || !pidAlive(s.pid)) {
                fs.rmSync(path.join(SESSIONS, n), {force: true});
                continue;
            }
            out.push(s);
        } catch (e) {
            // half written: next time
        }
    }
    return out.sort((a, b) => a.port - b.port);
};

const projectNameFrom = file => path.basename(file).replace(/\.sb3$/i, '')
    .replace(/-source$/i, '');
const setProjectName = name => {
    if (!name || name === watch.name) return;
    watch.name = name;
    notifyEditor('identity', identity());
    writeStatus();
};

// Events from the tab: a note typed for Claude, the person taking over the
// editor or handing it back, and a heartbeat with a thumbnail.
const handleEvent = message => {
    switch (message.event) {
    case 'note':
        if (typeof message.text === 'string' && message.text.trim()) {
            watch.notes.push({text: message.text.trim().slice(0, 1000), about: message.about || null});
        }
        break;
    case 'takeover':
        watch.takenOver = Boolean(message.on);
        if (!message.on) {
            watch.notes.push({text: `I have handed the editor back to you.${message.changed ?
                ` While I had it I changed: ${message.changed}. Read those sprites before changing them.` :
                ' I did not change anything.'}`});
        }
        break;
    case 'heartbeat':
        if (typeof message.thumb === 'string' && message.thumb.length < 60000) watch.thumb = message.thumb;
        watch.frameMs = typeof message.frameMs === 'number' ? message.frameMs : watch.frameMs;
        watch.hidden = Boolean(message.hidden);
        watch.idlePaused = Boolean(message.idlePaused);
        break;
    default:
        return;
    }
    writeStatus();
};

// Notes and the take-over state ride along with the next tool reply: Claude
// can only hear the person between steps.
const withNotes = result => {
    const extra = [...staleNoteHook()];
    if (watch.takenOver) {
        extra.push('The person watching has taken over the editor to make changes themselves. Do not change ' +
            'the project until they hand it back: wait a little and check again, or ask them.');
    }
    if (watch.notes.length) {
        for (const n of watch.notes) {
            extra.push(`The person watching left you a note${n.about ? ` about ${n.about}` : ''}: "${n.text}"`);
        }
        watch.notes = [];
        notifyEditor('notes-read');
        writeStatus();
    }
    if (!extra.length || !result || !Array.isArray(result.content)) return result;
    return {...result, content: [...result.content, {type: 'text', text: `\n${extra.join('\n')}`}]};
};

const progress = p => {
    watch.progress = p;
    notifyEditor('progress', p || {done: 1, total: 1});
    writeStatus();
};

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

    // The control room, and what it asks of each server.
    const origin = req.headers.origin;
    const cors = origin && allowedOrigin(origin) ? {'Access-Control-Allow-Origin': origin} : {};
    if (pathname === '/build-id') {
        res.writeHead(200, {'Content-Type': 'text/plain', 'Cache-Control': 'no-cache'}).end(currentBuild() || '');
        return;
    }
    if (pathname === '/sessions') {
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...cors})
            .end(JSON.stringify(readSessions()));
        return;
    }
    if (pathname === '/flags') {
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...cors})
            .end(JSON.stringify(openFlags()));
        return;
    }
    if (pathname === '/flags/resolve') {
        // Only pages on this computer, like /act.
        if (req.method !== 'POST' || (origin && !allowedOrigin(origin))) {
            res.writeHead(403, cors).end();
            return;
        }
        resolveFlag(new URL(req.url, 'http://x').searchParams.get('id'), 'Resolved by the person');
        res.writeHead(204, cors).end();
        return;
    }
    if (pathname === '/control') {
        fs.readFile(path.join(here, 'control.html'), (err, data) => {
            if (err) res.writeHead(404).end();
            else res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache'}).end(data);
        });
        return;
    }
    if (pathname === '/act') {
        // Only pages on this computer: a website must not pause the games.
        if (req.method !== 'POST' || (origin && !allowedOrigin(origin))) {
            res.writeHead(403, cors).end();
            return;
        }
        const what = new URL(req.url, 'http://x').searchParams.get('do');
        if (!['pause', 'resume'].includes(what)) {
            res.writeHead(400, cors).end();
            return;
        }
        notifyEditor('act', {do: what});
        res.writeHead(204, cors).end();
        return;
    }

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
            ws.build = message.build || null;
            // A tab opened by hand has no mark and is welcome.
            if (message.chat && message.chat !== CHAT) {
                ws.send(JSON.stringify({refused: 'This Flipwarp tab belonged to a Claude chat that has ended. ' +
                    'You can close it.'}));
                ws.close();
                log('refused a tab from an earlier chat');
                return;
            }
            ws.marked = message.chat === CHAT;
            if (editor && editor.readyState === editor.OPEN) {
                // Only a tab this chat opened may wait to take over. Anything
                // else on this computer that can reach the port (another page,
                // a project's extension) cannot queue up to be handed the job
                // the moment the real tab reloads.
                if (!ws.marked) {
                    ws.send(JSON.stringify({refused: 'Another Flipwarp tab is already connected to this Claude ' +
                        'chat. You can close this one.'}));
                    ws.close();
                    log('refused an unmarked tab while one is connected');
                    return;
                }
                waiting.push(ws);
                log('another editor tab connected; it waits until the first one closes');
            } else {
                editor = ws;
                resetStale();
                log('editor connected');
                // A tab that reloaded has lost the take-over: it starts watching.
                watch.takenOver = false;
                notifyEditor('welcome', {...identity(), plan: watch.plan});
                writeStatus();
            }
            return;
        }
        if (message.event) {
            if (ws === editor) handleEvent(message);
            return;
        }
        // Answers count only from the tab that was asked: anything else
        // connected could otherwise answer for it, guessing the next id.
        const request = pending.get(message.id);
        if (!request || request.socket !== ws) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) {
            if (message.error.stack && !message.error.parse) log(`editor error: ${message.error.stack}`);
            // A tab from before a request was added does not know it.
            const e = new Error(/^Unknown request/.test(message.error.message || '') ?
                `This editor tab runs an older Flipwarp that does not know "${request.method}". Save the game ` +
                    '(save_project), ask the person to reload the Flipwarp tab, then load_project it again.' :
                message.error.message);
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
            if (editor) notifyEditor('welcome', {...identity(), plan: watch.plan});
            writeStatus();
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
            writeStatus();
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
    return `Connected. The editor is at ${editorUrl()}\nThe person can watch from http://127.0.0.1:${port}/control ` +
        '(that page is for them: other chats\' work is not yours to open).' +
        (others ?
        `\n${others} other Flipwarp tab(s) are open too and are not being used. ` +
        'Close them if that is confusing.' : '');
};

const openInBrowser = url => {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] :
        process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, {detached: true, stdio: 'ignore'}).unref();
};

// A browser gives a hidden tab little of a busy computer: with chats building
// at the same time a big project can take minutes to open behind another tab.
// Chrome can be told not to, but only when it starts, and a Chrome already
// running ignores it, so Flipwarp's tabs get a Chrome of their own: one window
// all chats share, with its own profile. FLIPWARP_OWN_BROWSER=0 uses the
// default browser instead, as does a computer without Chrome or Edge.
const browserToKeepAwake = () => {
    if (process.env.FLIPWARP_OWN_BROWSER === '0') return null;
    const roots = process.platform === 'win32' ?
        [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
            .flatMap(root => [
                path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
            ]) :
        process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] :
            ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
    return roots.find(file => fs.existsSync(file)) || null;
};

let openedAt = 0;
const launchEditor = () => {
    openedAt = Date.now();
    const browser = browserToKeepAwake();
    if (!browser) {
        openInBrowser(editorUrl());
        return;
    }
    spawn(browser, [
        `--user-data-dir=${path.join(os.homedir(), '.flipwarp', 'browser')}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        editorUrl()
    ], {detached: true, stdio: 'ignore'}).unref();
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
        'the game with the play tools and fix it until it works. To rebuild a finished game the Scratch way ' +
        '(restyle it), call restyle_workflow first. A person watches the editor: call plan with your steps ' +
        'when you start a job and as you reach each one, give tools a short why, and act on notes from them ' +
        'that come back in tool replies. When you hit something that would matter beyond this chat (a bug in ' +
        'Flipwarp or these tools, something slow, a missing tool, a guide that misled you, an idea that would ' +
        'help everyone) call flag_issue straight away and carry on, even if you found a way round: every other ' +
        'chat and the person see it. list_flags shows what others have found.'
});

// Every tool takes a "why", shown to the person watching beside what it does,
// and every reply carries any note they left.
const WHY = z.string().max(200).optional()
    .describe('One short sentence for the person watching: why you are doing this');
const registerTool = server.registerTool.bind(server);
server.registerTool = (name, config, handler) => registerTool(name, {
    ...config,
    inputSchema: {...(config.inputSchema || {}), why: WHY}
}, async (args, extra) => {
    const {why, ...rest} = args || {};
    currentWhy = typeof why === 'string' && why.trim() ? why.trim() : null;
    watch.lastAction = {tool: name, why: currentWhy, at: Date.now()};
    writeStatus();
    try {
        return withNotes(await handler(rest, extra));
    } finally {
        currentWhy = null;
    }
});

server.registerTool('plan', {
    title: 'Show the plan',
    description: 'Shows the person watching a checklist of your steps and which one you are on, with a ' +
        'progress bar, in the editor, on its tab and in the control room. Call it with steps when you plan a ' +
        'job, with current as you reach each step, with status "needs-you" when you are waiting for the ' +
        'person and "done" at the end. name is the game\'s name, shown on its tab.',
    inputSchema: {
        steps: z.array(z.string().max(80)).min(1).max(20).optional().describe('The steps, in order'),
        current: z.number().int().min(1).optional().describe('The step you are on now, counting from 1'),
        status: z.enum(['working', 'needs-you', 'done']).optional(),
        name: z.string().max(60).optional()
    }
}, tool(async ({steps, current, status, name}) => {
    const plan = watch.plan || {steps: [], current: 1, status: 'working'};
    if (steps) {
        plan.steps = steps;
        plan.current = 1;
    }
    if (current) plan.current = Math.min(current, Math.max(1, plan.steps.length));
    plan.status = status || (steps || current ? 'working' : plan.status);
    if (plan.status === 'done') plan.current = plan.steps.length;
    watch.plan = plan;
    if (name) setProjectName(name);
    notifyEditor('plan', {plan});
    writeStatus();
    if (!plan.steps.length) return text('There is no plan yet: give steps.');
    return text(plan.status === 'done' ? `Plan done: all ${plan.steps.length} steps. If anything in Flipwarp got ` +
        'in your way and is not flagged yet, flag_issue saves the next chat from it.' :
        `Showing step ${plan.current} of ${plan.steps.length}: ${plan.steps[plan.current - 1]}` +
        (plan.status === 'needs-you' ? ' (waiting for the person)' : ''));
}));

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

// --- the rest of the tools, reloaded when they change -----------------------------
//
// tools.mjs (and the guide, pieces and sounds it uses) can change while chats
// are working. When one does, the old tools are taken away and the new ones
// registered in their place, over the same connections: Claude Code is told
// the tool list changed, the editor tab and the game stay as they are. A
// reload that fails keeps the tools that were there. A change to this file
// itself cannot be loaded this way, and Claude is told to have the chat
// reconnected.

const ctx = {ask, text, json, failure, tool, describeParse, progress, notifyEditor, setProjectName, projectNameFrom,
    watch};
let toolsModule = null;
let toolHandles = [];
let toolsVersion = 0;

const loadTools = async () => {
    const version = toolsVersion++;
    let mod;
    try {
        mod = await import(`./tools.mjs${version ? `?v=${version}` : ''}`);
    } catch (e) {
        log(`the changed tools could not be loaded, keeping the ones there: ${e.message}`);
        return false;
    }
    const old = toolHandles;
    for (const handle of old) handle.remove();
    try {
        toolHandles = await mod.registerTools(server, ctx, version);
        toolsModule = mod;
        return true;
    } catch (e) {
        log(`the changed tools could not be registered, putting the old ones back: ${e.message}`);
        for (const handle of toolHandles) {
            try {
                handle.remove();
            } catch (err) {
                // not registered after all
            }
        }
        toolHandles = toolsModule ? await toolsModule.registerTools(server, ctx, version) : [];
        return false;
    }
};
await loadTools();

let shellChanged = false;
let shellTold = false;
const watchFiles = () => {
    let timer = null;
    const changed = name => {
        if (!name) return;
        if (name === 'server.mjs') {
            shellChanged = true;
            return;
        }
        if (!/\.(mjs|fw)$/.test(name)) return;
        clearTimeout(timer);
        timer = setTimeout(async () => {
            if (await loadTools()) log('tools reloaded');
        }, 500);
    };
    for (const dir of [here, path.join(here, 'library')]) {
        try {
            fs.watch(dir, (event, name) => changed(name)).unref();
        } catch (e) {
            // No watching here: new tools arrive with the next reconnect.
        }
    }
};
watchFiles();

// --- an editor tab older than the editor ------------------------------------------
//
// The tab says which build of the editor it loaded. When the editor has been
// rebuilt since, Claude is told once (and the tab shows it) that the tab needs
// saving and reloading before new tools work in it.

let staleTold = false;
resetStale = () => {
    staleTold = false;
};
const tabIsOld = () => {
    if (!editor || !editor.build) return false;
    const now = currentBuild();
    return Boolean(now && now !== editor.build);
};
try {
    let timer = null;
    fs.watch(BUILD, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (tabIsOld() && !staleTold) notifyEditor('stale');
        }, 3000);
    }).unref();
} catch (e) {
    // Checked again with every tool reply.
}
const staleNote = () => {
    const notes = [];
    if (tabIsOld() && !staleTold) {
        staleTold = true;
        notifyEditor('stale');
        notes.push('The Flipwarp editor has been rebuilt since this editor tab opened, so the tab runs the older ' +
            'version and newer tools may not work in it. Save the game (save_project), then ask the person to ' +
            'reload the Flipwarp tab, then load_project it again.');
    }
    if (shellChanged && !shellTold) {
        shellTold = true;
        notes.push('Part of the Flipwarp server has been updated that only takes effect when this chat ' +
            'reconnects to it. When convenient, ask the person to reconnect flipwarp (/mcp, then Reconnect).');
    }
    return notes;
};
staleNoteHook = staleNote;

if (OPEN_AT_START) {
    server.server.oninitialized = async () => {
        if (!await listening || !fs.existsSync(path.join(BUILD, 'editor.html'))) return;
        if (!editor) launchEditor();
    };
}

// When the chat ends, Claude Code closes this server's input: take this chat
// out of the control room and let the port go, rather than hold it with
// nobody left to use it.
process.on('exit', removeStatus);
process.stdin.on('end', () => process.exit(0));

await server.connect(new StdioServerTransport());
log('ready');
