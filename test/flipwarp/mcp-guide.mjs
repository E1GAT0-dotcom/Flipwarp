// Every example in the guide flipwarp-mcp gives Claude has to be text the
// editor accepts. A guide that teaches a spelling the parser refuses is worse
// than no guide: Claude would trust it over the error message.
//
// Runs without a browser.
import {parse} from '../../src/lib/flipwarp/parse.js';
import {buildTarget} from '../../src/lib/flipwarp/build.js';
import {GUIDE} from '../../mcp/guide.mjs';

// Names the examples use without declaring them, the way a real sprite would
// have them at its top.
const PRELUDE = [
    'variable speed;',
    'variable n;',
    'global variable score;',
    'global broadcast gameOver as "game over";'
].join('\n');

// The indented blocks in the guide, each one a run of lines starting with four
// spaces (blank lines inside a run belong to it).
const codeBlocks = () => {
    const blocks = [];
    let current = null;
    for (const line of GUIDE.split('\n')) {
        if (line.startsWith('    ')) {
            if (!current) current = [];
            current.push(line.slice(4));
        } else if (line.trim() === '' && current) {
            current.push('');
        } else if (current) {
            blocks.push(current.join('\n').trim());
            current = null;
        }
    }
    if (current) blocks.push(current.join('\n').trim());
    return blocks;
};

// The editor puts an @at marker on each script before parsing; a script
// starts after a blank line outside any body. Here every block in the guide
// starts its scripts at column 0, so a line that does is the start of one.
const withMarkers = text => {
    let y = 0;
    return text.split('\n').map(line => {
        if (/^(when|define)/.test(line)) {
            y += 400;
            return `@at(0, ${y})\n${line}`;
        }
        return line;
    }).join('\n');
};

// The examples written inline in the guide's bullet points.
const INLINE = [
    'if (!(n == 1)) { show(); }',
    'if (!(n < 1)) { show(); }',
    'if (touching("_edge_")) { show(); }',
    'if (touching("_mouse_")) { show(); }',
    'goTo("_random_");',
    'createCloneOf("_myself_");',
    'pointTowards("_mouse_");',
    'stop("this script");',
    'stop("other scripts in sprite");',
    'setEffect("ghost", 50);',
    'goToLayer("front");',
    'say(mathOp("abs", n));',
    'say(propertyOf("x position", "Player"));',
    'broadcast(gameOver);',
    'pen.penDown();',
    'pen.setPenColorTo("#ff0000");',
    'music.playDrumForBeats("1", 0.25);',
    'checkAmount(mouseDown(), 3);'
];

const HATS = [
    'whenThisSpriteClicked {\n  show();\n}',
    'whenStageClicked {\n  show();\n}',
    'whenIStartAsAClone {\n  show();\n}',
    'whenBackdropSwitchesTo("level 2") {\n  show();\n}',
    'whenGreaterThan("timer", 10) {\n  show();\n}'
];

const DEFINE_CHECK = 'define checkAmount(flag, n) as "check %b amount %s" {\n  show();\n}';

let failures = 0;
const tryText = (label, text) => {
    const target = {isStage: false, name: 'Sprite1', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}};
    const ctx = {globals: {variables: {}, lists: {}}, broadcasts: {}};
    try {
        buildTarget(parse(`${PRELUDE}\n\n${withMarkers(text)}`, 'js'), target, ctx, 'js');
    } catch (e) {
        failures++;
        console.log(`FAIL ${label}: line ${e.line}: ${e.message}`);
        console.log(text.split('\n').map(l => `    ${l}`).join('\n'));
    }
};

codeBlocks().forEach((block, i) => tryText(`code block ${i + 1}`, block));
for (const statement of INLINE) {
    tryText(statement, `${DEFINE_CHECK}\n\nwhenGreenFlagClicked {\n  ${statement}\n}`);
}
for (const hat of HATS) tryText(hat.split('\n')[0], hat);

if (failures) {
    console.log(`${failures} guide example(s) the editor refuses`);
    process.exit(1);
}
console.log('every guide example is accepted');
