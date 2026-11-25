// Exported code comes out with no comments: these take them out of the
// runtimes and the written game, leaving the code itself exactly as it was.

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'throw', 'case', 'do', 'else', 'yield', 'await']);

/**
 * Text with some ranges cut out; lines left empty by a cut go, and runs of
 * blank lines become one, except on lines that start inside a string.
 * @param {string} text the code
 * @param {Array<[number, number]>} cuts [start, end) ranges to remove, in order
 * @param {Set<number>} inString indexes of newlines that are inside a string
 * @returns {string} the code without the cuts
 */
const cutOut = (text, cuts, inString) => {
    // Mark each line: does it start inside a string, did a cut touch it?
    const lines = [];
    let current = {text: '', cut: false, protect: false};
    let at = 0;
    const push = upto => {
        for (let k = at; k < upto; k++) {
            if (text[k] === '\n') {
                lines.push(current);
                current = {text: '', cut: false, protect: inString.has(k)};
            } else {
                current.text += text[k];
            }
        }
        at = upto;
    };
    for (const [start, end] of cuts) {
        push(start);
        current.cut = true;
        // A cut that spans lines (a block comment) keeps its line breaks.
        for (let k = start; k < end; k++) {
            if (text[k] === '\n') {
                lines.push(current);
                current = {text: '', cut: true, protect: false};
            }
        }
        at = end;
    }
    push(text.length);
    lines.push(current);
    const kept = [];
    for (const l of lines) {
        if (l.protect) {
            // Its start is inside a string; a comment cut from it came after the string ended.
            kept.push(l.cut ? l.text.replace(/[ \t\r]+$/, '') : l.text);
            continue;
        }
        const line = l.text.replace(/[ \t\r]+$/, '');
        if (!line.trim() && l.cut) continue;
        if (!line.trim() && kept.length && !kept[kept.length - 1].trim()) continue;
        kept.push(line);
    }
    while (kept.length && !kept[0].trim()) kept.shift();
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    return `${kept.join('\n')}\n`;
};

/**
 * JavaScript without its comments: strings, template literals and regular
 * expressions are read past, so a "//" inside one is left alone.
 * @param {string} code JavaScript
 * @returns {string} the same code with no comments
 */
export const stripJs = code => {
    const cuts = [];
    const inString = new Set();
    const n = code.length;
    let i = 0;
    let last = '';
    // Template literals in progress: the brace depth each ${ ... } started at.
    const templates = [];
    let depth = 0;
    const template = () => {
        // From just after ` or the } closing a ${: to the literal's end or the next ${.
        while (i < n) {
            const c = code[i];
            if (c === '\\') {
                i += 2;
            } else if (c === '`') {
                i++;
                last = 'string';
                return;
            } else if (c === '$' && code[i + 1] === '{') {
                i += 2;
                templates.push(depth);
                depth++;
                last = '{';
                return;
            } else {
                if (c === '\n') inString.add(i);
                i++;
            }
        }
    };
    while (i < n) {
        const c = code[i];
        const d = code[i + 1];
        if (c === '/' && d === '/') {
            const start = i;
            while (i < n && code[i] !== '\n') i++;
            cuts.push([start, i]);
        } else if (c === '/' && d === '*') {
            const end = code.indexOf('*/', i + 2);
            const stop = end < 0 ? n : end + 2;
            cuts.push([i, stop]);
            i = stop;
        } else if (c === '"' || c === '\'') {
            i++;
            while (i < n && code[i] !== c && code[i] !== '\n') i += code[i] === '\\' ? 2 : 1;
            i++;
            last = 'string';
        } else if (c === '`') {
            i++;
            template();
        } else if (c === '/') {
            const regex = !last || KEYWORDS_BEFORE_REGEX.has(last) ||
                (last.length === 1 && /[^\w$)\]]/.test(last));
            i++;
            if (regex) {
                let inClass = false;
                while (i < n && code[i] !== '\n') {
                    if (code[i] === '\\') {
                        i += 2;
                        continue;
                    }
                    if (code[i] === '[') inClass = true;
                    else if (code[i] === ']') inClass = false;
                    else if (code[i] === '/' && !inClass) break;
                    i++;
                }
                i++;
                while (i < n && /[a-z]/i.test(code[i])) i++;
                last = 'regex';
            } else {
                last = '/';
            }
        } else if (/[\w$]/.test(c)) {
            const start = i;
            while (i < n && /[\w$]/.test(code[i])) i++;
            last = code.slice(start, i);
        } else if (/\s/.test(c)) {
            i++;
        } else {
            i++;
            if (c === '{') {
                depth++;
            } else if (c === '}') {
                depth--;
                if (templates.length && templates[templates.length - 1] === depth) {
                    templates.pop();
                    template();
                    continue;
                }
            }
            last = c;
        }
    }
    return cutOut(code, cuts, inString);
};

