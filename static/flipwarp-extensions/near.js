// Near. Flipwarp
//
// "Which sprites are close to me" is a question Scratch answers by asking every
// sprite in turn. With twenty clones that is four hundred comparisons a frame
// and nobody notices. With four hundred clones it is a hundred and sixty
// thousand, and the project crawls, which is where most ambitious Scratch
// games stop.
//
// This keeps a coarse grid of where everything is. Only the handful of squares
// around you are looked at, so the work stops growing with the number of
// sprites and starts growing with how crowded your own corner is.
//
// The grid is rebuilt when asked rather than every frame, because a project
// that moves everything and then asks one question should not pay for a rebuild
// per question, and one that asks a hundred questions between moves should not
// pay for a hundred rebuilds.
//
// It is thrown away, though, at the moments it is certainly wrong: the green
// flag, the stop button, and a sprite or a clone coming or going. None of those
// is movement, they are the project becoming a different set of sprites, and a
// note of where the old set was is worse than no note at all.

(function (Scratch) {
    'use strict';

    const vm = Scratch.vm;

    // Squares this size across. Big enough that most questions look at nine of
    // them and no more; small enough that a square is not the whole stage.
    const DEFAULT_SQUARE = 48;

    class FlipwarpNear {
        constructor () {
            this.square = DEFAULT_SQUARE;
            this.grid = new Map();
            this.built = false;
            this.counted = 0;
            this.watchTheProject();
        }

        getInfo () {
            return {
                id: 'flipwarpNear',
                name: 'Near',
                color1: '#4f9e5c',
                color2: '#3f8049',
                blocks: [
                    {
                        opcode: 'rebuild',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'note where every sprite is'
                    },
                    {
                        opcode: 'setSquare',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'use squares [SIZE] steps across',
                        arguments: {
                            SIZE: {type: Scratch.ArgumentType.NUMBER, defaultValue: DEFAULT_SQUARE}
                        }
                    },
                    '---',
                    {
                        opcode: 'countNear',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'how many within [RANGE] of me',
                        arguments: {
                            RANGE: {type: Scratch.ArgumentType.NUMBER, defaultValue: 40}
                        }
                    },
                    {
                        opcode: 'anyNear',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'anything within [RANGE] of me?',
                        arguments: {
                            RANGE: {type: Scratch.ArgumentType.NUMBER, defaultValue: 40}
                        }
                    },
                    {
                        opcode: 'nearestDistance',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'distance to the nearest within [RANGE]',
                        arguments: {
                            RANGE: {type: Scratch.ArgumentType.NUMBER, defaultValue: 200}
                        }
                    },
                    {
                        opcode: 'nearestDirection',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'direction of the nearest within [RANGE]',
                        arguments: {
                            RANGE: {type: Scratch.ArgumentType.NUMBER, defaultValue: 200}
                        }
                    },
                    '---',
                    {
                        opcode: 'countNearPoint',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'how many within [RANGE] of x [X] y [Y]',
                        arguments: {
                            RANGE: {type: Scratch.ArgumentType.NUMBER, defaultValue: 40},
                            X: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0},
                            Y: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0}
                        }
                    },
                    {
                        opcode: 'noted',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'sprites noted'
                    },
                    {
                        opcode: 'looked',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'sprites looked at last time'
                    }
                ]
            };
        }

        setSquare (args) {
            const size = Scratch.Cast.toNumber(args.SIZE);
            // A square of nothing would put every sprite in its own square and
            // make the grid slower than the thing it replaces.
            this.square = size >= 4 ? size : 4;
            this.forget();
        }

        /**
         * Watch for the moments the note is certainly out of date.
         *
         * The grid is a note of where everything was, and a note is only ever
         * wrong at some particular moment. Three of those moments are not
         * about movement at all: the project starting again, which puts every
         * sprite back where it began; the project being stopped, which throws
         * every clone away; and a sprite or a clone appearing or going away,
         * which changes who is in the grid rather than where they are. The
         * last one is why this matters beyond wrong answers: a deleted clone
         * that is still sitting in a bucket cannot be freed, so a project that
         * makes and deletes clones all day would hold every one of them until
         * something happened to ask for a rebuild.
         *
         * Movement is deliberately not on the list. Sprites moving is the
         * commonest thing that happens in a project, and treating it as news
         * would mean a rebuild every frame, which is exactly the cost this
         * extension exists to avoid. A project that moves everything and then
         * wants a fresh answer says so with "note where every sprite is".
         */
        watchTheProject () {
            const runtime = vm && vm.runtime;
            if (!runtime || typeof runtime.on !== 'function') return;
            const forget = () => this.forget();
            runtime.on('PROJECT_START', forget);
            runtime.on('PROJECT_STOP_ALL', forget);
            runtime.on('targetWasCreated', forget);
            runtime.on('targetWasRemoved', forget);
        }

        // Thrown away rather than rebuilt on the spot: a project that never
        // asks another question should not pay for a rebuild, and the sprites
        // in the old grid are let go of straight away rather than being held
        // until whenever the next question comes.
        forget () {
            this.grid = new Map();
            this.counted = 0;
            this.built = false;
        }

        // Which square a place falls in. Squares are named by their corner
        // rather than numbered, so the grid never needs a size or an edge.
        cellOf (x, y) {
            return `${Math.floor(x / this.square)},${Math.floor(y / this.square)}`;
        }

        rebuild () {
            this.grid = new Map();
            this.counted = 0;
            for (const target of vm.runtime.targets) {
                if (target.isStage || !target.visible) continue;
                const key = this.cellOf(target.x, target.y);
                const bucket = this.grid.get(key);
                if (bucket) bucket.push(target);
                else this.grid.set(key, [target]);
                this.counted++;
            }
            this.built = true;
        }

        /**
         * Every sprite in the squares a circle touches. Not every sprite in the
         * circle, the squares are the point, and the caller measures.
         * @param {number} x middle of the circle
         * @param {number} y middle of the circle
         * @param {number} range how far out to look
         * @returns {Array} the sprites worth measuring
         */
        candidates (x, y, range) {
            if (!this.built) this.rebuild();
            const found = [];
            const reach = Math.max(1, Math.ceil(range / this.square));
            const cx = Math.floor(x / this.square);
            const cy = Math.floor(y / this.square);
            for (let i = cx - reach; i <= cx + reach; i++) {
                for (let j = cy - reach; j <= cy + reach; j++) {
                    const bucket = this.grid.get(`${i},${j}`);
                    if (bucket) found.push(...bucket);
                }
            }
            return found;
        }

        measureFrom (x, y, range, skip) {
            const near = [];
            const found = this.candidates(x, y, range);
            this.looking = found.length;
            for (const target of found) {
                if (target === skip) continue;
                const dx = target.x - x;
                const dy = target.y - y;
                const distance = Math.sqrt((dx * dx) + (dy * dy));
                if (distance <= range) near.push({target, distance, dx, dy});
            }
            return near;
        }

        countNear (args, util) {
            const me = util.target;
            return this.measureFrom(me.x, me.y,
                Scratch.Cast.toNumber(args.RANGE), me).length;
        }

        anyNear (args, util) {
            return this.countNear(args, util) > 0;
        }

        nearest (args, util) {
            const me = util.target;
            const near = this.measureFrom(me.x, me.y,
                Scratch.Cast.toNumber(args.RANGE), me);
            let best = null;
            for (const one of near) {
                if (!best || one.distance < best.distance) best = one;
            }
            return best;
        }

        nearestDistance (args, util) {
            const best = this.nearest(args, util);
            // Nothing within range answers with the range itself rather than
            // with zero, which would read as "right on top of me".
            return best ? Math.round(best.distance * 100) / 100 :
                Scratch.Cast.toNumber(args.RANGE);
        }

        nearestDirection (args, util) {
            const best = this.nearest(args, util);
            if (!best) return 90;
            // Scratch's degrees: zero is up, and they run clockwise.
            const degrees = (Math.atan2(best.dx, best.dy) * 180) / Math.PI;
            return Math.round(degrees * 100) / 100;
        }

        countNearPoint (args) {
            return this.measureFrom(
                Scratch.Cast.toNumber(args.X),
                Scratch.Cast.toNumber(args.Y),
                Scratch.Cast.toNumber(args.RANGE),
                null
            ).length;
        }

        noted () {
            if (!this.built) this.rebuild();
            return this.counted;
        }

        looked () {
            // What the grid saved you: how many sprites the last question
            // actually measured, against how many there are.
            return this.looking === undefined ? 0 : this.looking;
        }
    }

    Scratch.extensions.register(new FlipwarpNear());
}(Scratch));
