// A small Python reader for importing Flipwarp's Python export (main.py) after
// it was edited. It reads the part of Python the export writes, and the usual
// things a person adds to it, into the same tree shape acorn gives for
// JavaScript (with "PyFor" and "PyDef" for Python's for and def), so one
// decompiler reads both.

export class PythonSyntaxError extends Error {}

const KEYWORDS = new Set(['and', 'or', 'not', 'if', 'elif', 'else', 'while', 'for', 'in', 'def', 'return', 'pass',
    'break', 'continue', 'True', 'False', 'None', 'lambda', 'yield', 'from', 'is', 'global', 'nonlocal']);

const tokenize = text => {
    const lines = String(text).replace(/\r\n?/g, '\n')
        .split('\n');
    const tokens = [];
    const indents = [0];
    let depth = 0; // brackets open: line breaks inside them do not count
    let lineNo = 0;
    const push = (type, value, line) => tokens.push({type, value, line});
    let pending = '';
    for (let n = 0; n < lines.length; n++) {
        lineNo = n + 1;
        let line = lines[n];
        if (pending) {
            line = pending + line;
            pending = '';
        }
        if (depth === 0) {
            const blank = /^\s*(#.*)?$/.test(line);
            if (blank) continue;
            const width = /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length;
            if (width > indents[indents.length - 1]) {
                indents.push(width);
                push('INDENT', null, lineNo);
            }
            while (width < indents[indents.length - 1]) {
                indents.pop();
                push('DEDENT', null, lineNo);
            }
        }
        let i = 0;
        while (i < line.length) {
            const c = line[i];
            if (c === ' ' || c === '\t') {
                i++;
                continue;
            }
            if (c === '#') break;
            if (c === '\\' && i === line.length - 1) {
                i++;
                continue;
            }
            const rest = line.slice(i);
            let m = /^(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?/.exec(rest);
            if (m && !/^[A-Za-z_]/.test(rest.slice(m[0].length))) {
                push('num', Number(m[0]), lineNo);
                i += m[0].length;
                continue;
            }
            m = /^([rRbBuU]?)('''|"""|'|")/.exec(rest);
            if (m) {
                const raw = m[1].toLowerCase() === 'r';
                const quote = m[2];
                let j = i + m[0].length;
                let out = '';
                let text = line;
                for (;;) {
                    if (j >= text.length) {
                        if (quote.length === 3 && n + 1 < lines.length) {
                            n++;
                            out += '\n';
                            text = lines[n];
                            line = text;
                            j = 0;
                            continue;
                        }
                        throw new PythonSyntaxError(`a string that never ends (line ${lineNo})`);
                    }
                    if (text.startsWith(quote, j)) {
                        j += quote.length;
                        break;
                    }
                    const ch = text[j];
                    if (ch === '\\' && !raw) {
                        const e = text[j + 1];
                        const map = {n: '\n', t: '\t', r: '\r', '\\': '\\', '\'': '\'', '"': '"', 0: '\0'};
                        if (e in map) {
                            out += map[e];
                            j += 2;
                            continue;
                        }
                        if (e === 'u' || e === 'x') {
                            const len = e === 'u' ? 4 : 2;
                            out += String.fromCharCode(parseInt(text.substr(j + 2, len), 16));
                            j += 2 + len;
                            continue;
                        }
                        out += ch;
                        j++;
                        continue;
                    }
                    out += ch;
                    j++;
                }
                push('str', out, lineNo);
                i = j;
                continue;
            }
            if (/^[fF]['"]/.test(rest)) throw new PythonSyntaxError(`f-strings have no block (line ${lineNo})`);
            m = /^[A-Za-z_]\w*/.exec(rest);
            if (m) {
                push(KEYWORDS.has(m[0]) ? 'kw' : 'name', m[0], lineNo);
                i += m[0].length;
                continue;
            }
            m = /^(\*\*=|\/\/=|\*\*|\/\/|==|!=|<=|>=|\+=|-=|\*=|\/=|%=|->|[-+*/%<>=()[\]{},:.@~|&^])/.exec(rest);
            if (m) {
                const op = m[0];
                if ('([{'.includes(op)) depth++;
                if (')]}'.includes(op)) depth = Math.max(0, depth - 1);
                push('op', op, lineNo);
                i += op.length;
                continue;
            }
            throw new PythonSyntaxError(`"${c}" is not Python (line ${lineNo})`);
        }
        if (depth === 0) push('NEWLINE', null, lineNo);
    }
    while (indents.length > 1) {
        indents.pop();
        push('DEDENT', null, lineNo);
    }
    push('EOF', null, lineNo);
    return tokens;
};

class Parser {
    constructor (tokens) {
        this.t = tokens;
        this.i = 0;
    }
    peek (k = 0) {
        return this.t[this.i + k];
    }
    next () {
        return this.t[this.i++];
    }
    is (type, value) {
        const tok = this.peek();
        return tok.type === type && (value === undefined || tok.value === value);
    }
    eat (type, value) {
        if (this.is(type, value)) return this.next();
        return null;
    }
    expect (type, value) {
        const tok = this.eat(type, value);
        if (!tok) {
            const at = this.peek();
            throw new PythonSyntaxError(`expected ${value || type} but found ${at.value || at.type} (line ${at.line})`);
        }
        return tok;
    }
    loc (tok) {
        return {start: {line: tok.line}};
    }

    // --- statements ---
    module () {
        const body = [];
        while (!this.is('EOF')) {
            if (this.eat('NEWLINE')) continue;
            body.push(...this.statement());
        }
        return {type: 'Program', body};
    }
    block () {
        if (!this.is('NEWLINE')) return this.simpleLine();
        this.expect('NEWLINE');
        this.expect('INDENT');
        const body = [];
        while (!this.is('DEDENT') && !this.is('EOF')) {
            if (this.eat('NEWLINE')) continue;
            body.push(...this.statement());
        }
        this.eat('DEDENT');
        return body;
    }
    statement () {
        const tok = this.peek();
        if (this.is('op', '@')) {
            const decorators = [];
            while (this.eat('op', '@')) {
                decorators.push(this.expr());
                this.expect('NEWLINE');
            }
            const def = this.statement()[0];
            def.decorators = decorators;
            return [def];
        }
        if (this.eat('kw', 'def')) {
            const name = this.expect('name').value;
            this.expect('op', '(');
            const params = [];
            while (!this.is('op', ')')) {
                const p = this.expect('name').value;
                let def = null;
                if (this.eat('op', '=')) def = this.expr();
                params.push({name: p, default: def});
                if (!this.eat('op', ',')) break;
            }
            this.expect('op', ')');
            if (this.eat('op', '->')) this.expr();
            this.expect('op', ':');
            return [{type: 'PyDef', name, params, body: this.block(), loc: this.loc(tok)}];
        }
        if (this.eat('kw', 'if')) return [this.ifRest(tok)];
        if (this.eat('kw', 'while')) {
            const test = this.expr();
            this.expect('op', ':');
            return [{type: 'WhileStatement', test, body: {type: 'BlockStatement', body: this.block()}, loc: this.loc(tok)}];
        }
        if (this.eat('kw', 'for')) {
            const target = this.expect('name').value;
            this.expect('kw', 'in');
            const iter = this.expr();
            this.expect('op', ':');
            return [{type: 'PyFor', target, iter, body: {type: 'BlockStatement', body: this.block()}, loc: this.loc(tok)}];
        }
        return this.simpleLine();
    }
    ifRest (tok) {
        const test = this.expr();
        this.expect('op', ':');
        const consequent = {type: 'BlockStatement', body: this.block()};
        let alternate = null;
        const at = this.peek();
        if (this.eat('kw', 'elif')) alternate = this.ifRest(at);
        else if (this.eat('kw', 'else')) {
            this.expect('op', ':');
            alternate = {type: 'BlockStatement', body: this.block()};
        }
        return {type: 'IfStatement', test, consequent, alternate, loc: this.loc(tok)};
    }
    // Simple statements, ";" between them, to the end of the line.
    simpleLine () {
        const out = [this.simple()];
        while (this.eat('op', ';')) {
            if (this.is('NEWLINE')) break;
            out.push(this.simple());
        }
        if (!this.eat('NEWLINE') && !this.is('EOF') && !this.is('DEDENT')) {
            const at = this.peek();
            throw new PythonSyntaxError(`unexpected ${at.value || at.type} (line ${at.line})`);
        }
        return out;
    }
    simple () {
        const tok = this.peek();
        const loc = this.loc(tok);
        if (this.eat('kw', 'pass')) return {type: 'EmptyStatement', loc};
        // import x / from x import y: nothing to make blocks of.
        if ((this.is('name', 'import') || this.is('kw', 'from')) && (this.peek(1).type === 'name')) {
            while (!this.is('NEWLINE') && !this.is('EOF') && !this.is('op', ';')) this.next();
            return {type: 'EmptyStatement', loc};
        }
        if (this.eat('kw', 'break')) return {type: 'BreakStatement', loc};
        if (this.eat('kw', 'continue')) return {type: 'ContinueStatement', loc};
        if (this.eat('kw', 'global') || this.eat('kw', 'nonlocal')) {
            while (this.eat('name')) if (!this.eat('op', ',')) break;
            return {type: 'EmptyStatement', loc};
        }
        if (this.eat('kw', 'return')) {
            const argument = this.is('NEWLINE') || this.is('op', ';') ? null : this.expr();
            return {type: 'ReturnStatement', argument, loc};
        }
        const left = this.exprOrYield();
        const assign = this.peek();
        if (assign.type === 'op' && ['=', '+=', '-=', '*=', '/=', '%='].includes(assign.value)) {
            this.next();
            const right = this.exprOrYield();
            return {type: 'ExpressionStatement', loc,
                expression: {type: 'AssignmentExpression', operator: assign.value, left, right, loc}};
        }
        return {type: 'ExpressionStatement', expression: left, loc};
    }
    exprOrYield () {
        const tok = this.peek();
        if (this.eat('kw', 'yield')) {
            const delegate = !!this.eat('kw', 'from');
            const argument = this.is('NEWLINE') || this.is('op', ';') || this.is('op', ')') ? null : this.expr();
            return {type: 'YieldExpression', delegate, argument, loc: this.loc(tok)};
        }
        return this.expr();
    }

    // --- expressions ---
    expr () {
        const tok = this.peek();
        if (this.eat('kw', 'lambda')) {
            const params = [];
            while (this.is('name')) {
                params.push({type: 'Identifier', name: this.next().value});
                if (!this.eat('op', ',')) break;
            }
            this.expect('op', ':');
            return {type: 'ArrowFunctionExpression', params, body: this.expr(), loc: this.loc(tok)};
        }
        const value = this.or();
        if (this.is('kw', 'if')) {
            this.next();
            const test = this.or();
            this.expect('kw', 'else');
            return {type: 'ConditionalExpression', test, consequent: value, alternate: this.expr(), loc: this.loc(tok)};
        }
        return value;
    }
    or () {
        let left = this.and();
        while (this.is('kw', 'or')) {
            const tok = this.next();
            left = {type: 'LogicalExpression', operator: '||', left, right: this.and(), loc: this.loc(tok)};
        }
        return left;
    }
    and () {
        let left = this.not();
        while (this.is('kw', 'and')) {
            const tok = this.next();
            left = {type: 'LogicalExpression', operator: '&&', left, right: this.not(), loc: this.loc(tok)};
        }
        return left;
    }
    not () {
        const tok = this.peek();
        if (this.eat('kw', 'not')) return {type: 'UnaryExpression', operator: '!', argument: this.not(), loc: this.loc(tok)};
        return this.compare();
    }
    compare () {
        let left = this.sum();
        const OPS = {'==': '===', '!=': '!==', '<': '<', '>': '>', '<=': '<=', '>=': '>='};
        for (;;) {
            const tok = this.peek();
            if (tok.type === 'op' && OPS[tok.value]) {
                this.next();
                left = {type: 'BinaryExpression', operator: OPS[tok.value], left, right: this.sum(), loc: this.loc(tok)};
            } else if (tok.type === 'kw' && tok.value === 'is') {
                this.next();
                const negate = !!this.eat('kw', 'not');
                left = {type: 'BinaryExpression', operator: negate ? '!==' : '===', left, right: this.sum(), loc: this.loc(tok)};
            } else if (tok.type === 'kw' && tok.value === 'in') {
                this.next();
                left = {type: 'PyIn', item: left, container: this.sum(), loc: this.loc(tok)};
            } else {
                return left;
            }
        }
    }
    sum () {
        let left = this.term();
        while (this.is('op', '+') || this.is('op', '-')) {
            const tok = this.next();
            left = {type: 'BinaryExpression', operator: tok.value, left, right: this.term(), loc: this.loc(tok)};
        }
        return left;
    }
    term () {
        let left = this.unary();
        while (['*', '/', '//', '%'].some(op => this.is('op', op))) {
            const tok = this.next();
            left = {type: 'BinaryExpression', operator: tok.value, left, right: this.unary(), loc: this.loc(tok)};
        }
        return left;
    }
    unary () {
        const tok = this.peek();
        if (this.is('op', '-') || this.is('op', '+')) {
            this.next();
            return {type: 'UnaryExpression', operator: tok.value, argument: this.unary(), loc: this.loc(tok)};
        }
        return this.power();
    }
    power () {
        const base = this.postfix();
        if (this.is('op', '**')) {
            const tok = this.next();
            return {type: 'BinaryExpression', operator: '**', left: base, right: this.unary(), loc: this.loc(tok)};
        }
        return base;
    }
    postfix () {
        let node = this.atom();
        for (;;) {
            const tok = this.peek();
            if (this.eat('op', '.')) {
                const name = this.next();
                node = {type: 'MemberExpression', object: node, computed: false,
                    property: {type: 'Identifier', name: name.value}, loc: this.loc(tok)};
            } else if (this.eat('op', '(')) {
                const args = [];
                const keywords = [];
                while (!this.is('op', ')')) {
                    if (this.is('name') && this.peek(1).type === 'op' && this.peek(1).value === '=') {
                        const key = this.next().value;
                        this.next();
                        keywords.push({name: key, value: this.expr()});
                    } else {
                        args.push(this.expr());
                    }
                    if (!this.eat('op', ',')) break;
                }
                this.expect('op', ')');
                node = {type: 'CallExpression', callee: node, arguments: args, keywords, loc: this.loc(tok)};
            } else if (this.eat('op', '[')) {
                const property = this.expr();
                this.expect('op', ']');
                node = {type: 'MemberExpression', object: node, computed: true, property, loc: this.loc(tok)};
            } else {
                return node;
            }
        }
    }
    atom () {
        const tok = this.next();
        const loc = this.loc(tok);
        if (tok.type === 'num') return {type: 'Literal', value: tok.value, loc};
        if (tok.type === 'str') {
            let value = tok.value;
            while (this.is('str')) value += this.next().value;
            return {type: 'Literal', value, loc};
        }
        if (tok.type === 'kw') {
            if (tok.value === 'True') return {type: 'Literal', value: true, loc};
            if (tok.value === 'False') return {type: 'Literal', value: false, loc};
            if (tok.value === 'None') return {type: 'Literal', value: null, loc};
        }
        if (tok.type === 'name') return {type: 'Identifier', name: tok.value, loc};
        if (tok.type === 'op' && tok.value === '(') {
            if (this.eat('op', ')')) return {type: 'ArrayExpression', elements: [], loc};
            const first = this.exprOrYield();
            if (this.eat('op', ',')) {
                const elements = [first];
                while (!this.is('op', ')')) {
                    elements.push(this.expr());
                    if (!this.eat('op', ',')) break;
                }
                this.expect('op', ')');
                return {type: 'ArrayExpression', elements, loc};
            }
            this.expect('op', ')');
            return first;
        }
        if (tok.type === 'op' && tok.value === '[') {
            const elements = [];
            while (!this.is('op', ']')) {
                elements.push(this.expr());
                if (!this.eat('op', ',')) break;
            }
            this.expect('op', ']');
            return {type: 'ArrayExpression', elements, loc};
        }
        if (tok.type === 'op' && tok.value === '{') {
            const properties = [];
            while (!this.is('op', '}')) {
                const key = this.expr();
                this.expect('op', ':');
                properties.push({key, value: this.expr()});
                if (!this.eat('op', ',')) break;
            }
            this.expect('op', '}');
            return {type: 'ObjectExpression', properties, loc};
        }
        throw new PythonSyntaxError(`unexpected ${tok.value || tok.type} (line ${tok.line})`);
    }
}

/**
 * Read Python.
 * @param {string} text the code
 * @returns {object} {type: 'Program', body}
 */
export const parsePython = text => new Parser(tokenize(text)).module();
