// A stand-in for a PenguinMod extension, using the APIs their extensions
// actually reach for. Served locally so the compatibility hooks can be tested
// without depending on anyone else's server.
(function (Scratch) {
    'use strict';
    const vm = Scratch.vm;
    let steps = 0;
    let pauseEvents = 0;

    // PenguinMod extensions branch on this. It should be falsy here, and the
    // extension should still load and work.
    const isPenguinMod = !!Scratch.extensions.isPenguinMod;

    vm.runtime.on('RUNTIME_STEP_START', () => {
        steps++;
    });
    vm.runtime.on('RUNTIME_PAUSED', () => {
        pauseEvents++;
    });
    vm.runtime.on('RUNTIME_UNPAUSED', () => {
        pauseEvents++;
    });

    class CompatProbe {
        getInfo () {
            return {
                id: 'flipwarpCompatProbe',
                name: 'Compat Probe',
                blocks: [
                    {opcode: 'steps', blockType: Scratch.BlockType.REPORTER, text: 'frames seen'},
                    {opcode: 'pauses', blockType: Scratch.BlockType.REPORTER, text: 'pause events seen'},
                    {opcode: 'host', blockType: Scratch.BlockType.REPORTER, text: 'is penguinmod?'},
                    {opcode: 'aLabel', blockType: Scratch.BlockType.LABEL, text: 'A label block'},
                    {opcode: 'aButton', blockType: Scratch.BlockType.BUTTON, text: 'A button block'}
                ]
            };
        }
        steps () {
            return steps;
        }
        pauses () {
            return pauseEvents;
        }
        host () {
            return String(isPenguinMod);
        }
        aButton () {
            // nothing; a button only has to exist without breaking the palette
        }
    }

    Scratch.extensions.register(new CompatProbe());
})(Scratch);
