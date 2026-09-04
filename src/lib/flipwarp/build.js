// A parsed tree -> Scratch blocks, ready to drop into a target.
import { BLOCKS, nameIndexFor, GETTERS } from './phrasebook.js';
import { getStyle } from './styles.js';
import { primitiveFor } from './input-shadows.js';
import { ParseError } from './hints.js';

const INFIX_OPCODE = {};
const PREFIX_OPCODE = {};
for (const [opcode, def] of Object.entries(BLOCKS)) {
  if (def.infix) INFIX_OPCODE[def.infix] = opcode;
  if (def.prefix) PREFIX_OPCODE[def.prefix] = opcode;
}

// Which shadow menu block a dropdown slot uses, and the field inside it.
const MENU_FIELD = {
  motion_goto_menu: 'TO', motion_glideto_menu: 'TO', motion_pointtowards_menu: 'TOWARDS',
  looks_costume: 'COSTUME', looks_backdrops: 'BACKDROP', sound_sounds_menu: 'SOUND_MENU',
  control_create_clone_of_menu: 'CLONE_OPTION', sensing_touchingobjectmenu: 'TOUCHINGOBJECTMENU',
  sensing_distancetomenu: 'DISTANCETOMENU', sensing_of_object_menu: 'OBJECT',
  sensing_keyoptions: 'KEY_OPTION', event_touchingobjectmenu: 'TOUCHINGOBJECTMENU',
  event_broadcast_menu: 'BROADCAST_OPTION',
};

// An extension menu block is named <extension>_menu_<MENU>, and the field
// inside it is that same <MENU>, so it never needs listing by hand.
const menuFieldFor = opcode => MENU_FIELD[opcode] ||
  (opcode.includes('_menu_') ? opcode.slice(opcode.indexOf('_menu_') + 6) : null);

export class Builder {
  constructor(names, style) {
    this.blocks = {};
    this.n = 0;
    this.style = getStyle(style);
    // Block names are spelled the active style's way, so the lookup that turns
    // a written name back into a block has to be the matching one.
    this.byName = nameIndexFor(this.style);
    this.names = names;      // ident -> { id, name, kind }
    this.procs = new Map();  // ident -> { proccode, argIds, argNames, argTypes }
    // Hats and defines swallow the rest of the stack as their body, so the
    // chain-linking step below must not overwrite what they already set.
    this.ownsNext = new Set();
    // Comment text keyed by the block it belongs to. Turned into real comment
    // records at the end, once every block has an id.
    this.blockComments = new Map();
  }

  id() { return `fw${(this.n++).toString(36)}`; }

  put(opcode, o = {}) {
    const id = this.id();
    this.blocks[id] = {
      opcode, next: null, parent: o.parent ?? null,
      inputs: o.inputs || {}, fields: o.fields || {},
      shadow: !!o.shadow, topLevel: false,
    };
    if (o.mutation) this.blocks[id].mutation = o.mutation;
    return id;
  }

  err(node, message, fix, id) {
    throw new ParseError({ line: node?.line ?? 0, column: 0, text: '', message, fix, id });
  }

  // ------------------------------------------------------------------ names

  resolve(ident, node, wanted) {
    const rec = this.names[ident];
    if (!rec) {
      this.err(node, `There is no variable, list or message called "${ident}".`,
        `Make it in the Variables palette first, or check the spelling. Names are listed at the top of this text.`, 'unknown-name');
    }
    if (wanted && rec.kind !== wanted) {
      this.err(node, `"${ident}" is a ${rec.kind}, but a ${wanted} belongs here.`,
        `Use a ${wanted} in this slot.`, 'wrong-kind');
    }
    return rec;
  }

  // ------------------------------------------------------------- statements

  buildScript(stmts, parentId = null) {
    const ids = [];
    for (const s of stmts) {
      const id = this.buildStatement(s);
      if (id && typeof s.comment === 'string') this.blockComments.set(id, s.comment);
      if (id) ids.push(id);
    }
    for (let i = 0; i < ids.length; i++) {
      if (!this.ownsNext.has(ids[i])) this.blocks[ids[i]].next = ids[i + 1] || null;
      this.blocks[ids[i]].parent = i === 0 ? parentId : ids[i - 1];
    }
    return ids[0] || null;
  }

  buildStatement(node) {
    if (node.k === 'assign') return this.buildAssign(node);
    if (node.k === 'if') return this.buildIf(node);
    if (node.k === 'define') return this.buildDefine(node);
    if (node.k === 'call') return this.buildCallStatement(node);
    this.err(node, 'Flipwarp does not understand this line.', 'Switch back to blocks and compare it with the block you meant.');
  }

