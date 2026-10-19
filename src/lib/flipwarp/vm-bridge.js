// The bridge between the running VM and the text form.
//
// Reading is easy: ask the VM to serialize itself and convert the target we
// are looking at. Writing swaps that one target's blocks in place and tells
// the editor to redraw, the project is never reloaded, so costumes and
// sounds are not re-fetched and nothing else about the project is touched.

import { targetToText } from './to-text.js';
import { parse } from './parse.js';
import { buildTarget } from './build.js';
import { canonTarget } from './canon.js';
import { ParseError } from './hints.js';
import { replaceTargetBlocks } from './sb3-to-runtime.js';
import { AT_LINE, splitPositions, restorePositions } from './positions.js';

const projectOf = vm => JSON.parse(vm.toJSON());

const contextOf = project => {
    const stage = project.targets.find(t => t.isStage) || {};
    return {
        globals: {variables: stage.variables || {}, lists: stage.lists || {}},
        broadcasts: stage.broadcasts || {}
    };
};

// The text as written, rebuilt into blocks. The @at markers put back in front
// of each script are lines the person never saw, so a mistake found after them
// is reported at the line it is on in the text they wrote, not one line
// further down for every script above it.
const buildWritten = (text, positions, target, project, style) => {
    const restored = restorePositions(text, positions);
    try {
        return buildTarget(parse(restored, style), target, contextOf(project), style);
    } catch (e) {
        if (e instanceof ParseError && typeof e.line === 'number' && restored !== text) {
            const lines = restored.split('\n');
            let inserted = 0;
            for (let i = 0; i < e.line - 1 && i < lines.length; i++) {
                if (AT_LINE.test(lines[i].trim())) inserted++;
            }
            e.line -= inserted;
        }
        throw e;
    }
};

const editingName = vm => (vm.editingTarget ? vm.editingTarget.getName() : null);

/**
 * The sprite (or stage) currently open in the editor, as text.
 * @param {VirtualMachine} vm the running VM
 * @returns {{text: string, name: string, isStage: boolean, blocks: number}} the target as text
 */
export const readCurrentTarget = (vm, showPositions = false, options = {}) => {
    const project = projectOf(vm);
    const name = editingName(vm);
    const target = project.targets.find(t => t.name === name);
    if (!target) throw new Error('No sprite is selected.');
    const full = targetToText(target, contextOf(project), options).text;
    const {positions, text} = splitPositions(full);
    return {
        text: showPositions ? full : text,
        positions,
        name,
        isStage: !!target.isStage,
        blocks: Object.values(target.blocks).filter(b => !b.shadow).length
    };
};

/**
 * Check text without changing anything. Throws ParseError on a bad line.
 * @param {VirtualMachine} vm the running VM
 * @param {string} text the edited text
 * @returns {{blocks: number, unchanged: boolean}} what the text would produce
 */
export const checkText = (vm, text, positions = [], style) => {
    const project = projectOf(vm);
    const name = editingName(vm);
    const target = project.targets.find(t => t.name === name);
    const rebuilt = buildWritten(text, positions, target, project, style);
    return {
        blocks: Object.values(rebuilt.blocks).filter(b => !b.shadow).length,
        unchanged: JSON.stringify(canonTarget(target.blocks, target.comments)) ===
            JSON.stringify(canonTarget(rebuilt.blocks, rebuilt.comments))
    };
};

/**
 * Put the text back into the project as real blocks.
 * @param {VirtualMachine} vm the running VM
 * @param {string} text the edited text
 * @returns {Promise<{blocks: number, changed: boolean}>} what was applied
 */
// Variables and lists the text names that the project does not have.
//
// Writing a name into a declaration is how you make one here, the same way
// typing a new name in a text editor makes a new thing. What must not happen
// is what happened before: the blocks were pointed at an id nothing owned, so
// the variable was in no palette, on no monitor, and saving the project wrote
// out blocks referring to something that was not there.
//
// This is also what a rename looks like from here. Changing "variable score"
// to "variable points" makes points and leaves score alone, with its value and
// its monitor, now used by nothing. That is deliberate: the two are the same
// keystrokes and only the person typing knows which they meant, and making a
// new one is the half that can be undone by deleting it. Find and replace
// renames properly, and says so.
const makeMissingVariables = (vm, liveTarget, created = []) => {
    if (!created.length) return;
    const stage = vm.runtime.getTargetForStage();
    for (const item of created) {
        if (item.kind === 'broadcast') continue;
        const owner = item.global ? stage : liveTarget;
        if (!owner || owner.lookupVariableById(item.id)) continue;
        // A global variable named "☁ something" is a cloud variable, the way
        // Scratch's own New Variable dialog names them. Made any other way it
        // would only look like one and never be shared.
        const cloud = item.global && item.kind === 'variable' && /^☁ /.test(item.name);
        owner.createVariable(item.id, item.name, item.kind === 'list' ? 'list' : '', cloud);
    }
    vm.emitTargetsUpdate();
};

export const applyText = async (vm, text, positions = [], style) => {
    const project = projectOf(vm);
    const name = editingName(vm);
    const target = project.targets.find(t => t.name === name);
    if (!target) throw new Error('No sprite is selected.');

    // Build first. If the text has a mistake anywhere in it, this throws and
    // the project is still untouched.
    const rebuilt = buildWritten(text, positions, target, project, style);
    const changed = JSON.stringify(canonTarget(target.blocks, target.comments)) !==
        JSON.stringify(canonTarget(rebuilt.blocks, rebuilt.comments));
    const count = Object.values(rebuilt.blocks).filter(b => !b.shadow).length;
    if (!changed) return {blocks: count, changed: false};

    const liveTarget = vm.editingTarget;
    if (!liveTarget) throw new Error('No sprite is selected.');

    vm.stopAll();
    makeMissingVariables(vm, liveTarget, rebuilt.created);
    replaceTargetBlocks(liveTarget, rebuilt.blocks, rebuilt.comments);
    vm.emitWorkspaceUpdate();
    vm.runtime.emitProjectChanged();

    return {blocks: count, changed: true};
};

/**
 * Put a target's blocks back to a saved state, how undoing a conversion works.
 * @param {VirtualMachine} vm the running VM
 * @param {string} targetName which sprite
 * @param {object} savedBlocks blocks in saved-project format
 * @returns {boolean} whether anything was restored
 */
export const restoreBlocks = (vm, targetName, savedBlocks, savedComments) => {
    const target = vm.runtime.targets.find(t => t.getName() === targetName && (!t.isSprite || t.isOriginal));
    if (!target) return false;
    vm.stopAll();
    replaceTargetBlocks(target, savedBlocks, savedComments);
    vm.emitWorkspaceUpdate();
    vm.runtime.emitProjectChanged();
    return true;
};

/**
 * A target's blocks exactly as they would be saved, the snapshot undo needs.
 * @param {VirtualMachine} vm the running VM
 * @returns {{name: string, blocks: object}} the snapshot
 */
export const snapshotCurrentTarget = vm => {
    const project = projectOf(vm);
    const name = editingName(vm);
    const target = project.targets.find(t => t.name === name);
    return {
        name,
        blocks: target ? target.blocks : {},
        comments: target ? (target.comments || {}) : {}
    };
};

export {ParseError};
