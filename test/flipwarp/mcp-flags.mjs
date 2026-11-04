// Chats flagging things for each other: a flag reaches a second chat with its
// own server, the same problem adds to the same flag, the control room's
// address shows them and resolving takes them off, and only pages on this
// computer can do that. Needs no editor tab.
//
// FLIPWARP_PORT picks the first of the two ports (default 8690).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.join(here, '..', '..', 'mcp');
const require = createRequire(path.join(mcpDir, 'package.json'));
const {Client} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {StdioClientTransport} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);

const port = Number(process.env.FLIPWARP_PORT) || 8690;
const flagsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-flags-')), 'flags.jsonl');
let failures = 0;
const check = (ok, what, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok && detail) console.log(`       ${String(detail).slice(0, 700)}`);
};

const chat = async (name, chatPort) => {
    const client = new Client({name, version: '0'});
    await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [path.join(mcpDir, 'server.mjs')],
        env: {...process.env, FLIPWARP_PORT: String(chatPort), FLIPWARP_FLAGS: flagsFile},
        stderr: 'ignore'
    }));
    return async (tool, args = {}) => {
        const r = await client.callTool({name: tool, arguments: args});
        return {error: !!r.isError, text: r.content.map(c => c.text || '').join('\n')};
    };
};

const one = await chat('first', port);
const two = await chat('second', port + 1);

let r = await one('list_flags');
check(r.text === 'Nothing is flagged.', 'nothing is flagged to begin with', r.text);

r = await one('flag_issue', {
    kind: 'slow',
    title: 'load_project takes minutes in a hidden tab',
    details: 'Keeping the tab visible avoids it.',
    about: 'load_project'
});
check(!r.error && /^Flagged as f/.test(r.text), 'a chat can flag something', r.text);
const id = r.text.match(/Flagged as (f\w+)/)[1];

r = await two('list_flags');
check(r.text.includes('load_project takes minutes') && r.text.includes('Keeping the tab visible'),
    'a second chat, with its own server, sees it', r.text);

r = await two('flag_issue', {
    kind: 'slow',
    title: 'load_project takes several minutes in a hidden tab',
    details: 'Seen on a big game.'
});
check(r.text.includes('already flagged') && r.text.includes('Keeping the tab visible'),
    'the same problem in other words adds to that flag, and passes on what it said', r.text);

r = await two('flag_issue', {kind: 'idea', title: 'A way to run a single custom block', details: 'For testing.'});
check(/^Flagged as/.test(r.text), 'a different problem gets its own flag', r.text);

r = await two('list_flags');
check(r.text.includes('2 chats hit this'), 'the list says how many chats hit it', r.text);
check(r.text.indexOf('load_project') < r.text.indexOf('single custom block'), 'most-hit first', r.text);

r = await one('flag_issue', {kind: 'bug', title: 'no', details: 'x'});
check(r.error, 'a title too short to recognise is refused', r.text);

// Waits until the server is listening, which it does in the background.
const base = `http://127.0.0.1:${port}`;
let shown = null;
for (let i = 0; i < 40 && !shown; i++) {
    try {
        shown = await (await fetch(`${base}/flags`)).json();
    } catch (e) {
        await new Promise(done => setTimeout(done, 250));
    }
}
check(shown && shown.length === 2 && shown[0].sightings.length === 1, 'the control room can read them', JSON.stringify(shown));

const page = await (await fetch(`${base}/control`)).text();
check(page.includes('id="flags"'), 'the control room has a place for them');

const refused = await fetch(`${base}/flags/resolve?id=${id}`, {method: 'POST', headers: {Origin: 'https://example.com'}});
check(refused.status === 403, 'a website cannot resolve one', refused.status);
check((await (await fetch(`${base}/flags`)).json()).length === 2, 'and it stays on the list');

r = await one('resolve_flag', {id: 'nope', note: 'x'});
check(r.error, 'resolving a flag that does not exist says so', r.text);

r = await one('resolve_flag', {id, note: 'Fixed.'});
check(!r.error, 'a chat can resolve one once it is fixed', r.text);

const other = (await (await fetch(`${base}/flags`)).json())[0];
const pressed = await fetch(`${base}/flags/resolve?id=${other.id}`, {method: 'POST'});
check(pressed.status === 204, 'the Resolved button works', pressed.status);

r = await two('list_flags');
check(r.text === 'Nothing is flagged.', 'and they are gone from every chat', r.text);

fs.writeFileSync(flagsFile, `${fs.readFileSync(flagsFile, 'utf8')}{"add":{"id":"cut sho`);
r = await two('list_flags');
check(!r.error, 'a line cut short by a crash does no harm', r.text);

r = await one('get_piece', {piece: 'nobody'});
check(r.error && r.text.includes('flag_issue'), 'the first failure of a chat reminds it flagging exists', r.text);
r = await one('get_piece', {piece: 'nobody'});
check(r.error && !r.text.includes('flag_issue'), 'only once', r.text);

fs.rmSync(path.dirname(flagsFile), {recursive: true, force: true});
console.log(failures ? `${failures} failure(s)` : 'flagging works');
process.exit(failures ? 1 : 0);
