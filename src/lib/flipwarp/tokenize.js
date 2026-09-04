import { ParseError, hintFor } from './hints.js';
import { getStyle } from './styles.js';

const PUNCT = ['(', ')', '{', '}', ',', ';', '@'];
const OPS = ['+=', '==', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '='];

const stripHash = line => line.replace(/^#/, '').replace(/^ /, '');

// How wide the indentation on this line is. Tabs go to the next multiple of
// eight, which is what every other language that cares about indentation does,
// so a file mixing tabs and spaces lines up the way the person's editor showed
// it to them.
function indentWidth(raw) {
    let w = 0;
    for (const ch of raw) {
        if (ch === ' ') w++;
        else if (ch === '\t') w += 8 - (w % 8);
        else break;
    }
    return w;
}

// In an indentation-based style some words are spelled differently but mean
// exactly what the brace style's symbol means. Translating them here rather
// than in the parser means the parser only ever sees one grammar.
const PYTHON_WORDS = {
    def: {t: 'ident', v: 'define'},
    and: {t: 'op', v: '&&'},
    or: {t: 'op', v: '||'},
    not: {t: 'op', v: '!'},
    True: {t: 'ident', v: 'true'},
    False: {t: 'ident', v: 'false'}
};

/**
 * Text to tokens.
 *
 * An indentation-based style is turned into the same token stream a
 * bracket-based one produces: going in one level emits the same "{" the brace
 * style writes, coming back out emits "}", and the end of a line emits ";".
 * The parser then has one grammar to know rather than two, and a bug fixed in
 * one style is fixed in both.
 *
 * @param {string} text the text to read
 * @param {object|string} style the style it is written in
 * @returns {Array} the tokens
 */
export function tokenize(text, style) {
    const st = getStyle(style);
    const tokens = [];
    const lines = text.split('\n');

    // Layout state, used only by indentation-based styles.
    const levels = [0];
    let parens = 0;
    let expectIndent = false;
    let openedBody = false;   // this line ended with the "start a body" mark
    let lineStart = 0;        // index in `tokens` where this line's own tokens begin

    const push = tok => tokens.push(tok);

    const fail = (ln, col, raw, id, message, fix) => {
        const h = hintFor(raw.slice(col - 1)) || hintFor(raw);
        throw new ParseError({
            line: ln + 1, column: col, text: raw,
            id: h?.id || id, message: h?.message || message, fix: h?.fix || fix
        });
    };

    for (let ln = 0; ln < lines.length; ln++) {
        const raw = lines[ln];

        // ------------------------------------------------------- layout
        // Blank lines and comment-only lines never change the indentation,
        // the same way they do not in Python. A comment sitting at an odd
        // indent should not silently close somebody's loop.
        const blank = raw.trim() === '';
        const commentOnly = /^\s*#/.test(raw) && !/^\s*#[0-9a-fA-F]/.test(raw.trim());

        if (st.indentBased && parens === 0 && !blank && !commentOnly) {
            const width = indentWidth(raw);
            const top = levels[levels.length - 1];

            if (expectIndent) {
                if (width <= top) {
                    fail(ln, width + 1, raw, 'expected-indent',
                        'This line needs to be indented, because the line above it starts a body.',
                        'Put some spaces in front of it — the same number for every line in the body.');
                }
                levels.push(width);
                expectIndent = false;
            } else if (width > top) {
                fail(ln, width + 1, raw, 'unexpected-indent',
                    'This line is indented further than the one above it, which does not start a body.',
                    'Line it up with the line above, or end that line with a : if it should hold this one.');
            } else {
                while (width < levels[levels.length - 1]) {
                    levels.pop();
                    push({t: 'punct', v: '}', line: ln + 1, col: width + 1});
                }
                if (width !== levels[levels.length - 1]) {
                    fail(ln, width + 1, raw, 'ragged-indent',
                        'This line does not line up with any body it could belong to.',
                        'Match its indentation to one of the lines above it.');
                }
            }
        }

        if (parens === 0) {
            lineStart = tokens.length;
            openedBody = false;
        }

        let i = 0;
        while (i < raw.length) {
            const ch = raw[i];

            if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

            // A whole line beginning with # is a comment — the real Scratch kind,
            // which ends up attached to a block or sitting on the canvas. Runs of
            // them are one comment, because a Scratch comment can hold several
            // lines of text and there is no other way to write that here.
            if (ch === '#' && raw.slice(0, i).trim() === '') {
                const parts = [stripHash(raw.slice(i))];
                let last = ln;
                while (last + 1 < lines.length && /^\s*#/.test(lines[last + 1])) {
                    last++;
                    parts.push(stripHash(lines[last].trim()));
                }
                // A comment with a line of code under it belongs to that block. One
                // with a blank line under it, or nothing, sits loose on the canvas —
                // which is what Scratch's two kinds of comment are.
                const after = lines[last + 1];
                push({
                    t: 'comment',
                    v: parts.join('\n'),
                    attached: after !== undefined && after.trim() !== '' && !/^\s*#/.test(after),
                    line: ln + 1, col: i + 1,
                });
                ln = last;
                break;
            }

            // Anything we refuse outright gets its prewritten answer, not a parser error.
            if (ch === '/' && (raw[i + 1] === '/' || raw[i + 1] === '*')) {
                const h = hintFor(raw.slice(i));
                throw new ParseError({
                    line: ln + 1, column: i + 1, text: raw, id: h?.id || 'comment',
                    message: h?.message || 'Comments are not part of Flipwarp.',
                    fix: h?.fix || 'Right-click the workspace in block mode and choose "Add Comment".',
                });
            }

            // String
            if (ch === '"' || ch === "'") {
                let j = i + 1, out = '';
                while (j < raw.length && raw[j] !== ch) {
                    if (raw[j] === '\\') { out += unescapeChar(raw[j + 1]); j += 2; }
                    else out += raw[j++];
                }
                if (j >= raw.length) {
                    throw new ParseError({
                        line: ln + 1, column: i + 1, text: raw, id: 'unclosed-string',
                        message: 'This piece of text is missing its closing quote.',
                        fix: `Add a ${ch} at the end of it.`,
                    });
                }
                push({ t: 'str', v: out, line: ln + 1, col: i + 1 });
                i = j + 1; continue;
            }

            // Number
            if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(raw[i + 1] || '') && expectsValue(tokens))) {
                let j = i; if (raw[j] === '-') j++;
                while (j < raw.length && /[0-9]/.test(raw[j])) j++;
                if (raw[j] === '.') { j++; while (j < raw.length && /[0-9]/.test(raw[j])) j++; }
                push({ t: 'num', v: raw.slice(i, j), line: ln + 1, col: i + 1 });
                i = j; continue;
            }

            // Identifier / keyword
            if (/[A-Za-z_$]/.test(ch)) {
                let j = i;
                // A dot is part of the name when a letter follows it, so extension
                // blocks such as pen.penDown read as a single name.
                while (j < raw.length && (/[A-Za-z0-9_$]/.test(raw[j]) ||
                       (raw[j] === '.' && /[A-Za-z_$]/.test(raw[j + 1] || '')))) j++;
                const word = raw.slice(i, j);

                if (st.indentBased && word === 'elif') {
                    fail(ln, i + 1, raw, 'else-if', 'Scratch has no "elif" block.',
                        'Put a whole new if inside the else, the way the blocks nest.');
                }
                const mapped = st.indentBased ? PYTHON_WORDS[word] : null;
                if (mapped) push({ ...mapped, line: ln + 1, col: i + 1 });
                else push({ t: 'ident', v: word, line: ln + 1, col: i + 1 });
                i = j; continue;
            }

            // Colour literal, e.g. #ff0000
            if (ch === '#') {
                let j = i + 1;
                while (j < raw.length && /[0-9a-fA-F]/.test(raw[j])) j++;
                push({ t: 'color', v: raw.slice(i, j), line: ln + 1, col: i + 1 });
                i = j; continue;
            }

            // The mark that starts a body, in a style that has one. It is only
            // that at the end of a line: there is nothing else a colon could
            // mean here, so anywhere else it is a mistake worth naming.
            if (ch === ':' && st.indentBased) {
                if (parens > 0 || raw.slice(i + 1).trim() !== '') {
                    fail(ln, i + 1, raw, 'stray-colon',
                        'A : only goes at the end of a line, where it starts an indented body.',
                        'Move it to the end of the line, or delete it.');
                }
                push({ t: 'punct', v: '{', line: ln + 1, col: i + 1 });
                openedBody = true;
                i++; continue;
            }

            const op = OPS.find(o => raw.startsWith(o, i));
            if (op) { push({ t: 'op', v: op, line: ln + 1, col: i + 1 }); i += op.length; continue; }

            if (PUNCT.includes(ch)) {
                if (ch === '(') parens++;
                if (ch === ')') parens = Math.max(0, parens - 1);
                push({ t: 'punct', v: ch, line: ln + 1, col: i + 1 });
                i++; continue;
            }

            const h = hintFor(raw.slice(i)) || hintFor(raw);
            throw new ParseError({
                line: ln + 1, column: i + 1, text: raw, id: h?.id || 'bad-character',
                message: h?.message || `Flipwarp does not know what "${ch}" means here.`,
                fix: h?.fix || 'Switch back to blocks and check this line against the block you meant.',
            });
        }

        // ------------------------------------------- end of a logical line
        // In a bracket-based style a line ending means nothing. In an
        // indentation-based one it ends the statement, which is the ";" the
        // other style writes by hand.
        if (st.indentBased && parens === 0) {
            const own = tokens.slice(lineStart);
            const real = own.filter(t => t.t !== 'comment');
            const startsWithMarker = real.length && real[0].t === 'punct' && real[0].v === '@';
            if (real.length && !openedBody && !startsWithMarker) {
                const last = real[real.length - 1];
                push({ t: 'punct', v: ';', line: last.line, col: last.col + 1 });
            }
            if (openedBody) expectIndent = true;
        }
    }

    // Anything still open at the end of the text closes here.
    if (st.indentBased) {
        while (levels.length > 1) {
            levels.pop();
            push({ t: 'punct', v: '}', line: lines.length, col: 1 });
        }
        if (expectIndent) {
            const raw = lines[lines.length - 1] || '';
            throw new ParseError({
                line: lines.length, column: 1, text: raw, id: 'empty-body',
                message: 'This body never got anything in it.',
                fix: 'Put at least one indented line under the line ending in :.'
            });
        }
    }

    tokens.push({ t: 'eof', v: '', line: lines.length, col: 1 });
    return tokens;
}

function unescapeChar(c) {
  return { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\' }[c] ?? c;
}

// A minus is a negative number only where a value is expected.
function expectsValue(tokens) {
  const last = tokens[tokens.length - 1];
  if (!last) return true;
  if (last.t === 'num' || last.t === 'str' || last.t === 'ident') return false;
  if (last.t === 'punct' && last.v === ')') return false;
  return true;
}
