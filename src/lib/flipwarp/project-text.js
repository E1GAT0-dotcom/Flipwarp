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
import LazyScratchBlocks from '../tw-lazy-scratch-blocks';

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
        // Which script each visible line sits in, counted the same way
        // to-text writes them out: one @at marker per script, in order. That
        // number is what lets a search result scroll the workspace to the
        // right place rather than only opening the right sprite.
        const visible = [];
        const scripts = [];
        let scriptIndex = -1;
        for (const line of lines) {
            if (AT_LINE.test(line.trim())) {
                scriptIndex++;
                continue;
            }
            visible.push(line);
            scripts.push(scriptIndex);
        }
        out.push({
            name: target.name,
            isStage: !!target.isStage,
            full,
            // Line numbers people see must match the text they would see in
            // the panel, which does not show the @at markers.
            visible,
            scripts
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
                script: target.scripts[index],
                text: line.trim(),
                id: `${target.name}:${index + 1}`
            });
        });
    }
    return {matches, unreadable};
};


// ------------------------------------------------- deleting a whole block

const indentOf = line => (/^[ \t]*/.exec(line) || [''])[0]
    .replace(/\t/g, '        ').length;

const opensBody = (line, style) => (style.indentBased ?
    /:\s*$/.test(line) : /\{\s*$/.test(line));

/**
 * The lines one block occupies: itself, and everything it holds.
 *
 * Deleting "goToXY(0, 0)" should take one line. Deleting "repeat(10)" should
 * take the loop and what is inside it, because that is what deleting the
 * block would do in the workspace — the alternative is an orphaned closing
 * brace and text that will not go back into blocks at all.
 *
 * @param {Array<string>} lines every line of the sprite, markers included
 * @param {number} index the line the match is on
 * @param {object} style the style the text is written in
 * @returns {Array<number>} first and last line, inclusive
 */
const spanOf = (lines, index, style) => {
    const line = lines[index];
    if (!opensBody(line, style)) return [index, index];

    if (style.indentBased) {
        const outer = indentOf(line);
        let end = index;
        for (let i = index + 1; i < lines.length; i++) {
            if (lines[i].trim() === '') continue;
            if (AT_LINE.test(lines[i].trim())) break;
            if (indentOf(lines[i]) <= outer) break;
            end = i;
        }
        return [index, end];
    }

    // Braces are counted rather than matched by indentation, because
    // indentation in a bracketed style is decoration and may be wrong.
    let depth = 0;
    for (let i = index; i < lines.length; i++) {
        for (const ch of lines[i]) {
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) return [index, i];
            }
        }
    }
    return [index, lines.length - 1];
};

/**
 * Tidy up after a deletion.
 *
 * Taking a line out can leave things behind that are not valid on their own:
 * a loop with nothing in it, or a script marker with no script under it. Both
 * are removed, and removing them can empty something else, so this repeats
 * until there is nothing left to tidy.
 *
 * @param {Array<string>} lines what is left after the deletion
 * @param {object} style the style the text is written in
 * @returns {Array<string>} the tidied lines
 */
