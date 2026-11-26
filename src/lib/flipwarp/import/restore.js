// A Flipwarp export brought back: the project it carries (export/source.js),
// with what was changed in the code since put back in. Scripts whose code is
// as exported keep their exact blocks; edited ones are read back from the code
// (decompile.js); sprites' positions, sizes and variables' starting values are
// read from the code too, so changing "x: 0" to "x: 50" moves the sprite.

import {Parser} from 'acorn';
import {jsUnits, pyUnits} from '../export/source.js';
import {makeDecompiler, DecompileError} from './decompile.js';
import {parsePython} from './python-parse.js';
import {targetToText, procIdentFromProccode, slugParam} from '../to-text.js';
import {declLine} from '../names.js';
import {parse} from '../parse.js';
import {buildTarget} from '../build.js';
import {getStyle} from '../styles.js';

const parseJs = code => Parser.parse(code, {ecmaVersion: 'latest', sourceType: 'script', locations: true,
    allowReturnOutsideFunction: true});

// The plain value written in the code: numbers, text, true/false, lists and objects of them.
const literalOf = node => {
    if (!node) return undefined;
    switch (node.type) {
    case 'Literal': return node.value;
    case 'TemplateLiteral': return node.expressions.length ? undefined : node.quasis.map(q => q.value.cooked).join('');
    case 'UnaryExpression':
        if (node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
            return -node.argument.value;
        }
        if (node.operator === '!' && node.argument.type === 'Literal') return !node.argument.value;
        return undefined;
    case 'Identifier':
        if (node.name === 'Infinity') return Infinity;
        if (node.name === 'NaN') return NaN;
        return undefined;
    case 'ArrayExpression': return node.elements.map(literalOf);
    case 'ObjectExpression': {
        const out = {};
        for (const p of node.properties) {
            const key = p.key.type === 'Identifier' ? p.key.name : literalOf(p.key);
            if (key === undefined) continue;
            out[String(key)] = literalOf(p.value);
        }
        return out;
    }
    }
    return undefined;
};

// game.addSprite({...}) / game.add_sprite(name=..., ...) in the code: the code's
// name for each sprite, and what the code says it starts as.
const specsOf = (program, py) => {
    const out = [];
    const visit = body => {
        for (const st of body) {
            let name = null;
            let init = null;
            if (st.type === 'VariableDeclaration' && st.declarations.length === 1) {
                name = st.declarations[0].id.name;
                init = st.declarations[0].init;
            } else if (st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' &&
                st.expression.left.type === 'Identifier') {
                name = st.expression.left.name;
                init = st.expression.right;
            } else if (st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression') {
                const callee = st.expression.callee;
                if ((callee.type === 'FunctionExpression' || callee.type === 'ArrowFunctionExpression') &&
                    callee.body.type === 'BlockStatement') visit(callee.body.body);
                continue;
            }
            if (!init || init.type !== 'CallExpression' || init.callee.type !== 'MemberExpression') continue;
            const method = init.callee.property && init.callee.property.name;
            if (!/^add_?(Sprite|Stage|sprite|stage)$/.test(method || '')) continue;
            let spec;
            if (py) {
                spec = {};
                for (const k of init.keywords || []) spec[k.name] = literalOf(k.value);
            } else {
                spec = literalOf(init.arguments[0]) || {};
            }
            out.push({variable: name, stage: /stage/i.test(method), spec});
        }
    };
    visit(program.body);
    return out;
};

