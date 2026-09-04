// Reading and changing the whole project as text.
//
// The Text button works on one sprite. These are the jobs that only make
// sense across all of them at once: finding where something is used, and
// renaming it everywhere. Both are trivial in text and close to impossible
// by hand in blocks, which is the point.
//
// Nothing here changes a project until applyReplacements is called, and that
// builds every affected sprite before touching any of them — so a rename that
// would break one sprite changes none of them, rather than half.

import {targetToText} from './to-text.js';
import {parse} from './parse.js';
import {buildTarget} from './build.js';
import {canonTarget} from './canon.js';
import {replaceTargetBlocks} from './sb3-to-runtime.js';
import {textOptions} from './settings.js';

const AT_LINE = /^@at\((-?\d+),\s*(-?\d+)\)$/;

const describe = e => (e && e.message ? e.message : String(e));

const projectOf = vm => JSON.parse(vm.toJSON());

const contextOf = project => {
    const stage = project.targets.find(t => t.isStage) || {};
    return {
        globals: {variables: stage.variables || {}, lists: stage.lists || {}},
        broadcasts: stage.broadcasts || {}
    };
};

/**
 * Every sprite and the stage, as text.
 * @param {VirtualMachine} vm the running VM
 * @returns {Array} one entry per target
 */
export const readAllTargets = vm => {
    const project = projectOf(vm);
    const context = contextOf(project);
    const out = [];
    for (const target of project.targets) {
        let full;
        try {
            full = targetToText(target, context, textOptions()).text;
        } catch (e) {
            // A sprite using an extension block has no text form. It is
            // listed as unreadable rather than silently skipped, so a search
            // that finds nothing there says why.
            out.push({name: target.name, isStage: !!target.isStage, unreadable: describe(e)});
            continue;
        }
        const lines = full.split('\n');
        out.push({
            name: target.name,
            isStage: !!target.isStage,
            full,
            // Line numbers people see must match the text they would see in
            // the panel, which does not show the @at markers.
            visible: lines.filter(line => !AT_LINE.test(line.trim()))
        });
    }
    return out;
};

// "variable speed;", "global list history as \"my history\";" — the line that
// names a variable rather than one that merely uses it.
//
// The terminator is optional because a style that ends statements with the end
// of the line has none to write. Nothing else can match this shape, so
// accepting both spellings costs no precision.
const DECLARATION =
    /^\s*(global\s+)?(variable|list|broadcast)\s+([A-Za-z_$][\w$]*)\s*(?:as\s+"((?:[^"\\]|\\.)*)")?\s*;?\s*$/;

const declarationOf = line => {
    const m = DECLARATION.exec(line);
    if (!m) return null;
    return {
        global: !!m[1],
        kind: m[2],
        // The real Scratch name, which is the quoted one when there is one.
        name: typeof m[4] === 'string' ? m[4].replace(/\\(.)/g, '$1') : m[3]
    };
};

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matcher = (query, {caseSensitive = false, wholeWord = false} = {}) => {
    if (!query) return null;
    const body = wholeWord ? `(?<![A-Za-z0-9_])${escapeRegExp(query)}(?![A-Za-z0-9_])` : escapeRegExp(query);
    try {
        return new RegExp(body, caseSensitive ? 'g' : 'gi');
    } catch (e) {
        // Older browsers reject lookbehind. Whole-word then falls back to a
        // plain search rather than the feature disappearing.
        return new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
    }
};

/**
 * Every line in the project containing the query.
 * @param {VirtualMachine} vm the running VM
 * @param {string} query what to look for
 * @param {object} options caseSensitive, wholeWord
 * @returns {{matches: Array, unreadable: Array}} what was found
 */
export const findInProject = (vm, query, options = {}) => {
    const re = matcher(query, options);
    const matches = [];
    const unreadable = [];
    if (!re) return {matches, unreadable};

    for (const target of readAllTargets(vm)) {
        if (target.unreadable) {
            unreadable.push({name: target.name, why: target.unreadable});
            continue;
        }
        target.visible.forEach((line, index) => {
            re.lastIndex = 0;
            if (!re.test(line)) return;
            matches.push({
                sprite: target.name,
                isStage: target.isStage,
                line: index + 1,
                text: line.trim()
            });
        });
    }
    return {matches, unreadable};
};

/**
 * What a replacement would do, without doing any of it.
 * @param {VirtualMachine} vm the running VM
 * @param {string} query what to look for
 * @param {string} replacement what to put instead
 * @param {object} options caseSensitive, wholeWord
 * @returns {{matches: Array, unreadable: Array}} each match with its new line
 */
