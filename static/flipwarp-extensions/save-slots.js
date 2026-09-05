// Save slots — Flipwarp
//
// Scratch has no memory between one visit and the next. A project that took an
// hour to play is an hour thrown away when the tab closes, so people build
// save systems out of a long text variable, a join block per value and a lot
// of hoping. This is that, done once and properly.
//
// A slot is a named box of named values, kept in the browser it was saved in.
// Nothing leaves the machine, and nothing is sent anywhere.

(function (Scratch) {
    'use strict';

    // Everything this extension writes is under one prefix, so it can never
    // tread on whatever else the page has stored, and clearing it is one loop.
    const PREFIX = 'flipwarp.save.';

    // Browsers give a page a few megabytes for this. A project that writes a
    // list on every frame would fill it, and the error a full store throws is
    // not one a Scratch project can catch, so it is caught here.
    const bytesOf = value => {
        try {
            return new Blob([value]).size;
        } catch (e) {
            return value.length * 2;
        }
    };

    const key = slot => PREFIX + String(slot);

    const readSlot = slot => {
        let raw = null;
        try {
            raw = localStorage.getItem(key(slot));
        } catch (e) {
            return null;
        }
        if (raw === null) return null;
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (e) {
            // Something else wrote here, or it was cut short. An unreadable
            // slot is treated as an empty one rather than breaking the project.
            return null;
        }
    };

    const writeSlot = (slot, data) => {
        try {
            localStorage.setItem(key(slot), JSON.stringify(data));
            return true;
        } catch (e) {
            return false;
        }
    };

    class FlipwarpSaveSlots {
        constructor () {
            this.lastError = '';
        }

        getInfo () {
            return {
                id: 'flipwarpSaveSlots',
                name: 'Save Slots',
                color1: '#3f8fd2',
                color2: '#3579b3',
                blocks: [
                    {
                        opcode: 'save',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'save [VALUE] as [NAME] in slot [SLOT]',
                        arguments: {
                            VALUE: {type: Scratch.ArgumentType.STRING, defaultValue: '100'},
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'score'},
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'}
                        }
                    },
                    {
                        opcode: 'load',
                        blockType: Scratch.BlockType.REPORTER,
                        text: '[NAME] from slot [SLOT]',
                        arguments: {
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'score'},
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'}
                        }
                    },
                    {
                        opcode: 'has',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'slot [SLOT] has [NAME]?',
                        arguments: {
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'score'},
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'}
                        }
                    },
                    '---',
                    {
                        opcode: 'saveList',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'save list [LIST] as [NAME] in slot [SLOT]',
                        arguments: {
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'my list'},
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'inventory'},
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'}
                        }
                    },
                    {
                        opcode: 'loadList',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'load [NAME] from slot [SLOT] into list [LIST]',
                        arguments: {
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'inventory'},
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'},
                            LIST: {type: Scratch.ArgumentType.STRING, defaultValue: 'my list'}
                        }
                    },
                    '---',
                    {
                        opcode: 'namesIn',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'names saved in slot [SLOT]',
                        arguments: {
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'}
                        }
                    },
                    {
                        opcode: 'slots',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'all slots'
                    },
                    {
                        opcode: 'slotExists',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'slot [SLOT] exists?',
                        arguments: {
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'}
                        }
                    },
                    '---',
                    {
                        opcode: 'forget',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'forget [NAME] in slot [SLOT]',
                        arguments: {
                            NAME: {type: Scratch.ArgumentType.STRING, defaultValue: 'score'},
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'}
                        }
                    },
                    {
                        opcode: 'deleteSlot',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'delete slot [SLOT]',
                        arguments: {
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'}
                        }
                    },
                    {
                        opcode: 'deleteEverything',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'delete every slot'
                    },
                    '---',
                    {
                        opcode: 'sizeOf',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'size of slot [SLOT] in characters',
                        arguments: {
                            SLOT: {type: Scratch.ArgumentType.STRING, defaultValue: 'slot 1'}
                        }
                    },
                    {
                        opcode: 'lastProblem',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'last save problem'
                    }
                ]
            };
        }

        save (args) {
            const slot = Scratch.Cast.toString(args.SLOT);
            const data = readSlot(slot) || {};
            data[Scratch.Cast.toString(args.NAME)] = Scratch.Cast.toString(args.VALUE);
            if (!writeSlot(slot, data)) {
                // Nearly always the store being full, but a browser set to
                // refuse storage altogether looks the same from here.
                this.lastError = 'could not save — this browser is out of room, or is not letting ' +
                    'this page remember anything';
                return;
            }
            this.lastError = '';
        }

        load (args) {
            const data = readSlot(Scratch.Cast.toString(args.SLOT));
            if (!data) return '';
            const value = data[Scratch.Cast.toString(args.NAME)];
            // Never undefined: a reporter that says "undefined" in the middle
            // of a sentence is worse than one that says nothing.
            return value === undefined ? '' : value;
        }

        has (args) {
            const data = readSlot(Scratch.Cast.toString(args.SLOT));
            return Boolean(data) &&
                Object.prototype.hasOwnProperty.call(data, Scratch.Cast.toString(args.NAME));
        }

        saveList (args, util) {
            const list = this.findList(Scratch.Cast.toString(args.LIST), util);
            if (!list) {
                this.lastError = `there is no list called ${Scratch.Cast.toString(args.LIST)}`;
                return;
            }
            const slot = Scratch.Cast.toString(args.SLOT);
            const data = readSlot(slot) || {};
            // Kept as its own array rather than as joined text, so a value
            // containing a comma survives the round trip.
            data[Scratch.Cast.toString(args.NAME)] = list.value.slice();
            if (!writeSlot(slot, data)) {
                this.lastError = 'could not save — this browser is out of room, or is not letting ' +
                    'this page remember anything';
                return;
            }
            this.lastError = '';
        }

        loadList (args, util) {
            const list = this.findList(Scratch.Cast.toString(args.LIST), util);
            if (!list) {
                this.lastError = `there is no list called ${Scratch.Cast.toString(args.LIST)}`;
                return;
            }
            const data = readSlot(Scratch.Cast.toString(args.SLOT));
            const saved = data && data[Scratch.Cast.toString(args.NAME)];
            if (!Array.isArray(saved)) {
                this.lastError = 'nothing was saved under that name, or it was not a list';
                return;
            }
            list.value = saved.slice();
            list._monitorUpToDate = false;
            this.lastError = '';
        }

        namesIn (args) {
            const data = readSlot(Scratch.Cast.toString(args.SLOT));
            return data ? Object.keys(data).join(', ') : '';
        }

        slots () {
            const found = [];
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const name = localStorage.key(i);
                    if (name && name.startsWith(PREFIX)) found.push(name.slice(PREFIX.length));
                }
            } catch (e) {
                return '';
            }
            return found.sort().join(', ');
        }

        slotExists (args) {
            return readSlot(Scratch.Cast.toString(args.SLOT)) !== null;
        }

        forget (args) {
            const slot = Scratch.Cast.toString(args.SLOT);
            const data = readSlot(slot);
            if (!data) return;
            delete data[Scratch.Cast.toString(args.NAME)];
            writeSlot(slot, data);
        }

        deleteSlot (args) {
            try {
                localStorage.removeItem(key(Scratch.Cast.toString(args.SLOT)));
            } catch (e) {
                // Nothing to be done, and nothing worth stopping the project for.
            }
        }

        deleteEverything () {
            try {
                const doomed = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const name = localStorage.key(i);
                    if (name && name.startsWith(PREFIX)) doomed.push(name);
                }
                for (const name of doomed) localStorage.removeItem(name);
            } catch (e) {
                // As above.
            }
        }

        sizeOf (args) {
            try {
                const raw = localStorage.getItem(key(Scratch.Cast.toString(args.SLOT)));
                return raw === null ? 0 : bytesOf(raw);
            } catch (e) {
                return 0;
            }
        }

        lastProblem () {
            return this.lastError;
        }

        // A list belongs either to the sprite running the block or to the
        // stage, and Scratch looks in that order, so this does too.
        findList (name, util) {
            const target = util.target;
            const own = target.lookupVariableByNameAndType(name, 'list', true);
            if (own) return own;
            const stage = target.runtime.getTargetForStage();
            return stage ? stage.lookupVariableByNameAndType(name, 'list', true) : null;
        }
    }

    Scratch.extensions.register(new FlipwarpSaveSlots());
}(Scratch));
