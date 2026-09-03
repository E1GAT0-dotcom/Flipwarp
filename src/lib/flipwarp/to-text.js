// Blocks -> text. One text document per target (sprite or stage).
import { BLOCKS, MENU_BLOCKS, LITERAL_SHADOWS, GETTERS, RESERVED } from './phrasebook.js';
import { NameTable, quote, declLine } from './names.js';

const IND = '  ';

export class ConversionError extends Error {
  constructor(msg, detail) { super(msg); this.detail = detail; }
}

// Anything not in the phrasebook is almost always a block from an extension
// loaded from a URL. Say which sprite is holding it up and what to do, rather
// than printing an opcode nobody recognises.
function unknownBlockMessage(opcode) {
  const extension = opcode.includes('_') ? opcode.slice(0, opcode.indexOf('_')) : opcode;
  return `This sprite uses a block from the "${extension}" extension, which Flipwarp cannot show as text yet. ` +
    'Its blocks still work — only the text view is missing. Remove that block from this sprite, or edit this ' +
    'sprite in blocks.';
}

// ---------------------------------------------------------------- helpers

function isShadowLiteral(block) { return LITERAL_SHADOWS.has(block.opcode); }

function literalFieldValue(block) {
  const key = Object.keys(block.fields)[0];
  return block.fields[key][0];
}

// A primitive input array, e.g. [4, "10"] or [10, "hello"] or [12, "score", "id"]
function primitiveToNode(prim) {
  const [type, a, b] = prim;
  switch (type) {
    case 4: case 5: case 6: case 7: case 8: return { t: 'num', v: a, prim: type };
    case 9: return { t: 'color', v: a };
    case 10: return { t: 'str', v: a };
    case 11: return { t: 'broadcast', name: a, id: b };
    case 12: return { t: 'varref', name: a, id: b };
    case 13: return { t: 'listref', name: a, id: b };
    default: return { t: 'str', v: String(a) };
  }
}

// A comment's text, written as # lines at the given indent. A Scratch
// comment can hold several lines, and each becomes its own # line.
function commentLines(text, pad) {
  return String(text).split('\n').map(line => (line === '' ? `${pad}#` : `${pad}# ${line}`));
}

export function targetToText(target, ctx) {
  const blocks = target.blocks;
  const allComments = Object.values(target.comments || {});
  const byBlock = new Map();
  for (const c of allComments) if (c.blockId) byBlock.set(c.blockId, c.text);
  const names = new NameTable(RESERVED);
  const procs = new Map(); // proccode -> {ident, args}

  // Register this target's own variables and lists, plus the stage's globals.
  for (const [id, v] of Object.entries(ctx.globals.variables)) names.add(id, v[0], 'variable', true);
  for (const [id, v] of Object.entries(ctx.globals.lists)) names.add(id, v[0], 'list', true);
  if (!target.isStage) {
    for (const [id, v] of Object.entries(target.variables || {})) names.add(id, v[0], 'variable', false);
    for (const [id, v] of Object.entries(target.lists || {})) names.add(id, v[0], 'list', false);
  }
  for (const [id, name] of Object.entries(ctx.broadcasts)) names.add(id, name, 'broadcast', true);

  const out = [];
  const decls = names.all().filter(r => usedIn(target, ctx, r));
  for (const r of decls) out.push(declLine(r));
  if (decls.length) out.push('');

  // Comments that sit on the canvas rather than on a block go first, each
  // followed by a blank line — which is exactly what marks them as loose when
  // the text is read back.
  const loose = allComments
    .filter(c => !c.blockId)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x) || String(a.text).localeCompare(String(b.text)));
  for (const c of loose) {
    out.push(...commentLines(c.text, ''));
    out.push('');
  }

  // Top-level scripts, in a stable order so the round trip is deterministic.
  const tops = Object.entries(blocks)
    .filter(([, b]) => b && typeof b === 'object' && b.topLevel && !b.shadow)
    .sort((a, b) => (a[1].y - b[1].y) || (a[1].x - b[1].x) || a[0].localeCompare(b[0]));

  for (const [id, block] of tops) {
    out.push(`@at(${Math.round(block.x)}, ${Math.round(block.y)})`);
    out.push(...scriptToText(id, blocks, names, 0, ctx, byBlock));
    out.push('');
  }

  return { text: out.join('\n').replace(/\n+$/, '\n'), names };
}

function usedIn() { return true; } // declare everything; simplest and lossless

// -------------------------------------------------------------- statements

