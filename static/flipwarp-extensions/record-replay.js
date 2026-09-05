// Record and replay input — Flipwarp
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

            this.watchKeyboard();
            this.watchMouse();
            this.everyFrame();
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

        // --- recording --------------------------------------------------

        watchKeyboard () {
            const note = (key, isDown) => {
                if (!this.recording) return;
                this.events.push({t: now() - this.startedAt, k: key, d: isDown ? 1 : 0});
            };
            // Watched on the way down through the page, so a key is recorded
            // whether or not something else stops it later.
            document.addEventListener('keydown', e => {
                if (e.repeat) return; // a held key, not a new press
                note(e.key, true);
            }, true);
            document.addEventListener('keyup', e => note(e.key, false), true);
        }

        watchMouse () {
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
            document.addEventListener('mousemove', e => {
                if (!this.recording) return;
                const at = place(e);
                if (!at) return;
                const last = this.events[this.events.length - 1];
                // A mouse moving across the stage is a hundred events a
                // second, nearly all of them the same. Only movements worth a
                // pixel or two are kept.
                if (last && last.m && Math.abs(last.x - at.x) < 0.004 &&
                    Math.abs(last.y - at.y) < 0.004) return;
                this.events.push({t: now() - this.startedAt, m: 1, x: at.x, y: at.y});
            }, true);
            const button = isDown => e => {
                if (!this.recording) return;
                const at = place(e);
                this.events.push({
                    t: now() - this.startedAt,
                    b: isDown ? 1 : 0,
                    x: at ? at.x : 0,
                    y: at ? at.y : 0
                });
            };
            document.addEventListener('mousedown', button(true), true);
            document.addEventListener('mouseup', button(false), true);
        }

        startRecording () {
            this.stopPlaying();
            this.events = [];
            this.startedAt = now();
            this.recording = true;
        }

        stopRecording () {
            this.recording = false;
        }

        isRecording () {
            return this.recording;
        }

        // --- playing back -----------------------------------------------

        everyFrame () {
            const step = () => {
                if (this.playing) this.advance();
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
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
            this.recording = false;
            this.playing = true;
            this.playIndex = 0;
            this.playFrom = now();
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
            this.recording = false;
            this.events = [];
        }
    }

    Scratch.extensions.register(new FlipwarpRecordReplay());
}(Scratch));
