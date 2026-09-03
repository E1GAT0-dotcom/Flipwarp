// Flipwarp never guesses. When text falls outside the phrasebook it stops and
// says what to do instead. These are the prewritten answers — plain language,
// no parser jargon, and every one of them points at the Scratch way to do it.

export const HINTS = [
  {
    id: 'line-comment',
    test: t => /^\s*\/\//.test(t),
    message: 'Comments start with # here, not //.',
    fix: 'Write # in front of the line. A # comment with a block under it becomes that block\'s comment; one on its own becomes a comment on the canvas.',
  },
  {
    id: 'block-comment',
    test: t => /\/\*/.test(t),
    message: 'Comments with /* */ are not part of Flipwarp.',
    fix: 'Put # in front of each line instead. Several # lines in a row make one comment with several lines in it.',
  },
  {
    id: 'declare-var',
    test: t => /^\s*(let|const|var)\s+/.test(t),
    message: 'let, const and var are not how variables are made here.',
    fix: 'Make the variable in the Variables palette, then it will appear at the top of this text and you can use its name.',
  },
  {
    id: 'function',
    test: t => /^\s*(function|async\s+function)\b/.test(t),
    message: 'function is not how custom blocks are made here.',
    fix: 'Use define, for example: define myBlock(count) as "my block %s" { ... }',
  },
  {
    id: 'return',
    test: t => /^\s*return\b/.test(t),
    message: 'Scratch custom blocks do not hand a value back, so return has nothing to do.',
    fix: 'Set a variable inside the block instead, then read that variable afterwards.',
  },
  {
    id: 'for-loop',
    test: t => /^\s*for\s*\(/.test(t),
    message: 'There is no for loop in Scratch.',
    fix: 'Use repeat(10) { ... } for a fixed count, or repeatUntil(condition) { ... } to stop on a condition.',
  },
  {
    id: 'while-loop',
    test: t => /^\s*while\s*\(/.test(t),
    message: 'while is a hidden Scratch block that most projects should not use.',
    fix: 'Use repeatUntil(condition) { ... }, which is the block in the Control palette.',
  },
  {
    id: 'else-if',
    test: t => /^\s*}\s*else\s+if\b/.test(t),
    message: 'Scratch has no "else if" block.',
    fix: 'Put a whole new if inside the else, the way the blocks nest: } else { if (...) { ... } }',
  },
  {
    id: 'strict-equals',
    test: t => /===|!==/.test(t),
    message: 'Scratch only has one kind of equals.',
    fix: 'Use == instead of ===. For "not equal", wrap it: !(a == b)',
  },
  {
    id: 'not-equals',
    test: t => /[^!<>=]!=[^=]/.test(t),
    message: 'Scratch has no "not equal" block.',
    fix: 'Write it as !(a == b), which is the not block wrapped around the equals block.',
  },
  {
    id: 'increment',
    test: t => /\+\+|--/.test(t),
    message: '++ and -- are not part of Flipwarp.',
    fix: 'Use score += 1 to change a variable by 1.',
  },
  {
    id: 'compound-assign',
    test: t => /[-*/]=/.test(t) && !/[<>!+]=/.test(t),
    message: 'Scratch can only change a variable by adding to it.',
    fix: 'To subtract, add a negative: score += -1. To multiply, use score = score * 2.',
  },
  {
    id: 'object-literal',
    test: t => /^\s*[A-Za-z_$][\w$]*\s*=\s*\{/.test(t),
    message: 'Scratch has no objects.',
    fix: 'Use a list instead, made in the Variables palette.',
  },
  {
    id: 'array-literal',
    test: t => /=\s*\[/.test(t),
    message: 'Scratch has no arrays written like this.',
    fix: 'Make a list in the Variables palette, then use addToList(myList, "thing").',
  },
  {
    id: 'index-access',
    test: t => /[A-Za-z_$][\w$]*\s*\[/.test(t),
    message: 'Square brackets are not how you read from a list.',
    fix: 'Use itemOfList(myList, 1) to get the first item.',
  },
  {
    id: 'await',
    test: t => /\bawait\b|\basync\b/.test(t),
    message: 'async and await are not part of Flipwarp.',
    fix: 'Scripts already wait on their own. Use wait(1) for a pause, or waitUntil(condition).',
  },
  {
    id: 'console',
    test: t => /\bconsole\s*\./.test(t),
    message: 'There is no console in Scratch.',
    fix: 'Use say("your message") to show something on the stage.',
  },
  {
    id: 'arrow-fn',
    test: t => /=>/.test(t),
    message: 'Arrow functions are not part of Flipwarp.',
    fix: 'Use define to make a custom block instead.',
  },
];

// Look for a prewritten answer for a line that failed to parse.
export function hintFor(lineText) {
  for (const h of HINTS) {
    try { if (h.test(lineText)) return h; } catch { /* a bad test never breaks a conversion */ }
  }
  return null;
}

export class ParseError extends Error {
  constructor({ line, column, text, message, fix, id }) {
    super(message);
    this.line = line;
    this.column = column;
    this.text = text;
    this.fix = fix;
    this.id = id || 'unknown';
  }

  // What the editor shows the user.
  report() {
    const where = `Line ${this.line}`;
    return [
      `${where}: ${this.message}`,
      this.fix ? `  Try this: ${this.fix}` : null,
      this.text ? `  ${this.text.trim()}` : null,
    ].filter(Boolean).join('\n');
  }
}
