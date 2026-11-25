/* eslint-disable no-use-before-define */
// The front end of "Export as code": a project's project.json turned into one
// plain description of the game that every exporter (Web Lab, Python, Game
// Lab) writes its own code from.
//
// project.json keeps blocks as a flat table of ids pointing at each other,
// with menus as hidden "shadow" blocks and numbers squeezed into arrays. Here
// that becomes trees: each script is a hat and a list of statements, each
// statement has its inputs as expressions, and every menu, number and
// variable is resolved to what it means. Nothing about any one target
// language is decided here.

// Input primitives in project.json: [type, value, ...].
const PRIMITIVE = {4: 'number',
    5: 'number',
    6: 'number',
    7: 'number',
    8: 'number',
    9: 'color',
    10: 'text',
    11: 'broadcast',
    12: 'variable',
    13: 'list'};

// The hats this exporter knows how to start.
export const HATS = new Set(['event_whenflagclicked', 'event_whenkeypressed', 'event_whenthisspriteclicked',
    'event_whenstageclicked', 'event_whenbroadcastreceived', 'event_whenbackdropswitchesto',
    'event_whengreaterthan', 'control_start_as_clone']);

// "10", "-2.5": written as numbers. "007", "1e3", "10.0" stay text, as typed.
const isCanonicalNumber = text => typeof text === 'string' && text !== '' && String(Number(text)) === text;

/**
 * A literal as the exporters want it: a canonical number becomes a number
 * (Scratch casts it the same way everywhere it matters), anything else stays
 * the text it was typed as.
 * @param {*} value from project.json
 * @returns {{kind: string, value: *}} the expression
 */
const literal = value => {
    if (typeof value === 'number' || typeof value === 'boolean') return {kind: 'lit', value};
    if (isCanonicalNumber(value)) return {kind: 'lit', value: Number(value)};
    return {kind: 'lit', value: value === null || typeof value === 'undefined' ? '' : String(value)};
};

/**
 * Read the TurboWarp settings comment (framerate, fencing, stage size...).
 * @param {object} project project.json
 * @returns {object} the options
 */
const optionsOf = project => {
    const options = {framerate: 30,
        fencing: true,
        miscLimits: true,
        maxClones: 300,
        width: 480,
        height: 360,
        turbo: false};
    const stage = project.targets.find(t => t.isStage);
    for (const comment of Object.values((stage && stage.comments) || {})) {
        const text = comment && comment.text;
        if (typeof text !== 'string' || !text.includes('_twconfig_')) continue;
        const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
        try {
            const config = JSON.parse(json);
            if (typeof config.framerate === 'number' && config.framerate > 0) options.framerate = config.framerate;
            if (config.width) options.width = config.width;
            if (config.height) options.height = config.height;
            if (config.turbo) options.turbo = true;
            const run = config.runtimeOptions || {};
            if (run.fencing === false) options.fencing = false;
            if (run.miscLimits === false) options.miscLimits = false;
            if (typeof run.maxClones === 'number') options.maxClones = run.maxClones;
        } catch (e) {
            // A broken settings comment: Scratch's defaults.
        }
    }
    return options;
};

/**
 * Turn project.json into the shared description.
 * @param {object} project project.json, parsed
 * @returns {object} {options, stage, sprites, targets, broadcasts, monitors, notes}
 */
