// The library of ready-made game pieces: Flipwarp text that has been played,
// not just parsed (test/flipwarp/mcp-game.mjs plays every one), for the parts
// of a game that are hard to get right and the same every time.
//
// A piece is a .fw file of Flipwarp text with {{SETTINGS}} in it. Pieces work
// together through shared global variables and messages, set out in the
// "contract" below, so a player, the level, coins and enemies made apart
// still fit.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_LEVEL = [
    '............................................................',
    '............................................................',
    '............................................................',
    '............................................................',
    '............................................................',
    '............................................................',
    '........................................................o...',
    '.................................oo....................###..',
    '................................####........................',
    '.............ooo.......oooo...........oooo..................',
    '............#####.....######.........######.........###.....',
    '..............................##..........................#.',
    '..P.....ooo.....o.........e...##...e.........ooo..e.......#.',
    '##################...#################....##################',
    '##################...#################....##################'
];

const key = (value, what) => ({default: value, kind: 'key', description: what});
const number = (value, what) => ({default: value, kind: 'number', description: what});
const char = (value, what) => ({default: value, kind: 'char', description: what});

export const CONTRACT = `How the pieces fit together:
- World coordinates: x from 0 at the left of the map, y from 0 at its bottom. A map
  character at column c, row r (from 1, top row first) is the tile from
  x = (c - 1) * tileSize to c * tileSize, y = (levelRowCount - r) * tileSize upwards.
- viewX, viewY: the world point at the middle of the screen. Anything in the world
  draws itself at goToXY(worldX - viewX, worldY - viewY).
- The player sets playerX, playerY (its centre) and playerVY every frame, then sends
  "render". Everything else moves and draws itself when it receives "render", so the
  whole screen moves together.
- "game start" is sent by the Stage once the map is ready: start there, not on the
  green flag. "player hit" sends the player back to the start (the platformer listens
  for it and sends it when falling out of the map; give a top-down player the same
  listener once something can hurt it). "bounce" springs it up.
- Globals: levelRows (list), tileSize, solidTiles, tileChars, levelCols, levelRowCount,
  spawnX, spawnY, camX, camY, viewX, viewY, playerX, playerY, playerVY, score.
- Fencing must be off (set_game_options), or sprites near the edges are pushed back
  onto the screen. Adding a piece that needs it turns it off.`;