  buildAssign(node) {
    const rec = this.resolve(node.ident, node, 'variable');
    const opcode = node.op === '=' ? 'data_setvariableto' : 'data_changevariableby';
    const id = this.put(opcode, { fields: { VARIABLE: [rec.name, rec.id] } });
    this.blocks[id].inputs.VALUE = this.buildInput(node.value, opcode, 'VALUE', id);
    return id;
  }

  buildIf(node) {
    const opcode = node.elseBody ? 'control_if_else' : 'control_if';
    const id = this.put(opcode);
    this.blocks[id].inputs.CONDITION = this.buildInput(node.cond, opcode, 'CONDITION', id);
    const a = this.buildScript(node.body, id);
    if (a) this.blocks[id].inputs.SUBSTACK = [2, a];
    if (node.elseBody) {
      const b = this.buildScript(node.elseBody, id);
      if (b) this.blocks[id].inputs.SUBSTACK2 = [2, b];
    }
    return id;
  }

  // What a custom block looks like from the outside, worked out from its
  // define alone. Nothing is built here, so this can run over the whole text
  // before any block exists.
  procSignatureOf(node) {
    const params = node.params;
    const proccode = node.proccode || [node.ident, ...params.map(() => '%s')].join(' ');
    const argIds = params.map((_, i) => `${node.ident}-arg-${i}`);
    const argNames = params.map(p => p.real);
    // %b slots are boolean parameters; everything else is a text/number slot.
    const slots = (proccode.match(/%[sbn]/g) || []);
    const argTypes = params.map((_, i) => (slots[i] === '%b' ? 'boolean' : 'string'));
    return { proccode, argIds, argNames, argTypes };
  }

  // Every custom block the text defines, known before anything is built.
  // Scripts come out in the order they sit on the canvas, not the order
  // somebody would write them in, so a call very often appears above the
  // define it belongs to — and without this that call has no block to be.
  registerProcs(scripts) {
    for (const script of scripts) {
      for (const stmt of script.stmts) {
        if (stmt.k === 'define') this.procs.set(stmt.ident, this.procSignatureOf(stmt));
      }
    }
  }

  buildDefine(node) {
    const params = node.params;
    const { proccode, argIds, argNames, argTypes } =
      this.procs.get(node.ident) || this.procSignatureOf(node);
    const argDefaults = argTypes.map(t => (t === 'boolean' ? 'false' : ''));

    const protoInputs = {};
    params.forEach((p, i) => {
      const rid = this.put(
        argTypes[i] === 'boolean' ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
        { fields: { VALUE: [p.real, null] }, shadow: true },
      );
      protoInputs[argIds[i]] = [1, rid];
    });

    const mutation = {
      tagName: 'mutation', children: [], proccode,
      argumentids: JSON.stringify(argIds),
      argumentnames: JSON.stringify(argNames),
      argumentdefaults: JSON.stringify(argDefaults),
      warp: node.warp ? 'true' : 'false',
    };
    const proto = this.put('procedures_prototype', { inputs: protoInputs, shadow: true, mutation });
    for (const [, v] of Object.entries(protoInputs)) this.blocks[v[1]].parent = proto;

    const def = this.put('procedures_definition', { inputs: { custom_block: [1, proto] } });
    this.blocks[proto].parent = def;

    this.procs.set(node.ident, { proccode, argIds, argNames, argTypes });
    // Parameters are visible as bare names inside the body.
    const saved = {};
    params.forEach((p, i) => { saved[p.slug] = this.names[p.slug]; this.names[p.slug] = { kind: 'param', name: p.real, type: argTypes[i] }; });
    const body = this.buildScript(node.body, def);
    params.forEach(p => { if (saved[p.slug] === undefined) delete this.names[p.slug]; else this.names[p.slug] = saved[p.slug]; });

    this.blocks[def].next = body;
    if (body) this.blocks[body].parent = def;
    this.ownsNext.add(def);
    return def;
  }

