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

// Script positions are real information, they are where you dragged each
// script, but @at lines are noise to read past. They are stripped out of the
// text you see and put back on the way in, so the positions survive without
// ever being on screen.
const AT_LINE = /^@at\((-?\d+),\s*(-?\d+)\)$/;

const splitPositions = text => {
    const positions = [];
    const lines = [];
    for (const line of text.split('\n')) {
        const m = AT_LINE.exec(line.trim());
        if (m) {
            positions.push({x: Number(m[1]), y: Number(m[2])});
            continue;
        }
        lines.push(line);
    }
    return {positions, text: lines.join('\n').replace(/^\n+/, '')};
};

// A script the text added has no saved position, so it goes below everything
// else rather than landing on top of a script that is already there.
const restorePositions = (text, positions) => {
    // With the markers on show, the text already carries its own positions
    // and must be left exactly as written.
    if (text.split('\n').some(line => AT_LINE.test(line.trim()))) return text;

    const out = [];
    let scriptIndex = 0;
    let lowest = positions.reduce((n, p) => Math.max(n, p.y), 0);
    let atScriptStart = true;

    const lines = text.split('\n');
    // A run of # lines with a blank line after it is a comment on the canvas,
    // not the start of a script, so it must not be given a script's position.
    const looseComment = index => {
        if (!/^\s*#/.test(lines[index])) return false;
        let k = index;
        while (k < lines.length && /^\s*#/.test(lines[k])) k++;
        return k >= lines.length || lines[k].trim() === '';
    };

    // How deep into a block body a line is. A blank line inside a body is
    // somebody spacing their code out, not the end of a script, and treating
    // it as the end of one used to split the script in two: in a brace style
    // the tail detached onto the canvas as its own script, and in an
    // indentation style the marker went in at column 0 and the next line was
    // reported as wrongly indented, pointing at a line nobody had touched.
    //
    // Braces answer this exactly. An indentation style has no braces, so the
    // indent of the line does instead: a line indented at all is inside
    // something.
    let depth = 0;
    const insideABody = index => {
        if (depth > 0) return true;
        // Look ahead: in an indentation style the blank line sits between two
        // indented lines, and both of those are inside the same body.
        for (let k = index + 1; k < lines.length; k++) {
            if (lines[k].trim() === '') continue;
            return /^\s+\S/.test(lines[k]);
        }
        return false;
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const blank = line.trim() === '';
        // No terminator in this test on purpose: a declaration ends with a
        // semicolon in one style and with the end of the line in the other,
        // and what matters here is only that the line is a declaration.
        const declaration = /^\s*(global\s+)?(variable|list|broadcast)\s/.test(line);

        if (!blank && !declaration && atScriptStart && !looseComment(index)) {
            const p = positions[scriptIndex];
            if (p) {
                out.push(`@at(${p.x}, ${p.y})`);
            } else {
                lowest += 260;
                out.push(`@at(0, ${lowest})`);
            }
            scriptIndex++;
            atScriptStart = false;
        }
        if (blank && !insideABody(index)) atScriptStart = true;
        out.push(line);
        // Counted after the line is kept, so a line that closes a body is
        // itself still inside it.
        for (const ch of line.replace(/"(\\.|[^"\\])*"/g, '')) {
            if (ch === '{') depth++;
            else if (ch === '}') depth = Math.max(0, depth - 1);
        }
    }
    return out.join('\n');
};

const projectOf = vm => JSON.parse(vm.toJSON());

const contextOf = project => {
    const stage = project.targets.find(t => t.isStage) || {};
    return {
        globals: {variables: stage.variables || {}, lists: stage.lists || {}},
        broadcasts: stage.broadcasts || {}
    };
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
    const rebuilt = buildTarget(parse(restorePositions(text, positions), style), target, contextOf(project), style);
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
        owner.createVariable(item.id, item.name, item.kind === 'list' ? 'list' : '');
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
    const rebuilt = buildTarget(parse(restorePositions(text, positions), style), target, contextOf(project), style);
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
