// Blocks -> text. One text document per target (sprite or stage).
import { BLOCKS, MENU_BLOCKS, LITERAL_SHADOWS, GETTERS, RESERVED } from './phrasebook.js';
import { NameTable, quote, declLine } from './names.js';
import { getStyle } from './styles.js';

// The default indent. The real one comes from the style options, because in an
// indentation-based style the indent is not decoration — it is what says where
// a body begins and ends.
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

export function targetToText(target, ctx, options = {}) {
  const st = getStyle(options.style);
  const ind = typeof options.indent === 'string' ? options.indent : IND;
  const blocks = target.blocks;
  const allComments = Object.values(target.comments || {});
  const byBlock = new Map();
  for (const c of allComments) if (c.blockId) byBlock.set(c.blockId, c.text);
  const names = new NameTable(RESERVED, st);
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
  for (const r of decls) out.push(declLine(r, st));
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
    out.push(...scriptToText(id, blocks, names, 0, ctx, byBlock, st, ind));
    out.push('');
  }

  return { text: out.join('\n').replace(/\n+$/, '\n'), names };
}

function usedIn() { return true; } // declare everything; simplest and lossless

// -------------------------------------------------------------- statements

function scriptToText(startId, blocks, names, depth, ctx, byBlock, st, ind) {
  const lines = [];
  let id = startId;
  while (id) {
    const block = blocks[id];
    if (!block) break;
    if (byBlock && byBlock.has(id)) lines.push(...commentLines(byBlock.get(id), ind.repeat(depth)));
    const res = blockToLines(id, block, blocks, names, depth, ctx, byBlock, st, ind);
    lines.push(...res.lines);
    if (res.consumedNext) break;
    id = block.next;
  }
  return lines;
}

function blockToLines(id, block, blocks, names, depth, ctx, byBlock, st, ind) {
  const pad = ind.repeat(depth);
  const op = block.opcode;

  if (op === 'procedures_definition') {
    const protoId = inputBlockId(block.inputs.custom_block);
    const proto = blocks[protoId];
    const { ident, params } = procSignature(proto, names, st);
    const body = block.next ? scriptToText(block.next, blocks, names, depth + 1, ctx, byBlock, st, ind) : [];
    const warp = proto.mutation.warp === 'true' || proto.mutation.warp === true;
    // The `as` clause carries the block's real Scratch label, which the
    // identifier alone can't express (word order, where each slot sits).
    const label = ` as ${quote(proto.mutation.proccode)}`;
    return { consumedNext: true, lines: closed(
      `${pad}${st.defineWord} ${warp ? 'fast ' : ''}${ident}(${params.join(', ')})${label}`,
      body, pad, st
    ) };
  }

  if (op === 'procedures_call') {
    const { ident, argIdents } = callSignature(block, names, st);
    const argOrder = JSON.parse(block.mutation.argumentids || '[]');
    const args = argOrder.map(aid => exprToText(block.inputs[aid], blocks, names, 0, ctx, undefined, st));
    return { lines: [`${pad}${ident}(${args.join(', ')})${st.terminator}`] };
  }

  const def = BLOCKS[op];
  if (!def) throw new ConversionError(unknownBlockMessage(op), { opcode: op });

  // if / if-else get real JavaScript shape
  if (def.syntax === 'if' || def.syntax === 'ifElse') {
    const cond = exprToText(block.inputs.CONDITION, blocks, names, 0, ctx, 'boolean', st);
    const a = substackLines(block.inputs.SUBSTACK, blocks, names, depth + 1, ctx, byBlock, st, ind);
    const lines = [`${pad}${st.ifHead(cond)}${st.openBody}`, ...a];
    if (def.syntax === 'ifElse') {
      const b = substackLines(block.inputs.SUBSTACK2, blocks, names, depth + 1, ctx, byBlock, st, ind);
      lines.push(st.elseLine(pad, st.closeBody, st.openBody), ...b);
    }
    if (st.closeBody) lines.push(`${pad}${st.closeBody}`);
    return { lines };
  }

  // variable assignment gets real JavaScript shape
  if (def.syntax === 'assign' || def.syntax === 'assignAdd') {
    const ident = names.identFor(block.fields.VARIABLE[1]) ?? names.add(block.fields.VARIABLE[1], block.fields.VARIABLE[0], 'variable');
    const val = exprToText(block.inputs.VALUE, blocks, names, 0, ctx, undefined, st);
    return { lines: [`${pad}${ident} ${def.syntax === 'assign' ? '=' : '+='} ${val}${st.terminator}`] };
  }

  const args = def.args
    .filter(a => !(def.substack || []).includes(a))
    .map(a => argToText(a, def, block, blocks, names, ctx, st));

  const spelled = st.blockName(def.name);

  if (def.substack && def.substack.length) {
    const head = args.length ? `${spelled}(${args.join(', ')})` : spelled;
    const body = substackLines(block.inputs[def.substack[0]], blocks, names, depth + 1, ctx, byBlock, st, ind);
    return { lines: closed(`${pad}${head}`, body, pad, st) };
  }

  if (def.kind === 'hat') {
    const head = args.length ? `${spelled}(${args.join(', ')})` : spelled;
    const body = block.next ? scriptToText(block.next, blocks, names, depth + 1, ctx, byBlock, st, ind) : [];
    return { consumedNext: true, lines: closed(`${pad}${head}`, body, pad, st) };
  }

  return { lines: [`${pad}${spelled}(${args.join(', ')})${st.terminator}`] };
}

