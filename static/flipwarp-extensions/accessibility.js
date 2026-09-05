// Accessibility, Flipwarp
//
// The Gameplay settings are for the person making a game. This is for the
// person playing one, and the difference matters: a packaged project has no
// settings window, so anything the player might need has to be something the
// project can offer them.
//
// Six things, and every one of them adjustable while it is on rather than
// take-it-or-leave-it. A reading voice nobody can follow is no better than no
// reading voice, and captions that vanish before they are read are worse than
// none, so the speed, the size, the timing and the colours are all blocks.
//
// Nothing here is switched on by itself. A project that takes the mouse
// pointer away, starts talking, or slows itself down without being asked is a
// project that has taken a decision away from the person using it, so every
// one of these starts off and stays off until the project turns it on, which
// almost always means offering the player a button.

(function (Scratch) {
    'use strict';

    const vm = Scratch.vm;
    const runtime = vm && vm.runtime;

    // Scratch's names for the keys that are not single characters. A remapped
    // key has to be written the way the project's own blocks write it, or the
    // project will never match it.
    const NAMED_KEYS = [
        'space', 'up arrow', 'down arrow', 'right arrow', 'left arrow', 'enter',
        'backspace', 'delete', 'shift', 'escape', 'caps lock', 'scroll lock',
        'control', 'insert', 'home', 'end', 'page up', 'page down'
    ];

    const speech = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;

    class FlipwarpAccessibility {
        constructor () {
            // --- reading aloud ---
            this.reading = false;
            this.voiceRate = 1;
            this.voicePitch = 1;

            // --- captions ---
            this.captions = false;
            this.captionSeconds = 3;
            this.captionScale = 1;
            this.captionAtTop = false;
            this.captionElement = null;
            this.captionTimer = null;

            // --- speed ---
            this.speed = 1;

            // --- a held key that counts as tapping ---
            this.repeating = false;
            this.repeatSeconds = 0.15;
            this.repeatTimers = new Map();

            // --- keys the player has changed ---
            this.remapped = new Map();

            // --- contrast ---
            this.contrast = 1;
            this.brightness = 1;

            this.install();
        }

        getInfo () {
            return {
                id: 'flipwarpAccessibility',
                name: 'Accessibility',
                color1: '#2f7f9e',
                color2: '#255f77',
                blocks: [
                    {
                        blockType: Scratch.BlockType.LABEL,
                        text: 'Reading aloud'
                    },
                    {
                        opcode: 'setReading',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'read what sprites say aloud [ON]',
                        arguments: {
                            ON: {type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on'}
                        }
                    },
                    {
                        opcode: 'speak',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'say [TEXT] aloud',
                        arguments: {
                            TEXT: {type: Scratch.ArgumentType.STRING, defaultValue: 'Press the green flag to start'}
                        }
                    },
                    {
                        opcode: 'setVoiceRate',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'read at [RATE] times normal speed',
                        arguments: {
                            RATE: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    {
                        opcode: 'setVoicePitch',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'read at pitch [PITCH]',
                        arguments: {
                            PITCH: {type: Scratch.ArgumentType.NUMBER, defaultValue: 1}
                        }
                    },
                    {
                        opcode: 'stopSpeaking',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'stop reading'
                    },
                    {
                        opcode: 'canRead',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'can this browser read aloud?'
                    },

                    {
                        blockType: Scratch.BlockType.LABEL,
                        text: 'Captions'
                    },
                    {
                        opcode: 'setCaptions',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'captions [ON]',
                        arguments: {
                            ON: {type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on'}
                        }
                    },
                    {
                        opcode: 'caption',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'caption [TEXT]',
                        arguments: {
                            TEXT: {type: Scratch.ArgumentType.STRING, defaultValue: 'a door creaks open'}
                        }
                    },
                    {
                        opcode: 'setCaptionSeconds',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'leave captions up for [SECONDS] seconds',
                        arguments: {
                            SECONDS: {type: Scratch.ArgumentType.NUMBER, defaultValue: 3}
                        }
                    },
                    {
                        opcode: 'setCaptionSize',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'caption size [PERCENT] %',
                        arguments: {
                            PERCENT: {type: Scratch.ArgumentType.NUMBER, defaultValue: 100}
                        }
                    },
                    {
                        opcode: 'setCaptionPlace',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'put captions at the [PLACE]',
                        arguments: {
                            PLACE: {type: Scratch.ArgumentType.STRING, menu: 'place', defaultValue: 'bottom'}
                        }
                    },

                    {
                        blockType: Scratch.BlockType.LABEL,
                        text: 'Speed'
                    },
                    {
                        opcode: 'setSpeed',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'run the game at [SPEED]',
                        arguments: {
                            SPEED: {type: Scratch.ArgumentType.STRING, menu: 'speed', defaultValue: 'normal speed'}
                        }
                    },
                    {
                        opcode: 'gameSpeed',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'game speed'
                    },

                    {
                        blockType: Scratch.BlockType.LABEL,
                        text: 'Keys'
                    },
                    {
                        opcode: 'setRepeating',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'holding a key counts as tapping it [ON]',
                        arguments: {
                            ON: {type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on'}
                        }
                    },
                    {
                        opcode: 'setRepeatSeconds',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'count a held key every [SECONDS] seconds',
                        arguments: {
                            SECONDS: {type: Scratch.ArgumentType.NUMBER, defaultValue: 0.15}
                        }
                    },
                    {
                        opcode: 'remap',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'let [FROM] do what [TO] does',
                        arguments: {
                            FROM: {type: Scratch.ArgumentType.STRING, defaultValue: 'a'},
                            TO: {type: Scratch.ArgumentType.STRING, defaultValue: 'left arrow'}
                        }
                    },
                    {
                        opcode: 'clearRemapping',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'put every key back'
                    },
                    {
                        opcode: 'standsFor',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'what [FROM] does now',
                        arguments: {
                            FROM: {type: Scratch.ArgumentType.STRING, defaultValue: 'a'}
                        }
                    },

                    {
                        blockType: Scratch.BlockType.LABEL,
                        text: 'Seeing it'
                    },
                    {
                        opcode: 'setContrast',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'stage contrast [PERCENT] %',
                        arguments: {
                            PERCENT: {type: Scratch.ArgumentType.NUMBER, defaultValue: 100}
                        }
                    },
                    {
                        opcode: 'setBrightness',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'stage brightness [PERCENT] %',
                        arguments: {
                            PERCENT: {type: Scratch.ArgumentType.NUMBER, defaultValue: 100}
                        }
                    },
                    {
                        opcode: 'resetLook',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'put the stage back to normal'
                    }
                ],
                menus: {
                    onOff: {acceptReporters: true, items: ['on', 'off']},
                    place: {acceptReporters: true, items: ['bottom', 'top']},
                    speed: {
                        acceptReporters: true,
                        items: ['normal speed', 'half speed', 'quarter speed']
                    }
                }
            };
        }

        // --- setting up ----------------------------------------------------

        // Everything here is wrapped only if it is there to wrap. An
        // extension is read by more than the editor: the script that builds
        // the text forms runs it with a skeleton of a runtime to ask what
        // blocks it has, and an extension that falls over in that skeleton is
        // an extension with no text form at all.
        install () {
            if (!runtime) return;

            // Reading what a sprite says. The event is the same one the say
            // bubble is drawn from, so anything that appears in a bubble can
            // be read, including "think" and the question an ask block puts
            // up, which is the one a player most needs read to them.
            runtime.on('SAY', (target, type, text) => {
                if (!this.reading) return;
                const said = String(text || '').trim();
                if (said) this.say(said);
            });

            // Speed. Frames are skipped rather than the clock being sped up,
            // and the clock is moved along by exactly one frame per frame that
            // runs, so waits and timers slow down with everything else. A
            // project running at half speed where the waits still take their
            // real time would come apart.
            const self = this;

            // Slowing the project down. In the editor Flipwarp already owns
            // the clock and offers a way in; asking it is the whole of the
            // job, and wrapping the step function a second time here would
            // give the project two owners of its clock and one of them would
            // stop telling the other the time. In a packaged project there is
            // no editor, so the same work is done here instead.
            this.timeKeeper = runtime.flipwarpTime || null;
            if (this.timeKeeper) return this.installTheRest(runtime);

            if (typeof runtime._step === 'function') {
                const realStep = runtime._step;
                let tick = 0;
                runtime._step = function (...args) {
                    if (self.speed > 1) {
                        tick = (tick + 1) % self.speed;
                        if (tick !== 0) return;
                    }
                    return realStep.apply(this, args);
                };
            }

            if (typeof runtime.updateCurrentMSecs === 'function') {
                const realClock = runtime.updateCurrentMSecs.bind(runtime);
                let virtual = null;
                runtime.updateCurrentMSecs = () => {
                    if (self.speed <= 1) {
                        virtual = null;
                        realClock();
                        return;
                    }
                    if (virtual === null) virtual = runtime.currentMSecs || Date.now();
                    virtual += runtime.currentStepTime;
                    runtime.currentMSecs = Math.round(virtual);
                };
            }

            return this.installTheRest(runtime);
        }

        installTheRest (runtime) {
            // Keys: the player's own names for them, and a held key that
            // counts as tapping.

            const keyboard = runtime.ioDevices && runtime.ioDevices.keyboard;
            if (keyboard && typeof keyboard.postData === 'function') {
                const realPost = keyboard.postData.bind(keyboard);
                this.postKey = realPost;
                keyboard.postData = data => {
                    if (!data || !data.key) return realPost(data);
                    const swapped = this.remapped.get(this.tidyKey(data.key));
                    const out = swapped ? {...data, key: this.domKey(swapped)} : data;
                    if (this.repeating) this.watchHeldKey(out);
                    return realPost(out);
                };
            }

            // Stopping the project stops everything this has started, because
            // a stop button that leaves a voice talking and a key repeating is
            // not a stop button.
            runtime.on('PROJECT_STOP_ALL', () => {
                this.stopSpeaking();
                this.clearHeldKeys();
                this.hideCaption();
            });

            // Blank line kept out of the middle of the wiring above on
            // purpose: this one is about what the extension leaves behind.
            runtime.on('PROJECT_START', () => {
                if (this.timeKeeper) this.timeKeeper.setSlowdown(this.speed);
            });
        }

        // --- reading aloud ---------------------------------------------------

        canRead () {
            return Boolean(speech);
        }

        say (text) {
            if (!speech) return;
            const utterance = new SpeechSynthesisUtterance(String(text));
            // Clamped to what the browsers accept. Out of range the whole
            // request is thrown away and nothing is said at all, which reads
            // as the block being broken.
            utterance.rate = Math.min(10, Math.max(0.1, this.voiceRate));
            utterance.pitch = Math.min(2, Math.max(0, this.voicePitch));
            speech.speak(utterance);
        }

        setReading (args) {
            this.reading = Scratch.Cast.toString(args.ON) !== 'off';
            if (!this.reading) this.stopSpeaking();
        }

        speak (args) {
            this.say(Scratch.Cast.toString(args.TEXT));
        }

        setVoiceRate (args) {
            this.voiceRate = Scratch.Cast.toNumber(args.RATE) || 1;
        }

        setVoicePitch (args) {
            this.voicePitch = Scratch.Cast.toNumber(args.PITCH);
        }

        stopSpeaking () {
            if (speech) speech.cancel();
        }

        // --- captions --------------------------------------------------------

        // Put over the stage rather than drawn on it, so a caption is real
        // text: it can be read out by a screen reader, and it stays sharp
        // whatever the stage is scaled to.
        captionBox () {
            if (this.captionElement) return this.captionElement;
            const canvas = runtime && runtime.renderer && runtime.renderer.canvas;
            const parent = (canvas && canvas.parentElement) || document.body;
            const box = document.createElement('div');
            box.setAttribute('aria-live', 'polite');
            box.style.position = 'absolute';
            box.style.left = '0';
            box.style.right = '0';
            box.style.margin = '0 auto';
            box.style.maxWidth = '90%';
            box.style.padding = '0.35em 0.6em';
            box.style.boxSizing = 'border-box';
            box.style.background = 'rgba(0, 0, 0, 0.75)';
            box.style.color = '#ffffff';
            box.style.font = '16px sans-serif';
            box.style.textAlign = 'center';
            box.style.borderRadius = '0.3em';
            box.style.pointerEvents = 'none';
            box.style.zIndex = '10';
            box.style.display = 'none';
            if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
            parent.appendChild(box);
            this.captionElement = box;
            return box;
        }

        placeCaption () {
            const box = this.captionBox();
            box.style.top = this.captionAtTop ? '0.5em' : '';
            box.style.bottom = this.captionAtTop ? '' : '0.5em';
            box.style.fontSize = `${Math.max(8, 16 * this.captionScale)}px`;
        }

        setCaptions (args) {
            this.captions = Scratch.Cast.toString(args.ON) !== 'off';
            if (!this.captions) this.hideCaption();
        }

        caption (args) {
            if (!this.captions) return;
            const box = this.captionBox();
            this.placeCaption();
            box.textContent = Scratch.Cast.toString(args.TEXT);
            box.style.display = 'block';
            if (this.captionTimer) clearTimeout(this.captionTimer);
            this.captionTimer = setTimeout(
                () => this.hideCaption(),
                Math.max(0.2, this.captionSeconds) * 1000
            );
        }

        hideCaption () {
            if (this.captionTimer) clearTimeout(this.captionTimer);
            this.captionTimer = null;
            if (this.captionElement) this.captionElement.style.display = 'none';
        }

        setCaptionSeconds (args) {
            this.captionSeconds = Scratch.Cast.toNumber(args.SECONDS);
        }

        setCaptionSize (args) {
            this.captionScale = Math.max(0.5, Scratch.Cast.toNumber(args.PERCENT) / 100);
            this.placeCaption();
        }

        setCaptionPlace (args) {
            this.captionAtTop = Scratch.Cast.toString(args.PLACE) === 'top';
            this.placeCaption();
        }

        // --- speed -----------------------------------------------------------

        setSpeed (args) {
            const asked = Scratch.Cast.toString(args.SPEED);
            this.speed = asked === 'half speed' ? 2 : asked === 'quarter speed' ? 4 : 1;
            // In the editor the clock belongs to Flipwarp itself, so the speed
            // is asked for rather than taken.
            if (this.timeKeeper) this.timeKeeper.setSlowdown(this.speed);
        }

        gameSpeed () {
            return this.speed === 4 ? 'quarter speed' :
                this.speed === 2 ? 'half speed' : 'normal speed';
        }

        // --- keys ------------------------------------------------------------

        // Scratch names a key by the character on it, or by one of a handful
        // of words. Anything else the player types is taken as its first
        // character, which is what the project's own key blocks do.
        tidyKey (key) {
            const text = String(key);
            if (text === ' ') return 'space';
            if (text.startsWith('Arrow')) return `${text.slice(5).toLowerCase()} arrow`;
            const lowered = text.toLowerCase();
            if (NAMED_KEYS.includes(lowered)) return lowered;
            return text.length > 1 ? lowered : text.toLowerCase();
        }

        // Back the other way, into something the keyboard device understands.
        // Back the other way, into something the keyboard device understands.
        //
        // Every name in NAMED_KEYS has to be here. The VM matches these
        // against the browser's own spelling, "Escape" rather than "escape",
        // and anything longer than one character that it does not recognise is
        // thrown away, so a name missing from this list did not merely fail to
        // remap: it swallowed the key press and left the key doing nothing at
        // all, which is worse than not remapping it.
        domKey (key) {
            if (key === 'space') return ' ';
            const arrow = /^(up|down|left|right) arrow$/.exec(key);
            if (arrow) return `Arrow${arrow[1][0].toUpperCase()}${arrow[1].slice(1)}`;
            const named = {
                enter: 'Enter',
                backspace: 'Backspace',
                delete: 'Delete',
                shift: 'Shift',
                escape: 'Escape',
                'caps lock': 'CapsLock',
                'scroll lock': 'ScrollLock',
                control: 'Control',
                insert: 'Insert',
                home: 'Home',
                end: 'End',
                'page up': 'PageUp',
                'page down': 'PageDown'
            };
            return named[key] || key;
        }

        remap (args) {
            const from = this.tidyKey(Scratch.Cast.toString(args.FROM));
            const to = this.tidyKey(Scratch.Cast.toString(args.TO));
            if (!from || !to) return;
            this.remapped.set(from, to);
        }

        clearRemapping () {
            this.remapped.clear();
        }

        standsFor (args) {
            const from = this.tidyKey(Scratch.Cast.toString(args.FROM));
            return this.remapped.get(from) || from;
        }

        setRepeating (args) {
            this.repeating = Scratch.Cast.toString(args.ON) !== 'off';
            if (!this.repeating) this.clearHeldKeys();
        }

        setRepeatSeconds (args) {
            this.repeatSeconds = Math.max(0.03, Scratch.Cast.toNumber(args.SECONDS));
        }

        // A game that wants the space bar hammered is a game some people
        // cannot play at all. Held down, the key is let go and pressed again
        // on a timer, so the project counts taps exactly as it did before and
        // needs no changes of its own.
        watchHeldKey (data) {
            const key = String(data.key);
            if (data.isDown) {
                if (this.repeatTimers.has(key)) return;
                const timer = setInterval(() => {
                    if (!this.postKey) return;
                    this.postKey({...data, isDown: false});
                    this.postKey({...data, isDown: true});
                }, this.repeatSeconds * 1000);
                this.repeatTimers.set(key, timer);
            } else {
                const timer = this.repeatTimers.get(key);
                if (timer) clearInterval(timer);
                this.repeatTimers.delete(key);
            }
        }

        clearHeldKeys () {
            for (const timer of this.repeatTimers.values()) clearInterval(timer);
            this.repeatTimers.clear();
        }

        // --- seeing it -------------------------------------------------------

        // A filter over the canvas rather than anything the project can see.
        // Sprites keep their own colours, so "touching colour" still answers
        // what it always answered and a game cannot be broken by turning the
        // contrast up.
        paint () {
            const canvas = runtime && runtime.renderer && runtime.renderer.canvas;
            if (!canvas) return;
            const parts = [];
            if (this.contrast !== 1) parts.push(`contrast(${this.contrast})`);
            if (this.brightness !== 1) parts.push(`brightness(${this.brightness})`);
            canvas.style.filter = parts.join(' ');
        }

        setContrast (args) {
            this.contrast = Math.max(0, Scratch.Cast.toNumber(args.PERCENT) / 100);
            this.paint();
        }

        setBrightness (args) {
            this.brightness = Math.max(0, Scratch.Cast.toNumber(args.PERCENT) / 100);
            this.paint();
        }

        resetLook () {
            this.contrast = 1;
            this.brightness = 1;
            this.paint();
        }
    }

    Scratch.extensions.register(new FlipwarpAccessibility());
}(Scratch));