export const planReplace = (vm, query, replacement, options = {}) => {
    const re = matcher(query, options);
    const matches = [];
    const unreadable = [];
    if (!re) return {matches, unreadable};

    for (const target of readAllTargets(vm)) {
        if (target.unreadable) {
            unreadable.push({name: target.name, why: target.unreadable});
            continue;
        }
        target.visible.forEach((line, index) => {
            re.lastIndex = 0;
            if (!re.test(line)) return;
            re.lastIndex = 0;
            matches.push({
                sprite: target.name,
                isStage: target.isStage,
                line: index + 1,
                text: line.trim(),
                after: line.replace(re, replacement).trim(),
                id: `${target.name}:${index + 1}`
            });
        });
    }
    return {matches, unreadable};
};

/**
 * Carry out chosen replacements.
 *
 * Every affected sprite is rebuilt first. If any of them fails to build, none
 * of them are changed — a rename either lands everywhere or nowhere, never
 * across half a project.
 *
 * @param {VirtualMachine} vm the running VM
 * @param {string} query what to look for
 * @param {string} replacement what to put instead
 * @param {Array<string>} chosen ids of the matches to carry out
 * @param {object} options caseSensitive, wholeWord
 * @returns {{sprites: number, lines: number, renamed: number}} what changed
 */
export const applyReplacements = (vm, query, replacement, chosen, options = {}) => {
    const re = matcher(query, options);
    if (!re) return {sprites: 0, lines: 0, renamed: 0};
    const wanted = new Set(chosen);

    // A declaration line is not text to swap — it is the name of a real
    // variable. Rewriting it as text would leave the old variable sitting
    // there with its value and point every block at a brand new one, which is
    // not a rename, it is a quiet duplication. So those go through the same
    // rename the editor itself uses, first, and every reference follows.
    const renamed = renameDeclarations(vm, re, replacement, wanted);

    // Whatever the renames did not cover, done as text. Lines the rename
    // already fixed no longer match, so they are simply passed over.
    const project = projectOf(vm);
    const context = contextOf(project);
    const rebuilds = [];
    let lines = 0;

    for (const target of project.targets) {
        const full = targetToText(target, context, textOptions()).text;
        const sourceLines = full.split('\n');
        let visibleIndex = 0;
        let touched = false;
        const edited = [];

        for (const line of sourceLines) {
            if (AT_LINE.test(line.trim())) {
                edited.push(line);
                continue;
            }
            visibleIndex++;
            if (!wanted.has(`${target.name}:${visibleIndex}`) || declarationOf(line)) {
                edited.push(line);
                continue;
            }
            re.lastIndex = 0;
            const next = line.replace(re, replacement);
            if (next !== line) {
                touched = true;
                lines++;
            }
            edited.push(next);
        }

        if (!touched) continue;

        // Throws here if the replacement made the text invalid, before
        // anything at all has been applied.
        const style = textOptions().style;
        const rebuilt = buildTarget(parse(edited.join('\n'), style), target, context, style);
        const changed = JSON.stringify(canonTarget(target.blocks, target.comments)) !==
            JSON.stringify(canonTarget(rebuilt.blocks, rebuilt.comments));
        if (changed) rebuilds.push({name: target.name, rebuilt});
    }

    if (rebuilds.length) {
        vm.stopAll();
        for (const {name, rebuilt} of rebuilds) {
            const live = vm.runtime.targets.find(t => t.getName() === name && (!t.isSprite || t.isOriginal));
            if (live) replaceTargetBlocks(live, rebuilt.blocks, rebuilt.comments);
        }
    }
    if (rebuilds.length || renamed) {
        vm.emitWorkspaceUpdate();
        vm.runtime.emitProjectChanged();
    }

    return {sprites: rebuilds.length, lines, renamed};
};