function scriptToText(startId, blocks, names, depth, ctx, byBlock) {
  const lines = [];
  let id = startId;
  while (id) {
    const block = blocks[id];
    if (!block) break;
    if (byBlock && byBlock.has(id)) lines.push(...commentLines(byBlock.get(id), IND.repeat(depth)));
    const res = blockToLines(id, block, blocks, names, depth, ctx, byBlock);
    lines.push(...res.lines);
    if (res.consumedNext) break;
    id = block.next;
  }
  return lines;
}

function blockToLines(id, block, blocks, names, depth, ctx, byBlock) {
  const pad = IND.repeat(depth);
  const op = block.opcode;

  if (op === 'procedures_definition') {
    const protoId = inputBlockId(block.inputs.custom_block);
    const proto = blocks[protoId];
    const { ident, params } = procSignature(proto, names);
    const body = block.next ? scriptToText(block.next, blocks, names, depth + 1, ctx, byBlock) : [];
    const warp = proto.mutation.warp === 'true' || proto.mutation.warp === true;
    // The `as` clause carries the block's real Scratch label, which the
    // identifier alone can't express (word order, where each slot sits).
    const label = ` as ${quote(proto.mutation.proccode)}`;
    return { consumedNext: true, lines: [
      `${pad}define ${warp ? 'fast ' : ''}${ident}(${params.join(', ')})${label} {`,
      ...body,
      `${pad}}`,
    ] };
  }

  if (op === 'procedures_call') {
    const { ident, argIdents } = callSignature(block, names);
    const argOrder = JSON.parse(block.mutation.argumentids || '[]');
    const args = argOrder.map(aid => exprToText(block.inputs[aid], blocks, names, 0, ctx));
    return { lines: [`${pad}${ident}(${args.join(', ')});`] };
  }

  const def = BLOCKS[op];
  if (!def) throw new ConversionError(unknownBlockMessage(op), { opcode: op });

  // if / if-else get real JavaScript shape
  if (def.syntax === 'if' || def.syntax === 'ifElse') {
    const cond = exprToText(block.inputs.CONDITION, blocks, names, 0, ctx, 'boolean');
    const a = substackLines(block.inputs.SUBSTACK, blocks, names, depth + 1, ctx, byBlock);
    const lines = [`${pad}if (${cond}) {`, ...a];
    if (def.syntax === 'ifElse') {
      const b = substackLines(block.inputs.SUBSTACK2, blocks, names, depth + 1, ctx, byBlock);
      lines.push(`${pad}} else {`, ...b);
    }
    lines.push(`${pad}}`);
    return { lines };
  }

  // variable assignment gets real JavaScript shape
  if (def.syntax === 'assign' || def.syntax === 'assignAdd') {
    const ident = names.identFor(block.fields.VARIABLE[1]) ?? names.add(block.fields.VARIABLE[1], block.fields.VARIABLE[0], 'variable');
    const val = exprToText(block.inputs.VALUE, blocks, names, 0, ctx);
    return { lines: [`${pad}${ident} ${def.syntax === 'assign' ? '=' : '+='} ${val};`] };
  }

  const args = def.args
    .filter(a => !(def.substack || []).includes(a))
    .map(a => argToText(a, def, block, blocks, names, ctx));

  if (def.substack && def.substack.length) {
    const head = args.length ? `${def.name}(${args.join(', ')})` : def.name;
    const body = substackLines(block.inputs[def.substack[0]], blocks, names, depth + 1, ctx, byBlock);
    return { lines: [`${pad}${head} {`, ...body, `${pad}}`] };
  }

  if (def.kind === 'hat') {
    const head = args.length ? `${def.name}(${args.join(', ')})` : def.name;
    const body = block.next ? scriptToText(block.next, blocks, names, depth + 1, ctx, byBlock) : [];
    return { consumedNext: true, lines: [`${pad}${head} {`, ...body, `${pad}}`] };
  }

  return { lines: [`${pad}${def.name}(${args.join(', ')});`] };
}

function substackLines(input, blocks, names, depth, ctx, byBlock) {
  if (!input) return [];
  const id = inputBlockId(input);
  return id ? scriptToText(id, blocks, names, depth, ctx, byBlock) : [];
}

function inputBlockId(input) {
  if (!input) return null;
  const v = input[1];
  return typeof v === 'string' ? v : null;
}

// ------------------------------------------------------------- expressions