  buildCallStatement(node) {
    // A call to a custom block the text defined.
    if (this.procs.has(node.name)) return this.buildProcCall(node);

    const opcode = this.byName.get(node.name);
    if (!opcode) {
      this.err(node, `There is no block called "${node.name}".`,
        'Check the spelling, or switch back to blocks and find the block you want in the palette.', 'unknown-block');
    }
    const def = BLOCKS[opcode];

    if (def.kind === 'reporter' || def.kind === 'boolean') {
      this.err(node, `"${node.name}" reports a value, so it cannot sit on its own line.`,
        `Put it inside another block, for example: say(${node.name}(...));`, 'reporter-as-statement');
    }

    const id = this.put(opcode);
    this.fillArgs(id, opcode, def, node);

    if (def.substack && def.substack.length) {
      const body = node.bodies && node.bodies[0] ? this.buildScript(node.bodies[0], id) : null;
      if (body) this.blocks[id].inputs[def.substack[0]] = [2, body];
    } else if (def.kind === 'hat') {
      const body = node.bodies && node.bodies[0] ? this.buildScript(node.bodies[0], id) : null;
      this.blocks[id].next = body;
      if (body) this.blocks[body].parent = id;
      this.ownsNext.add(id);
    } else if (node.bodies) {
      this.err(node, `"${node.name}" does not hold other blocks inside it.`,
        'Remove the { } after it and end the line with a semicolon.', 'unexpected-body');
    }
    return id;
  }

  buildProcCall(node) {
    const p = this.procs.get(node.name);
    const mutation = {
      tagName: 'mutation', children: [], proccode: p.proccode,
      argumentids: JSON.stringify(p.argIds), warp: 'false',
    };
    const id = this.put('procedures_call', { mutation });
    if (node.args.length !== p.argIds.length) {
      this.err(node, `"${node.name}" takes ${p.argIds.length} thing(s), but ${node.args.length} were given.`,
        'Check how many slots the custom block has.', 'wrong-arg-count');
    }
    p.argIds.forEach((aid, i) => {
      const isBool = p.argTypes[i] === 'boolean';
      this.blocks[id].inputs[aid] = isBool
        ? this.buildBooleanInput(node.args[i], id)
        : this.buildLiteralOrBlock(node.args[i], [10, 'TEXT'], id);
    });
    return id;
  }

  fillArgs(id, opcode, def, node) {
    const slots = def.args.filter(a => !(def.substack || []).includes(a));
    if (node.args.length !== slots.length) {
      this.err(node, `"${node.name}" needs ${slots.length} thing(s) in its brackets, but got ${node.args.length}.`,
        'Switch back to blocks to see how many slots this block has.', 'wrong-arg-count');
    }
    slots.forEach((slot, i) => {
      const arg = node.args[i];
      if ((def.fields || []).includes(slot)) {
        this.blocks[id].fields[slot] = this.buildField(slot, arg, node);
      } else if (def.menu && def.menu[slot]) {
        this.blocks[id].inputs[slot] = this.buildMenu(def.menu[slot], arg, id, node);
      } else {
        this.blocks[id].inputs[slot] = this.buildInput(arg, opcode, slot, id);
      }
    });
  }

  buildField(slot, arg, node) {
    if (slot === 'VARIABLE' || slot === 'LIST') {
      if (arg.k !== 'ref') this.err(arg, `This slot needs the name of a ${slot === 'LIST' ? 'list' : 'variable'}.`, 'Write its name without quotes.', 'field-needs-name');
      const rec = this.resolve(arg.name, arg, slot === 'LIST' ? 'list' : 'variable');
      return [rec.name, rec.id];
    }
    if (slot === 'BROADCAST_OPTION') {
      if (arg.k !== 'ref') this.err(arg, 'This slot needs the name of a message.', 'Write the message name without quotes.', 'field-needs-name');
      const rec = this.resolve(arg.name, arg, 'broadcast');
      return [rec.name, rec.id];
    }
    if (arg.k === 'str') return [arg.v, null];
    if (arg.k === 'num') return [arg.v, null];
    this.err(arg, 'This slot is a dropdown, so it needs one of its choices in quotes.', 'Switch to blocks to see the choices, then copy one exactly.', 'dropdown-needs-choice');
  }

  buildMenu(menuOpcode, arg, parentId, node) {
    const field = menuFieldFor(menuOpcode);
    if (field === 'BROADCAST_OPTION') {
      if (arg.k !== 'ref') this.err(arg, 'This slot needs the name of a message.', 'Write the message name without quotes.', 'field-needs-name');
      const rec = this.resolve(arg.name, arg, 'broadcast');
      // Written as a primitive rather than as a shadow block, because that is
      // how Scratch itself saves a message slot. Building the shadow instead
      // works, but it does not match what was read, so every project using
      // broadcast looked edited the moment it was converted — which threw
      // away the "nothing changed" path and the undo that goes with it.
      return [1, [11, rec.name, rec.id]];
    }
    if (arg.k !== 'str' && arg.k !== 'num') {
      this.err(arg, 'This slot is a dropdown, so it needs one of its choices in quotes.', 'Switch to blocks to see the choices, then copy one exactly.', 'dropdown-needs-choice');
    }
    const mid = this.put(menuOpcode, { fields: { [field]: [String(arg.v), null] }, shadow: true, parent: parentId });
    return [1, mid];
  }

