// The two ways the same blocks can be written.
//
// A style is only a spelling. The blocks, the tree the parser builds, and
// everything build.js does with that tree are identical either way — which is
// the point: switching style must never change what your project does, only
// what it looks like while you are reading it.
//
// The JavaScript style is the original one and is defined here as the exact
// shapes to-text.js used to hard-code, so nothing about it can drift.

// goToXY -> go_to_xy, whenIReceive -> when_i_receive, pen.penDown ->
// pen.pen_down. The second replace is what keeps runs of capitals together:
// without it "whenIReceive" would come out as "when_i_receive" only by luck
// and "XY" would split into "x_y".
export const camelToSnake = name => String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

// Words from a free-form Scratch name ("my score", "high-score!!").
const words = name => String(name)
    .replace(/[^A-Za-z0-9_ ]+/g, ' ')
    .trim()
    .split(/[\s_]+/)
    .filter(Boolean);

const camelSlug = name => {
    const parts = words(name);
    const s = parts
        .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)))
        .join('');
    return (!s || /^[0-9]/.test(s)) ? `_${s}` : s;
};

const snakeSlug = name => {
    const s = words(name).map(w => camelToSnake(w)).join('_');
    return (!s || /^[0-9]/.test(s)) ? `_${s}` : s;
};

// Reserved in either style, always. A name that is a keyword in one style is
// avoided in both, so switching style never renames anyone's variable behind
// their back.
export const STYLE_KEYWORDS = new Set([
    // shared
    'if', 'else', 'while', 'repeat', 'forever', 'true', 'false',
    'variable', 'list', 'broadcast', 'global', 'as', 'fast', 'define',
    // JavaScript
    'null', 'undefined', 'return', 'function', 'var', 'let', 'const',
    'for', 'do', 'switch', 'case', 'new',
    // Python
    'def', 'elif', 'pass', 'None', 'True', 'False', 'and', 'or', 'not',
    'import', 'from', 'lambda', 'class', 'del', 'with', 'yield', 'None_'
]);

const JS = {
    id: 'js',
    label: 'JavaScript',
    // Bodies are delimited by braces, so a line break means nothing and
    // indentation is decoration.
    indentBased: false,
    defineWord: 'define',
    trueWord: 'true',
    falseWord: 'false',
    // How `not`, `and`, `or` are written. The tokenizer turns whichever
    // spelling is active into the same operator token either way.
    notWord: '!',
    andWord: '&&',
    orWord: '||',
    blockName: name => name,
    slug: camelSlug,
    // The pieces to-text.js writes.
    terminator: ';',
    openBody: ' {',
    closeBody: '}',
    // `} else {` sits on one line in braces; in Python `else:` is its own.
    elseLine: (pad, close, open) => `${pad}${close} else${open}`,
    ifHead: cond => `if (${cond})`,
    // Whether the parser should expect brackets around an if's condition.
    ifCondParens: true
};

const PYTHON = {
    id: 'python',
    label: 'Python',
    indentBased: true,
    defineWord: 'def',
    trueWord: 'True',
    falseWord: 'False',
    notWord: 'not ',
    andWord: 'and',
    orWord: 'or',
    blockName: camelToSnake,
    slug: snakeSlug,
    terminator: '',
    openBody: ':',
    closeBody: '',
    elseLine: (pad, close, open) => `${pad}else${open}`,
    ifHead: cond => `if ${cond}`,
    ifCondParens: false
};

export const STYLES = {js: JS, python: PYTHON};

export const STYLE_IDS = Object.keys(STYLES);

/**
 * The style with this id, falling back to JavaScript.
 *
 * Everything that reads a style goes through here, so a stored setting from a
 * future version — or a corrupted one — degrades to the original behaviour
 * instead of throwing somewhere far away.
 *
 * @param {string|object} id a style id, or a style
 * @returns {object} the style
 */
export const getStyle = id => {
    if (id && typeof id === 'object' && id.id) return id;
    return STYLES[id] || JS;
};

export default STYLES;
