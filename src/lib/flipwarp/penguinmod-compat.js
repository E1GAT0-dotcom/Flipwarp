// Compatibility hooks for extensions written against PenguinMod.
//
// The point of this file is that it is ONE file. PenguinMod extensions are
// written for PenguinMod's engine, and where they use something this engine
// lacks, the fix belongs here rather than in a forked copy of the extension:
// a hook added once serves every extension that wants it, and their
// extensions keep updating on their own.
//
// Everything here was found by running the checker over PenguinMod's gallery
// and then confirming, against this engine's own source, that the thing was
// genuinely missing. Most of what their extensions reach for already exists:
// BlockType.BUTTON, LABEL and XML; the events BEFORE_EXECUTE, PROJECT_STOP_ALL,
// EXTENSION_ADDED, STAGE_SIZE_CHANGED and targetWasRemoved; and the global
// `vm`, which the editor sets. Those needed nothing.

import BlockShape from 'scratch-vm/src/extension-support/tw-block-shape';
import ArgumentType from 'scratch-vm/src/extension-support/argument-type';
import BlockType from 'scratch-vm/src/extension-support/block-type';
import ScratchApi from 'scratch-vm/src/extension-support/tw-extension-api-common';
import Target from 'scratch-vm/src/engine/target';
import LazyScratchBlocks from '../tw-lazy-scratch-blocks';

// PenguinMod draws blocks in shapes this engine does not have. The shape is
// decoration — it changes how a block looks, not what it does — so each one
// falls back to the nearest real shape. The extension loads and works; its
// blocks just look ordinary.
const SHAPE_FALLBACKS = {
    LEAF: BlockShape.ROUND,
    ARROW: BlockShape.ROUND,
    PLUS: BlockShape.ROUND,
    TICKET: BlockShape.ROUND,
    SLANTED: BlockShape.ROUND,
    BUMPED: BlockShape.ROUND,
    OCTAGONAL: BlockShape.HEXAGONAL
};

// A notch shape is likewise only how the join between blocks is drawn.
const NOTCH_SHAPES = {
    DEFAULT: 1,
    FLAT: 1,
    ROUND: 1,
    ANGLE: 1
};

// PenguinMod lets a menu declare how it is presented. This engine has one
// kind of menu, so every name maps to it rather than to nothing.
const MENU_TYPES = {
    DEFAULT: 'default',
    NORMAL: 'default',
    LIST: 'default',
    GRID: 'default'
};

let extended = false;

/**
 * Widen the shared extension API objects. Every extension loaded afterwards
 * sees these, because they all read the same objects.
 */
const extendExtensionApi = () => {
    if (extended) return;
    extended = true;

    for (const [name, fallback] of Object.entries(SHAPE_FALLBACKS)) {
        if (BlockShape[name] === undefined) BlockShape[name] = fallback;
    }

    // An empty slot: a block with a gap that takes no value.
    if (ArgumentType.EMPTY === undefined) ArgumentType.EMPTY = 'empty';

    // PenguinMod has an input that picks one of the project's variables from
    // a dropdown. This engine has no such input, so the slot becomes a plain
    // text box. This one is a downgrade rather than a like-for-like: the
    // block still works, but you type the variable's name instead of choosing
    // it, and a typo is only found when the block runs.
    if (ArgumentType.VARIABLE === undefined) ArgumentType.VARIABLE = ArgumentType.STRING;

    // PenguinMod's OUTPUT block type is a reporter that returns a value of a
    // custom type. Their own extensions describe it as "basically just
    // undefined"; here it draws and behaves as an ordinary reporter.
    if (BlockType.OUTPUT === undefined) BlockType.OUTPUT = BlockType.REPORTER;

    // Every extension is handed this same object, so adding to it here means
    // reaching for Scratch.MenuType or Scratch.NotchShape returns something
    // sensible instead of throwing partway through the extension's setup.
    if (ScratchApi) {
        if (!ScratchApi.NotchShape) ScratchApi.NotchShape = NOTCH_SHAPES;
        if (!ScratchApi.MenuType) ScratchApi.MenuType = MENU_TYPES;
        if (!ScratchApi.gui) ScratchApi.gui = GUI_API;
    }
};

// PenguinMod hands extensions a small door into the editor. Every extension
// in their gallery that uses it uses exactly one method, getBlockly, and uses
// it to add a custom input field or a custom block shape to the palette.
//
// This editor already loads Blockly on demand and keeps the one copy the
// workspace itself uses, so this hands back that same copy: a field an
// extension registers is a field the workspace really has.
const GUI_API = {
    getBlockly: () => Promise.resolve()
        .then(() => LazyScratchBlocks.load())
        .then(() => LazyScratchBlocks.get()),

    // Their name for the same thing in older extensions.
    getBlocklyEagerly: () => GUI_API.getBlockly()
};

/**
 * Add the hooks this engine is missing to a VM instance.
 * @param {VirtualMachine} vm the VM to extend
 */
