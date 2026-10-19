// What the flipwarp-mcp play tests share: start the server as Claude Code
// does, wait for an editor to connect, call tools, count what passed.
//
// FLIPWARP_PORT picks the port, for when another copy of the server (Claude
// Code's own, say) already has 8601. The SDK hands a server only a few safe
// environment variables unless told otherwise, so the whole environment is
// passed on, or the port would never reach it.
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
export const mcpDir = path.join(here, '..', '..', 'mcp');
const require = createRequire(path.join(mcpDir, 'package.json'));
const {Client} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const {StdioClientTransport} = await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);

export const port = Number(process.env.FLIPWARP_PORT) || 8601;
export const editorUrl = `http://127.0.0.1:${port}/editor.html?mcp`;

/**
 * Start the server and wait for an editor to connect to it.
 * @param {string} name what this test calls itself
 * @param {object} [options] stderr: 'inherit' to see the server's log
 * @returns {Promise<object>} the helpers
 */
export const start = async (name, {stderr = 'ignore'} = {}) => {
    const client = new Client({name, version: '0'});
    await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: [path.join(mcpDir, 'server.mjs')],
        env: {...process.env, FLIPWARP_PORT: String(port)},
        stderr
    }));

    let failures = 0;
    const raw = (tool, args = {}) => client.callTool({name: tool, arguments: args});
    const call = async (tool, args = {}) => {
        const r = await raw(tool, args);
        return {
            error: !!r.isError,
            text: r.content.filter(c => c.type === 'text').map(c => c.text).join('\n'),
            image: r.content.find(c => c.type === 'image')
        };
    };
    const check = (ok, what, detail) => {
        if (!ok) failures++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
        if (!ok && detail) console.log(`       ${String(detail).slice(0, 800).split('\n').join('\n       ')}`);
        return ok;
    };
    const must = async (what, tool, args) => {
        const r = await call(tool, args);
        check(!r.error, what, r.text);
        return r;
    };
    // SAVE_PICTURES=<folder> keeps a picture a tool answered with.
    const keep = (label, r) => {
        const to = process.env.SAVE_PICTURES;
        if (!to || !r || !r.image) return;
        fs.mkdirSync(to, {recursive: true});
        fs.writeFileSync(path.join(to, `${label}.png`), Buffer.from(r.image.data, 'base64'));
    };
    const finish = async passed => {
        await client.close();
        if (failures) {
            console.log(`${failures} failure(s)`);
            process.exit(1);
        }
        console.log(passed);
        process.exit(0);
    };

    console.log(`waiting for the editor at ${editorUrl} ...`);
    const until = Date.now() + 120000;
    while (Date.now() < until && (await call('open_editor', {launch: false})).error) {
        await new Promise(r => setTimeout(r, 1000));
    }
    if ((await call('open_editor', {launch: false})).error) {
        console.log('FAIL the editor never connected');
        process.exit(1);
    }
    return {client, raw, call, check, must, keep, finish, failures: () => failures};
};
