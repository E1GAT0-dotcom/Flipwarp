// Idle pause, and a tab closing itself once its chat has ended.
//
// Starts a server as a chat would, then open the address it prints (it asks
// for a 5 second idle pause). A game counting its frames runs (the turn makes
// each pass of the loop a frame); with no requests it must
// stop counting, and carry on with the next request with no jump. Then the
// project is saved, this chat ends and a new one takes the port: the old tab
// must close itself (check that it has gone).
//
// FLIPWARP_PORT=<port> picks the port (default 8660).
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

const port = String(Number(process.env.FLIPWARP_PORT) || 8660);
let failures = 0;
const check = (ok, what, detail) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok && detail) console.log(`       ${String(detail).slice(0, 600)}`);
    return ok;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chat = async name => {
    const client = new Client({name, version: '0'});
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(mcpDir, 'server.mjs')],
        env: {...process.env, FLIPWARP_PORT: port, FLIPWARP_OPEN: ''},
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
    return {client, call, url, log: () => log};
};
const count = async a => JSON.parse((await a.call('get_state')).text).stage.globals.n;

const a = await chat('idle test');
console.log(`\nopen:\n  ${a.url}&idle=5\n`);
const until = Date.now() + 120000;
while (Date.now() < until && (await a.call('open_editor', {launch: false})).error) await sleep(1000);

const written = await a.call('write_sprite', {sprite: 'Sprite1', text: `global variable n;

whenGreenFlagClicked {
  n = 0;
  forever {
    n += 1;
    turnRight(1);
  }
}`});
check(!written.error, 'write a counting game', written.text);
await a.call('green_flag');
await sleep(1000);
const before = await count(a);
check(before > 0, 'it counts', before);

// No requests for 15s: paused after about 5.
await sleep(15000);
const after = await count(a);
const ran = after - before;
check(ran < 12 * 30, `it paused while idle (${ran} frames in 15s, not about 450)`, after);
await sleep(2000);
const again = await count(a);
check(again > after, 'the next request carried it on', `${after} -> ${again}`);
check(again - after < 3 * 30, 'with no jump', `${after} -> ${again}`);

// Saved, so the tab may close once this chat has ended.
const file = path.join(os.tmpdir(), 'flipwarp-idle-test.sb3');
const saved = await a.call('save_project', {path: file});
check(!saved.error, 'save the project', saved.text);
await a.client.close();
await sleep(1000);
const b = await chat('next chat');
check(new URL(b.url).port === port, 'the next chat takes the port');
await sleep(15000);
check(/refused a tab from an earlier chat/.test(b.log()), 'the next chat refused the old tab', b.log());
console.log('now check the old tab has closed itself');
await b.client.close();
fs.rmSync(file, {force: true});

if (failures) {
    console.log(`${failures} failure(s)`);
    process.exit(1);
}
console.log('idle pause: all passed');
process.exit(0);
