// Pathfinding — Flipwarp
//
// Getting from here to there without walking into the walls. Scratch's answer
// is "point towards and move", which works until something is in the way and
// then presses the sprite into a corner forever.
//
// The world here is a grid of squares, each either open or blocked, laid over
// the stage. You mark the walls, ask for a route, and step along it. The route
// is found with A* — the same method used everywhere for this — which is
// Dijkstra's with a hint about which direction the goal is in, so it looks at
// far fewer squares than it otherwise would.
//
// The grid is its own thing rather than something read off a tilemap, so this
// is useful on its own. A tilemap can fill it in later.

(function (Scratch) {
    'use strict';

    const STAGE = {width: 480, height: 360};

    class FlipwarpPathfinding {
        constructor () {
            this.square = 24;
            this.blocked = new Set();
            this.route = [];
            this.looked = 0;
        }

        getInfo () {
            return {
                id: 'flipwarpPathfinding',
                name: 'Pathfinding',
                color1: '#b8873f',
                color2: '#966d31',
                blocks: [
                    {
                        opcode: 'setSquare',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'use squares [SIZE] steps across',
                        arguments: {
                            SIZE: {type: Scratch.ArgumentType.NUMBER, defaultValue: 24}
                        }
                    },
                    {
                        opcode: 'clearWalls',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'clear all walls'
                    },
                    {
                        opcode: 'blockAt',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'put a wall at x [X] y [Y]',
                        arguments: {
                            X: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0},
                            Y: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0}
                        }
                    },
                    {
                        opcode: 'unblockAt',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'clear the wall at x [X] y [Y]',
                        arguments: {
                            X: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0},
                            Y: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0}
                        }
                    },
                    {
                        opcode: 'isBlocked',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'wall at x [X] y [Y]?',
                        arguments: {
                            X: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0},
                            Y: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0}
                        }
                    },
                    '---',
                    {
                        opcode: 'findFromMe',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'find a route from me to x [X] y [Y]',
                        arguments: {
                            X: {type: Scratch.ArgumentType.NUMBER, defaultValue: 100},
                            Y: {type: Scratch.ArgumentType.NUMBER, defaultValue: 100}
                        }
                    },
                    {
                        opcode: 'find',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'find a route from x [FX] y [FY] to x [TX] y [TY]',
                        arguments: {
                            FX: {type: Scratch.ArgumentType.NUMBER, defaultValue: -100},
                            FY: {type: Scratch.ArgumentType.NUMBER, defaultValue: -100},
                            TX: {type: Scratch.ArgumentType.NUMBER, defaultValue: 100},
                            TY: {type: Scratch.ArgumentType.NUMBER, defaultValue: 100}
                        }
                    },
                    {
                        opcode: 'found',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'route found?'
                    },
                    '---',
                    {
                        opcode: 'steps',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'steps in the route'
                    },
                    {
                        opcode: 'stepX',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'x of step [N]',
                        arguments: {
                            N: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    {
                        opcode: 'stepY',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'y of step [N]',
                        arguments: {
                            N: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    {
                        opcode: 'goToStep',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'go to step [N] of the route',
                        arguments: {
                            N: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    {
                        opcode: 'directionOfNextStep',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'direction of the next step from me'
                    },
                    {
                        opcode: 'squaresLookedAt',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'squares looked at'
                    }
                ]
            };
        }

        // --- the grid ----------------------------------------------------

        // A square is named by the pair of whole numbers it sits at. Stage
        // coordinates have their middle at zero and go negative, which whole
        // division handles as long as it rounds down rather than towards zero.
        cellOf (x, y) {
            return [Math.floor(x / this.square), Math.floor(y / this.square)];
        }

        middleOf (i, j) {
            return [
                (i * this.square) + (this.square / 2),
                (j * this.square) + (this.square / 2)
            ];
        }

        setSquare (args) {
            const size = Scratch.Cast.toNumber(args.SIZE);
            this.square = size >= 4 ? size : 4;
            // The walls were marked in squares of the old size and mean
            // something different in squares of the new one.
            this.blocked = new Set();
            this.route = [];
        }

        clearWalls () {
            this.blocked = new Set();
        }

        blockAt (args) {
            const [i, j] = this.cellOf(
                Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y));
            this.blocked.add(`${i},${j}`);
        }

        unblockAt (args) {
            const [i, j] = this.cellOf(
                Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y));
            this.blocked.delete(`${i},${j}`);
        }

        isBlocked (args) {
            const [i, j] = this.cellOf(
                Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y));
            return this.blocked.has(`${i},${j}`);
        }

        // --- finding a way through ---------------------------------------

        /**
         * A* over the grid.
         * @param {number} fromX where to start
         * @param {number} fromY where to start
         * @param {number} toX where to end
         * @param {number} toY where to end
         * @returns {Array} the middles of the squares to walk through
         */
        search (fromX, fromY, toX, toY) {
            const start = this.cellOf(fromX, fromY);
            const goal = this.cellOf(toX, toY);
            const startKey = `${start[0]},${start[1]}`;
            const goalKey = `${goal[0]},${goal[1]}`;
            this.looked = 0;

            if (this.blocked.has(goalKey)) return [];
            if (startKey === goalKey) return [this.middleOf(goal[0], goal[1])];

            // Routes stay on the stage. Letting them wander off the edge
            // sounds harmless and is not: a wall built right across the stage
            // would be walked around through the wings, so a door built into
            // it would mean nothing. A sprite that has drifted off the edge
            // can still find its way back, because where it starts is never
            // ruled out — only where it may step next.
            const limit = {
                left: Math.floor((-STAGE.width / 2) / this.square),
                right: Math.floor(((STAGE.width / 2) - 1) / this.square),
                bottom: Math.floor((-STAGE.height / 2) / this.square),
                top: Math.floor(((STAGE.height / 2) - 1) / this.square)
            };

            // How far the goal is if nothing were in the way. Diagonal steps
            // cost about 1.414, so the guess uses that too — a guess that is
            // never an overestimate is what keeps the answer the shortest one.
            const guess = (i, j) => {
                const dx = Math.abs(i - goal[0]);
                const dy = Math.abs(j - goal[1]);
                return (Math.min(dx, dy) * Math.SQRT2) + Math.abs(dx - dy);
            };

            const cameFrom = new Map();
            const costSoFar = new Map([[startKey, 0]]);
            // A plain list kept in order rather than a heap: the grids a stage
            // holds are small enough that the tidier thing wins nothing, and
            // the untidy thing is one line.
            const open = [{i: start[0], j: start[1], key: startKey, score: guess(start[0], start[1])}];
            const done = new Set();

            while (open.length) {
                let bestAt = 0;
                for (let k = 1; k < open.length; k++) {
                    if (open[k].score < open[bestAt].score) bestAt = k;
                }
                const here = open.splice(bestAt, 1)[0];
                if (done.has(here.key)) continue;
                done.add(here.key);
                this.looked++;

                if (here.key === goalKey) {
                    const route = [];
                    let key = goalKey;
                    let at = [goal[0], goal[1]];
                    while (key !== startKey) {
                        route.unshift(this.middleOf(at[0], at[1]));
                        const previous = cameFrom.get(key);
                        if (!previous) break;
                        at = previous;
                        key = `${at[0]},${at[1]}`;
                    }
                    return route;
                }

                for (let di = -1; di <= 1; di++) {
                    for (let dj = -1; dj <= 1; dj++) {
                        if (di === 0 && dj === 0) continue;
                        const i = here.i + di;
                        const j = here.j + dj;
                        if (i < limit.left || i > limit.right ||
                            j < limit.bottom || j > limit.top) continue;
                        const key = `${i},${j}`;
                        if (this.blocked.has(key) || done.has(key)) continue;
                        // No cutting the corner between two walls: a sprite
                        // that does looks like it walked through the join.
                        if (di !== 0 && dj !== 0) {
                            if (this.blocked.has(`${here.i + di},${here.j}`) ||
                                this.blocked.has(`${here.i},${here.j + dj}`)) continue;
                        }
                        const step = (di !== 0 && dj !== 0) ? Math.SQRT2 : 1;
                        const cost = costSoFar.get(here.key) + step;
                        if (costSoFar.has(key) && cost >= costSoFar.get(key)) continue;
                        costSoFar.set(key, cost);
                        cameFrom.set(key, [here.i, here.j]);
                        open.push({i, j, key, score: cost + guess(i, j)});
                    }
                }
            }
            return [];
        }

        find (args) {
            this.route = this.search(
                Scratch.Cast.toNumber(args.FX), Scratch.Cast.toNumber(args.FY),
                Scratch.Cast.toNumber(args.TX), Scratch.Cast.toNumber(args.TY));
        }

        findFromMe (args, util) {
            this.route = this.search(
                util.target.x, util.target.y,
                Scratch.Cast.toNumber(args.X), Scratch.Cast.toNumber(args.Y));
        }

        found () {
            return this.route.length > 0;
        }

        steps () {
            return this.route.length;
        }

        at (n) {
            // Counted from one, as Scratch counts everything.
            return this.route[Scratch.Cast.toNumber(n) - 1] || null;
        }

        stepX (args) {
            const step = this.at(args.N);
            return step ? Math.round(step[0] * 100) / 100 : 0;
        }

        stepY (args) {
            const step = this.at(args.N);
            return step ? Math.round(step[1] * 100) / 100 : 0;
        }

        goToStep (args, util) {
            const step = this.at(args.N);
            if (step) util.target.setXY(step[0], step[1]);
        }

        directionOfNextStep (args, util) {
            const me = util.target;
            // The first step still ahead of the sprite, so this works whether
            // it is walking the route or being carried along it.
            for (const step of this.route) {
                const dx = step[0] - me.x;
                const dy = step[1] - me.y;
                if (Math.sqrt((dx * dx) + (dy * dy)) < this.square / 2) continue;
                const degrees = (Math.atan2(dx, dy) * 180) / Math.PI;
                return Math.round(degrees * 100) / 100;
            }
            return me.direction;
        }

        squaresLookedAt () {
            return this.looked;
        }
    }

    Scratch.extensions.register(new FlipwarpPathfinding());
}(Scratch));
