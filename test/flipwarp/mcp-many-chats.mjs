// Several Claude Code chats at once, each with its own editor.
//
// Starts two servers on one port range, as two chats in Scratch Studio do,
// and checks they take different ports and keys. Then open the two editor
// addresses it prints: each tab must connect to its own server only. Last,
// the first server stops and a third takes its port: the first tab, left
// open, must be refused rather than take over the new chat.
//
// FLIPWARP_PORT=<first port> picks where the range starts (default 8650).
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.join(here, '..', '..', 'mcp');
const require = createRequire(path.join(mcpDir, 'package.json'));
const {Client} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {StdioClientTransport} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);

const base = Number(process.env.FLIPWARP_PORT) || 8650;
const range = `${base}-${base + 2}`;

let failures = 0;
const check = (ok, what, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok && detail) console.log(`       ${String(detail).slice(0, 600)}`);
    return ok;
};

const chat = async name => {
    const client = new Client({name, version: '0'});
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(mcpDir, 'server.mjs')],
        env: {...process.env, FLIPWARP_PORT: range, FLIPWARP_OPEN: ''},
        stderr: 'pipe'
    });
    let log = '';
    transport.stderr.on('data', d => {
        log += d;
    });
    await client.connect(transport);
    const call = async (tool, args = {}) => {
        const r = await client.callTool({name: tool, arguments: args});
        return {error: !!r.isError, text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n')};
    };
    const first = await call('open_editor', {launch: false});
    const url = (first.text.match(/http:\/\/\S+/) || [''])[0].replace(/[.,]$/, '');
    const connected = async ms => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            if (!(await call('open_editor', {launch: false})).error) return true;
            await new Promise(r => setTimeout(r, 1000));
        }
        return false;
    };
    return {client, call, url, connected, log: () => log};
};

const portOf = url => Number(new URL(url).port);
const keyOf = url => new URL(url).searchParams.get('chat');

const a = await chat('chat A');
const b = await chat('chat B');
check(portOf(a.url) === base && portOf(b.url) === base + 1, 'two chats take the first two free ports',
    `${a.url} / ${b.url}`);
check(keyOf(a.url) && keyOf(b.url) && keyOf(a.url) !== keyOf(b.url), 'each chat has its own key');

console.log(`\nopen both:\n  ${a.url}\n  ${b.url}\n`);
check(await a.connected(120000), 'chat A connects to its editor');
check(await b.connected(120000), 'chat B connects to its editor');

await a.call('create_sprite', {name: 'Only In A'});
const inA = (await a.call('project_overview')).text;
const inB = (await b.call('project_overview')).text;
check(inA.includes('Only In A') && !inB.includes('Only In A'), 'each chat works in its own project');

// Chat A ends; its tab stays open. Chat C gets A's port.
await a.client.close();
await new Promise(r => setTimeout(r, 1000));
const c = await chat('chat C');
check(portOf(c.url) === base, 'a new chat takes the port the ended chat left', c.url);
check(keyOf(c.url) !== keyOf(a.url), 'with a new key');
check(!(await c.connected(20000)), 'the ended chat\'s tab does not take over the new chat');
check(/refused a tab from an earlier chat/.test(c.log()), 'the new chat refused it', c.log());
check(!(await b.call('project_overview')).error, 'chat B is still connected');

await b.client.close();
await c.client.close();
if (failures) {
    console.log(`${failures} failure(s)`);
    process.exit(1);
}
console.log('several chats: all passed');
process.exit(0);