export const PIECES = {
    level: {
        title: 'Level map',
        sprite: 'Stage',
        description: 'The map as text rows, read once at the green flag; finds the "P" start; sends ' +
            '"game start". Every other piece needs it.',
        params: {
            ROWS: {default: DEFAULT_LEVEL, kind: 'rows', description: 'The map: one string per row, top first, ' +
                'all the same length. # solid, . air, P start, o coin, e enemy (any characters you like).'},
            TILE_SIZE: number(24, 'Size of one tile in steps. 15 rows of 24 fill the 360-step-tall stage.'),
            SOLID: {default: '#', kind: 'chars', description: 'Characters the player cannot pass through'},
            DRAWN: {default: '#', kind: 'chars', description: 'Characters the tiles piece draws (each needs a ' +
                'costume of that name on the Tiles sprite)'}
        }
    },
    collision: {
        title: 'Tile collision',
        sprite: 'any',
        description: 'tileAt(x, y), solidAt(x, y) and boxHits(left, bottom, right, top) against the map. ' +
            'Added for you with the pieces that need it; add it alone to any sprite that has to know about walls.',
        params: {}
    },
    tiles: {
        title: 'Tile drawing',
        sprite: 'Tiles',
        description: 'Stamps the visible part of the map with the pen every frame. Needs one costume per ' +
            'drawn character, named that character.',
        options: {fencing: false},
        params: {}
    },
    platformer: {
        title: 'Platformer player',
        sprite: 'Player',
        requires: ['collision'],
        description: 'Run, jump (coyote time, jump buffering, short hops), land on tiles, fall in pits, ' +
            'camera follow, walk/jump animation by costume name.',
        options: {fencing: false},
        params: {
            LEFT: key('left arrow', 'Key to run left'),
            RIGHT: key('right arrow', 'Key to run right'),
            JUMP_KEY: key('up arrow', 'Key to jump'),
            ACCEL: number(1.5, 'Speed gained per frame while running; top speed is about 3 times this'),
            FRICTION: number(0.75, 'Speed kept each frame, 0 to 1. Lower stops sooner'),
            GRAVITY: number(0.9, 'Speed lost per frame falling'),
            JUMP: number(13, 'Jump speed. 13 with gravity 0.9 jumps about 3.5 tiles of 24'),
            HALF_WIDTH: number(8, 'Half the hitbox width'),
            HALF_HEIGHT: number(12, 'Half the hitbox height')
        }
    },
    topdown: {
        title: 'Top-down player',
        sprite: 'Player',
        requires: ['collision'],
        description: 'Eight-direction walking through a tile map, sliding along walls, camera follow, ' +
            'four-way animation by costume name.',
        options: {fencing: false},
        params: {
            LEFT: key('left arrow', 'Key to walk left'),
            RIGHT: key('right arrow', 'Key to walk right'),
            UP: key('up arrow', 'Key to walk up'),
            DOWN: key('down arrow', 'Key to walk down'),
            ACCEL: number(1.2, 'Speed gained per frame'),
            FRICTION: number(0.7, 'Speed kept each frame, 0 to 1'),
            HALF_WIDTH: number(8, 'Half the hitbox width'),
            HALF_HEIGHT: number(8, 'Half the hitbox height')
        }
    },
    coins: {
        title: 'Collectibles',
        sprite: 'Coin',
        description: 'A clone at every matching map character; the player picks it up and score goes up.',
        options: {fencing: false},
        params: {
            CHAR: char('o', 'Map character to place one at'),
            REACH: number(14, 'How close the player has to be, in steps')
        }
    },
    enemy: {
        title: 'Walking enemies',
        sprite: 'Enemy',
        requires: ['collision'],
        description: 'A clone at every matching map character, walking its platform and turning at walls ' +
            'and edges. Hurts the player from the side; squashed from above.',
        options: {fencing: false},
        params: {
            CHAR: char('e', 'Map character to place one at'),
            SPEED: number(1, 'Steps per frame'),
            HALF_WIDTH: number(10, 'Half its width'),
            HALF_HEIGHT: number(12, 'Half its height')
        }
    }
};

const KEY_NAMES = new Set(['space', 'up arrow', 'down arrow', 'left arrow', 'right arrow', 'enter', 'any']);

