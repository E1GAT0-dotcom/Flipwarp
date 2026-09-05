// Record and replay input. Flipwarp
//
// Recording what someone pressed, and pressing it again later. Two things this
// is good for: testing a game the same way twice, which is otherwise a matter
// of trying to remember what you did, and attract-mode demos that play
// themselves on the title screen.
//
// What is recorded is the input, not the game. Replay presses the same keys at
// the same moments; whether that produces the same game depends on the project
// being predictable. Anything that uses "pick random" will wander off, and that
// is worth knowing before you go looking for the bug in here.

(function (Scratch) {
    'use strict';

    const vm = Scratch.vm;

    // Times are measured from the moment recording started rather than from
    // the clock, so a recording is the same length whenever it is played.
    const now = () => Date.now();

    // A recording is a list in memory and nothing trims it, so a project that
    // starts recording and never stops would grow it for as long as the tab is
    // open. This is where it stops. The limit is generous on purpose: a mouse
    // moved about without pause records at a few dozen events a second, so
    // this is a good quarter of an hour of that, and ordinary play is a small
    // fraction of it.
    const MOST_EVENTS = 50000;

    class FlipwarpRecordReplay {
        constructor () {
            this.events = [];
            this.recording = false;
            this.startedAt = 0;

            this.playing = false;
            this.playFrom = 0;
            this.playIndex = 0;
            this.playSpeed = 1;
            this.held = new Set();

            // Nothing is listened for and no frames are asked for until
            // something is actually being recorded or played. An extension
            // that is in a project but not in use should cost the page
            // nothing, and the listeners here are on the way down through the
            // page, so leaving them on means every key and every mouse move
            // anybody makes goes through this for the life of the tab.
            this.listening = false;
            this.frameAsked = false;
            this.handlers = this.makeHandlers();
            this.watchTheProject();
        }

        getInfo () {
            return {
                id: 'flipwarpRecordReplay',
                name: 'Record & Replay',
                color1: '#c9683f',
                color2: '#ab5734',
                blocks: [
                    {
                        opcode: 'startRecording',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'start recording input'
                    },
                    {
                        opcode: 'stopRecording',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'stop recording'
                    },
                    {
                        opcode: 'isRecording',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'recording?'
                    },
                    '---',
                    {
                        opcode: 'play',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'play the recording'
                    },
                    {
                        opcode: 'playAndWait',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'play the recording and wait'
                    },
                    {
                        opcode: 'stopPlaying',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'stop playing'
                    },
                    {
                        opcode: 'isPlaying',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'playing?'
                    },
                    {
                        opcode: 'setSpeed',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'play at [SPEED] times speed',
                        arguments: {
                            SPEED: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    '---',
                    {
                        opcode: 'length',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'recording length in seconds'
                    },
                    {
                        opcode: 'count',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'things in the recording'
                    },
                    {
                        opcode: 'asText',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'recording as text'
                    },
                    {
                        opcode: 'fromText',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'use recording [TEXT]',
                        arguments: {
                            TEXT: {type: Scratch.ArgumentType.STRING, defaultValue: ''}
                        }
                    },
                    {
                        opcode: 'clear',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'clear the recording'
                    }
                ]
            };
        }

        // --- starting and stopping with the project ----------------------

        /**
         * The red stop button stops this too.
         *
         * Playback posts keys and mouse clicks straight into the runtime, so a
         * recording still playing after the project was stopped looks exactly
         * like a project that will not stop: keys arriving from nowhere, the
         * mouse moving on its own. Recording is stopped for a quieter reason,
         * that nobody is watching it any more and it would go on growing.
         */
        watchTheProject () {
            const runtime = vm && vm.runtime;
            if (!runtime || typeof runtime.on !== 'function') return;
            runtime.on('PROJECT_STOP_ALL', () => {
                this.stopPlaying();
                this.stopRecording();
            });
        }

        // --- recording --------------------------------------------------

        /**
         * The listeners, made once so that they can be taken off again.
         *
         * A listener with no name is a listener that cannot be removed, which
         * is what went wrong here before: they were added at load, as
         * throwaway functions, and there was no way back.
         * @returns {object} what to listen for, and with what
         */
        makeHandlers () {
            const note = (key, isDown) => {
                if (!this.recording) return;
                this.remember({t: now() - this.startedAt, k: key, d: isDown ? 1 : 0});
            };
            const stage = () => document.querySelector('canvas');
            const place = e => {
                const canvas = stage();
                if (!canvas) return null;
                const box = canvas.getBoundingClientRect();
                if (!box.width || !box.height) return null;
                // Kept as a fraction of the stage rather than in pixels, so a
                // recording made on a phone plays back on a desktop.
                return {
                    x: (e.clientX - box.left) / box.width,
                    y: (e.clientY - box.top) / box.height
                };
            };
            const button = isDown => e => {
                if (!this.recording) return;
                const at = place(e);
                this.remember({
                    t: now() - this.startedAt,
                    b: isDown ? 1 : 0,
                    x: at ? at.x : 0,
                    y: at ? at.y : 0
                });
            };
            return {
                keydown: e => {
                    if (e.repeat) return; // a held key, not a new press
                    note(e.key, true);
                },
                keyup: e => note(e.key, false),
                mousemove: e => {
                    if (!this.recording) return;
                    const at = place(e);
                    if (!at) return;
                    const last = this.events[this.events.length - 1];
                    // A mouse moving across the stage is a hundred events a
                    // second, nearly all of them the same. Only movements
                    // worth a pixel or two are kept.
                    if (last && last.m && Math.abs(last.x - at.x) < 0.004 &&
                        Math.abs(last.y - at.y) < 0.004) return;
                    this.remember({t: now() - this.startedAt, m: 1, x: at.x, y: at.y});
                },
                mousedown: button(true),
                mouseup: button(false)
            };
        }

        // Watched on the way down through the page, so a key is recorded
        // whether or not something else stops it later.
        listen () {
            if (this.listening) return;
            if (typeof document === 'undefined' ||
                typeof document.addEventListener !== 'function') return;
            for (const name of Object.keys(this.handlers)) {
                document.addEventListener(name, this.handlers[name], true);
            }
            this.listening = true;
        }

        deafen () {
            if (!this.listening) return;
            this.listening = false;
            // A page that let them be put on but has no way of taking them off
            // is not a page this has ever run in, and is not worth stopping a
            // project over.
            if (typeof document.removeEventListener !== 'function') return;
            for (const name of Object.keys(this.handlers)) {
                document.removeEventListener(name, this.handlers[name], true);
            }
        }

        // Everything recorded goes through here, so that the limit is in one
        // place and nothing can get past it.
        remember (event) {
            if (this.events.length >= MOST_EVENTS) {
                // Full. Recording stops rather than the oldest being thrown
                // away: a recording that has lost its beginning plays back as
                // nonsense, while one that stops early is still a recording of
                // what happened, and the blocks that report its length and how
                // much is in it say so.
                this.stopRecording();
                return;
            }
            this.events.push(event);
        }

        startRecording () {
            this.stopPlaying();
            this.events = [];
            this.startedAt = now();
            this.recording = true;
            this.listen();
        }

        stopRecording () {
            this.recording = false;
            this.deafen();
        }

        isRecording () {
            return this.recording;
        }

        // --- playing back -----------------------------------------------

        /**
         * Ask for the next frame, and only while something is playing.
         *
         * A frame loop that runs for the life of the page to find that there
         * is nothing to do is the sort of thing that turns up later as a
         * project being slow for no reason anybody can point at. This one ends
         * as soon as playback does: the frame already asked for sees that
         * nothing is playing and does not ask for another.
         */
        everyFrame () {
            if (this.frameAsked) return;
            if (typeof requestAnimationFrame !== 'function') return;
            this.frameAsked = true;
            requestAnimationFrame(() => {
                this.frameAsked = false;
                if (!this.playing) return;
                this.advance();
                this.everyFrame();
            });
        }

        advance () {
            const elapsed = (now() - this.playFrom) * this.playSpeed;
            while (this.playIndex < this.events.length &&
                   this.events[this.playIndex].t <= elapsed) {
                this.perform(this.events[this.playIndex]);
                this.playIndex++;
            }
            if (this.playIndex >= this.events.length) this.stopPlaying();
        }

        perform (event) {
            if (event.k !== undefined) {
                if (event.d) this.held.add(event.k);
                else this.held.delete(event.k);
                vm.postIOData('keyboard', {key: event.k, isDown: Boolean(event.d)});
                return;
            }
            // Mouse positions are given back in the units the runtime wants:
            // a fraction of the stage becomes a place on it.
            const size = vm.runtime.stageWidth ?
                {w: vm.runtime.stageWidth, h: vm.runtime.stageHeight} : {w: 480, h: 360};
            const x = (event.x * size.w) - (size.w / 2);
            const y = (size.h / 2) - (event.y * size.h);
            if (event.m) {
                vm.postIOData('mouse', {x, y, canvasWidth: size.w, canvasHeight: size.h});
            } else {
                vm.postIOData('mouse', {
                    isDown: Boolean(event.b), x, y,
                    canvasWidth: size.w, canvasHeight: size.h
                });
            }
        }

        play () {
            if (!this.events.length) return;
            this.stopRecording();
            this.playing = true;
            this.playIndex = 0;
            this.playFrom = now();
            this.everyFrame();
        }

        playAndWait () {
            this.play();
            // The runtime waits on the promise, so a project can put anything
            // after this block and know the recording finished first.
            return new Promise(resolve => {
                const check = () => {
                    if (!this.playing) resolve();
                    else setTimeout(check, 50);
                };
                check();
            });
        }

        stopPlaying () {
            if (!this.playing) return;
            this.playing = false;
            // Every key the recording pressed is let go of, or a recording cut
            // short leaves a sprite walking into a wall forever.
            for (const key of this.held) {
                vm.postIOData('keyboard', {key, isDown: false});
            }
            this.held.clear();
        }

        isPlaying () {
            return this.playing;
        }

        setSpeed (args) {
            const speed = Scratch.Cast.toNumber(args.SPEED);
            // Zero would stop time and never finish; backwards is not a thing
            // a stream of presses can do.
            this.playSpeed = speed > 0 ? speed : 1;
        }

        // --- looking at it ----------------------------------------------

        length () {
            if (!this.events.length) return 0;
            return Math.round(this.events[this.events.length - 1].t) / 1000;
        }

        count () {
            return this.events.length;
        }

        asText () {
            try {
                return JSON.stringify(this.events);
            } catch (e) {
                return '';
            }
        }

        fromText (args) {
            const text = Scratch.Cast.toString(args.TEXT);
            try {
                const parsed = JSON.parse(text);
                if (!Array.isArray(parsed)) return;
                this.stopPlaying();
                this.events = parsed.filter(e => e && typeof e.t === 'number');
            } catch (e) {
                // Text that is not a recording leaves the one you had alone,
                // which is friendlier than throwing it away.
            }
        }

        clear () {
            this.stopPlaying();
            this.stopRecording();
            this.events = [];
        }
    }

    Scratch.extensions.register(new FlipwarpRecordReplay());
}(Scratch));