export const installPenguinModCompat = vm => {
    extendExtensionApi();

    const runtime = vm && vm.runtime;
    if (!runtime || runtime.__flipwarpCompatInstalled) return;
    runtime.__flipwarpCompatInstalled = true;

    // PenguinMod fires this at the top of every frame. Extensions use it to
    // do per-frame work without a forever loop. Wrapping _step rather than
    // patching scratch-vm keeps this out of the dependency.
    if (typeof runtime._step === 'function') {
        const originalStep = runtime._step;
        runtime._step = function flipwarpStep (...args) {
            try {
                this.emit('RUNTIME_STEP_START');
            } catch (e) {
                // An extension throwing in its own handler must not stop the
                // project from running.
            }
            return originalStep.apply(this, args);
        };
    }

    // This engine emits PROJECT_STOP_ALL when everything stops. PenguinMod
    // calls the same moment PROJECT_STOP, and extensions listen for either.
    runtime.on('PROJECT_STOP_ALL', () => {
        try {
            runtime.emit('PROJECT_STOP');
        } catch (e) {
            // as above
        }
    });

    // Several extensions reach the extension manager through the runtime
    // rather than through the VM. It is the same object either way; this
    // engine simply never put it there.
    //
    // What it is used for: loading a built-in extension that this one needs,
    // such as Pen+ pulling in the pen extension. That works. Asking for an
    // extension that is not built in — jwArray, which is PenguinMod's — logs
    // a warning and carries on, which is what those extensions already
    // expect: they all test for the thing afterwards.
    if (!runtime.extensionManager && vm.extensionManager) {
        runtime.extensionManager = vm.extensionManager;
    }

    installSerializers(runtime);
    installCompiledBlockStub(runtime);
    installVariableEvents();
};

// PenguinMod lets an extension invent a value type — a vector, a set, an
// iterator — and register how to write one down and read it back, so a
// project can be saved with one sitting in a variable.
//
// This keeps the registrations, which is what the extensions need in order to
// load and run: the types work for as long as the project is open. What it
// does not do is reach into how projects are saved, so a value of one of
// these types is not preserved in a saved file. Saying that plainly is better
// than a hook that looks like it saves and quietly does not.
const installSerializers = runtime => {
    if (typeof runtime.registerSerializer === 'function') return;

    runtime.serializers = runtime.serializers || Object.create(null);
    runtime.registerSerializer = function flipwarpRegisterSerializer (name, serialize, deserialize) {
        runtime.serializers[name] = {serialize, deserialize};
    };
    runtime.getSerializer = name => runtime.serializers[name] || null;
};

// PenguinMod's compiler lets an extension supply its own code generator for
// its blocks. This engine's compiler has no such door, and building one is a
// change to the compiler itself, not a hook.
//
// Accepting and ignoring the registration lets the extension load and lets
// every ordinary block in it work. Blocks that exist only as compiled code —
// usually the ones whose handler is a stub — will not do anything. The names
// are logged so it is clear which extension is affected rather than leaving a
// block that silently does nothing.
const installCompiledBlockStub = runtime => {
    if (typeof runtime.registerCompiledExtensionBlocks === 'function') return;

    runtime.compiledExtensionBlocks = runtime.compiledExtensionBlocks || Object.create(null);
    runtime.registerCompiledExtensionBlocks = function flipwarpRegisterCompiled (id, info) {
        runtime.compiledExtensionBlocks[id] = info;
        // eslint-disable-next-line no-console
        console.warn(
            `Flipwarp: the extension "${id}" wants PenguinMod's compiler for some of its blocks. ` +
            'The extension is loaded; blocks that only exist as compiled code will not run.'
        );
    };
};

// PenguinMod tells extensions when a variable is made, renamed or removed.
// These wrap the target's own methods, so the events fire however the change
// was made — from the palette, from a block, or from a project loading.
//
// Deliberately absent: an event for a variable's VALUE changing. PenguinMod
// has one, but a variable's value changes thousands of times a second in a
// running project, and firing on every write would be its own performance
// problem. Guessing which meaning an extension wants is worse than leaving
// it out and saying so.
let variableEventsInstalled = false;

const installVariableEvents = () => {
    if (variableEventsInstalled || !Target || !Target.prototype) return;
    variableEventsInstalled = true;

    const announce = (target, event, variable) => {
        const runtime = target && target.runtime;
        if (!runtime || !variable) return;
        try {
            runtime.emit(event, {
                id: variable.id,
                name: variable.name,
                type: variable.type,
                target: target.id
            });
        } catch (e) {
            // An extension throwing in its handler must not break the edit
            // that caused it.
        }
    };

    const wrap = (method, event, pick) => {
        const original = Target.prototype[method];
        if (typeof original !== 'function') return;
        Target.prototype[method] = function flipwarpVariableEvent (...args) {
            const before = pick === 'before' ? this.variables[args[0]] : null;
            const result = original.apply(this, args);
            announce(this, event, before || this.variables[args[0]]);
            return result;
        };
    };

    wrap('createVariable', 'variableCreate', 'after');
    wrap('renameVariable', 'variableChange', 'after');
    wrap('deleteVariable', 'variableDelete', 'before');
};

export const PENGUINMOD_SHAPE_FALLBACKS = SHAPE_FALLBACKS;
export const PENGUINMOD_NOTCH_SHAPES = NOTCH_SHAPES;
export const PENGUINMOD_MENU_TYPES = MENU_TYPES;
