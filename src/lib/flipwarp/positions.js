// Where each script sits on the canvas, carried through the text as @at
// markers. Kept apart from vm-bridge.js, which needs the VM, so that tests
// (and flipwarp-mcp's) can put the markers in exactly as the editor does.

// Script positions are real information, they are where you dragged each
// script, but @at lines are noise to read past. They are stripped out of the
// text you see and put back on the way in, so the positions survive without
// ever being on screen.
export const AT_LINE = /^@at\((-?\d+),\s*(-?\d+)\)$/;

export const splitPositions = text => {
    const positions = [];
    const lines = [];
    for (const line of text.split('\n')) {
        const m = AT_LINE.exec(line.trim());
        if (m) {
            positions.push({x: Number(m[1]), y: Number(m[2])});
            continue;
        }
        lines.push(line);
    }
    return {positions, text: lines.join('\n').replace(/^\n+/, '')};
};

// A script the text added has no saved position, so it goes below everything
// else rather than landing on top of a script that is already there.
export const restorePositions = (text, positions) => {
    // With the markers on show, the text already carries its own positions
    // and must be left exactly as written.
    if (text.split('\n').some(line => AT_LINE.test(line.trim()))) return text;

    const out = [];
    let scriptIndex = 0;
    let lowest = positions.reduce((n, p) => Math.max(n, p.y), 0);
    let atScriptStart = true;

    const lines = text.split('\n');
    // A run of # lines with a blank line after it is a comment on the canvas,
    // not the start of a script, so it must not be given a script's position.
    const looseComment = index => {
        if (!/^\s*#/.test(lines[index])) return false;
        let k = index;
        while (k < lines.length && /^\s*#/.test(lines[k])) k++;
        return k >= lines.length || lines[k].trim() === '';
    };

    // How deep into a block body a line is. A blank line inside a body is
    // somebody spacing their code out, not the end of a script, and treating
    // it as the end of one used to split the script in two: in a brace style
    // the tail detached onto the canvas as its own script, and in an
    // indentation style the marker went in at column 0 and the next line was
    // reported as wrongly indented, pointing at a line nobody had touched.
    //
    // Braces answer this exactly. An indentation style has no braces, so the
    // indent of the line does instead: a line indented at all is inside
    // something.
    let depth = 0;
    const insideABody = index => {
        if (depth > 0) return true;
        // Look ahead: in an indentation style the blank line sits between two
        // indented lines, and both of those are inside the same body.
        for (let k = index + 1; k < lines.length; k++) {
            if (lines[k].trim() === '') continue;
            return /^\s+\S/.test(lines[k]);
        }
        return false;
    };

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const blank = line.trim() === '';
        // No terminator in this test on purpose: a declaration ends with a
        // semicolon in one style and with the end of the line in the other,
        // and what matters here is only that the line is a declaration.
        const declaration = /^\s*(global\s+)?(variable|list|broadcast)\s/.test(line);

        if (!blank && !declaration && atScriptStart && !looseComment(index)) {
            const p = positions[scriptIndex];
            if (p) {
                out.push(`@at(${p.x}, ${p.y})`);
            } else {
                lowest += 260;
                out.push(`@at(0, ${lowest})`);
            }
            scriptIndex++;
            atScriptStart = false;
        }
        if (blank && !insideABody(index)) atScriptStart = true;
        out.push(line);
        // Counted after the line is kept, so a line that closes a body is
        // itself still inside it.
        for (const ch of line.replace(/"(\\.|[^"\\])*"/g, '')) {
            if (ch === '{') depth++;
            else if (ch === '}') depth = Math.max(0, depth - 1);
        }
    }
    return out.join('\n');
};
