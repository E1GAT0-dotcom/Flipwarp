/* eslint-disable no-console */
// Reads every built-in extension's own block definitions and writes a
// phrasebook for them. Generated rather than hand-written, because there are
// hundreds of extension blocks and hand-copying them is how mistakes get in.

const fs = require('fs');
const path = require('path');

const EXTENSIONS = {
    pen: 'scratch3_pen',
    music: 'scratch3_music',
    text2speech: 'scratch3_text2speech',
    translate: 'scratch3_translate',
    videoSensing: 'scratch3_video_sensing',
    makeymakey: 'scratch3_makeymakey',
    microbit: 'scratch3_microbit',
    ev3: 'scratch3_ev3',
    boost: 'scratch3_boost',
    wedo2: 'scratch3_wedo2',
    gdxfor: 'scratch3_gdx_for'
};

// Enough of a runtime for an extension to describe itself.
const stubRuntime = () => {
    const noop = () => {};
    return {
        on: noop,
        off: noop,
        once: noop,
        emit: noop,
        formatMessage: m => m.default,
        getTargetForStage: () => null,
        requestRedraw: noop,
        registerPeripheralExtension: noop,
        emitMicrophoneSamples: noop,
        renderer: null,
        ioDevices: {
            clock: {projectTimer: () => 0},
            userData: {getUsername: () => ''},
            video: {getFrame: () => null, setPreviewGhost: noop, enableVideo: noop, disableVideo: noop, mirror: true},
            keyboard: {}
        },
        attachRuntime: noop,
        peripheralExtensions: {},
        _events: {},
        HACK_VideoProvider: null
    };
};

const ARG_SHADOW = {
    number: 'math_number',
    angle: 'math_angle',
    color: 'colour_picker',
    string: 'text',
    Boolean: null,
    matrix: 'matrix',
    note: 'note'
};

// What an extension is called in the text. Usually its own id, but Flipwarp's
// own ids all start with "flipwarp" so they can never collide with anyone
// else's in a project file — which is right there and unbearable in a line of
// text you have to read. The id in the project is untouched; only the spelling
// changes.
const TEXT_PREFIX = {
    flipwarpSaveSlots: 'saveSlots',
    flipwarpRecordReplay: 'replay',
    flipwarpDialogue: 'dialogue'
};

const camel = label => {
    const words = String(label)
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[^A-Za-z0-9 ]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!words.length) return null;
    return words
        .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)))
        .join('');
};

// Some extensions start timers or video loops the moment they are built.
// This only needs their block list, so nothing is allowed to keep running.
const timers = [];
const realSetInterval = global.setInterval;
const realSetTimeout = global.setTimeout;
global.setInterval = (...a) => {
    const t = realSetInterval(...a); timers.push(t); return t;
};
global.setTimeout = (...a) => {
    const t = realSetTimeout(...a); timers.push(t); return t;
};

const results = {};
const taken = new Set();
const shadows = {};
const menus = {};
const failures = [];

// Flipwarp's own extensions are not built into the virtual machine — they are
// ordinary extension files served from this site, the same shape as anyone
// else's. They are read here for the same reason: so that their blocks have a
// text form, which is the one thing that makes them worth writing rather than
// pointing people at somebody else's.
const readOurOwn = () => {
    const folder = path.join(__dirname, '..', 'static', 'flipwarp-extensions');
    if (!fs.existsSync(folder)) return [];
    const found = [];
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.js'))
        .sort()) {
        // An extension file expects a Scratch object to register itself with,
        // and a browser to run in. It gets neither here — just enough of both
        // to describe its own blocks and stop.
        let registered = null;
        const Scratch = {
            BlockType: {
                COMMAND: 'command',
                REPORTER: 'reporter',
                BOOLEAN: 'Boolean',
                HAT: 'hat',
                LOOP: 'loop',
                CONDITIONAL: 'conditional',
                BUTTON: 'button',
                LABEL: 'label'
            },
            ArgumentType: {
                STRING: 'string',
                NUMBER: 'number',
                BOOLEAN: 'Boolean',
                ANGLE: 'angle',
                COLOR: 'color',
                MATRIX: 'matrix',
                NOTE: 'note',
                COSTUME: 'costume',
                SOUND: 'sound',
                IMAGE: 'image'
            },
            Cast: {toString: String, toNumber: Number, toBoolean: Boolean},
            vm: {runtime: stubRuntime(), postIOData: () => {}},
            extensions: {register: instance => {
                registered = instance;
            }}
        };
        const source = fs.readFileSync(path.join(folder, file), 'utf8');
        try {
            // eslint-disable-next-line no-new-func
            new Function('Scratch', 'document', 'localStorage', 'requestAnimationFrame', 'Blob',
                source)(
                Scratch,
                {addEventListener: () => {},
                    querySelector: () => null,
                    createElement: () => ({getContext: () => null})},
                {getItem: () => null,
                    setItem: () => {},
                    removeItem: () => {},
                    key: () => null,
                    length: 0},
                () => 0,
                // Only ever asked its size, and only in the parts of an
                // extension that do not run while it is describing itself.
                class {
                    get size () {
                        return 0;
                    }
                }
            );
        } catch (e) {
            failures.push(`${file}: ${e.message}`);
            continue;
        }
        if (!registered) {
            failures.push(`${file}: registered nothing`);
            continue;
        }
        found.push(registered.getInfo());
    }
    return found;
};

