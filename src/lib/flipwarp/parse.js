// Text -> a tree. Nothing Scratch-specific happens here; that is build.mjs.
import { tokenize } from './tokenize.js';
import { ParseError, hintFor } from './hints.js';
import { BY_NAME, BLOCKS } from './phrasebook.js';

const BIN_PREC = { '||': 1, '&&': 2, '==': 3, '<': 4, '>': 4, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 };

export function parse(text) {
  return new Parser(tokenize(text), text.split('\n')).program();
}

class Parser {
  constructor(tokens, lines) {
    this.toks = tokens; this.i = 0; this.lines = lines;
    // Comments with nothing under them belong to the canvas rather than to a
    // block, so they are collected here and hung on the target, not on a
    // statement.
    this.freeComments = [];
  }

  // Comment lines sit in front of whatever they are about. One with a
  // statement under it is that statement's comment; anything else is loose.
  takeComments() {
    let attached = null;
    while (this.at('comment')) {
      const tok = this.next();
      if (tok.attached && attached === null) attached = tok.v;
      else this.freeComments.push({ text: tok.v, line: tok.line });
    }
    return attached;
  }

  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  at(t, v) { const p = this.peek(); return p.t === t && (v === undefined || p.v === v); }

  fail(tok, message, fix, id) {
    const lineText = this.lines[tok.line - 1] || '';
    const h = hintFor(lineText);
    throw new ParseError({
      line: tok.line, column: tok.col, text: lineText,
      id: h?.id || id || 'unexpected',
      message: h?.message || message,
      fix: h?.fix || fix,
    });
  }

  expect(t, v, what) {
    if (!this.at(t, v)) {
      const tok = this.peek();
      this.fail(tok, `Expected ${what || `"${v}"`} here.`, 'Check for a missing bracket, comma or semicolon on this line.');
    }
    return this.next();
  }

  program() {
    const decls = [];
    const scripts = [];
    while (!this.at('eof')) {
      if (this.at('comment')) {
        // Between scripts there is nothing for a comment to attach to except
        // the script that follows, which script() picks up itself.
        if (this.peek().attached) { scripts.push(this.script()); continue; }
        this.takeComments();
        continue;
      }
      if (this.looksLikeDeclaration()) { decls.push(this.declaration()); continue; }
      scripts.push(this.script());
    }
    return { decls, scripts, comments: this.freeComments };
  }

  // "broadcast" is both a declaration keyword and a block name, so a line is
  // only a declaration when it reads like one: keyword, a name, then ; or as.
  looksLikeDeclaration() {
    let k = 0;
    if (this.at('ident', 'global')) k = 1;
    const kw = this.peek(k);
    if (kw.t !== 'ident' || !['variable', 'list', 'broadcast'].includes(kw.v)) return false;
    const name = this.peek(k + 1);
    if (name.t !== 'ident') return false;
    const after = this.peek(k + 2);
    return (after.t === 'punct' && after.v === ';') || (after.t === 'ident' && after.v === 'as');
  }

  declaration() {
    const start = this.peek();
    let isGlobal = false;
    if (this.at('ident', 'global')) { this.next(); isGlobal = true; }
    const kwTok = this.next();
    const kind = kwTok.v;
    if (!['variable', 'list', 'broadcast'].includes(kind)) {
      this.fail(kwTok, `"${kind}" is not something Flipwarp can declare.`, 'Declarations look like: variable score;  or  global list history as "my history";');
    }
    const ident = this.expect('ident', undefined, 'a name').v;
    let name = ident;
    if (this.at('ident', 'as')) { this.next(); name = this.expect('str', undefined, 'the real Scratch name in quotes').v; }
    this.expect('punct', ';', 'a semicolon');
    return { kind, ident, name, global: isGlobal, line: start.line };
  }

  script() {
    let at = null;
    if (this.at('punct', '@')) {
      this.next();
      const kw = this.expect('ident', undefined, 'at');
      if (kw.v !== 'at') this.fail(kw, `Flipwarp does not know "@${kw.v}".`, 'The only marker is @at(x, y), which says where a script sits on the canvas.');
      this.expect('punct', '(');
      const x = Number(this.expect('num', undefined, 'a number').v);
      this.expect('punct', ',');
      const y = Number(this.expect('num', undefined, 'a number').v);
      this.expect('punct', ')');
      at = { x, y };
    }
    // A script is everything up to the next @at marker (or the end).
    const stmts = [];
    do { stmts.push(this.statement()); }
    while (!this.at('eof') && !this.at('punct', '@') &&
      !(this.at('comment') && !this.peek().attached));
    return { at, stmts };
  }

  block() {
    this.expect('punct', '{');
    const out = [];
    while (!this.at('punct', '}')) {
      if (this.at('eof')) this.fail(this.peek(), 'This block never closes.', 'Add a } to close it.');
      // A comment as the last thing inside a body has no block under it, so
      // it goes to the canvas rather than being thrown away.
      if (this.at('comment') && !this.peek().attached) { this.takeComments(); continue; }
      out.push(this.statement());
    }
    this.next();
    return out;
  }