// A header, its body, and the closing line if the style has one. An
// indentation-based style closes a body by going back out again, so there is
// no line to write.
function closed(head, body, pad, st) {
  const lines = [`${head}${st.openBody}`, ...body];
  if (st.closeBody) lines.push(`${pad}${st.closeBody}`);
  return lines;
}

function substackLines(input, blocks, names, depth, ctx, byBlock, st, ind) {
  if (!input) return [];
  const id = inputBlockId(input);
  return id ? scriptToText(id, blocks, names, depth, ctx, byBlock, st, ind) : [];
}

function inputBlockId(input) {
  if (!input) return null;
  const v = input[1];
  return typeof v === 'string' ? v : null;
}

// ------------------------------------------------------------- expressions

function argToText(argName, def, block, blocks, names, ctx, st) {
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
  return exprToText(block.inputs[argName], blocks, names, 0, ctx, undefined, st);
}

function exprToText(input, blocks, names, prec, ctx, want, st) {
  const style = getStyle(st);
  if (!input) return want === 'boolean' ? style.falseWord : '""';

  const kind = input[0];
  const val = input[1];

  // A block sits in the slot.
  if (typeof val === 'string') {
    return blockExprToText(val, blocks, names, prec, ctx, style);
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

function blockExprToText(id, blocks, names, prec, ctx, st) {
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
    return slugParam(block.fields.VALUE[0], st);
  }

  if (op === 'procedures_call') {
    const { ident } = callSignature(block, names, st);
    const argOrder = JSON.parse(block.mutation.argumentids || '[]');
    const args = argOrder.map(aid => exprToText(block.inputs[aid], blocks, names, 0, ctx, undefined, st));
    return `${ident}(${args.join(', ')})`;
  }

  const def = BLOCKS[op];
  if (!def) throw new ConversionError(unknownBlockMessage(op), { opcode: op });

  if (def.infix) {
    const l = exprToText(block.inputs[def.args[0]], blocks, names, def.prec, ctx, undefined, st);
    const r = exprToText(block.inputs[def.args[1]], blocks, names, def.prec + 1, ctx, undefined, st);
    const s = `${l} ${spellOperator(def.infix, st)} ${r}`;
    return def.prec < prec ? `(${s})` : s;
  }
  if (def.prefix) {
    const a = exprToText(block.inputs[def.args[0]], blocks, names, def.prec, ctx, 'boolean', st);
    return `${spellOperator(def.prefix, st)}${a}`;
  }

  const args = def.args.map(a => argToText(a, def, block, blocks, names, ctx, st));
  return `${st.blockName(def.name)}(${args.join(', ')})`;
}

// && || ! are the phrasebook's spelling. A style may write them as words.
function spellOperator(op, st) {
  if (op === '&&') return st.andWord;
  if (op === '||') return st.orWord;
  if (op === '!') return st.notWord;
  return op;
}

// -------------------------------------------------------------- procedures

export function slugParam(name, st) {
  return getStyle(st).slug(name);
}

export function procIdentFromProccode(proccode, st) {
  const style = getStyle(st);
  const label = proccode.replace(/%[sbn]/g, ' ').trim();
  return slugParam(label, style) || style.slug('custom block');
}

function procSignature(proto, names, st) {
  const proccode = proto.mutation.proccode;
  const argNames = JSON.parse(proto.mutation.argumentnames || '[]');
  const params = argNames.map(n => {
    const slug = slugParam(n, st);
    return slug === n ? slug : `${slug} as ${quote(n)}`;
  });
  return { ident: procIdentFromProccode(proccode, st), params, proccode };
}

function callSignature(block, names, st) {
  const proccode = block.mutation.proccode;
  return { ident: procIdentFromProccode(proccode, st), proccode };
}
