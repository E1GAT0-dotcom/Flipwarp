// The editor's end of flipwarp-mcp: how Claude Code reads and writes the
// project open in this tab.
//
// Opened with ?mcp in its address, the editor connects to the flipwarp-mcp
// server on this machine and answers its requests. Everything Claude does goes
// through the same functions the Text button uses, in the same text, so it
// gets the same refusals with the same line numbers and hints, and nothing it
// writes can be something a person could not have typed. Without ?mcp this
// file does nothing at all.
//
// The text is always the js style, whatever the editor is set to. Claude reads
// one spelling well; it should not have to guess which one this tab is in.

import {
    readCurrentTarget, checkText, applyText, snapshotCurrentTarget, restoreBlocks, ParseError
} from './vm-bridge.js';
import {findInProject} from './project-text.js';
import {checkProject, applyFixes} from './health.js';
import {getStyle} from './styles.js';
import {getSettings, setSettings} from './settings.js';
import {BLOCKS, addedOpcodes} from './phrasebook.js';
import {syncExtensionText} from './runtime-extensions.js';
import {spriteUpload} from '../file-uploader.js';
import FLIPWARP_EXTENSIONS, {flipwarpBase} from './flipwarp-extensions.js';
import {PLAY_METHODS, installPlay} from './mcp-play.js';
import {costumeMethods, imageFrom} from './mcp-costumes.js';
import {soundMethods} from './mcp-sounds.js';
import {perfMethods} from './mcp-perf.js';
import {renameMethods} from './mcp-rename.js';
import {
    fingerprintScripts, changedScripts, measureScripts, settleScripts, tidyScripts, showScripts
} from './script-layout.js';
import {installLive, record, describe as describeAction, busy, narrate} from './mcp-live.js';
import {installIdlePause, requestStarted, requestFinished} from './mcp-idle.js';

const STYLE = getStyle('js');
const TEXT_OPTIONS = {style: STYLE, indent: '  '};
const UNDO_LIMIT = 50;

