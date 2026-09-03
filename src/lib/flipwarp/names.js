// Scratch names are free-form ("my score", "high-score!!"). Text needs
// identifiers. This builds a stable, collision-free two-way mapping and
// emits declarations so the real names are never lost.

const KEYWORDS = new Set(['if', 'else', 'while', 'repeat', 'forever', 'define',
  'true', 'false', 'variable', 'list', 'broadcast', 'global', 'null', 'undefined',
  'return', 'function', 'var', 'let', 'const', 'for', 'do', 'switch', 'case', 'new']);

export function slugify(name) {
  let s = String(name)
    .replace(/[^A-Za-z0-9_ ]+/g, ' ')
    .trim()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)))
    .join('');
  if (!s || /^[0-9]/.test(s)) s = '_' + s;
  return s;
}

// Assign unique identifiers within one namespace.
export class NameTable {
  constructor(reserved = new Set()) {
    this.reserved = reserved;
    this.byId = new Map();    // scratch id -> { ident, name, kind, global }
    this.byIdent = new Map(); // ident -> scratch id
  }

  add(id, name, kind, isGlobal = false) {
    if (this.byId.has(id)) return this.byId.get(id).ident;
    let base = slugify(name);
    if (this.reserved.has(base) || KEYWORDS.has(base)) base = base + '_';
    let ident = base;
    let n = 2;
    while (this.byIdent.has(ident)) ident = base + n++;
    const rec = { ident, name, kind, global: isGlobal, id };
    this.byId.set(id, rec);
    this.byIdent.set(ident, id);
    return ident;
  }

  identFor(id) { return this.byId.get(id)?.ident; }
  recordFor(id) { return this.byId.get(id); }
  idForIdent(ident) { return this.byIdent.get(ident); }
  all() { return [...this.byId.values()]; }
}

export function quote(s) {
  return JSON.stringify(String(s));
}

// Declaration line for one name, e.g.  variable score;
//                                      global list inventory as "my inventory";
export function declLine(rec) {
  const kw = rec.kind === 'list' ? 'list' : rec.kind === 'broadcast' ? 'broadcast' : 'variable';
  const scope = rec.global ? 'global ' : '';
  const alias = rec.ident !== rec.name ? ` as ${quote(rec.name)}` : '';
  return `${scope}${kw} ${rec.ident}${alias};`;
}
