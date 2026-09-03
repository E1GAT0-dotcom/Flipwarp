import { ParseError, hintFor } from './hints.js';

const PUNCT = ['(', ')', '{', '}', ',', ';', '@'];
const OPS = ['+=', '==', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '='];

const stripHash = line => line.replace(/^#/, '').replace(/^ /, '');

export function tokenize(text) {
  const tokens = [];
  const lines = text.split('\n');

  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln];
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
        tokens.push({
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
        tokens.push({ t: 'str', v: out, line: ln + 1, col: i + 1 });
        i = j + 1; continue;
      }

      // Number
      if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(raw[i + 1] || '') && expectsValue(tokens))) {
        let j = i; if (raw[j] === '-') j++;
        while (j < raw.length && /[0-9]/.test(raw[j])) j++;
        if (raw[j] === '.') { j++; while (j < raw.length && /[0-9]/.test(raw[j])) j++; }
        tokens.push({ t: 'num', v: raw.slice(i, j), line: ln + 1, col: i + 1 });
        i = j; continue;
      }

      // Identifier / keyword
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i;
        // A dot is part of the name when a letter follows it, so extension
        // blocks such as pen.penDown read as a single name.
        while (j < raw.length && (/[A-Za-z0-9_$]/.test(raw[j]) ||
               (raw[j] === '.' && /[A-Za-z_$]/.test(raw[j + 1] || '')))) j++;
        tokens.push({ t: 'ident', v: raw.slice(i, j), line: ln + 1, col: i + 1 });
        i = j; continue;
      }

      // Colour literal, e.g. #ff0000
      if (ch === '#') {
        let j = i + 1;
        while (j < raw.length && /[0-9a-fA-F]/.test(raw[j])) j++;
        tokens.push({ t: 'color', v: raw.slice(i, j), line: ln + 1, col: i + 1 });
        i = j; continue;
      }

      const op = OPS.find(o => raw.startsWith(o, i));
      if (op) { tokens.push({ t: 'op', v: op, line: ln + 1, col: i + 1 }); i += op.length; continue; }

      if (PUNCT.includes(ch)) { tokens.push({ t: 'punct', v: ch, line: ln + 1, col: i + 1 }); i++; continue; }

      const h = hintFor(raw.slice(i)) || hintFor(raw);
      throw new ParseError({
        line: ln + 1, column: i + 1, text: raw, id: h?.id || 'bad-character',
        message: h?.message || `Flipwarp does not know what "${ch}" means here.`,
        fix: h?.fix || 'Switch back to blocks and check this line against the block you meant.',
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