const tidy = (lines, style) => {
    let out = lines;
    for (let pass = 0; pass < 50; pass++) {
        const doomed = new Set();
        for (let i = 0; i < out.length; i++) {
            const line = out[i];
            if (line.trim() === '') continue;

            // A marker with no script under it.
            if (AT_LINE.test(line.trim())) {
                let j = i + 1;
                while (j < out.length && out[j].trim() === '') j++;
                if (j >= out.length || AT_LINE.test(out[j].trim())) doomed.add(i);
                continue;
            }

            if (!opensBody(line, style)) continue;

            // A body with nothing in it.
            let j = i + 1;
            while (j < out.length && out[j].trim() === '') j++;
            if (style.indentBased) {
                const empty = j >= out.length ||
                    AT_LINE.test(out[j].trim()) ||
                    indentOf(out[j]) <= indentOf(line);
                if (empty) doomed.add(i);
            } else if (j < out.length && out[j].trim() === '}') {
                doomed.add(i);
                doomed.add(j);
            }
        }
        if (!doomed.size) break;
        out = out.filter((_, i) => !doomed.has(i));
    }
    return out;
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
    const wholeBlock = !!options.wholeBlock;
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
            const declaration = declarationOf(line);
            matches.push({
                sprite: target.name,
                isStage: target.isStage,
                line: index + 1,
                script: target.scripts[index],
                text: line.trim(),
                // In whole-block mode nothing is written in place of the
                // line — the line and everything it holds goes.
                after: wholeBlock ? '' : line.replace(re, replacement).trim(),
                deletes: wholeBlock && !declaration,
                // A declaration is the name of a real variable, so deleting
                // it would leave every block that uses it pointing at nothing.
                cannotDelete: wholeBlock && declaration ? 'this names a variable' : null,
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
    const wholeBlock = !!options.wholeBlock;
    const re = matcher(query, options);
    if (!re) return {sprites: 0, lines: 0, renamed: 0};
    const wanted = new Set(chosen);

    // A declaration line is not text to swap — it is the name of a real
    // variable. Rewriting it as text would leave the old variable sitting
    // there with its value and point every block at a brand new one, which is
    // not a rename, it is a quiet duplication. So those go through the same
    // rename the editor itself uses, first, and every reference follows.
    const renamed = wholeBlock ? 0 : renameDeclarations(vm, re, replacement, wanted);

    // Whatever the renames did not cover, done as text. Lines the rename
    // already fixed no longer match, so they are simply passed over.
    const project = projectOf(vm);
    const context = contextOf(project);
    const rebuilds = [];
    let lines = 0;

    const style = textOptions().style;

    for (const target of project.targets) {
        const full = targetToText(target, context, textOptions()).text;
        const sourceLines = full.split('\n');

        // Where each line the person can see sits in the real text, which
        // also carries the @at markers they never see.
        const sourceOf = [];
        sourceLines.forEach((line, i) => {
            if (!AT_LINE.test(line.trim())) sourceOf.push(i);
        });

        const edited = sourceLines.slice();
        const doomed = new Set();
        let touched = false;

        for (let v = 0; v < sourceOf.length; v++) {
            const at = sourceOf[v];
            const line = sourceLines[at];
            if (!wanted.has(`${target.name}:${v + 1}`) || declarationOf(line)) continue;

            if (wholeBlock) {
                const [from, to] = spanOf(sourceLines, at, style);
                for (let i = from; i <= to; i++) doomed.add(i);
                touched = true;
                lines++;
                continue;
            }

            re.lastIndex = 0;
            const next = line.replace(re, replacement);
            if (next !== line) {
                edited[at] = next;
                touched = true;
                lines++;
            }
        }

        if (!touched) continue;

        // Deleting can leave an empty loop or a marker with no script under
        // it, neither of which is valid on its own.
        const kept = doomed.size ?
            tidy(edited.filter((_, i) => !doomed.has(i)), style) :
            edited;

        // Throws here if the change made the text invalid, before anything at
        // all has been applied.
        const rebuilt = buildTarget(parse(kept.join('\n'), style), target, context, style);
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
    // Asking for the sprite that is already open is not free — it rebuilds
    // the workspace, which loses the scroll position and any selection.
    if (vm.editingTarget && vm.editingTarget.id === target.id) return true;
    vm.setEditingTarget(target.id);
    return true;
};

// The editor has more than one copy of Blockly loaded and more than one
// workspace on the page — the block palette is a workspace of its own — so
// the right one is the one that actually holds the block.
const workspaceHolding = blockId => {
    if (!LazyScratchBlocks.isLoaded()) return null;
    const Blockly = LazyScratchBlocks.get();
    const db = Blockly.Workspace && Blockly.Workspace.WorkspaceDB_;
    const all = db ? Object.values(db) :
        [Blockly.getMainWorkspace && Blockly.getMainWorkspace()].filter(Boolean);
    for (const workspace of all) {
        try {
            if (workspace.isFlyout) continue;
            if (workspace.getBlockById && workspace.getBlockById(blockId)) return workspace;
        } catch (e) {
            // A workspace mid-teardown is not the one we want anyway.
        }
    }
    return null;
};

// Scroll the workspace so a block is in the middle of it, and select it.
//
// Two things make this harder than the one call it looks like. The block is
// not there the instant we ask, because changing sprite tears the workspace
// down and builds it again — so it is asked for repeatedly for a short while.
// And that rebuild also resets the scroll, and can land *after* we have
// scrolled, putting the view straight back where it was. So it is done again
// a moment later, and the second one is what usually sticks.
const centre = (blockId, attempt = 0) => {
    const workspace = workspaceHolding(blockId);
    if (!workspace) {
        if (attempt < 25) setTimeout(() => centre(blockId, attempt + 1), 80);
        return false;
    }
    try {
        if (workspace.centerOnBlock) workspace.centerOnBlock(blockId);
        const block = workspace.getBlockById(blockId);
        // Selected as well, because one script among many on a big canvas is
        // still hard to pick out once you get there.
        if (block && block.select) block.select();
        return true;
    } catch (e) {
        // Scrolling is a courtesy. Never let it break the search.
        return false;
    }
};

const scrollTo = blockId => {
    centre(blockId);
    setTimeout(() => centre(blockId), 150);
    setTimeout(() => centre(blockId), 450);
};

/**
 * Open the sprite a match is in and scroll the workspace to the script it is
 * part of.
 *
 * The scripts are ordered here exactly the way the converter orders them when
 * it writes the text — by where they sit on the canvas — so the number
 * counted out of the text picks the same script back out of the project.
 *
 * @param {VirtualMachine} vm the running VM
 * @param {string} name the sprite to open
 * @param {number} scriptIndex which script, counted from the text
 * @returns {boolean} whether the sprite was opened
 */
export const revealScript = (vm, name, scriptIndex) => {
    if (!openSprite(vm, name)) return false;
    if (typeof scriptIndex !== 'number' || scriptIndex < 0) return true;

    // Read from the running project rather than a saved copy of it. Saving
    // renumbers every block, so the ids in vm.toJSON() are not the ids the
    // workspace knows a block by — looking one up there finds nothing at all,
    // silently.
    const target = vm.runtime.targets.find(t =>
        t.getName() === name && (!t.isSprite || t.isOriginal));
    if (!target || !target.blocks) return true;

    const all = target.blocks._blocks || {};
    // Ordered the way the converter orders scripts when it writes them out:
    // by where they sit on the canvas. Two scripts at exactly the same point
    // could come out the other way round, which would scroll to the wrong one
    // of the pair — and no worse than that.
    const tops = Object.values(all)
        .filter(b => b && b.topLevel && !b.shadow)
        .sort((a, b) => ((a.y || 0) - (b.y || 0)) ||
            ((a.x || 0) - (b.x || 0)) ||
            String(a.id).localeCompare(String(b.id)));

    const found = tops[scriptIndex];
    if (found) scrollTo(found.id);
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