// Rename the variables and lists whose declaration lines were chosen, the way
// the editor renames them: the variable itself, then every block that names
// it, across every sprite for a global one.
const renameDeclarations = (vm, re, replacement, wanted) => {
    const project = projectOf(vm);
    const context = contextOf(project);
    const jobs = [];

    for (const target of project.targets) {
        const lines = targetToText(target, context, textOptions()).text.split('\n');
        let visibleIndex = 0;
        for (const line of lines) {
            if (AT_LINE.test(line.trim())) continue;
            visibleIndex++;
            if (!wanted.has(`${target.name}:${visibleIndex}`)) continue;
            const declaration = declarationOf(line);
            if (!declaration) continue;
            re.lastIndex = 0;
            const after = declarationOf(line.replace(re, replacement));
            if (!after || after.name === declaration.name) continue;
            jobs.push({target: target.name, kind: declaration.kind, from: declaration.name, to: after.name});
        }
    }

    if (!jobs.length) return 0;

    const stage = vm.runtime.getTargetForStage();
    let done = 0;
    const seen = new Set();

    for (const job of jobs) {
        if (job.kind === 'broadcast') continue;
        const owner = vm.runtime.targets.find(t =>
            t.getName() === job.target && (!t.isSprite || t.isOriginal));
        if (!owner) continue;

        // A sprite's text lists the globals it can see, so the same rename can
        // be asked for by several sprites at once. Each variable is renamed
        // once.
        const type = job.kind === 'list' ? 'list' : '';
        const lookup = holder => (holder ? Object.entries(holder.variables)
            .find(([, v]) => v.name === job.from && v.type === type) : null);

        // A variable on the stage is a global one even when it is the stage's
        // own text that names it — which is exactly where a rename is most
        // likely to be typed, and where treating it as local would rename it
        // on the stage and leave every sprite still saying the old name.
        const onStage = lookup(stage);
        const local = owner.isStage ? null : lookup(owner);
        const found = local || onStage;
        if (!found) continue;
        const id = found[0];
        if (seen.has(id)) continue;
        seen.add(id);

        if (local) {
            owner.renameVariable(id, job.to);
            owner.blocks.updateBlocksAfterVarRename(id, job.to);
        } else {
            stage.renameVariable(id, job.to);
            for (const t of vm.runtime.targets) t.blocks.updateBlocksAfterVarRename(id, job.to);
        }
        done++;
    }
    return done;
};

/**
 * Open a sprite in the editor.
 * @param {VirtualMachine} vm the running VM
 * @param {string} name which sprite
 * @returns {boolean} whether it was found
 */
export const openSprite = (vm, name) => {
    const target = vm.runtime.targets.find(t => t.getName() === name && (!t.isSprite || t.isOriginal));
    if (!target) return false;
    vm.setEditingTarget(target.id);
    return true;
};

/**
 * One script, as text — the block you right-clicked and everything joined to
 * it below and inside it.
 *
 * Built by handing the converter a copy of the sprite that contains only that
 * script's blocks, so a single script goes through exactly the same code as a
 * whole sprite rather than a second, nearly-identical path.
 *
 * @param {VirtualMachine} vm the running VM
 * @param {string} blockId any block in the script
 * @returns {string} the script as text
 */
export const scriptToText = (vm, blockId) => {
    const project = projectOf(vm);
    const name = vm.editingTarget ? vm.editingTarget.getName() : null;
    const target = project.targets.find(t => t.name === name);
    if (!target || !target.blocks[blockId]) throw new Error('That block is not in this sprite.');

    // Up to the top of the script first: right-clicking halfway down should
    // give you the whole thing, the same as dragging it would.
    let topId = blockId;
    let guard = 0;
    while (target.blocks[topId] && target.blocks[topId].parent && guard++ < 10000) {
        topId = target.blocks[topId].parent;
    }

    // Then everything hanging off it.
    const wanted = {};
    const walk = id => {
        const block = target.blocks[id];
        if (!block || wanted[id]) return;
        wanted[id] = block;
        for (const input of Object.values(block.inputs || {})) {
            for (const part of input.slice(1)) {
                if (typeof part === 'string') walk(part);
            }
        }
        if (block.next) walk(block.next);
    };
    walk(topId);

    const root = {...wanted[topId], topLevel: true, parent: null, x: 0, y: 0};
    const only = {...wanted, [topId]: root};

    return targetToText({...target, blocks: only}, contextOf(project), textOptions()).text
        .split('\n')
        .filter(line => !AT_LINE.test(line.trim()))
        .join('\n')
        .trim();
};

// -------------------------------------------------------------- pasting in

