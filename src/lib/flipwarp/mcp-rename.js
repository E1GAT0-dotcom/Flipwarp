// Renaming, for flipwarp-mcp: a variable, list, message, custom block or a
// custom block's input, everywhere it is used, so the project works exactly
// as before with a name a person can read. Rewriting the text of every
// sprite to do it would be the risky way; this changes the names in place.

// A message picked by a computed name (broadcast(join("level", n))) cannot
// be followed from here, so the rename says so.
const computedBroadcasts = (vm, oldName) => {
    let count = 0;
    for (const target of vm.runtime.targets) {
        if (target.isSprite() && !target.isOriginal) continue;
        const all = target.blocks._blocks;
        for (const block of Object.values(all)) {
            if (!block || (block.opcode !== 'event_broadcast' && block.opcode !== 'event_broadcastandwait')) continue;
            const input = block.inputs.BROADCAST_INPUT;
            const holder = input && all[input.block];
            if (holder && holder.opcode !== 'event_broadcast_menu') count++;
        }
    }
    return count ? `${count} broadcast(s) send a computed name; any that make "${oldName}" still say the old name.` :
        null;
};

const originals = vm => vm.runtime.targets.filter(t => !t.isSprite() || t.isOriginal);

const finish = vm => {
    for (const target of originals(vm)) target.blocks.resetCache();
    vm.runtime.requestBlocksUpdate();
    vm.emitWorkspaceUpdate();
    vm.runtime.emitProjectChanged();
};

const placeholders = code => (String(code).match(/%[sbn]/g) || []).map(p => (p === '%b' ? 'b' : 's')).join('');

/**
 * @param {function} targetNamed (vm, name) -> target, from the bridge
 * @returns {object} the rename request
 */
