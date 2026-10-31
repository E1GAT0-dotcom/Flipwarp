// The Scratch-way checks on real saved projects, without an editor:
//
//   node test/flipwarp/scratch-way-files.mjs game.sb3 [more.sb3 ...]
//
// Reads each project.json into the shape the health check reads (the VM's,
// not the file's), runs it, and prints the Scratch-way findings. For seeing
// that games people made pass and games built the other way are pointed at.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {checkProject} from '../../src/lib/flipwarp/health.js';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

const KINDS = new Set(['pen-ui', 'pen-every-frame', 'one-big-sprite', 'giant-block', 'fast-waits', 'short-names',
    'many-costumes', 'huge-list']);

// The file keeps small values inside the block that holds them; the VM keeps
// every one as a little block of its own. Only what the checks read is made.
const PRIMITIVE = {4: 'math_number', 5: 'math_positive_number', 6: 'math_whole_number', 7: 'math_integer',
    8: 'math_angle', 9: 'colour_picker', 10: 'text', 11: 'event_broadcast_menu', 12: 'data_variable',
    13: 'data_listcontents'};

const toVmBlocks = fileBlocks => {
    const blocks = {};
    let made = 0;
    const primitive = (array, parent) => {
        const id = `p${made++}`;
        const [kind, value, ref] = array;
        const opcode = PRIMITIVE[kind] || 'text';
        const fields = kind === 11 ? {BROADCAST_OPTION: {name: 'BROADCAST_OPTION', value, id: ref}} :
            kind === 12 ? {VARIABLE: {name: 'VARIABLE', value, id: ref}} :
                kind === 13 ? {LIST: {name: 'LIST', value, id: ref}} : {TEXT: {name: 'TEXT', value}};
        blocks[id] = {id, opcode, parent, next: null, inputs: {}, fields, shadow: kind !== 12 && kind !== 13,
            topLevel: !parent};
        return id;
    };
    for (const [id, b] of Object.entries(fileBlocks || {})) {
        if (Array.isArray(b)) {
            const pid = primitive(b, null);
            blocks[id] = {...blocks[pid], id};
            delete blocks[pid];
            continue;
        }
        const inputs = {};
        for (const [name, input] of Object.entries(b.inputs || {})) {
            const [, first, second] = input;
            const ref = v => (Array.isArray(v) ? primitive(v, id) : v);
            const blockId = ref(first);
            const shadowId = input[0] === 3 ? ref(second) : (input[0] === 1 ? blockId : null);
            inputs[name] = {name, block: blockId, shadow: shadowId};
        }
        const fields = {};
        for (const [name, field] of Object.entries(b.fields || {})) {
            fields[name] = {name, value: field[0], id: field[1]};
        }
        blocks[id] = {id, opcode: b.opcode, next: b.next, parent: b.parent, inputs, fields, shadow: !!b.shadow,
            topLevel: !!b.topLevel, x: b.x, y: b.y, mutation: b.mutation};
    }
    return blocks;
};

const fakeVm = project => {
    const targets = project.targets.map(t => {
        const variables = {};
        for (const [id, v] of Object.entries(t.variables || {})) {
            variables[id] = {id, name: v[0], type: '', value: v[1], isCloud: !!v[2]};
        }
        for (const [id, v] of Object.entries(t.lists || {})) variables[id] = {id, name: v[0], type: 'list', value: v[1]};
        for (const [id, name] of Object.entries(t.broadcasts || {})) {
            variables[id] = {id, name, type: 'broadcast_msg', value: name};
        }
        const costumes = (t.costumes || []).map(c => ({name: c.name}));
        return {
            id: t.name, isStage: t.isStage, isOriginal: true, isSprite: !t.isStage,
            getName: () => t.name, blocks: {_blocks: toVmBlocks(t.blocks)}, variables,
            getCostumes: () => costumes, getSounds: () => (t.sounds || []).map(s => ({name: s.name})),
            currentCostume: t.currentCostume || 0
        };
    });
    // Knows every block, so the checks about missing extensions stay quiet.
    return {runtime: {targets, _primitives: new Proxy({}, {get: () => () => null})}};
};

const files = process.argv.slice(2);
if (!files.length) {
    console.log('Give .sb3 files to check.');
    process.exit(0);
}
for (const file of files) {
    const zip = await JSZip.loadAsync(fs.readFileSync(file));
    const project = JSON.parse(await zip.file('project.json').async('string'));
    const findings = checkProject(fakeVm(project)).filter(f => KINDS.has(f.kind));
    console.log(`\n${path.basename(file)}: ${findings.length ? findings.length : 'no'} Scratch-way finding(s)`);
    for (const f of findings) console.log(`  [${f.grade}] ${f.kind}: ${f.title}${process.env.DETAIL ? `
      ${f.detail}` : ""}`);
}