// The longest common run of fingerprints, to see which scripts are as they were.
const align = (old, now) => {
    const n = old.length;
    const m = now.length;
    const table = Array.from({length: n + 1}, () => new Int32Array(m + 1));
    for (let a = n - 1; a >= 0; a--) {
        for (let b = m - 1; b >= 0; b--) {
            table[a][b] = old[a].hash === now[b].hash ? table[a + 1][b + 1] + 1 :
                Math.max(table[a + 1][b], table[a][b + 1]);
        }
    }
    // Pairs: [oldIndex|null, nowIndex|null, same].
    const pairs = [];
    let a = 0;
    let b = 0;
    const pendingOld = [];
    const pendingNow = [];
    const flush = () => {
        // Between two scripts that are the same, a changed one takes the place of an old one.
        while (pendingOld.length || pendingNow.length) {
            pairs.push([pendingOld.length ? pendingOld.shift() : null, pendingNow.length ? pendingNow.shift() : null,
                false]);
        }
    };
    while (a < n || b < m) {
        if (a < n && b < m && old[a].hash === now[b].hash) {
            flush();
            pairs.push([a, b, true]);
            a++;
            b++;
        } else if (b >= m || (a < n && table[a + 1][b] >= table[a][b + 1])) {
            pendingOld.push(a++);
        } else {
            pendingNow.push(b++);
        }
    }
    flush();
    return pairs;
};

const contextOf = project => {
    const stage = project.targets.find(t => t.isStage) || {};
    return {
        globals: {variables: stage.variables || {}, lists: stage.lists || {}},
        broadcasts: stage.broadcasts || {}
    };
};

