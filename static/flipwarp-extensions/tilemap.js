// Tilemap — Flipwarp
//
// A level built out of squares, which is how nearly every platformer, maze and
// top-down game is actually built, and which Scratch has no way of saying. The
// usual workarounds are a list of numbers with the width remembered in your
// head, or one clone per tile — the first is unreadable and the second falls
// over at a few hundred tiles.
//
// This owns the grid and the arithmetic. It does not draw: what a tile looks
// like is a costume, and stamping costumes is something the project already
// knows how to do. What it gives you instead is the two things that are
// genuinely fiddly — turning stage coordinates into tiles and back, and asking
// whether a move would put you inside a wall — and a way to write a level down
// as text, which is the only form a level is readable in.
//
//     ##########
//     #..@.....#
//     #...####.#
//     #........#
//     ##########
//
// That is a map. Every character is a tile, the first line is the top, and the
// characters mean whatever you say they mean. It reads as the level it is, it
// survives being pasted into a comment, and it fits how the rest of Flipwarp
// works: a thing you can look at as text and edit as text.
//
// Which characters are solid is a separate question from what they look like,
// so a door can be drawn as a wall and walked through, and a pit can be drawn
// as floor and not.

(function (Scratch) {
    'use strict';

    const vm = Scratch.vm;

    const DEFAULT_TILE = 32;
    const EMPTY = '.';

    // A map written out as lines. Deliberately not JSON: this is meant to be
    // typed by hand and read at a glance.
    const EXAMPLE = [
        '##########',
        '#........#',
        '#..####..#',
        '#........#',
        '##########'
    ].join('\n');

    class FlipwarpTilemap {
        constructor () {
            this.size = DEFAULT_TILE;
            // Row 0 is the top row, the way it is written down.
            this.rows = [];
            this.width = 0;
            this.height = 0;
            this.solid = new Set(['#']);
            // Where the top-left corner of the map sits on the stage. Set when
            // the map is loaded so that a map smaller than the stage is
            // centred rather than starting in a corner.
            this.originX = 0;
            this.originY = 0;
        }

        getInfo () {
            return {
                id: 'flipwarpTilemap',
                name: 'Tilemap',
                color1: '#8a6bbf',
                color2: '#6f55a0',
                blocks: [
                    {
                        opcode: 'load',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'use map [MAP]',
                        arguments: {
                            MAP: {type: Scratch.ArgumentType.STRING, defaultValue: EXAMPLE}
                        }
                    },
                    {
                        opcode: 'setTileSize',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'make each tile [SIZE] steps across',
                        arguments: {
                            SIZE: {type: Scratch.ArgumentType.NUMBER, defaultValue: DEFAULT_TILE}
                        }
                    },
                    {
                        opcode: 'setSolid',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'treat [CHARS] as walls',
                        arguments: {
                            CHARS: {type: Scratch.ArgumentType.STRING, defaultValue: '#'}
                        }
                    },
                    '---',
                    {
                        opcode: 'tileAtColumnRow',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'tile at column [COL] row [ROW]',
                        arguments: {
                            COL: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1},
                            ROW: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    {
                        opcode: 'tileAt',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'tile at x [X] y [Y]',
                        arguments: {
                            X: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0},
                            Y: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0}
                        }
                    },
                    {
                        opcode: 'tileUnderMe',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'tile under me'
                    },
                    {
                        opcode: 'setTile',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'put [TILE] at column [COL] row [ROW]',
                        arguments: {
                            TILE: {type: Scratch.ArgumentType.STRING, defaultValue: '#'},
                            COL: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1},
                            ROW: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    '---',
                    {
                        opcode: 'isWallAt',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'wall at x [X] y [Y]?',
                        arguments: {
                            X: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0},
                            Y: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0}
                        }
                    },
                    {
                        opcode: 'wouldHitWall',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'would I hit a wall moving [DX] across and [DY] up?',
                        arguments: {
                            DX: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0},
                            DY: {type: Scratch.ArgumentType.NUMBER, defaultValue: -8}
                        }
                    },
                    {
                        opcode: 'slideBy',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'move [DX] across and [DY] up, stopping at walls',
                        arguments: {
                            DX: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0},
                            DY: {type: Scratch.ArgumentType.NUMBER, defaultValue: -8}
                        }
                    },
                    '---',
                    {
                        opcode: 'tileCount',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'number of tiles'
                    },
                    {
                        opcode: 'goToTile',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'go to the middle of tile [N]',
                        arguments: {
                            N: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    {
                        opcode: 'tileNumber',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'tile number [N]',
                        arguments: {
                            N: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    {
                        opcode: 'columns',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'columns'
                    },
                    {
                        opcode: 'rowCount',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'rows'
                    },
                    '---',
                    {
                        opcode: 'firstX',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'x of the first [TILE]',
                        arguments: {
                            TILE: {type: Scratch.ArgumentType.STRING, defaultValue: '@'}
                        }
                    },
                    {
                        opcode: 'firstY',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'y of the first [TILE]',
                        arguments: {
                            TILE: {type: Scratch.ArgumentType.STRING, defaultValue: '@'}
                        }
                    },
                    {
                        opcode: 'countOf',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'how many [TILE]',
                        arguments: {
                            TILE: {type: Scratch.ArgumentType.STRING, defaultValue: '#'}
                        }
                    },
                    '---',
                    {
                        opcode: 'asText',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'the map as text'
                    },
                    {
                        opcode: 'sendWallsToPathfinding',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'give the walls to Pathfinding'
                    }
                ]
            };
        }

        // --- the grid ----------------------------------------------------

        /**
         * Read a map written as lines.
         *
         * Short lines are padded rather than refused: a map typed by hand has
         * trailing spaces trimmed by every editor there is, and refusing it
         * would mean the thing that reads best is the thing that does not
         * work.
         * @param {object} args the block's arguments
         */
        load (args) {
            const text = Scratch.Cast.toString(args.MAP).replace(/\r/g, '');
            const lines = text.split('\n');
            // A leading or trailing blank line is what you get from writing a
            // map on its own lines in a text block, and is not part of it.
            while (lines.length && lines[0].trim() === '') lines.shift();
            while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();

            this.width = lines.reduce((n, line) => Math.max(n, line.length), 0);
            this.height = lines.length;
            this.rows = lines.map(line => {
                const cells = Array.from(line);
                while (cells.length < this.width) cells.push(EMPTY);
                return cells;
            });
            this.centre();
        }

        // Where the map's top-left corner goes. Centred on the stage, so a map
        // that fits is in the middle and one that does not overhangs evenly
        // rather than running off one side.
        centre () {
            this.originX = -((this.width * this.size) / 2);
            this.originY = (this.height * this.size) / 2;
        }

        setTileSize (args) {
            const size = Scratch.Cast.toNumber(args.SIZE);
            this.size = size >= 1 ? size : 1;
            this.centre();
        }

        setSolid (args) {
            this.solid = new Set(Array.from(Scratch.Cast.toString(args.CHARS)));
        }

        // Stage coordinates to column and row. Row 0 is the top, because that
        // is the row written first, and stage y counts the other way.
        cellOf (x, y) {
            return [
                Math.floor((x - this.originX) / this.size),
                Math.floor((this.originY - y) / this.size)
            ];
        }

        middleOf (col, row) {
            return [
                this.originX + (col * this.size) + (this.size / 2),
                this.originY - (row * this.size) - (this.size / 2)
            ];
        }

        inside (col, row) {
            return col >= 0 && row >= 0 && col < this.width && row < this.height;
        }

        at (col, row) {
            if (!this.inside(col, row)) return '';
            return this.rows[row][col];
        }

        // --- reading it --------------------------------------------------

        // Columns and rows are counted from one in the blocks, because every
        // other number a Scratch project deals with is.
        tileAtColumnRow (args) {
            return this.at(
                Scratch.Cast.toNumber(args.COL) - 1,
                Scratch.Cast.toNumber(args.ROW) - 1
            );
        }

        tileAt (args) {
            const [col, row] = this.cellOf(
                Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y));
            return this.at(col, row);
        }

        tileUnderMe (args, util) {
            const target = util.target;
            const [col, row] = this.cellOf(target.x, target.y);
            return this.at(col, row);
        }

        setTile (args) {
            const col = Scratch.Cast.toNumber(args.COL) - 1;
            const row = Scratch.Cast.toNumber(args.ROW) - 1;
            if (!this.inside(col, row)) return;
            const tile = Scratch.Cast.toString(args.TILE);
            // One character, because a tile is one character everywhere else
            // in this extension and a two-character tile would make the map
            // text unreadable.
            this.rows[row][col] = tile.length ? Array.from(tile)[0] : EMPTY;
        }

        columns () {
            return this.width;
        }

        rowCount () {
            return this.height;
        }

        tileCount () {
            return this.width * this.height;
        }

        // Tiles are numbered along each row in turn, the way they are written.
        placeOf (n) {
            const index = Math.round(Scratch.Cast.toNumber(n)) - 1;
            if (index < 0 || index >= this.width * this.height || this.width === 0) return null;
            return [index % this.width, Math.floor(index / this.width)];
        }

        tileNumber (args) {
            const place = this.placeOf(args.N);
            return place ? this.at(place[0], place[1]) : '';
        }

        goToTile (args, util) {
            const place = this.placeOf(args.N);
            if (!place) return;
            const [x, y] = this.middleOf(place[0], place[1]);
            util.target.setXY(x, y);
        }

        find (tile) {
            const wanted = Scratch.Cast.toString(tile);
            const first = wanted.length ? Array.from(wanted)[0] : EMPTY;
            for (let row = 0; row < this.height; row++) {
                for (let col = 0; col < this.width; col++) {
                    if (this.rows[row][col] === first) return [col, row];
                }
            }
            return null;
        }

        firstX (args) {
            const place = this.find(args.TILE);
            return place ? this.middleOf(place[0], place[1])[0] : 0;
        }

        firstY (args) {
            const place = this.find(args.TILE);
            return place ? this.middleOf(place[0], place[1])[1] : 0;
        }

        countOf (args) {
            const wanted = Scratch.Cast.toString(args.TILE);
            const first = wanted.length ? Array.from(wanted)[0] : EMPTY;
            let found = 0;
            for (const row of this.rows) {
                for (const cell of row) if (cell === first) found++;
            }
            return found;
        }

        asText () {
            return this.rows.map(row => row.join('')).join('\n');
        }

        // --- walls ---------------------------------------------------------

        solidAt (col, row) {
            // Outside the map counts as solid: a level with an open edge is a
            // level you fall out of, and a sprite that has left the map has
            // nothing sensible to be told about where it is.
            if (!this.inside(col, row)) return true;
            return this.solid.has(this.rows[row][col]);
        }

        isWallAt (args) {
            const [col, row] = this.cellOf(
                Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y));
            return this.solidAt(col, row);
        }

        wouldHitWall (args, util) {
            const target = util.target;
            const dx = Scratch.Cast.toNumber(args.DX);
            const dy = Scratch.Cast.toNumber(args.DY);
            const [col, row] = this.cellOf(target.x + dx, target.y + dy);
            return this.solidAt(col, row);
        }

        /**
         * Move, but stop at the wall rather than in it.
         *
         * The two directions are tried separately, which is the difference
         * between a game that slides along a wall and one that sticks to it:
         * walking diagonally into a wall you can still walk along should still
         * move you along it.
         * @param {object} args the block's arguments
         * @param {object} util the block's context
         */
        slideBy (args, util) {
            const target = util.target;
            const dx = Scratch.Cast.toNumber(args.DX);
            const dy = Scratch.Cast.toNumber(args.DY);
            let x = target.x;
            let y = target.y;

            const free = (nx, ny) => {
                const [col, row] = this.cellOf(nx, ny);
                return !this.solidAt(col, row);
            };

            // Stepped rather than jumped, so a fast sprite cannot pass through
            // a wall thinner than its own speed.
            const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (this.size / 2)));
            const stepX = dx / steps;
            const stepY = dy / steps;
            for (let i = 0; i < steps; i++) {
                if (free(x + stepX, y)) x += stepX;
                if (free(x, y + stepY)) y += stepY;
            }
            target.setXY(x, y);
        }

        /**
         * Hand the walls to the Pathfinding extension, if it is loaded.
         *
         * Without this, giving a route-finder a level means a loop that reads
         * every tile and writes it back one block at a time — hundreds of
         * blocks running to say something both extensions already know.
         */
        sendWallsToPathfinding () {
            const other = vm && vm.runtime && vm.runtime.ext_flipwarpPathfinding;
            if (!other || typeof other.clearWalls !== 'function') return;
            // Its squares are its own business, but a route through squares
            // that are not the tiles will go through walls, so they are made
            // to agree.
            other.setSquare({SIZE: this.size});
            other.clearWalls();
            for (let row = 0; row < this.height; row++) {
                for (let col = 0; col < this.width; col++) {
                    if (!this.solid.has(this.rows[row][col])) continue;
                    const [x, y] = this.middleOf(col, row);
                    other.blockAt({X: x, Y: y});
                }
            }
        }
    }

    Scratch.extensions.register(new FlipwarpTilemap());
}(Scratch));
