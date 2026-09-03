// A normalized view of a target's blocks, with block ids stripped out, so two
// projects can be compared for real sameness rather than for identical ids.
export function canonTarget(blocks, comments) {
  const byBlock = new Map();
  const loose = [];
  for (const c of Object.values(comments || {})) {
    if (c.blockId) byBlock.set(c.blockId, c.text);
    else loose.push(String(c.text));
  }
  const scripts = canonScripts(blocks, byBlock);
  // Canvas comments have no block to hang off, so they are compared as a
  // sorted list of their text — moving one does not count as a change to the
  // code, but editing one does.
  return loose.length ? { scripts, loose: loose.sort() } : scripts;
}

function canonScripts(blocks, byBlock) {
  const tops = Object.entries(blocks)
    .filter(([, b]) => b && b.topLevel && !b.shadow)
    .sort((a, b) => (a[1].y - b[1].y) || (a[1].x - b[1].x));
  return tops.map(([id, b]) => ({ x: Math.round(b.x), y: Math.round(b.y), stack: canonStack(id, blocks, byBlock) }));
}

function canonStack(id, blocks, byBlock) {
  const out = [];
  let cur = id;
  while (cur) {
    const b = blocks[cur];
    if (!b) break;
    out.push(canonBlock(cur, blocks, byBlock));
    cur = b.next;
  }
  return out;
}

function canonBlock(id, blocks, byBlock) {
  const b = blocks[id];
  const node = { op: b.opcode };
  // The comment travels with the block it is attached to, so a changed
  // comment counts as a change to that script rather than being invisible.
  if (byBlock && byBlock.has(id)) node.comment = byBlock.get(id);

  const fieldKeys = Object.keys(b.fields).sort();
  if (fieldKeys.length) {
    node.fields = {};
    // The id half of a field is a project-local identifier; the name is what
    // actually matters, so only the name is compared.
    for (const k of fieldKeys) node.fields[k] = b.fields[k][0];
  }

  // Custom-block argument ids are random internal names, exactly like block
  // ids, so arguments are compared by position rather than by their id text.
  const argIds = b.mutation && b.mutation.argumentids ? JSON.parse(b.mutation.argumentids) : null;
  if (argIds) {
    node.args = argIds.map(aid => (b.inputs[aid] ? canonInput(b.inputs[aid], blocks, aid, byBlock) : null));
    const others = Object.keys(b.inputs).filter(k => b.inputs[k] && !argIds.includes(k)).sort();
    if (others.length) {
      node.inputs = {};
      for (const k of others) node.inputs[k] = canonInput(b.inputs[k], blocks, k, byBlock);
    }
  } else {
    const inputKeys = Object.keys(b.inputs).filter(k => b.inputs[k]).sort();
    if (inputKeys.length) {
      node.inputs = {};
      for (const k of inputKeys) node.inputs[k] = canonInput(b.inputs[k], blocks, k, byBlock);
    }
  }

  if (b.mutation) {
    node.mut = {
      proccode: b.mutation.proccode,
      warp: String(b.mutation.warp),
      argnames: b.mutation.argumentnames ? JSON.parse(b.mutation.argumentnames) : undefined,
      argcount: b.mutation.argumentids ? JSON.parse(b.mutation.argumentids).length : undefined,
    };
  }
  return node;
}

// SUBSTACK and SUBSTACK2 hold a whole stack of blocks; every other input
// holds a single value block.
const STATEMENT_INPUTS = new Set(['SUBSTACK', 'SUBSTACK2']);

function canonInput(input, blocks, key, byBlock) {
  const val = input[1];
  if (typeof val === 'string') {
    if (!blocks[val]) return null;
    return STATEMENT_INPUTS.has(key) ?
      canonStack(val, blocks, byBlock) : canonBlock(val, blocks, byBlock);
  }
  if (Array.isArray(val)) {
    // [type, value] or [type, name, id] — the id is dropped.
    return { prim: val[0], v: val[1] };
  }
  return null;
}

export function sameTarget(a, b, aComments, bComments) {
  return JSON.stringify(canonTarget(a, aComments)) === JSON.stringify(canonTarget(b, bComments));
}