// The address to connect to. ?mcp on its own means the server that served this
// page; ?mcp=8601 means that port on this machine, for a copy of the editor
// served from somewhere else.
const serverAddress = () => {
    let param;
    try {
        param = new URLSearchParams(location.search).get('mcp');
    } catch (e) {
        return null;
    }
    if (param === null) return null;
    if (/^\d+$/.test(param)) return `ws://127.0.0.1:${param}/mcp`;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}/mcp`;
};

// The chat that opened this tab (?chat=...), if one did. The server refuses a
// tab from an earlier chat, so a tab left open does not take over the next
// chat that happens to get the same port.
const chatKey = () => {
    try {
        return new URLSearchParams(location.search).get('chat');
    } catch (e) {
        return null;
    }
};

// --- finding things --------------------------------------------------------

const originals = vm => vm.runtime.targets.filter(t => !t.isSprite || t.isOriginal);

const targetNamed = (vm, name) => {
    if (typeof name !== 'string' || name === '') {
        throw new Error('Say which sprite. Use "Stage" for the stage.');
    }
    const all = originals(vm);
    const found = all.find(t => t.getName() === name) ||
        (String(name).toLowerCase() === 'stage' ? all.find(t => t.isStage) : null);
    if (!found) {
        const names = all.map(t => (t.isStage ? 'Stage' : t.getName())).join(', ');
        throw new Error(`There is no sprite called "${name}". The project has: ${names}.`);
    }
    return found;
};

// Reading and writing work on the sprite open in the editor, the way the Text
// button does, so the sprite is opened first. That also means the person
// watching sees which sprite is being changed.
const open = (vm, name) => {
    const target = targetNamed(vm, name);
    if (vm.editingTarget !== target) vm.setEditingTarget(target.id);
    return target;
};

const describeError = e => {
    if (e instanceof ParseError || (e && typeof e.line === 'number')) {
        return {
            message: e.message,
            parse: {line: e.line, column: e.column, text: e.text, fix: e.fix || null, id: e.id}
        };
    }
    // The stack goes to the server's log, not to Claude: it is for whoever is
    // fixing Flipwarp, not for whoever is making a game.
    return {message: e && e.message ? e.message : String(e), stack: e && e.stack ? String(e.stack) : null};
};

// --- what the project holds -----------------------------------------------

const variablesOf = target => Object.values(target.variables).map(v => ({
    name: v.name,
    type: v.type === 'list' ? 'list' : v.type === 'broadcast_msg' ? 'broadcast' : 'variable',
    value: v.type === 'list' ? `${v.value.length} items` : v.value
}));

const overview = vm => {
    const stage = vm.runtime.getTargetForStage();
    const sprites = originals(vm).filter(t => !t.isStage);
    const blockCount = t => Object.values(t.blocks._blocks).filter(b => !b.shadow).length;
    const scriptCount = t => t.blocks._scripts.filter(id => {
        const b = t.blocks._blocks[id];
        return b && !b.shadow;
    }).length;
    const loaded = [...vm.extensionManager._loadedExtensions.keys()];
    return {
        editing: vm.editingTarget ? (vm.editingTarget.isStage ? 'Stage' : vm.editingTarget.getName()) : null,
        running: vm.runtime.threads.length > 0,
        stage: {
            width: vm.runtime.stageWidth,
            height: vm.runtime.stageHeight,
            backdrops: stage.getCostumes().map(c => c.name),
            currentBackdrop: stage.getCostumes()[stage.currentCostume].name,
            scripts: scriptCount(stage),
            blocks: blockCount(stage),
            globals: variablesOf(stage)
        },
        sprites: sprites.map(t => ({
            name: t.getName(),
            x: Math.round(t.x),
            y: Math.round(t.y),
            size: Math.round(t.size),
            direction: t.direction,
            visible: t.visible,
            layer: t.getLayerOrder ? t.getLayerOrder() : null,
            costumes: t.getCostumes().map(c => c.name),
            currentCostume: t.getCostumes()[t.currentCostume].name,
            sounds: t.getSounds().map(s => s.name),
            scripts: scriptCount(t),
            blocks: blockCount(t),
            locals: variablesOf(t),
            clones: vm.runtime.targets.filter(c => c.isSprite && !c.isOriginal && c.sprite === t.sprite).length
        })),
        extensions: loaded,
        otherExtensionText: getSettings().otherExtensionText,
        otherExtensionBlocks: addedOpcodes().length
    };
};

// --- undo ------------------------------------------------------------------

// One entry per write, oldest first. Kept on this page only: reloading the
// editor is a fresh start, as it is for the editor's own undo.
const undoStack = [];

// --- sprites ---------------------------------------------------------------

const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">' +
    '<circle cx="30" cy="30" r="26" fill="#9966ff" stroke="#774dcb" stroke-width="4"/></svg>';

const createSprite = (vm, {name, x, y, ...source}) => new Promise((resolve, reject) => {
    if (!name) throw new Error('A new sprite needs a name.');
    if (originals(vm).some(t => t.getName() === name)) {
        throw new Error(`There is already a sprite called "${name}".`);
    }
    const drawn = ['svg', 'pixels', 'png', 'jpg'].some(k => source[k]);
    const image = imageFrom(drawn ? source : {svg: PLACEHOLDER_SVG});
    const data = image.bytes.buffer.slice(image.bytes.byteOffset, image.bytes.byteOffset + image.bytes.length);
    spriteUpload(data, image.type, name, vm, sprite => {
        vm.addSprite(sprite).then(() => {
            const made = vm.editingTarget;
            if (made && typeof x === 'number' && typeof y === 'number') made.setXY(x, y);
            resolve({name: made ? made.getName() : name});
        }, reject);
    }, reject);
});

// A script as a person would name it: its custom block, or its hat and the
// message or key it waits for.
const scriptName = (target, id) => {
    const blocks = target.blocks._blocks;
    const top = blocks[id];
    if (!top) return 'a script';
    if (top.opcode === 'procedures_definition') {
        const prototype = top.inputs.custom_block && blocks[top.inputs.custom_block.block];
        const code = prototype && prototype.mutation ? prototype.mutation.proccode : '';
        return code.replace(/\s*%[sbn]/g, '').trim() || 'a custom block';
    }
    const field = Object.values(top.fields || {})[0];
    const what = top.opcode.replace(/^(event_|control_)/, '').replace(/^when/, 'when ');
    return field ? `${what} ${field.value}` : what;
};

// --- extensions ------------------------------------------------------------

// Text that uses pen.penDown() needs the pen extension loaded, or the block
// lands in the project with nothing behind it. A person adds the extension
// from the library first; here it is added for them, but only Scratch's and
// Flipwarp's own. Anything else has to be loaded already to have a text form
// at all, so there is never anything to fetch from somewhere unknown.
const extensionsByPrefix = () => {
    const m = new Map();
    for (const [opcode, def] of Object.entries(BLOCKS)) {
        if (!def.extension) continue;
        const dot = def.name.indexOf('.');
        if (dot > 0) m.set(def.name.slice(0, dot), opcode.slice(0, opcode.indexOf('_')));
    }
    return m;
};

const loadExtensionsFor = async (vm, text) => {
    const bare = text.replace(/"(\\.|[^"\\])*"/g, '""').replace(/#.*$/gm, '');
    const byPrefix = extensionsByPrefix();
    const used = new Set();
    for (const m of bare.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\.[A-Za-z]/g)) {
        if (byPrefix.has(m[1])) used.add(byPrefix.get(m[1]));
    }
    const loaded = [];
    const manager = vm.extensionManager;
    for (const id of used) {
        if (manager.isExtensionLoaded(id)) continue;
        if (manager.isBuiltinExtension(id)) {
            manager.loadExtensionIdSync(id);
            loaded.push(id);
            continue;
        }
        const own = FLIPWARP_EXTENSIONS.find(e => e.id === id);
        if (own) {
            await manager.loadExtensionURL(flipwarpBase() + own.file);
            loaded.push(id);
        }
    }
    return loaded;
};

// --- the requests ----------------------------------------------------------

const METHODS = {
    ...PLAY_METHODS,
    ...costumeMethods(targetNamed),
    ...soundMethods(targetNamed),
    ...perfMethods((target, id) => scriptName(target, id)),
    ...renameMethods(targetNamed),

    overview: vm => overview(vm),

    readSprite: (vm, {sprite}) => {
        open(vm, sprite);
        try {
            const read = readCurrentTarget(vm, false, TEXT_OPTIONS);
            return {sprite: read.isStage ? 'Stage' : read.name, text: read.text, blocks: read.blocks};
        } catch (e) {
            return {sprite, unreadable: describeError(e).message};
        }
    },

    checkText: (vm, {sprite, text}) => {
        open(vm, sprite);
        let positions = [];
        try {
            positions = readCurrentTarget(vm, false, TEXT_OPTIONS).positions;
        } catch (e) {
            // A sprite with no text form can still be written over.
        }
        try {
            const result = checkText(vm, text, positions, STYLE);
            return {ok: true, blocks: result.blocks, unchanged: result.unchanged};
        } catch (e) {
            return {ok: false, error: describeError(e)};
        }
    },

    writeSprite: async (vm, {sprite, text}) => {
        const target = open(vm, sprite);
        let positions = [];
        try {
            positions = readCurrentTarget(vm, false, TEXT_OPTIONS).positions;
        } catch (e) {
            // As above.
        }
        const before = snapshotCurrentTarget(vm);
        // What the scripts were and where they sat, to tell afterwards which
        // scripts changed and which are new (new ones are given a position
        // nothing had).
        const fingerprints = fingerprintScripts(target);
        const oldPositions = new Set(measureScripts(target).map(s => `${s.x},${s.y}`));
        try {
            // Checked before anything is loaded, so a mistake in the text
            // cannot leave an extension added to the project for nothing.
            checkText(vm, text, positions, STYLE);
            const extensionsLoaded = await loadExtensionsFor(vm, text);
            const result = await applyText(vm, text, positions, STYLE);
            result.extensionsLoaded = extensionsLoaded;
            let changedIds = [];
            let summary = '';
            let moved = 0;
            if (result.changed) {
                undoStack.push(before);
                if (undoStack.length > UNDO_LIMIT) undoStack.shift();
                const written = vm.editingTarget;
                const fresh = new Set(measureScripts(written).map(s => `${s.x},${s.y}`)
                    .filter(p => !oldPositions.has(p)));
                moved = settleScripts(vm, written, fresh).moved;
                changedIds = changedScripts(written, fingerprints);
                const names = changedIds.map(id => scriptName(written, id));
                summary = names.length ? names.join(', ') : 'rearranged';
                showScripts(changedIds);
            }
            return {
                ok: true,
                blocks: result.blocks,
                changed: result.changed,
                extensionsLoaded: result.extensionsLoaded,
                undoSteps: undoStack.length,
                changedIds,
                summary,
                moved
            };
        } catch (e) {
            return {ok: false, error: describeError(e)};
        }
    },

    undo: vm => {
        const saved = undoStack.pop();
        if (!saved) return {ok: false, error: {message: 'There is nothing to undo.'}};
        const restored = restoreBlocks(vm, saved.name, saved.blocks, saved.comments);
        return {ok: restored, sprite: saved.name, undoSteps: undoStack.length};
    },

    find: (vm, {query, caseSensitive, wholeWord}) => {
        const {matches, unreadable} = findInProject(vm, query, {caseSensitive, wholeWord});
        return {
            matches: matches.slice(0, 200).map(m => ({sprite: m.sprite, line: m.line, text: m.text})),
            more: Math.max(0, matches.length - 200),
            unreadable
        };
    },

    health: vm => ({findings: checkProject(vm)}),

    fixHealth: (vm, {ids}) => {
        const all = checkProject(vm);
        const chosen = all.filter(f => ids.includes(f.id) && f.fix);
        return applyFixes(vm, chosen);
    },

    createSprite: (vm, params) => createSprite(vm, params),

    deleteSprite: (vm, {sprite}) => {
        const target = targetNamed(vm, sprite);
        if (target.isStage) throw new Error('The stage cannot be deleted.');
        vm.deleteSprite(target.id);
        return {deleted: sprite};
    },

    renameSprite: (vm, {sprite, name}) => {
        const target = targetNamed(vm, sprite);
        if (target.isStage) throw new Error('The stage cannot be renamed.');
        vm.renameSprite(target.id, name);
        return {name: target.getName()};
    },

    // For setting up a test: put the player next to the enemy, give it one
    // life left. A sprite's own variable, or else a global one.
    setVariable: (vm, {sprite, name, value}) => {
        const target = sprite ? targetNamed(vm, sprite) : vm.runtime.getTargetForStage();
        const stage = vm.runtime.getTargetForStage();
        const find = t => Object.values(t.variables).find(v => v.name === name && v.type !== 'broadcast_msg');
        const variable = find(target) || find(stage);
        if (!variable) throw new Error(`There is no variable or list called "${name}" for ${sprite || 'the Stage'}.`);
        if (variable.type === 'list') {
            if (!Array.isArray(value)) throw new Error(`"${name}" is a list, so give a list of values.`);
            variable.value = value.map(String);
        } else {
            variable.value = value;
        }
        const owner = find(target) && !target.isStage ? target.getName() : 'Stage';
        return {name, value: variable.value, owner};
    },

    // Every script laid out again: events down the left, custom blocks down
    // the right. For a sprite whose scripts have piled up.
    tidyScripts: (vm, {sprite}) => {
        const target = open(vm, sprite);
        const scripts = tidyScripts(vm, target);
        showScripts(scripts.slice(0, 1).map(s => s.id), 1200);
        return {scripts};
    },

    // What Claude says it is doing, shown at the top of the activity strip.
    narrate: (vm, {text}) => {
        narrate(text);
        return {shown: true};
    },

    selectSprite: (vm, {sprite}) => {
        const target = open(vm, sprite);
        return {editing: target.isStage ? 'Stage' : target.getName()};
    },

    blockList: () => Object.entries(BLOCKS)
        .filter(([, def]) => !def.hidden)
        .map(([opcode, def]) => ({
            opcode,
            name: def.name,
            kind: def.kind,
            infix: def.infix || null,
            args: (def.args || []).filter(a => !(def.substack || []).includes(a)),
            fields: def.fields || [],
            body: !!(def.substack && def.substack.length),
            fromOtherExtension: !!def.runtime
        })),

    setExtensionText: (vm, {enabled}) => {
        setSettings({otherExtensionText: !!enabled});
        const added = syncExtensionText(vm);
        return {otherExtensionText: !!enabled, blocks: added.length};
    },

    saveProject: async vm => {
        const blob = await vm.saveProjectSb3();
        const buffer = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let i = 0; i < buffer.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, buffer.subarray(i, i + 0x8000));
        }
        return {base64: btoa(binary), bytes: buffer.length};
    },

    loadProject: async (vm, {base64}) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        undoStack.length = 0;
        await vm.loadProject(bytes.buffer);
        return overview(vm);
    }
};

// --- the connection --------------------------------------------------------

const status = text => {
    // eslint-disable-next-line no-console
    console.log(`[flipwarp-mcp] ${text}`);
};

export const installMcpBridge = vm => {
    const address = serverAddress();
    if (!address || typeof WebSocket === 'undefined') return;
    installPlay(vm);
    installLive({
        onUndo: () => {
            const result = METHODS.undo(vm);
            const line = describeAction('undo', {}, result, !result.ok);
            if (line) record(line);
        },
        onJump: (sprite, ids) => {
            try {
                open(vm, sprite);
                showScripts(ids.length ? ids : []);
            } catch (e) {
                // The sprite has gone since: nothing to show.
            }
        }
    });

    installIdlePause(vm);

    // Whether the project has changed since it was loaded or Claude last
    // saved it, so a tab whose chat has ended is only closed when nothing
    // would be lost.
    let unsaved = false;
    vm.on('PROJECT_CHANGED', () => {
        unsaved = true;
    });
    vm.runtime.on('PROJECT_LOADED', () => {
        unsaved = false;
    });

    // A tab a chat opened (it has a chat key) closes itself once that chat
    // has ended: when the next chat's server refuses it, or when no server
    // has answered for ENDED_AFTER_MS. A tab opened by hand is never closed.
    const key = chatKey();
    const ENDED_AFTER_MS = 60000;
    let ended = false;
    let lostAt = 0;
    const chatEnded = () => {
        if (ended) return;
        ended = true;
        status('the chat that opened this tab has ended');
        if (unsaved) {
            narrate('The Claude chat that opened this tab has ended. This project has changes that were not ' +
                'saved: save it (File > Save to your computer), then close this tab.');
            return;
        }
        narrate('The Claude chat that opened this tab has ended, and its project is saved, so this tab is closing.');
        setTimeout(() => {
            window.close();
            // Still here: the browser would not let a page close its own tab.
            setTimeout(() => narrate('The Claude chat that opened this tab has ended. You can close it.'), 1000);
        }, 5000);
    };

    let delay = 1000;
    const connect = () => {
        let socket;
        try {
            socket = new WebSocket(address);
        } catch (e) {
            setTimeout(connect, delay);
            return;
        }
        socket.onopen = () => {
            delay = 1000;
            lostAt = 0;
            status(`connected to ${address}`);
            socket.send(JSON.stringify({hello: 'flipwarp', version: 1, chat: key}));
        };
        socket.onmessage = async event => {
            let request;
            try {
                request = JSON.parse(event.data);
            } catch (e) {
                return;
            }
            if (request.refused) {
                chatEnded();
                return;
            }
            const {id, method, params} = request;
            const fn = METHODS[method];
            let reply;
            busy();
            requestStarted();
            try {
                if (!fn) throw new Error(`Unknown request "${method}".`);
                reply = {id, result: await fn(vm, params || {})};
                if (method === 'saveProject' || method === 'loadProject') unsaved = false;
            } catch (e) {
                reply = {id, error: describeError(e)};
            } finally {
                requestFinished();
            }
            socket.send(JSON.stringify(reply));
            // The strip says what just happened. A failure to say it must
            // never become a failure of the request, which is already sent.
            try {
                const line = describeAction(method, params || {}, reply.result || {}, !!reply.error);
                if (line) record(line);
            } catch (e) {
                // Nothing to show, then.
            }
        };
        socket.onclose = () => {
            if (ended) return;
            if (key) {
                if (!lostAt) lostAt = Date.now();
                if (Date.now() - lostAt > ENDED_AFTER_MS) {
                    chatEnded();
                    return;
                }
            }
            status(`not connected, trying again in ${delay / 1000}s`);
            setTimeout(connect, delay);
            delay = Math.min(delay * 2, 10000);
        };
    };
    // Only once the page has loaded and the editor has loaded its first
    // project. Connecting sooner let Claude open a project of its own while
    // the editor was still loading the default one, which then finished
    // last and replaced it: Claude went on working on sprites that were gone.
    let started = false;
    let firstProject = false;
    const startWhenReady = () => {
        if (started || !firstProject || document.readyState !== 'complete') return;
        started = true;
        connect();
    };
    vm.runtime.once('PROJECT_LOADED', () => {
        firstProject = true;
        startWhenReady();
    });
    // A project that never finishes loading must not keep Claude out for good.
    setTimeout(() => {
        firstProject = true;
        startWhenReady();
    }, 20000);
    if (document.readyState === 'complete') startWhenReady();
    else window.addEventListener('load', startWhenReady);
};
