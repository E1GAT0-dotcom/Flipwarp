// Every ready-made piece has to be text the editor accepts, alone and merged
// into a sprite that already has things in it. Whether the pieces then play
// properly is test/flipwarp/mcp-game.mjs, which needs the editor running.
//
// Runs without a browser.
import {parse} from '../../src/lib/flipwarp/parse.js';
import {buildTarget} from '../../src/lib/flipwarp/build.js';
import {restorePositions} from '../../src/lib/flipwarp/positions.js';
import {PIECES, pieceText, mergeText, piecesToAdd, definesIn} from '../../mcp/library/index.mjs';

let failures = 0;
const check = (ok, what) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// The hidden @at markers go in exactly as the editor puts them in.
const withMarkers = text => restorePositions(text, []);

const builds = (label, text, isStage = false) => {
    const target = {isStage, name: isStage ? 'Stage' : 'Sprite1', variables: {}, lists: {}, broadcasts: {},
        blocks: {}, comments: {}};
    const ctx = {globals: {variables: {}, lists: {}}, broadcasts: {}};
    try {
        const built = buildTarget(parse(withMarkers(text), 'js'), target, ctx, 'js');
        const blocks = Object.values(built.blocks).filter(b => !b.shadow).length;
        check(blocks > 0, `${label} (${blocks} blocks)`);
    } catch (e) {
        check(false, `${label}: line ${e.line}: ${e.message}${e.fix ? ` / ${e.fix}` : ''}`);
        if (typeof e.line === 'number') {
            const lines = withMarkers(text).split('\n');
            console.log(lines.slice(Math.max(0, e.line - 3), e.line + 1).map(l => `      ${l}`).join('\n'));
        }
    }
};

for (const name of Object.keys(PIECES)) {
    const {texts} = piecesToAdd(name, {}, '');
    builds(`${name} builds`, mergeText('', texts), PIECES[name].sprite === 'Stage');
}

// A player sprite that already has things, then the enemy piece on top of a
// platformer: collision must come in once, and the declarations must merge.
const existing = 'variable lives;\n\nwhenThisSpriteClicked {\n  lives = 3;\n}\n';
let sprite = mergeText(existing, piecesToAdd('platformer', {}, existing).texts);
builds('platformer merged into a sprite with scripts', sprite);
check(sprite.includes('whenThisSpriteClicked'), 'what the sprite had is kept');
const second = piecesToAdd('enemy', {}, sprite);
check(second.added.join() === 'enemy', 'collision is not added twice');
sprite = mergeText(sprite, second.texts);
builds('enemy merged on top of platformer', sprite);
check(sprite.split('\n').filter(l => /^variable halfW;$/.test(l)).length === 1, 'a shared variable is declared once');
check(definesIn(sprite).filter(d => d === 'tileAt').length === 1, 'tileAt is defined once');

let clash = null;
try {
    piecesToAdd('platformer', {}, sprite);
} catch (e) {
    clash = e.message;
}
check(clash && clash.includes('already has'), 'adding the same piece twice is refused');

// Settings.
const level = pieceText('level', {ROWS: ['P..#', '####'], TILE_SIZE: 32, SOLID: '#=', DRAWN: '#='});
check(level.includes('addToList(levelRows, "P..#");') && level.includes('tileSize = 32;'), 'level settings fill in');
builds('a custom level builds', level, true);
const refuse = (label, fn, includes) => {
    try {
        fn();
        check(false, `${label} (was accepted)`);
    } catch (e) {
        check(e.message.includes(includes), `${label}: ${e.message}`);
    }
};
refuse('rows of different lengths', () => pieceText('level', {ROWS: ['P..', '####']}), 'row 2 is 4 long');
refuse('a quote in a row', () => pieceText('level', {ROWS: ['P"']}), 'no quotes');
refuse('a bad key', () => pieceText('platformer', {JUMP_KEY: 'jump'}), 'key as keyPressed');
refuse('a setting that is not there', () => pieceText('coins', {SPEED: 2}), 'has no setting SPEED');
refuse('a piece that is not there', () => pieceText('boss', {}), 'no piece "boss"');
refuse('a digit as a map character', () => pieceText('coins', {CHAR: '1'}), 'not a digit');
builds('a platformer with other keys', pieceText('platformer', {LEFT: 'a', RIGHT: 'd', JUMP_KEY: 'space'})
    + `\n${pieceText('collision')}`);

if (failures) {
    console.log(`${failures} failure(s)`);
    process.exit(1);
}
console.log('every piece builds, alone and merged');
