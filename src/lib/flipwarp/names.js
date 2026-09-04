// Scratch names are free-form ("my score", "high-score!!"). Text needs
// identifiers. This builds a stable, collision-free two-way mapping and
// emits declarations so the real names are never lost.

import {getStyle, STYLE_KEYWORDS} from './styles.js';

const KEYWORDS = STYLE_KEYWORDS;

export function slugify(name, style) {
  return getStyle(style).slug(name);
}

// Assign unique identifiers within one namespace.
export class NameTable {
  constructor(reserved = new Set(), style) {
    this.reserved = reserved;
    this.style = getStyle(style);
    this.byId = new Map();    // scratch id -> { ident, name, kind, global }
    this.byIdent = new Map(); // ident -> scratch id
  }

  add(id, name, kind, isGlobal = false) {
    if (this.byId.has(id)) return this.byId.get(id).ident;
    let base = this.style.slug(name);
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
//
// The terminator is the style's, and in an indentation-based style there is
// none — the end of the line is what ends the declaration.
export function declLine(rec, style) {
  const kw = rec.kind === 'list' ? 'list' : rec.kind === 'broadcast' ? 'broadcast' : 'variable';
  const scope = rec.global ? 'global ' : '';
  const alias = rec.ident !== rec.name ? ` as ${quote(rec.name)}` : '';
  return `${scope}${kw} ${rec.ident}${alias}${getStyle(style).terminator}`;
}
