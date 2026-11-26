// The project carried inside an export, so that File > Import from Code.org can
// bring it back: project.json and where each costume and sound went, packed
// small, and a fingerprint of each script as it was written. A script whose
// code is unchanged comes back as the very blocks it was; one that was edited
// on Code.org is read back from its code.

import {Parser} from 'acorn';

// The packed project is one string in the code, starting with this.
export const SOURCE_MARK = 'FWSRC1:';
const SOURCE_RE = /FWSRC1:([A-Za-z0-9+/=]+)/;

// Line endings, indents and blank lines do not change what a script does, and
// editors change them freely, so they do not count.
const normalize = text => String(text).replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');

/**
 * A short fingerprint of a piece of code (64-bit FNV-1a, as hex).
 * @param {string} text the code
 * @returns {string} 16 hex digits
 */
export const fingerprint = text => {
    const s = normalize(text);
    let h1 = 0x811c9dc5;
    let h2 = 0x050c5d1f;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c ^ (i & 0xff), 0x01000193) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
};

const parseJs = code => Parser.parse(code, {ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true,
    allowHashBang: true});

const isMe = params => params.length >= 2 && params[0].type === 'Identifier' && params[0].name === 'me' &&
    (params[1].type === 'Identifier' ? params[1].name === 'warp' :
        params[1].type === 'AssignmentPattern' && params[1].left.name === 'warp');

/**
 * The scripts and custom blocks in exported JavaScript (Web Lab's game.js or
 * Game Lab's code.js), in order. A script is "sprite.whenSomething(..., function
 * (me, warp) {...});"; a custom block is "function name(me, warp, ...) {...}".
 * @param {string} code the code
 * @param {object} [ast] the code already parsed
 * @returns {Array<object>} {kind: 'hat'|'proc', owner, hat, fn, node, text, hash}
 */
export const jsUnits = (code, ast) => {
    const program = ast || parseJs(code);
    const out = [];
    const visit = body => {
        for (const st of body) {
            if (st.type === 'FunctionDeclaration' && st.id && isMe(st.params)) {
                const text = code.slice(st.start, st.end);
                out.push({kind: 'proc', fn: st.id.name, node: st, text, hash: fingerprint(text)});
                continue;
            }
            if (st.type !== 'ExpressionStatement') continue;
            const call = st.expression;
            if (call.type !== 'CallExpression') continue;
            const callee = call.callee;
            // (function () { ... })(); : the Web Lab game is inside one.
            if ((callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression') &&
                callee.body.type === 'BlockStatement') {
                visit(callee.body.body);
                continue;
            }
            if (callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier' ||
                !/^when/.test(callee.property.name)) continue;
            const fn = call.arguments[call.arguments.length - 1];
            if (!fn || (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression') ||
                !isMe(fn.params)) continue;
            const text = code.slice(st.start, st.end);
            out.push({kind: 'hat', owner: callee.object.name, hat: callee.property.name, node: st, text,
                hash: fingerprint(text)});
        }
    };
    visit(program.body);
    return out;
};

/**
 * The scripts and custom blocks in exported Python (main.py), in order: each is
 * a decorator line ("@player.when_flag_clicked", "@custom_block") and its def.
 * @param {string} code the code
 * @returns {Array<object>} {kind: 'hat'|'proc', owner, hat, fn, start, end, text, hash}
 */
export const pyUnits = code => {
    const lines = String(code).replace(/\r\n?/g, '\n')
        .split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^@([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/.exec(lines[i]);
        if (!m) continue;
        let j = i + 1;
        while (j < lines.length && /^@/.test(lines[j])) j++;
        const def = /^def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[j] || '');
        if (!def) continue;
        let end = j + 1;
        // The body: every line after the def until one that starts at the left edge.
        while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end++;
        while (end > j + 1 && lines[end - 1].trim() === '') end--;
        const text = lines.slice(i, end).join('\n');
        const proc = m[1] === 'custom_block' && !m[2];
        out.push(proc ?
            {kind: 'proc', fn: def[1], start: i, end, text, hash: fingerprint(text)} :
            {kind: 'hat', owner: m[1], hat: m[2], fn: def[1], start: i, end, text, hash: fingerprint(text)});
        i = end - 1;
    }
    return out;
};

const toBase64 = bytes => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
};
const fromBase64 = text => {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};
const streamBytes = async (bytes, stream) => {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
};

/**
 * Pack the project for carrying inside the code.
 * @param {object} source {v, target, title, project, units, assets}
 * @returns {Promise<string>} "FWSRC1:" and the packed project
 */
export const packSource = async source => {
    const json = new TextEncoder().encode(JSON.stringify(source));
    return SOURCE_MARK + toBase64(await streamBytes(json, new CompressionStream('deflate-raw')));
};

/**
 * Find the project packed in some code, if there is one.
 * @param {string} text the code (or a page with the code in it)
 * @returns {boolean} whether it is there
 */
export const hasSource = text => SOURCE_RE.test(String(text));

/**
 * Unpack the project carried in some code.
 * @param {string} text the code (or a page with the code in it)
 * @returns {Promise<?object>} {v, target, title, project, units, assets}, or null when there is none
 */
export const unpackSource = async text => {
    const m = SOURCE_RE.exec(String(text));
    if (!m) return null;
    const bytes = await streamBytes(fromBase64(m[1]), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(bytes));
};

/**
 * Pair what the writer says it wrote with the scripts found in the finished
 * code, and fingerprint each one.
 * @param {Array<object>} written {target, top, fn, proccode, params} from the writer, in order
 * @param {Array<object>} found from jsUnits or pyUnits
 * @returns {?Array<object>} {target, top, hash, fn, proccode, params}, or null when they do not line up
 */
export const fingerprintUnits = (written, found) => {
    if (!written || written.length !== found.length) return null;
    const out = [];
    for (let i = 0; i < written.length; i++) {
        const w = written[i];
        const f = found[i];
        if ((w.fn ? 'proc' : 'hat') !== f.kind || (w.fn && w.fn !== f.fn)) return null;
        out.push({...w, hash: f.hash});
    }
    return out;
};