function argToText(argName, def, block, blocks, names, ctx) {
  if ((def.fields || []).includes(argName)) {
    const f = block.fields[argName];
    if (!f) throw new ConversionError(`Block "${block.opcode}" is missing field ${argName}`);
    // Variable and list fields are written as their identifier, not a string.
    if (argName === 'VARIABLE' || argName === 'LIST') {
      return names.identFor(f[1]) ?? names.add(f[1], f[0], argName === 'LIST' ? 'list' : 'variable');
    }
    if (argName === 'BROADCAST_OPTION') {
      return names.identFor(f[1]) ?? names.add(f[1], f[0], 'broadcast', true);
    }
    return quote(f[0]);
  }
  return exprToText(block.inputs[argName], blocks, names, 0, ctx);
}

function exprToText(input, blocks, names, prec, ctx, want) {
  if (!input) return want === 'boolean' ? 'false' : '""';

  const kind = input[0];
  const val = input[1];

  // A block sits in the slot.
  if (typeof val === 'string') {
    return blockExprToText(val, blocks, names, prec, ctx);
  }
  // A primitive sits in the slot.
  if (Array.isArray(val)) {
    const node = primitiveToNode(val);
    return nodeToText(node, names);
  }
  return '""';
}

// A slot's primitive type comes from the block, not from how the value is
// written, so a plain-looking number can be written bare and still come back
// as exactly the same primitive. Anything not in canonical number form is
// quoted, so nothing is reinterpreted on the way back.
const CANONICAL_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
export function valueToText(v) {
  const s = String(v);
  return CANONICAL_NUMBER.test(s) ? s : quote(s);
}

function nodeToText(node, names) {
  switch (node.t) {
    case 'num': return valueToText(node.v);
    case 'str': return valueToText(node.v);
    case 'color': return quote(node.v);
    case 'broadcast':
    case 'varref':
    case 'listref':
      return names.identFor(node.id) ?? quote(node.name);
    default: return '""';
  }
}

function blockExprToText(id, blocks, names, prec, ctx) {
  const block = blocks[id];
  if (!block) return '""';
  const op = block.opcode;

  if (isShadowLiteral(block)) {
    return valueToText(literalFieldValue(block));
  }

  if (MENU_BLOCKS.has(op)) {
    const key = Object.keys(block.fields)[0];
    const f = block.fields[key];
    if (key === 'BROADCAST_OPTION') return names.identFor(f[1]) ?? quote(f[0]);
    return quote(f[0]);
  }

  if (GETTERS[op]) {
    const f = block.fields[GETTERS[op]];
    return names.identFor(f[1]) ?? quote(f[0]);
  }

  if (op === 'argument_reporter_string_number' || op === 'argument_reporter_boolean') {
    return slugParam(block.fields.VALUE[0]);
  }

  if (op === 'procedures_call') {
    const { ident } = callSignature(block, names);
    const argOrder = JSON.parse(block.mutation.argumentids || '[]');
    const args = argOrder.map(aid => exprToText(block.inputs[aid], blocks, names, 0, ctx));
    return `${ident}(${args.join(', ')})`;
  }

  const def = BLOCKS[op];
  if (!def) throw new ConversionError(unknownBlockMessage(op), { opcode: op });

  if (def.infix) {
    const l = exprToText(block.inputs[def.args[0]], blocks, names, def.prec, ctx);
    const r = exprToText(block.inputs[def.args[1]], blocks, names, def.prec + 1, ctx);
    const s = `${l} ${def.infix} ${r}`;
    return def.prec < prec ? `(${s})` : s;
  }
  if (def.prefix) {
    const a = exprToText(block.inputs[def.args[0]], blocks, names, def.prec, ctx, 'boolean');
    return `${def.prefix}${a}`;
  }

  const args = def.args.map(a => argToText(a, def, block, blocks, names, ctx));
  return `${def.name}(${args.join(', ')})`;
}

// -------------------------------------------------------------- procedures

export function slugParam(name) {
  let s = String(name).replace(/[^A-Za-z0-9_ ]+/g, ' ').trim().split(/\s+/)
    .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1))).join('');
  if (!s || /^[0-9]/.test(s)) s = '_' + s;
  return s;
}

export function procIdentFromProccode(proccode) {
  const label = proccode.replace(/%[sbn]/g, ' ').trim();
  return slugParam(label) || 'customBlock';
}

function procSignature(proto, names) {
  const proccode = proto.mutation.proccode;
  const argNames = JSON.parse(proto.mutation.argumentnames || '[]');
  const params = argNames.map(n => {
    const slug = slugParam(n);
    return slug === n ? slug : `${slug} as ${quote(n)}`;
  });
  return { ident: procIdentFromProccode(proccode), params, proccode };
}

function callSignature(block, names) {
  const proccode = block.mutation.proccode;
  return { ident: procIdentFromProccode(proccode), proccode };
}