const checkParam = (piece, name, spec, value) => {
    const where = `${piece} setting ${name}`;
    switch (spec.kind) {
    case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${where} must be a number.`);
        return String(value);
    case 'key':
        if (!KEY_NAMES.has(value) && !(typeof value === 'string' && /^[a-z0-9]$/.test(value))) {
            throw new Error(`${where} must be a key as keyPressed names it: "space", "left arrow", "a", ...`);
        }
        return value;
    case 'char':
        if (typeof value !== 'string' || [...value].length !== 1 || /["\\0-9]/.test(value)) {
            throw new Error(`${where} must be one character, not a digit, quote or backslash.`);
        }
        return value;
    case 'chars':
        if (typeof value !== 'string' || !value.length || /["\\]/.test(value)) {
            throw new Error(`${where} must be some characters, with no quotes or backslashes.`);
        }
        return value;
    case 'rows': {
        const rows = typeof value === 'string' ? value.split('\n').filter(r => r.length) : value;
        if (!Array.isArray(rows) || !rows.length) throw new Error(`${where} must be a list of strings.`);
        const width = [...rows[0]].length;
        rows.forEach((row, i) => {
            if (typeof row !== 'string' || /["\\]/.test(row)) {
                throw new Error(`${where}: row ${i + 1} must be a string with no quotes or backslashes.`);
            }
            if ([...row].length !== width) {
                throw new Error(`${where}: row ${i + 1} is ${[...row].length} long but row 1 is ${width}. ` +
                    'Every row must be the same length.');
            }
        });
        return rows;
    }
    default:
        return String(value);
    }
};

/**
 * A piece's text with its settings filled in.
 * @param {string} name the piece
 * @param {object} [given] settings to use instead of the defaults
 * @returns {string} Flipwarp text
 */
export const pieceText = (name, given = {}) => {
    const piece = PIECES[name];
    if (!piece) throw new Error(`There is no piece "${name}". There are: ${Object.keys(PIECES).join(', ')}.`);
    for (const k of Object.keys(given)) {
        if (!piece.params[k]) {
            throw new Error(`The ${name} piece has no setting ${k}. It has: ` +
                `${Object.keys(piece.params).join(', ') || 'none'}.`);
        }
    }
    let text = fs.readFileSync(path.join(here, `${name}.fw`), 'utf8').replace(/\r\n/g, '\n');
    for (const [k, spec] of Object.entries(piece.params)) {
        const value = checkParam(name, k, spec, k in given ? given[k] : spec.default);
        if (spec.kind === 'rows') {
            text = text.replace(new RegExp(`^([ \\t]*)\\{\\{${k}\\}\\}$`, 'm'),
                (_, indent) => value.map(row => `${indent}  addToList(levelRows, "${row}");`).join('\n'));
        } else {
            text = text.split(`{{${k}}}`).join(value);
        }
    }
    const left = text.match(/\{\{[A-Z_]+\}\}/);
    if (left) throw new Error(`The ${name} piece still has ${left[0]} in it.`);
    return text;
};

// --- putting a piece into a sprite that already has text ----------------------

const DECLARATION = /^\s*(global\s+)?(variable|list|broadcast)\s+([A-Za-z_$][\w$]*)\b.*;\s*$/;
const DEFINE = /^\s*define\s+(?:fast\s+)?([A-Za-z_$][\w$]*)\s*\(/;

export const definesIn = text => text.split('\n').map(l => DEFINE.exec(l)).filter(Boolean)
    .map(m => m[1]);

const split = text => {
    const decls = [];
    const body = [];
    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
        if (DECLARATION.test(line)) decls.push(line.trim());
        else body.push(line);
    }
    return {decls, body: body.join('\n').trim()};
};

const declKey = line => {
    const m = DECLARATION.exec(line);
    return `${m[2]} ${m[3]}`;
};

/**
 * A sprite's text with pieces added: declarations together at the top, each
 * name once, then what the sprite had, then each piece's scripts.
 * @param {string} existing the sprite's text now
 * @param {string[]} pieces texts to add
 * @returns {string} the whole sprite
 */
export const mergeText = (existing, pieces) => {
    const parts = [split(existing), ...pieces.map(split)];
    const seen = new Set();
    const decls = [];
    for (const part of parts) {
        for (const line of part.decls) {
            const k = declKey(line);
            if (seen.has(k)) continue;
            seen.add(k);
            decls.push(line);
        }
    }
    const bodies = parts.map(p => p.body).filter(Boolean);
    return `${decls.join('\n')}\n\n${bodies.join('\n\n')}\n`;
};

/**
 * The text to add for a piece, with the pieces it needs that the sprite does
 * not have yet. Refuses a piece whose custom blocks the sprite already has.
 * @param {string} name the piece
 * @param {object} settings its settings
 * @param {string} existing the sprite's text now
 * @returns {{texts: string[], added: string[]}} texts in order, and their names
 */
export const piecesToAdd = (name, settings, existing) => {
    const have = new Set(definesIn(existing));
    const texts = [];
    const added = [];
    for (const need of PIECES[name] ? PIECES[name].requires || [] : []) {
        const text = pieceText(need);
        if (definesIn(text).every(d => have.has(d))) continue;
        texts.push(text);
        added.push(need);
    }
    const main = pieceText(name, settings);
    const clash = definesIn(main).filter(d => have.has(d));
    if (clash.length) {
        throw new Error(`This sprite already has ${clash.join(', ')}, so the ${name} piece would clash with ` +
            'it. Use get_piece to read the piece and fit it in by hand, or put it on another sprite.');
    }
    texts.push(main);
    added.push(name);
    return {texts, added};
};