  statement() {
    const comment = this.takeComments();
    if (comment !== null) {
      const stmt = this.statement();
      stmt.comment = comment;
      return stmt;
    }
    const tok = this.peek();

    if (tok.t === 'ident' && tok.v === 'define') return this.defineStatement();
    if (tok.t === 'ident' && tok.v === 'if') return this.ifStatement();

    if (tok.t !== 'ident') {
      this.fail(tok, 'Flipwarp expected a block here.', 'Every line starts with a block name, if, or define.');
    }

    // assignment:  score = 1;   score += 1;
    if (this.peek(1).t === 'op' && (this.peek(1).v === '=' || this.peek(1).v === '+=')) {
      const ident = this.next().v;
      const op = this.next().v;
      const value = this.expression();
      this.expect('punct', ';', 'a semicolon');
      return { k: 'assign', ident, op, value, line: tok.line };
    }

    const name = this.next().v;

    // A bare word followed by a body:  forever { ... }
    if (this.at('punct', '{')) {
      const body = this.block();
      return { k: 'call', name, args: [], bodies: [body], line: tok.line };
    }

    let args = [];
    if (this.at('punct', '(')) args = this.argList();

    if (this.at('punct', '{')) {
      const body = this.block();
      return { k: 'call', name, args, bodies: [body], line: tok.line };
    }

    this.expect('punct', ';', 'a semicolon');
    return { k: 'call', name, args, bodies: null, line: tok.line };
  }

  ifStatement() {
    const tok = this.next();
    this.expect('punct', '(');
    const cond = this.expression();
    this.expect('punct', ')');
    const body = this.block();
    let elseBody = null;
    if (this.at('ident', 'else')) {
      const elseTok = this.next();
      if (this.at('ident', 'if')) {
        this.fail(elseTok, 'Scratch has no "else if" block.',
          'Put a whole new if inside the else, the way the blocks nest: } else { if (...) { ... } }', 'else-if');
      }
      elseBody = this.block();
    }
    return { k: 'if', cond, body, elseBody, line: tok.line };
  }

  defineStatement() {
    const tok = this.next();
    let warp = false;
    if (this.at('ident', 'fast')) { this.next(); warp = true; }
    const ident = this.expect('ident', undefined, 'a name for the custom block').v;
    this.expect('punct', '(');
    const params = [];
    while (!this.at('punct', ')')) {
      const slug = this.expect('ident', undefined, 'a parameter name').v;
      let real = slug;
      if (this.at('ident', 'as')) { this.next(); real = this.expect('str', undefined, 'the real name in quotes').v; }
      params.push({ slug, real });
      if (this.at('punct', ',')) this.next();
    }
    this.next();
    let proccode = null;
    if (this.at('ident', 'as')) { this.next(); proccode = this.expect('str', undefined, 'the block label in quotes').v; }
    const body = this.block();
    return { k: 'define', ident, params, proccode, warp, body, line: tok.line };
  }

  argList() {
    this.expect('punct', '(');
    const args = [];
    while (!this.at('punct', ')')) {
      args.push(this.expression());
      if (this.at('punct', ',')) { this.next(); continue; }
      if (!this.at('punct', ')')) this.fail(this.peek(), 'Expected a comma or a closing bracket here.', 'Separate the things inside the brackets with commas.');
    }
    this.next();
    return args;
  }

  // ------------------------------------------------------------ expressions

  expression(minPrec = 0) {
    let left = this.unary();
    for (;;) {
      const p = this.peek();
      if (p.t !== 'op' || !(p.v in BIN_PREC)) break;
      const prec = BIN_PREC[p.v];
      if (prec < minPrec) break;
      this.next();
      const right = this.expression(prec + 1);
      left = { k: 'binary', op: p.v, left, right, line: p.line };
    }
    return left;
  }

  unary() {
    if (this.at('op', '!')) { const t = this.next(); return { k: 'unary', op: '!', arg: this.unary(), line: t.line }; }
    if (this.at('op', '-')) { const t = this.next(); return { k: 'neg', arg: this.unary(), line: t.line }; }
    return this.primary();
  }

  primary() {
    const tok = this.peek();

    if (this.at('punct', '(')) { this.next(); const e = this.expression(); this.expect('punct', ')'); return e; }
    if (tok.t === 'num') { this.next(); return { k: 'num', v: tok.v, line: tok.line }; }
    if (tok.t === 'str') { this.next(); return { k: 'str', v: tok.v, line: tok.line }; }
    if (tok.t === 'color') { this.next(); return { k: 'color', v: tok.v, line: tok.line }; }

    if (tok.t === 'ident') {
      this.next();
      if (this.at('punct', '(')) return { k: 'call', name: tok.v, args: this.argList(), line: tok.line };
      return { k: 'ref', name: tok.v, line: tok.line };
    }

    this.fail(tok, 'Flipwarp expected a value here.', 'A value is a number, some text in quotes, a variable name, or a block like answer().');
  }
}