/**
 * CSS without its comments.
 * @param {string} css a style sheet
 * @returns {string} the same style with no comments
 */
export const stripCss = css => {
    const cuts = [];
    const re = /\/\*[\s\S]*?\*\//g;
    let m;
    while ((m = re.exec(css))) cuts.push([m.index, m.index + m[0].length]);
    return cutOut(css, cuts, new Set());
};

/**
 * An HTML page without its <!-- comments -->.
 * @param {string} html a page
 * @returns {string} the same page with no comments
 */
export const stripHtml = html => html.replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n?/g, '');

/**
 * Python without its comments or docstrings (a def or class left with no body gets "pass").
 * @param {string} code Python
 * @returns {string} the same program with no comments
 */
export const stripPython = code => {
    const n = code.length;
    const cuts = [];
    const inString = new Set();
    // Logical lines: their tokens, to find docstrings (a statement that is only a string).
    const statements = [];
    let tokens = [];
    let parens = 0;
    let i = 0;
    const endStatement = () => {
        if (tokens.length) statements.push(tokens);
        tokens = [];
    };
    while (i < n) {
        const c = code[i];
        if (c === '#') {
            const start = i;
            while (i < n && code[i] !== '\n') i++;
            cuts.push([start, i]);
            continue;
        }
        if (c === '\\' && code[i + 1] === '\n') {
            i += 2;
            continue;
        }
        if (c === '\n') {
            if (!parens) endStatement();
            i++;
            continue;
        }
        const string = code.slice(i, i + 5).match(/^[rRbBuUfF]{0,2}('''|"""|'|")/);
        const prev = i ? code[i - 1] : '';
        if (string && !(string[0].length > string[1].length && /[\w]/.test(prev))) {
            const quote = string[1];
            const start = i;
            i += string[0].length;
            while (i < n) {
                if (code[i] === '\\') {
                    if (code[i + 1] === '\n') inString.add(i + 1);
                    i += 2;
                } else if (code.startsWith(quote, i)) {
                    i += quote.length;
                    break;
                } else if (code[i] === '\n' && quote.length === 1) {
                    break;
                } else {
                    if (code[i] === '\n') inString.add(i);
                    i++;
                }
            }
            tokens.push({type: 'string', start, end: i});
            continue;
        }
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if ('([{'.includes(c)) parens++;
        if (')]}'.includes(c)) parens = Math.max(0, parens - 1);
        const start = i;
        if (/[\w]/.test(c)) {
            while (i < n && /[\w]/.test(code[i])) i++;
        } else {
            i++;
        }
        tokens.push({type: 'code', start, end: i, text: code.slice(start, i)});
    }
    endStatement();
    // A docstring: a statement that is one string, first in the file or first after "def/class ...:".
    const header = s => s[0].type === 'code' && /^(def|class|async)$/.test(s[0].text) &&
        s[s.length - 1].type === 'code' && s[s.length - 1].text === ':';
    const lineStart = at => code.lastIndexOf('\n', at - 1) + 1;
    const bodiless = [];
    statements.forEach((s, k) => {
        const first = k === 0 || header(statements[k - 1]);
        if (!first || s.length !== 1 || s[0].type !== 'string') return;
        const {start, end} = s[0];
        cuts.push([lineStart(start), end]);
        for (let p = start; p < end; p++) if (code[p] === '\n') inString.delete(p);
        // Was the docstring the whole body?
        const next = statements[k + 1];
        const indent = start - lineStart(start);
        const nextIndent = next ? next[0].start - lineStart(next[0].start) : -1;
        if (k > 0 && nextIndent < indent) bodiless.push({at: start, indent});
    });
    cuts.sort((a, b) => a[0] - b[0]);
    let text = code;
    // "pass" where a docstring was a body, put in before cutting (from the end, so indexes hold).
    for (const {at, indent} of bodiless.sort((a, b) => b.at - a.at)) {
        text =`${text.slice(0, lineStart(at))}${' '.repeat(indent)}pass\n${text.slice(lineStart(at))}`;
        const shift = indent + 5;
        for (const cut of cuts) {
            if (cut[0] >= lineStart(at)) {
                cut[0] += shift;
                cut[1] += shift;
            }
        }
        const moved = new Set();
        for (const p of inString) moved.add(p >= lineStart(at) ? p + shift : p);
        inString.clear();
        for (const p of moved) inString.add(p);
    }
    return cutOut(text, cuts, inString);
};