// A target's text in pieces: the declarations and loose comments, then one
// piece per script, in the order targetToText writes them.
const piecesOf = (target, ctx) => {
    const {text, names} = targetToText(target, ctx);
    const lines = text.split('\n');
    const tops = Object.entries(target.blocks || {})
        .filter(([, b]) => b && typeof b === 'object' && b.topLevel && !b.shadow)
        .sort((a, b) => (a[1].y - b[1].y) || (a[1].x - b[1].x) || a[0].localeCompare(b[0]))
        .map(([id]) => id);
    const head = [];
    const scripts = [];
    for (const line of lines) {
        if (/^@at\(/.test(line)) scripts.push({lines: [line]});
        else if (scripts.length) scripts[scripts.length - 1].lines.push(line);
        else head.push(line);
    }
    scripts.forEach((s, k) => {
        s.top = tops[k];
    });
    return {head, scripts, names};
};

/**
 * Bring back a Flipwarp export.
 * @param {object} source what the export carried (unpackSource)
 * @param {string} code the game's code as it is now
 * @param {function} findAsset (entry, md5ext) -> Promise<?{data: Uint8Array, ext: string, resolution?: number}>
 * @returns {Promise<{project: object, assets: object, notes: Array<string>, title: string}>} project.json and its files
 */
export const restoreExport = async (source, code, findAsset) => {
    const notes = [];
    const project = JSON.parse(JSON.stringify(source.project));
    const py = source.target === 'python';
    const lang = py ? 'py' : source.target === 'gamelab' ? 'gamelab' : 'js';
    const stage = project.targets.find(t => t.isStage);
    const targetNamed = name => (name === null ? stage : project.targets.find(t => !t.isStage && t.name === name));

    // --- what the code is now ---
    let program = null;
    try {
        program = py ? parsePython(code) : parseJs(code);
    } catch (e) {
        notes.push(`The code could not be read (${e.message}), so the project is as it was exported.`);
    }
    let found = [];
    if (program) {
        try {
            found = py ? pyUnits(code) : jsUnits(code, program);
        } catch (e) {
            found = [];
        }
    }

    // The code's name for each sprite: from the addSprite lines, and from the scripts.
    const varToTarget = new Map();
    const specs = program ? specsOf(program, py) : [];
    for (const s of specs) {
        const t = s.stage ? stage : project.targets.find(x => !x.isStage && x.name === s.spec.name);
        if (t) varToTarget.set(s.variable, t);
    }

    // --- sprites' starting positions, sizes, variables ---
    for (const s of specs) {
        const t = varToTarget.get(s.variable);
        if (!t) continue;
        const spec = s.spec;
        const set = (key, field, ok) => {
            if (!(key in spec) || spec[key] === undefined || (ok && !ok(spec[key]))) return;
            t[field] = spec[key];
        };
        const isNum = v => typeof v === 'number' && Number.isFinite(v);
        if (!t.isStage) {
            set('x', 'x', isNum);
            set('y', 'y', isNum);
            set('direction', 'direction', isNum);
            set('size', 'size', isNum);
            set('visible', 'visible', v => typeof v === 'boolean');
            set('rotationStyle', 'rotationStyle', v => typeof v === 'string');
            set('rotation_style', 'rotationStyle', v => typeof v === 'string');
            set('draggable', 'draggable', v => typeof v === 'boolean');
        }
        set('volume', 'volume', isNum);
        if (isNum(spec.costume) && spec.costume >= 0 && spec.costume < (t.costumes || []).length) {
            t.currentCostume = Math.floor(spec.costume);
        }
        const values = (table, given, list) => {
            if (!given || typeof given !== 'object') return;
            for (const [name, value] of Object.entries(given)) {
                if (value === undefined) continue;
                const entry = Object.entries(table).find(([, v]) => v[0] === name);
                if (entry) {
                    if (JSON.stringify(entry[1][1]) !== JSON.stringify(value)) entry[1][1] = value;
                } else if (!list || Array.isArray(value)) {
                    // A variable the code added.
                    let id = `fw-import-${name.replace(/\W+/g, '-')}`;
                    for (let n = 2; table[id]; n++) id = `fw-import-${name.replace(/\W+/g, '-')}-${n}`;
                    table[id] = [name, value];
                }
            }
        };
        t.variables = t.variables || {};
        t.lists = t.lists || {};
        values(t.variables, spec.variables, false);
        values(t.lists, spec.lists, true);
    }

    // --- scripts: which are as they were ---
    const old = source.units || [];
    const pairs = found.length || old.length ? align(old, found) : [];
    for (const [a, b] of pairs) {
        if (a === null || b === null) continue;
        const owner = found[b].owner;
        if (owner && !varToTarget.has(owner)) varToTarget.set(owner, targetNamed(old[a].target));
    }
    // Where a script found in the code belongs.
    const ownerOf = unit => {
        if (unit.kind === 'hat') return varToTarget.get(unit.owner) || null;
        const known = old.find(u => u.fn === unit.fn);
        if (known) return targetNamed(known.target);
        // A new custom block: its name starts with its sprite's name in the code.
        let best = null;
        for (const [v, t] of varToTarget) {
            if (unit.fn.startsWith(`${v}_`) && (!best || v.length > best[0].length)) best = [v, t];
        }
        return best ? best[1] : stage;
    };

    const changes = new Map(); // target -> {replace: Map(top -> unit), remove: Set(top), add: [unit]}
    const changesOf = t => {
        if (!changes.has(t)) changes.set(t, {replace: new Map(), remove: new Set(), add: []});
        return changes.get(t);
    };
    for (const [a, b, same] of pairs) {
        if (same) continue;
        if (a !== null && b !== null) {
            const t = targetNamed(old[a].target);
            const now = ownerOf(found[b]);
            if (t && now === t) {
                changesOf(t).replace.set(old[a].top, found[b]);
                continue;
            }
            if (t) changesOf(t).remove.add(old[a].top);
            if (now) changesOf(now).add.push(found[b]);
            continue;
        }
        if (a !== null) {
            const t = targetNamed(old[a].target);
            if (t) changesOf(t).remove.add(old[a].top);
        } else {
            const now = ownerOf(found[b]);
            if (now) changesOf(now).add.push(found[b]);
            else notes.push(`A script in the code belongs to no sprite Flipwarp knows ("${found[b].owner}"), so it was left out.`);
        }
    }

    // --- edited scripts back into blocks ---
    const st = getStyle();
    for (const [t, change] of changes) {
        const where = t.isStage ? 'the Stage' : `"${t.name}"`;
        const ctx = contextOf(project);
        const {head, scripts, names} = piecesOf(t, ctx);
        const extraDecls = [];
        const findName = (name, kind, global) => names.all()
            .find(r => r.kind === kind && r.name === name && (global === undefined || r.global === global));
        let fresh = 0;
        const declare = (name, kind, global) => {
            const id = `fw-new-${fresh++}`;
            names.add(id, name, kind, global);
            const rec = names.recordFor(id);
            extraDecls.push(declLine(rec, st));
            return rec.ident;
        };
        const procs = new Map(); // fn -> {ident, proccode, argKinds}
        for (const u of old) {
            if (!u.fn || targetNamed(u.target) !== t) continue;
            procs.set(u.fn, {
                ident: procIdentFromProccode(u.proccode, st, names),
                proccode: u.proccode,
                argKinds: (u.proccode.match(/%[snb]/g) || []).map(s => (s === '%b' ? 'boolean' : 'value')),
                params: u.params || []
            });
        }
        // New custom blocks the code added.
        for (const u of [...change.add, ...change.replace.values()]) {
            if (u.kind !== 'proc' || procs.has(u.fn)) continue;
            let node = u.node || null;
            if (!node && py) {
                try {
                    node = parsePython(u.text).body[0];
                } catch (e) {
                    node = null;
                }
            }
            const count = node ? Math.max(0, node.params.length - 2) : 0;
            const proccode = [u.fn, ...Array(count).fill('%s')].join(' ');
            procs.set(u.fn, {ident: procIdentFromProccode(proccode, st, names), proccode,
                argKinds: Array(count).fill('value'), params: [], fresh: true});
        }
        const monitorOf = id => {
            for (const target of [t, stage]) {
                if ((target.variables || {})[id]) return {ident: names.identFor(id), list: false};
                if ((target.lists || {})[id]) return {ident: names.identFor(id), list: true};
            }
            return null;
        };
        const decompiler = makeDecompiler({
            lang,
            variable: (name, {global, list}) => {
                const kind = list ? 'list' : 'variable';
                const rec = (!global && !t.isStage && findName(name, kind, false)) || findName(name, kind, true) ||
                    (!global && findName(name, kind));
                return rec ? rec.ident : declare(name, kind, !!global || t.isStage);
            },
            broadcast: name => {
                const rec = findName(name, 'broadcast');
                return rec ? rec.ident : declare(name, 'broadcast', true);
            },
            proc: fn => procs.get(fn) || null,
            monitor: monitorOf
        });
        const unitNode = unit => {
            if (!py) return unit.node;
            const tree = parsePython(unit.text);
            return tree.body[0];
        };
        // The unit's script as text, or null (with a note) when it cannot be read.
        const textOf = (unit, oldScript) => {
            try {
                const node = unitNode(unit);
                if (unit.kind === 'hat') {
                    if (py) {
                        const deco = node.decorators[0];
                        const args = deco.type === 'CallExpression' ? deco.arguments : [];
                        const fnBody = node.body;
                        return decompiler.hatScript(unit.hat, args, fnBody);
                    }
                    const callExpr = node.expression;
                    const fn = callExpr.arguments[callExpr.arguments.length - 1];
                    const body = fn.body.type === 'BlockStatement' ? fn.body.body : [{type: 'ExpressionStatement',
                        expression: fn.body}];
                    return decompiler.hatScript(unit.hat, callExpr.arguments.slice(0, -1), body);
                }
                // A custom block.
                const codeParams = (py ? node.params.map(p => p.name) : node.params.map(p => (p.type === 'Identifier' ?
                    p.name : p.left.name))).slice(2);
                const proc = procs.get(unit.fn);
                let header;
                let paramTexts;
                const oldHead = oldScript && oldScript.lines.find(l => /^define\b/.test(l.trim()));
                const m = oldHead && /^define\s+(fast\s+)?([\w$]+)\((.*)\)\s+as\s+("(?:[^"\\]|\\.)*")\s*\{?\s*$/.exec(oldHead.trim());
                const warp = bodyOf(node).some(s => s.type === 'ExpressionStatement' &&
                    s.expression.type === 'AssignmentExpression' && s.expression.left.type === 'Identifier' &&
                    s.expression.left.name === 'warp' && s.expression.right.type === 'Literal' && s.expression.right.value === true);
                if (m && splitParams(m[3]).length === codeParams.length) {
                    paramTexts = splitParams(m[3]).map(p => p.split(/\s+as\s+/)[0].trim());
                    header = `define ${warp ? 'fast ' : ''}${m[2]}(${m[3]}) as ${m[4]}`;
                } else {
                    paramTexts = codeParams.map(p => slugParam(p, st));
                    header = `define ${warp ? 'fast ' : ''}${proc.ident}(${paramTexts.join(', ')}) as ${JSON.stringify(proc.proccode)}`;
                }
                return decompiler.procScript(header, codeParams, paramTexts, bodyOf(node));
            } catch (e) {
                if (!(e instanceof DecompileError)) console.warn(e); // eslint-disable-line no-console
                notes.push(`A script in ${where} was changed in a way Flipwarp cannot turn into blocks ` +
                    `(${e.message}), so it is as it was exported.`);
                return null;
            }
        };
        const bodyOf = node => (py ? node.body : node.body.body);

        let lowest = scripts.reduce((y, s) => {
            const at = /^@at\((-?\d+),\s*(-?\d+)\)/.exec(s.lines[0]);
            return at ? Math.max(y, Number(at[2])) : y;
        }, 0);
        const out = [];
        for (const s of scripts) {
            if (change.remove.has(s.top)) continue;
            const unit = change.replace.get(s.top);
            if (!unit) {
                out.push(...s.lines);
                continue;
            }
            const text = textOf(unit, s);
            if (text === null) {
                out.push(...s.lines);
                continue;
            }
            out.push(s.lines[0], text, '');
            // Blocks from extensions (other than the pen) never reach the code, so an
            // edited script comes back without them.
            const lost = [...new Set(s.lines.join('\n').match(/\b(?!pen\.)[a-z][A-Za-z0-9]*\.[A-Za-z]\w*\(/g) || [])]
                .map(x => x.slice(0, -1));
            if (lost.length) {
                notes.push(`A script in ${where} was changed on Code.org, so it comes back from the code, without ` +
                    `the blocks the export could not carry (${lost.slice(0, 3).join(', ')}).`);
            }
        }
        for (const unit of change.add) {
            const text = textOf(unit, null);
            if (text === null) continue;
            lowest += 200;
            out.push(`@at(0, ${lowest})`, text, '');
        }
        // Declarations go first, so the new ones join the others at the top.
        const firstBlank = head.findIndex(l => l.trim() === '');
        const decls = firstBlank >= 0 && head.slice(0, firstBlank).every(l => /^(global\s+)?(variable|list|broadcast)\b/.test(l)) ?
            head.slice(0, firstBlank) : [];
        const rest = decls.length ? head.slice(firstBlank) : head;
        const fullText = [...decls, ...extraDecls, ...(decls.length || extraDecls.length ? [''] : []),
            ...rest, ...out].join('\n');
        try {
            const built = buildTarget(parse(fullText), t, ctx);
            t.blocks = built.blocks;
            t.comments = built.comments;
            for (const c of built.created) {
                const owner = c.global || t.isStage ? stage : t;
                if (c.kind === 'broadcast') {
                    stage.broadcasts = stage.broadcasts || {};
                    stage.broadcasts[c.id] = c.name;
                } else if (c.kind === 'list') {
                    owner.lists = owner.lists || {};
                    owner.lists[c.id] = [c.name, []];
                } else {
                    owner.variables = owner.variables || {};
                    owner.variables[c.id] = [c.name, 0];
                }
            }
        } catch (e) {
            notes.push(`The changes to ${where}'s scripts could not be made into blocks (${e.message}), ` +
                'so its scripts are as they were exported.');
        }
    }

    // --- costumes and sounds ---
    const assets = {};
    const entries = source.assets || {};
    for (const t of project.targets) {
        const where = t.isStage ? 'the Stage' : `"${t.name}"`;
        for (const c of t.costumes || []) {
            const md5ext = c.md5ext || `${c.assetId}.${c.dataFormat}`;
            const got = await findAsset(entries[md5ext] || null, md5ext, 'costume', c);
            if (!got) {
                notes.push(`${where}'s costume "${c.name}" was not found (upload its picture with the code), ` +
                    'so it is an empty box.');
                Object.assign(c, placeholderCostume(assets));
                continue;
            }
            if (got.md5ext && got.md5ext !== md5ext) {
                // A picture that came back as a different file (a PNG of an SVG, a smaller copy).
                const res = got.resolution || 1;
                const oldRes = c.bitmapResolution || 1;
                c.rotationCenterX = (c.rotationCenterX / oldRes) * res;
                c.rotationCenterY = (c.rotationCenterY / oldRes) * res;
                c.bitmapResolution = res;
                c.dataFormat = got.ext;
                c.assetId = got.md5ext.replace(/\.[^.]+$/, '');
                c.md5ext = got.md5ext;
            }
            assets[c.md5ext || md5ext] = got.data;
        }
        for (const s of t.sounds || []) {
            const md5ext = s.md5ext || `${s.assetId}.${s.dataFormat}`;
            const got = await findAsset(entries[md5ext] || null, md5ext, 'sound', s);
            if (!got) {
                notes.push(`${where}'s sound "${s.name}" was not found (upload it with the code), so it is silent.`);
                Object.assign(s, placeholderSound(assets));
                continue;
            }
            if (got.md5ext && got.md5ext !== md5ext) {
                s.dataFormat = got.ext;
                s.assetId = got.md5ext.replace(/\.[^.]+$/, '');
                s.md5ext = got.md5ext;
            }
            assets[s.md5ext || md5ext] = got.data;
        }
    }
    return {project, assets, notes, title: source.title || 'Project'};
};

// "a, b as \"my b\"" -> ['a', 'b as "my b"']
const splitParams = text => {
    const out = [];
    let cur = '';
    let inStr = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            cur += ch;
            if (ch === '\\') cur += text[++i] || '';
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') inStr = true;
        if (ch === ',') {
            out.push(cur.trim());
            cur = '';
            continue;
        }
        cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
};

const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
    '<rect x="1" y="1" width="38" height="38" rx="4" fill="#e9eef2" stroke="#855cd6" stroke-width="2" ' +
    'stroke-dasharray="5 3"/></svg>';
const PLACEHOLDER_SVG_ID = 'f1a0c0de0000000000000000000000a1';
const placeholderCostume = assets => {
    assets[`${PLACEHOLDER_SVG_ID}.svg`] = new TextEncoder().encode(PLACEHOLDER_SVG);
    return {assetId: PLACEHOLDER_SVG_ID, md5ext: `${PLACEHOLDER_SVG_ID}.svg`, dataFormat: 'svg', bitmapResolution: 1,
        rotationCenterX: 20, rotationCenterY: 20};
};
// A tenth of a second of quiet.
const silentWav = () => {
    const rate = 22050;
    const samples = rate / 10;
    const bytes = new Uint8Array(44 + (samples * 2));
    const v = new DataView(bytes.buffer);
    const text = (o, s) => [...s].forEach((c, k) => v.setUint8(o + k, c.charCodeAt(0)));
    text(0, 'RIFF');
    v.setUint32(4, 36 + (samples * 2), true);
    text(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    text(36, 'data');
    v.setUint32(40, samples * 2, true);
    return bytes;
};
const PLACEHOLDER_WAV_ID = 'f1a0c0de0000000000000000000000a2';
const placeholderSound = assets => {
    assets[`${PLACEHOLDER_WAV_ID}.wav`] = silentWav();
    return {assetId: PLACEHOLDER_WAV_ID, md5ext: `${PLACEHOLDER_WAV_ID}.wav`, dataFormat: 'wav', rate: 22050,
        sampleCount: 2205};
};