export const renameMethods = targetNamed => ({
    // {kind: variable | list | message | block | input, sprite, from, to, block (for input)}
    rename: (vm, {kind, sprite, from, to, block: blockName}) => {
        const stage = vm.runtime.getTargetForStage();
        if (typeof to !== 'string' || !to.trim()) throw new Error('Give the new name.');
        if (from === to) throw new Error('The new name is the same as the old one.');

        if (kind === 'variable' || kind === 'list') {
            const type = kind === 'list' ? 'list' : '';
            const local = sprite && String(sprite).toLowerCase() !== 'stage' ? targetNamed(vm, sprite) : null;
            const lookIn = local ? [local, stage] : [stage];
            const owner = lookIn.find(t => Object.values(t.variables).some(v => v.name === from && v.type === type));
            if (!owner) {
                throw new Error(`There is no ${kind} called "${from}"${local ? ` in ${local.getName()} or for all ` +
                    'sprites' : ' for all sprites (say which sprite for one of a sprite\'s own)'}.`);
            }
            const variable = Object.values(owner.variables).find(v => v.name === from && v.type === type);
            if (variable.isCloud) {
                throw new Error(`"${from}" is a cloud variable. Its name is where it is kept online, so renaming ` +
                    'it would cut the game off from what players have already stored. Leave it as it is.');
            }
            // The new name must not be taken where this one can be seen.
            const clash = owner.isStage ?
                originals(vm).some(t => Object.values(t.variables).some(v => v.name === to && v.type === type)) :
                [owner, stage].some(t => Object.values(t.variables).some(v => v.name === to && v.type === type));
            if (clash) throw new Error(`A ${kind} called "${to}" already exists where "${from}" is used.`);
            const newName = to;
            owner.renameVariable(variable.id, newName);
            for (const target of owner.isStage ? originals(vm) : [owner]) {
                target.blocks.updateBlocksAfterVarRename(variable.id, newName);
            }
            finish(vm);
            return {renamed: kind, from, to: newName, forAllSprites: owner.isStage};
        }

        if (kind === 'message') {
            const message = Object.values(stage.variables).find(v => v.type === 'broadcast_msg' && v.name === from);
            if (!message) throw new Error(`There is no message called "${from}".`);
            if (Object.values(stage.variables).some(v => v.type === 'broadcast_msg' && v.name === to)) {
                throw new Error(`A message called "${to}" already exists.`);
            }
            stage.renameVariable(message.id, to);
            // A message keeps its name twice, and the saved file reads it
            // from the value.
            message.value = to;
            let changed = 0;
            for (const target of originals(vm)) {
                for (const block of Object.values(target.blocks._blocks)) {
                    const field = block && block.fields && block.fields.BROADCAST_OPTION;
                    if (field && (field.id === message.id || field.value === from)) {
                        field.value = to;
                        field.id = message.id;
                        changed++;
                    }
                }
            }
            finish(vm);
            return {renamed: 'message', from, to, blocks: changed, note: computedBroadcasts(vm, from)};
        }

        const target = targetNamed(vm, sprite);
        const all = target.blocks._blocks;
        const definitions = Object.values(all).filter(b => b && b.opcode === 'procedures_prototype' && b.mutation);
        const label = code => String(code).replace(/\s*%[sbn]/g, '')
            .trim();
        const findPrototype = name => definitions.find(p =>
            p.mutation.proccode === name || label(p.mutation.proccode) === name);

        if (kind === 'block') {
            const prototype = findPrototype(from);
            if (!prototype) {
                throw new Error(`${target.getName()} has no custom block "${from}". It has: ` +
                    `${definitions.map(p => `"${label(p.mutation.proccode)}"`).join(', ') || 'none'}.`);
            }
            const oldCode = prototype.mutation.proccode;
            // Keep the inputs where they were: give the new name with them
            // (as in "move %s steps"), or just a name, which keeps the old
            // inputs after it.
            let newCode = /%[sbn]/.test(to) ? to : `${to}${oldCode.slice(label(oldCode).length)}`;
            newCode = newCode.replace(/\s+/g, ' ').trim();
            if (placeholders(newCode) !== placeholders(oldCode)) {
                throw new Error(`"${newCode}" has different inputs from "${oldCode}". Keep the same inputs ` +
                    'in the same order (%s for number or text, %b for true/false), or give just a name.');
            }
            if (definitions.some(p => p !== prototype && p.mutation.proccode === newCode)) {
                throw new Error(`${target.getName()} already has a custom block "${newCode}".`);
            }
            let calls = 0;
            prototype.mutation.proccode = newCode;
            for (const block of Object.values(all)) {
                if (block && block.opcode === 'procedures_call' && block.mutation &&
                    block.mutation.proccode === oldCode) {
                    block.mutation.proccode = newCode;
                    calls++;
                }
            }
            finish(vm);
            return {renamed: 'custom block', from: oldCode, to: newCode, calls};
        }

        if (kind === 'input') {
            const prototype = findPrototype(blockName);
            if (!prototype) throw new Error(`${target.getName()} has no custom block "${blockName}".`);
            const names = JSON.parse(prototype.mutation.argumentnames || '[]');
            const at = names.indexOf(from);
            if (at < 0) {
                throw new Error(`"${label(prototype.mutation.proccode)}" has no input "${from}". Its inputs: ` +
                    `${names.map(n => `"${n}"`).join(', ') || 'none'}.`);
            }
            if (names.includes(to)) throw new Error(`It already has an input called "${to}".`);
            names[at] = to;
            prototype.mutation.argumentnames = JSON.stringify(names);
            // The input's own block in the definition's hat, and every use of
            // it inside the definition.
            const definition = all[prototype.parent];
            let uses = 0;
            const pending = [prototype.id, definition && definition.next];
            const seen = new Set();
            while (pending.length) {
                const id = pending.pop();
                if (!id || seen.has(id)) continue;
                seen.add(id);
                const block = all[id];
                if (!block) continue;
                if (/^argument_reporter_/.test(block.opcode) && block.fields.VALUE &&
                    block.fields.VALUE.value === from) {
                    block.fields.VALUE.value = to;
                    uses++;
                }
                if (block.next) pending.push(block.next);
                for (const input of Object.values(block.inputs || {})) {
                    if (input && input.block) pending.push(input.block);
                    if (input && input.shadow) pending.push(input.shadow);
                }
            }
            finish(vm);
            return {renamed: 'input', block: label(prototype.mutation.proccode), from, to, uses: Math.max(0, uses - 1)};
        }

        throw new Error('kind must be variable, list, message, block or input.');
    }
});