  // --------------------------------------------------------------- inputs

  buildInput(arg, opcode, slot, parentId) {
    const prim = primitiveFor(opcode, slot);
    if (prim === null) return this.buildBooleanInput(arg, parentId);
    return this.buildLiteralOrBlock(arg, prim, parentId);
  }

  buildBooleanInput(arg, parentId) {
    const r = this.buildExpr(arg, parentId, true);
    const BOOLEAN_HINT = 'Use a pointed block such as touching("_mouse_") or keyPressed("space"), or a comparison such as score > 10.';
    if (r.kind !== 'block') {
      this.err(arg, 'This slot only takes a yes/no block, not a plain value.', BOOLEAN_HINT, 'boolean-slot');
    }
    // The slot is the pointed kind, so only a pointed block fits it. A round
    // reporter such as a variable is the wrong shape, exactly as in blocks.
    const op = this.blocks[r.id].opcode;
    const isBoolean = op === 'argument_reporter_boolean' || BLOCKS[op]?.kind === 'boolean';
    if (!isBoolean) {
      const what = op === 'data_variable' ? `"${arg.name}" is a variable` : 'This block reports a value';
      this.err(arg, `${what}, and a round block does not fit a pointed slot.`,
        `Compare it instead, for example ${arg.name || 'it'} == 1, or ${arg.name || 'it'} > 0.`, 'boolean-slot-shape');
    }
    this.blocks[r.id].parent = parentId;
    return [2, r.id];
  }

  buildLiteralOrBlock(arg, prim, parentId) {
    const [ptype, ] = prim;
    const r = this.buildExpr(arg, parentId, false);
    if (r.kind === 'block') {
      this.blocks[r.id].parent = parentId;
      return [3, r.id, [ptype, defaultValueFor(ptype)]];
    }
    return [1, [ptype, r.v]];
  }

  // Returns { kind: 'block', id } or { kind: 'lit', v }.
  buildExpr(node, parentId, wantBoolean) {
    const blk = id => ({ kind: 'block', id });
    const lit = v => ({ kind: 'lit', v });
    switch (node.k) {
      case 'num': return lit(String(node.v));
      case 'str': return lit(node.v);
      case 'color': return lit(node.v);
      case 'neg': {
        if (node.arg.k === 'num') return lit('-' + node.arg.v);
        this.err(node, 'Scratch has no "make this negative" block.', 'Use a subtraction instead, for example (0 - score).', 'unary-minus');
        break;
      }
      case 'ref': {
        const rec = this.names[node.name];
        if (rec && rec.kind === 'param') {
          return blk(this.put(rec.type === 'boolean' ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
            { fields: { VALUE: [rec.name, null] }, parent: parentId }));
        }
        const r = this.resolve(node.name, node);
        if (r.kind === 'variable') return blk(this.put('data_variable', { fields: { VARIABLE: [r.name, r.id] }, parent: parentId }));
        if (r.kind === 'list') return blk(this.put('data_listcontents', { fields: { LIST: [r.name, r.id] }, parent: parentId }));
        this.err(node, `"${node.name}" is a message, which cannot be used as a value here.`, 'Messages can only go in broadcast(...) and whenIReceive(...).', 'broadcast-as-value');
        break;
      }
      case 'unary': {
        const opcode = PREFIX_OPCODE[node.op];
        const id = this.put(opcode, { parent: parentId });
        this.blocks[id].inputs[BLOCKS[opcode].args[0]] = this.buildBooleanInput(node.arg, id);
        return blk(id);
      }
      case 'binary': {
        const opcode = INFIX_OPCODE[node.op];
        if (!opcode) this.err(node, `Flipwarp has no block for "${node.op}".`, 'Check the operator against the Operators palette.', 'unknown-operator');
        const def = BLOCKS[opcode];
        const id = this.put(opcode, { parent: parentId });
        this.blocks[id].inputs[def.args[0]] = this.buildInput(node.left, opcode, def.args[0], id);
        this.blocks[id].inputs[def.args[1]] = this.buildInput(node.right, opcode, def.args[1], id);
        return blk(id);
      }
      case 'call': {
        if (this.procs.has(node.name)) {
          this.err(node, `"${node.name}" is a custom block, and custom blocks do not report a value.`,
            'Set a variable inside the custom block, then read that variable here.', 'proc-as-value');
        }
        const opcode = this.byName.get(node.name);
        if (!opcode) this.err(node, `There is no block called "${node.name}".`, 'Check the spelling against the palette.', 'unknown-block');
        const def = BLOCKS[opcode];
        if (def.kind !== 'reporter' && def.kind !== 'boolean') {
          this.err(node, `"${node.name}" is an action, so it cannot be used as a value.`, 'Put it on its own line ending in a semicolon.', 'statement-as-value');
        }
        const id = this.put(opcode, { parent: parentId });
        this.fillArgs(id, opcode, def, node);
        return blk(id);
      }
      default:
        this.err(node, 'Flipwarp does not understand this value.', 'Use a number, text in quotes, a variable name, or a block.');
    }
  }
}