const everything = [
    ...Object.entries(EXTENSIONS).map(([id, dir]) => ({id, dir})),
    ...readOurOwn().map(info => ({id: info.id, info}))
];

for (const entry of everything) {
    const id = entry.id;
    let info = entry.info;
    if (!info) {
        try {
            // eslint-disable-next-line global-require
            const Klass = require(path.join('scratch-vm/src/extensions', entry.dir, 'index.js'));
            const instance = new Klass(stubRuntime());
            info = instance.getInfo();
        } catch (e) {
            failures.push(`${id}: ${e.message}`);
            continue;
        }
    }

    const extId = info.id || id;

    for (const block of info.blocks || []) {
        if (typeof block === 'string') continue; // separators
        if (!block.opcode) continue;
        if (block.blockType === 'label' || block.blockType === 'button') continue;

        const opcode = `${extId}_${block.opcode}`;
        const args = Object.keys(block.arguments || {});

        // The block's own text names the slots in order, e.g. "set pen [COLOR]".
        const order = [];
        const re = /\[([A-Z0-9_]+)\]/g;
        let m;
        const text = typeof block.text === 'string' ? block.text : String(block.text || '');
        while ((m = re.exec(text))) if (args.includes(m[1])) order.push(m[1]);
        for (const a of args) if (!order.includes(a)) order.push(a);

        const kind =
            block.blockType === 'reporter' ? 'reporter' :
                block.blockType === 'Boolean' ? 'boolean' :
                    block.blockType === 'hat' ? 'hat' :
                        block.blockType === 'conditional' || block.blockType === 'loop' ? 'c' :
                            'statement';

        const fields = [];
        const shadowMap = {};
        for (const argName of order) {
            const arg = block.arguments[argName];
            if (arg && arg.menu) {
                // An extension menu with accepts-reporters off is a plain
                // dropdown field; with it on, it is an input holding a menu.
                const menuDef = (info.menus || {})[arg.menu];
                const acceptsReporters = menuDef && typeof menuDef === 'object' && menuDef.acceptReporters;
                if (acceptsReporters) {
                    menus[opcode] = menus[opcode] || {};
                    menus[opcode][argName] = `${extId}_menu_${arg.menu}`;
                } else {
                    fields.push(argName);
                }
                continue;
            }
            shadowMap[argName] = ARG_SHADOW[arg && arg.type] === undefined ? 'text' : ARG_SHADOW[arg.type];
        }
        if (Object.keys(shadowMap).length) shadows[opcode] = shadowMap;

        // Two blocks can read the same ("set pen color to" exists twice, once
        // for a colour and once for a hue number). A name has to be unique or
        // the round trip cannot come back, so a clash falls back to the
        // block's own opcode, which is unique by definition.
        const spoken = TEXT_PREFIX[extId] || extId;
        let name = `${spoken}.${camel(text) || camel(block.opcode) || block.opcode}`;
        if (taken.has(name)) name = `${spoken}.${camel(block.opcode) || block.opcode}`;
        let n = 2;
        while (taken.has(name)) name = `${spoken}.${camel(block.opcode)}${n++}`;
        taken.add(name);

        results[opcode] = {opcode, name, kind, args: order, fields};
    }
}

for (const t of timers) {
    clearInterval(t); clearTimeout(t);
}
global.setInterval = realSetInterval;
global.setTimeout = realSetTimeout;

const lines = [];
lines.push('// Generated by scripts/flipwarp-extract-extensions.js from the extensions\'');
lines.push('// own block definitions. Do not edit by hand — re-run the script.');
lines.push('//');
lines.push('// Extension block names are written with their extension in front, so');
lines.push('// pen.penDown() can never collide with a core block or another');
lines.push('// extension\'s block of the same name.');
lines.push('');
lines.push('export const EXTENSION_BLOCKS = {');
for (const def of Object.values(results)) {
    const parts = [
        `kind: '${def.kind}'`,
        `name: '${def.name}'`,
        `args: ${JSON.stringify(def.args)}`
    ];
    if (def.fields.length) parts.push(`fields: ${JSON.stringify(def.fields)}`);
    if (menus[def.opcode]) parts.push(`menu: ${JSON.stringify(menus[def.opcode])}`);
    parts.push('extension: true');
    lines.push(`    ${def.opcode}: { ${parts.join(', ')} },`);
}
lines.push('};');
lines.push('');
lines.push(`export const EXTENSION_INPUT_SHADOWS = ${JSON.stringify(shadows, null, 4)};`);
lines.push('');

const out = path.join(__dirname, '..', 'src', 'lib', 'flipwarp', 'extension-blocks.js');
fs.writeFileSync(out, lines.join('\n'));

console.log(`extensions read: ${Object.keys(EXTENSIONS).length - failures.length}/${Object.keys(EXTENSIONS).length}`);
console.log(`extension blocks with a text form: ${Object.keys(results).length}`);
if (failures.length) console.log(`could not read: ${failures.join(' | ')}`);