// Every id in a freshly built set of blocks, swapped for one that is not
// already in the sprite. Two conversions in the same sprite both number their
// blocks from zero, so pasting without this would land one script on top of
// another and lose both.
const withFreshIds = (built, target) => {
    const taken = new Set(Object.keys(target.blocks || {}));
    for (const id of Object.keys(target.comments || {})) taken.add(id);

    const stamp = Date.now().toString(36);
    let n = 0;
    const fresh = new Map();
    const idFor = old => {
        if (!fresh.has(old)) {
            let id;
            do {
                id = `fwp${stamp}${(n++).toString(36)}`;
            } while (taken.has(id));
            taken.add(id);
            fresh.set(old, id);
        }
        return fresh.get(old);
    };

    // Only a string that names one of the new blocks is an id. The other
    // strings in an input are values — a message name, a dropdown choice —
    // and renaming one of those would quietly change what the script does.
    const isBlockId = v => typeof v === 'string' && Object.prototype.hasOwnProperty.call(built.blocks, v);
    const remap = value => {
        if (isBlockId(value)) return idFor(value);
        if (Array.isArray(value)) return value.map(remap);
        return value;
    };

    const blocks = {};
    for (const [oldId, block] of Object.entries(built.blocks)) {
        const inputs = {};
        for (const [name, input] of Object.entries(block.inputs || {})) inputs[name] = remap(input);
        blocks[idFor(oldId)] = {
            ...block,
            inputs,
            parent: block.parent ? idFor(block.parent) : null,
            next: block.next ? idFor(block.next) : null,
            comment: block.comment ? idFor(block.comment) : undefined
        };
    }

    const comments = {};
    for (const [oldId, comment] of Object.entries(built.comments || {})) {
        comments[idFor(oldId)] = {
            ...comment,
            blockId: comment.blockId ? idFor(comment.blockId) : null
        };
    }
    return {blocks, comments};
};

// Where the pasted scripts land. Under everything already there by default,
// so nothing is buried; at the mouse when the paste came from a right-click,
// because that is where the person was pointing.
const place = (blocks, target, at) => {
    const tops = Object.values(blocks).filter(b => b.topLevel);
    let x = at ? Math.round(at.x) : 0;
    let y = at ? Math.round(at.y) : 0;
    if (!at) {
        for (const block of Object.values(target.blocks || {})) {
            if (block && block.topLevel) y = Math.max(y, Math.round(block.y || 0) + 220);
        }
    }
    for (const block of tops) {
        block.x = x;
        block.y = y;
        // Stagger, so pasting several scripts at once does not stack them.
        y += 220;
    }
    return tops.length;
};

// A script that uses a variable this sprite has not got would paste as a
// block pointing at nothing, which looks like a block with an empty slot and
// is very hard to work out. The names the text declares are made first.
const ensureNames = (vm, liveTarget, decls) => {
    const stage = vm.runtime.getTargetForStage();
    const made = [];
    let n = 0;
    for (const decl of decls || []) {
        const type = decl.kind === 'list' ? 'list' : decl.kind === 'broadcast' ? 'broadcast_msg' : '';
        // A local name shadows a global one, so both places are checked
        // before anything is made.
        const found = liveTarget.lookupVariableByNameAndType(decl.name, type) ||
            (stage && stage.lookupVariableByNameAndType(decl.name, type));
        if (found) continue;
        // Messages are the whole project's, never one sprite's. Everything
        // else goes where the text said it should.
        const owner = (decl.global || decl.kind === 'broadcast') ? stage : liveTarget;
        if (!owner) continue;
        owner.createVariable(`fwpv${Date.now().toString(36)}${n++}`, decl.name, type);
        made.push(decl.name);
    }
    return made;
};

/**
 * Add text to the sprite that is open, as blocks, keeping what is already
 * there.
 *
 * The other direction of Copy as text. Unlike the Text button this does not
 * replace the sprite: the scripts in the text are added alongside the ones
 * already in it.
 *
 * @param {VirtualMachine} vm the running VM
 * @param {string} text the text to add
 * @param {{x: number, y: number}} at where to put it, in workspace coordinates
 * @returns {{scripts: number, created: Array}} what was added
 */
export const pasteText = (vm, text, at) => {
    const liveTarget = vm.editingTarget;
    if (!liveTarget) throw new Error('No sprite is selected.');

    const style = textOptions().style;
    // Read the text before anything at all is created. If it has a mistake in
    // it this throws, and the project is exactly as it was.
    const ast = parse(text, style);
    if (!ast.scripts.length) throw new Error('There is nothing here to add.');

    const created = ensureNames(vm, liveTarget, ast.decls);

    // Serialized after the names are made, so the builder finds them and
    // points the new blocks at the real variables rather than inventing ids.
    const project = projectOf(vm);
    const target = project.targets.find(t => t.name === liveTarget.getName());
    const built = buildTarget(ast, target, contextOf(project), style);

    const {blocks, comments} = withFreshIds(built, target);
    const scripts = place(blocks, target, at);

    replaceTargetBlocks(
        liveTarget,
        {...target.blocks, ...blocks},
        {...(target.comments || {}), ...comments}
    );
    vm.emitWorkspaceUpdate();
    vm.runtime.emitProjectChanged();

    return {scripts, created};
};