function defaultValueFor(ptype) {
  return ptype === 10 || ptype === 9 ? '' : '';
}

// ------------------------------------------------------------------ entry

export function buildTarget(ast, target, ctx, style) {
  // ident -> the real Scratch variable/list/broadcast it points at
  const names = {};
  const findByName = (tables, name) => {
    for (const [id, v] of tables) if (v[0] === name) return id;
    return null;
  };
  const varTables = [...Object.entries(ctx.globals.variables), ...Object.entries(target.variables || {})];
  const listTables = [...Object.entries(ctx.globals.lists), ...Object.entries(target.lists || {})];
  const bcTables = Object.entries(ctx.broadcasts).map(([id, n]) => [id, [n]]);

  for (const d of ast.decls) {
    const table = d.kind === 'list' ? listTables : d.kind === 'broadcast' ? bcTables : varTables;
    let id = findByName(table, d.name);
    if (!id) id = `${d.kind}-${d.name.replace(/\s+/g, '-')}`; // a name the text introduced
    names[d.ident] = { id, name: d.name, kind: d.kind };
  }

  const b = new Builder(names, style);
  b.registerProcs(ast.scripts);
  const tops = [];
  for (const script of ast.scripts) {
    const head = b.buildScript(script.stmts, null);
    if (!head) continue;
    b.blocks[head].topLevel = true;
    b.blocks[head].x = script.at ? script.at.x : 0;
    b.blocks[head].y = script.at ? script.at.y : 0;
    b.blocks[head].parent = null;
    tops.push(head);
  }

  return { blocks: b.blocks, comments: buildComments(b, ast, target) };
}

// Scratch comments carry a size and a place on the canvas as well as their
// text, and none of that can be written in the text form without cluttering
// it. So a comment whose text is unchanged keeps the box it already had, and
// only genuinely new text gets a fresh one. Matching on the text rather than
// on position means moving a comment in the text does not move its box.
const COMMENT_DEFAULTS = { width: 200, height: 200, minimized: false };

function buildComments(b, ast, target) {
  const existing = Object.values(target.comments || {});
  const unclaimed = new Set(existing.map((_, i) => i));
  const claim = text => {
    for (const i of unclaimed) {
      if (existing[i].text === text) { unclaimed.delete(i); return existing[i]; }
    }
    return null;
  };

  const comments = {};
  let n = 0;
  const add = (text, blockId) => {
    const old = claim(text);
    const id = `fwc${(n++).toString(36)}`;
    comments[id] = {
      blockId: blockId || null,
      x: old ? old.x : 0,
      y: old ? old.y : 0,
      width: old ? old.width : COMMENT_DEFAULTS.width,
      height: old ? old.height : COMMENT_DEFAULTS.height,
      minimized: old ? !!old.minimized : COMMENT_DEFAULTS.minimized,
      text,
    };
    if (blockId && b.blocks[blockId]) b.blocks[blockId].comment = id;
  };

  for (const [blockId, text] of b.blockComments) add(text, blockId);
  for (const c of ast.comments || []) add(c.text, null);

  // A brand-new canvas comment with no box of its own would land on top of
  // whatever is at the origin, so loose ones without a place are stacked down
  // the left instead.
  let lowest = existing.reduce((y, c) => Math.max(y, (c.y || 0) + (c.height || 200)), 0);
  for (const c of Object.values(comments)) {
    if (c.blockId || c.x !== 0 || c.y !== 0) continue;
    c.y = lowest;
    lowest += (c.height || 200) + 20;
  }

  return comments;
}