export const readProject = project => {
    const notes = [];
    const note = (where, what) => notes.push({where, what});
    const stageSource = project.targets.find(t => t.isStage);

    // Every variable and list by id, with who owns it, so a block's field can
    // be resolved even when its stored name is stale.
    const owners = new Map();
    for (const t of project.targets) {
        for (const [id, v] of Object.entries(t.variables || {})) {
            owners.set(id, {id, name: v[0], list: false, global: t.isStage, owner: t.name});
        }
        for (const [id, v] of Object.entries(t.lists || {})) {
            owners.set(id, {id, name: v[0], list: true, global: t.isStage, owner: t.name});
        }
    }
    const findVariable = (target, name, id, list) => {
        if (id && owners.has(id)) {
            const found = owners.get(id);
            if (found.global || found.owner === target.name) return found;
        }
        const scope = [target, stageSource];
        for (const t of scope) {
            const table = list ? t.lists : t.variables;
            for (const [vid, v] of Object.entries(table || {})) {
                if (v[0] === name) return {id: vid, name, list, global: t.isStage, owner: t.name};
            }
        }
        // Scratch makes a missing one on the fly, on the stage.
        return {id: id || `missing-${name}`, name, list, global: true, owner: stageSource.name, missing: true};
    };

    const broadcasts = new Map();
    for (const [id, name] of Object.entries(stageSource.broadcasts || {})) broadcasts.set(id, name);

    const readTarget = source => {
        const blocks = source.blocks || {};
        const where = source.isStage ? 'Stage' : source.name;

        const expression = (input, kind) => {
            // An input: [shadowType, blockOrPrimitive, shadow?].
            if (!Array.isArray(input)) return literal('');
            const value = input[1];
            if (value === null || typeof value === 'undefined') {
                return kind === 'boolean' ? {kind: 'lit', value: false} : literal('');
            }
            return valueOf(value);
        };

        const valueOf = value => {
            if (Array.isArray(value)) {
                const type = PRIMITIVE[value[0]];
                if (type === 'variable' || type === 'list') {
                    const v = findVariable(source, value[1], value[2], type === 'list');
                    return {kind: type === 'list' ? 'list' : 'var', ...v};
                }
                if (type === 'broadcast') return {kind: 'lit', value: value[1]};
                if (type === 'color') return {kind: 'lit', value: value[1]};
                // A number typed into a text slot ("set score to 10") behaves the
                // same as the number everywhere in Scratch, so it is written as one.
                return literal(value[1]);
            }
            const block = blocks[value];
            if (!block) return literal('');
            if (Array.isArray(block)) return valueOf(block);
            return expressionBlock(value, block);
        };

        const fieldsOf = block => {
            const out = {};
            for (const [name, field] of Object.entries(block.fields || {})) {
                out[name] = Array.isArray(field) ? field[0] : field;
            }
            return out;
        };

        const expressionBlock = (id, block) => {
            // A menu is a shadow block with one field: just its value.
            if (block.shadow && !Object.keys(block.inputs || {}).length) {
                const values = Object.values(fieldsOf(block));
                if (values.length === 1) return literal(values[0]);
            }
            if (block.opcode === 'data_variable' || block.opcode === 'data_listcontents') {
                const field = block.fields[block.opcode === 'data_variable' ? 'VARIABLE' : 'LIST'];
                const v = findVariable(source, field[0], field[1], block.opcode === 'data_listcontents');
                return block.opcode === 'data_variable' ? {kind: 'var', ...v} : {kind: 'listContents', ...v};
            }
            if (block.opcode === 'argument_reporter_string_number' || block.opcode === 'argument_reporter_boolean') {
                return {kind: 'arg', name: fieldsOf(block).VALUE, boolean: block.opcode === 'argument_reporter_boolean'};
            }
            return {kind: 'block', ...node(id, block)};
        };

        const node = (id, block) => {
            const inputs = {};
            const branches = {};
            for (const [name, input] of Object.entries(block.inputs || {})) {
                if (name === 'SUBSTACK' || name === 'SUBSTACK2') {
                    branches[name] = stack(Array.isArray(input) ? input[1] : null);
                } else if (name !== 'custom_block') {
                    inputs[name] = expression(input);
                }
            }
            const fields = fieldsOf(block);
            // Variables and lists named in fields, resolved.
            if (block.fields && block.fields.VARIABLE && block.opcode !== 'data_variable') {
                fields.VARIABLE = findVariable(source, block.fields.VARIABLE[0], block.fields.VARIABLE[1], false);
            }
            if (block.fields && block.fields.LIST && block.opcode !== 'data_listcontents') {
                fields.LIST = findVariable(source, block.fields.LIST[0], block.fields.LIST[1], true);
            }
            if (block.fields && block.fields.BROADCAST_OPTION) {
                const [name, bid] = block.fields.BROADCAST_OPTION;
                fields.BROADCAST_OPTION = broadcasts.get(bid) || name;
            }
            const out = {op: block.opcode, id, inputs, fields, branches};
            if (block.mutation) out.mutation = block.mutation;
            return out;
        };

        const stack = firstId => {
            const out = [];
            let id = firstId;
            let guard = 0;
            while (id && blocks[id] && guard++ < 100000) {
                const block = blocks[id];
                if (Array.isArray(block)) break;
                out.push(node(id, block));
                id = block.next;
            }
            return out;
        };

        const scripts = [];
        const procedures = [];
        for (const [id, block] of Object.entries(blocks)) {
            if (Array.isArray(block) || !block.topLevel) continue;
            if (block.opcode === 'procedures_definition') {
                const protoInput = block.inputs && block.inputs.custom_block;
                const proto = protoInput && blocks[protoInput[1]];
                const mutation = (proto && proto.mutation) || {};
                let argNames = [];
                let argIds = [];
                try {
                    argNames = JSON.parse(mutation.argumentnames || '[]');
                    argIds = JSON.parse(mutation.argumentids || '[]');
                } catch (e) {
                    // Treated as taking nothing.
                }
                const argKinds = argIds.map((aid, i) => {
                    const code = String(mutation.proccode || '');
                    const slots = code.match(/%[snb]/g) || [];
                    return slots[i] === '%b' ? 'boolean' : 'value';
                });
                procedures.push({
                    proccode: String(mutation.proccode || ''),
                    argNames,
                    argIds,
                    argKinds,
                    warp: mutation.warp === true || mutation.warp === 'true',
                    body: stack(block.next)
                });
                continue;
            }
            if (!HATS.has(block.opcode)) {
                // A loose block, or a hat from an extension.
                if (block.opcode.startsWith('event_') || block.opcode.startsWith('control_') ||
                    /^[a-zA-Z0-9]+_when/.test(block.opcode)) {
                    if (!block.next) continue;
                    note(where, `a script starting with "${block.opcode}", which this export cannot start`);
                }
                continue;
            }
            const hat = node(id, block);
            scripts.push({hat, body: stack(block.next)});
        }

        const costumes = (source.costumes || []).map(c => ({
            name: c.name,
            md5ext: c.md5ext || `${c.assetId}.${c.dataFormat}`,
            dataFormat: c.dataFormat,
            bitmapResolution: c.bitmapResolution || 1,
            rotationCenterX: c.rotationCenterX || 0,
            rotationCenterY: c.rotationCenterY || 0
        }));
        const sounds = (source.sounds || []).map(s => ({
            name: s.name,
            md5ext: s.md5ext || `${s.assetId}.${s.dataFormat}`,
            dataFormat: s.dataFormat,
            rate: s.rate,
            sampleCount: s.sampleCount
        }));
        const variables = Object.entries(source.variables || {}).map(([id, v]) => ({
            id, name: v[0], value: v[1], cloud: !!v[2]
        }));
        const lists = Object.entries(source.lists || {}).map(([id, v]) => ({id, name: v[0], value: v[1] || []}));

        return {
            name: source.isStage ? 'Stage' : source.name,
            isStage: !!source.isStage,
            x: source.x || 0,
            y: source.y || 0,
            direction: typeof source.direction === 'number' ? source.direction : 90,
            size: typeof source.size === 'number' ? source.size : 100,
            visible: source.visible !== false,
            rotationStyle: source.rotationStyle || 'all around',
            draggable: !!source.draggable,
            currentCostume: source.currentCostume || 0,
            layerOrder: source.layerOrder || 0,
            volume: typeof source.volume === 'number' ? source.volume : 100,
            tempo: source.tempo || 60,
            costumes,
            sounds,
            variables,
            lists,
            scripts,
            procedures
        };
    };

    const targets = project.targets.map(readTarget);
    const stage = targets.find(t => t.isStage);
    const sprites = targets.filter(t => !t.isStage).sort((a, b) => a.layerOrder - b.layerOrder);

    // Monitors: the readouts shown on the stage.
    const monitors = (project.monitors || []).map(m => ({
        id: m.id,
        mode: m.mode,
        opcode: m.opcode,
        params: m.params || {},
        spriteName: m.spriteName || null,
        x: m.x || 0,
        y: m.y || 0,
        width: m.width || 0,
        height: m.height || 0,
        visible: !!m.visible,
        sliderMin: m.sliderMin,
        sliderMax: m.sliderMax,
        isDiscrete: m.isDiscrete
    }));

    return {
        options: optionsOf(project),
        stage,
        sprites,
        targets: [stage, ...sprites],
        broadcasts: [...new Set(broadcasts.values())],
        monitors,
        extensions: project.extensions || [],
        notes
    };
};

/**
 * Walk every block (statements and expressions) of a target.
 * @param {object} target from readProject
 * @param {function} visit called with each block node and where it is
 */
export const walkBlocks = (target, visit) => {
    const walkExpr = expr => {
        if (!expr || expr.kind !== 'block') return;
        visit(expr, 'expression');
        for (const input of Object.values(expr.inputs || {})) walkExpr(input);
    };
    const walkStack = list => {
        for (const statement of list || []) {
            visit(statement, 'statement');
            for (const input of Object.values(statement.inputs || {})) walkExpr(input);
            for (const branch of Object.values(statement.branches || {})) walkStack(branch);
        }
    };
    for (const script of target.scripts) {
        visit(script.hat, 'hat');
        for (const input of Object.values(script.hat.inputs || {})) walkExpr(input);
        walkStack(script.body);
    }
    for (const proc of target.procedures) walkStack(proc.body);
};
