// The bridge between the running VM and the text form.
//
// Reading is easy: ask the VM to serialize itself and convert the target we
// are looking at. Writing swaps that one target's blocks in place and tells
// the editor to redraw — the project is never reloaded, so costumes and
// sounds are not re-fetched and nothing else about the project is touched.

import { targetToText } from './to-text.js';
import { parse } from './parse.js';
import { buildTarget } from './build.js';
import { canonTarget } from './canon.js';
import { ParseError } from './hints.js';
import { replaceTargetBlocks } from './sb3-to-runtime.js';

// Script positions are real information — they are where you dragged each
// script — but @at lines are noise to read past. They are stripped out of the
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

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const blank = line.trim() === '';
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
        if (blank) atScriptStart = true;
        out.push(line);
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
export const readCurrentTarget = (vm, showPositions = false) => {
    const project = projectOf(vm);
    const name = editingName(vm);
    const target = project.targets.find(t => t.name === name);
    if (!target) throw new Error('No sprite is selected.');
    const full = targetToText(target, contextOf(project)).text;
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
export const checkText = (vm, text, positions = []) => {
    const project = projectOf(vm);
    const name = editingName(vm);
    const target = project.targets.find(t => t.name === name);
    const rebuilt = buildTarget(parse(restorePositions(text, positions)), target, contextOf(project));
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
export const applyText = async (vm, text, positions = []) => {
    const project = projectOf(vm);
    const name = editingName(vm);
    const target = project.targets.find(t => t.name === name);
    if (!target) throw new Error('No sprite is selected.');

    // Build first. If the text has a mistake anywhere in it, this throws and
    // the project is still untouched.
    const rebuilt = buildTarget(parse(restorePositions(text, positions)), target, contextOf(project));
    const changed = JSON.stringify(canonTarget(target.blocks, target.comments)) !==
        JSON.stringify(canonTarget(rebuilt.blocks, rebuilt.comments));
    const count = Object.values(rebuilt.blocks).filter(b => !b.shadow).length;
    if (!changed) return {blocks: count, changed: false};

    const liveTarget = vm.editingTarget;
    if (!liveTarget) throw new Error('No sprite is selected.');

    vm.stopAll();
    replaceTargetBlocks(liveTarget, rebuilt.blocks, rebuilt.comments);
    vm.emitWorkspaceUpdate();
    vm.runtime.emitProjectChanged();

    return {blocks: count, changed: true};
};

/**
 * Put a target's blocks back to a saved state — how undoing a conversion works.
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
 * A target's blocks exactly as they would be saved — the snapshot undo needs.
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
