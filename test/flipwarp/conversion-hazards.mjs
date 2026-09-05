// The ways a round trip could quietly hand back a different project.
//
// round-trip.mjs proves that a well-behaved sprite survives the journey. This
// one is the other half: sprites built the way real projects go wrong, where
// the old code converted cleanly and gave back something that was not the same
// project. Every case here failed silently before, with no error and nothing
// on screen to say anything had happened, which is what makes them worth a
// file of their own.
//
// Runs without a browser; the conversion is plain JavaScript.
import {targetToText} from '../../src/lib/flipwarp/to-text.js';
import {parse} from '../../src/lib/flipwarp/parse.js';
import {buildTarget} from '../../src/lib/flipwarp/build.js';

const stage = (extra = {}) => ({
    isStage: true, name: 'Stage',
    variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
    ...extra
});

const ctxOf = st => ({
    globals: {variables: st.variables || {}, lists: st.lists || {}},
    broadcasts: st.broadcasts || {}
});

// One trip out and back, returning the text and the rebuilt blocks.
const roundTrip = (sprite, st, style = 'js') => {
    const {text} = targetToText(sprite, ctxOf(st), {style});
    const rebuilt = buildTarget(parse(text, style), sprite, ctxOf(st), style);
    return {text, rebuilt};
};

const opcodes = blocks => Object.values(blocks)
    .filter(b => b && !b.shadow)
    .map(b => b.opcode)
    .sort();

const checks = [];
const check = (name, ok, extra) => checks.push([name, ok, extra]);

// --- a custom block named like a real one --------------------------------
// The reader looks at custom blocks before built-in ones, so a custom block
// called "say" used to swallow every real say in the sprite.
{
    const sprite = {
        isStage: false, name: 'Talker', variables: {}, lists: {}, comments: {},
        blocks: {
            def: {
                opcode: 'procedures_definition', next: null, parent: null,
                inputs: {custom_block: [1, 'proto']}, fields: {}, topLevel: true,
                shadow: false, x: 0, y: 0
            },
            proto: {
                opcode: 'procedures_prototype', next: null, parent: 'def',
                inputs: {}, fields: {}, shadow: true, topLevel: false,
                mutation: {
                    tagName: 'mutation', children: [], proccode: 'say',
                    argumentids: '[]', argumentnames: '[]', argumentdefaults: '[]',
                    warp: 'false'
                }
            },
            hat: {
                opcode: 'event_whenflagclicked', next: 'realSay', parent: null,
                inputs: {}, fields: {}, topLevel: true, shadow: false, x: 0, y: 200
            },
            realSay: {
                opcode: 'looks_say', next: null, parent: 'hat',
                inputs: {MESSAGE: [1, [10, 'hello']]}, fields: {},
                topLevel: false, shadow: false
            }
        }
    };
    const {text, rebuilt} = roundTrip(sprite, stage());
    const after = opcodes(rebuilt.blocks);
    check('a custom block cannot take a real block\'s name',
        after.includes('looks_say') && after.filter(o => o === 'procedures_call').length === 0,
        {text, after});
}

// --- two custom blocks that used to slug to the same name ----------------
{
    const proto = (id, proccode) => ({
        opcode: 'procedures_prototype', next: null, parent: id, inputs: {}, fields: {},
        shadow: true, topLevel: false,
        mutation: {
            tagName: 'mutation', children: [], proccode,
            argumentids: '["a"]', argumentnames: '["n"]', argumentdefaults: '[""]',
            warp: 'false'
        }
    });
    const sprite = {
        isStage: false, name: 'Jumper', variables: {}, lists: {}, comments: {},
        blocks: {
            d1: {
                opcode: 'procedures_definition', next: null, parent: null,
                inputs: {custom_block: [1, 'p1']}, fields: {}, topLevel: true,
                shadow: false, x: 0, y: 0
            },
            p1: proto('d1', 'jump %s'),
            d2: {
                opcode: 'procedures_definition', next: null, parent: null,
                inputs: {custom_block: [1, 'p2']}, fields: {}, topLevel: true,
                shadow: false, x: 0, y: 300
            },
            p2: proto('d2', '%s jump')
        }
    };
    const {text, rebuilt} = roundTrip(sprite, stage());
    const codes = Object.values(rebuilt.blocks)
        .filter(b => b && b.opcode === 'procedures_prototype')
        .map(b => b.mutation.proccode)
        .sort();
    check('two custom blocks keep their own names',
        codes.length === 2 && codes[0] !== codes[1], {text, codes});
}

// --- a local variable with the same name as a global ----------------------
{
    const st = stage({variables: {'g1': ['score', 0]}});
    const sprite = {
        isStage: false, name: 'Player', variables: {'v1': ['score', 0]}, lists: {},
        comments: {},
        blocks: {
            hat: {
                opcode: 'event_whenflagclicked', next: 'setLocal', parent: null,
                inputs: {}, fields: {}, topLevel: true, shadow: false, x: 0, y: 0
            },
            setLocal: {
                opcode: 'data_setvariableto', next: null, parent: 'hat',
                inputs: {VALUE: [1, [10, '1']]}, fields: {VARIABLE: ['score', 'v1']},
                topLevel: false, shadow: false
            }
        }
    };
    const {text, rebuilt} = roundTrip(sprite, st);
    const set = Object.values(rebuilt.blocks).find(b => b.opcode === 'data_setvariableto');
    check('a sprite\'s own variable is not swapped for the stage\'s',
        set && set.fields.VARIABLE[1] === 'v1', {text, got: set && set.fields.VARIABLE});
}

// --- an empty pointed slot ------------------------------------------------
{
    const sprite = {
        isStage: false, name: 'Halfbuilt', variables: {}, lists: {}, comments: {},
        blocks: {
            iff: {
                opcode: 'control_if', next: null, parent: null,
                inputs: {SUBSTACK: [2, 'mv']}, fields: {},
                topLevel: true, shadow: false, x: 0, y: 0
            },
            mv: {
                opcode: 'motion_movesteps', next: null, parent: 'iff',
                inputs: {STEPS: [1, [4, '10']]}, fields: {}, topLevel: false, shadow: false
            }
        }
    };
    let failed = null;
    let rebuilt = null;
    let text = '';
    try {
        ({text, rebuilt} = roundTrip(sprite, stage()));
    } catch (e) {
        failed = e.message;
    }
    const iff = rebuilt && Object.values(rebuilt.blocks).find(b => b.opcode === 'control_if');
    check('an if with nothing in its hexagon goes out and comes back',
        failed === null && iff && !iff.inputs.CONDITION, {failed, text, inputs: iff && iff.inputs});
}

// --- a reporter left on the canvas ---------------------------------------
for (const [what, block] of [
    ['a variable', {
        opcode: 'data_variable', next: null, parent: null, inputs: {},
        fields: {VARIABLE: ['score', 'g1']}, topLevel: true, shadow: false, x: 10, y: 10
    }],
    ['a reporter', {
        opcode: 'motion_xposition', next: null, parent: null, inputs: {}, fields: {},
        topLevel: true, shadow: false, x: 10, y: 10
    }]
]) {
    const st = stage({variables: {'g1': ['score', 0]}});
    const sprite = {
        isStage: false, name: 'Watcher', variables: {}, lists: {}, comments: {},
        blocks: {loose: block}
    };
    let failed = null;
    let rebuilt = null;
    let text = '';
    try {
        ({text, rebuilt} = roundTrip(sprite, st));
    } catch (e) {
        failed = e.message;
    }
    const kept = rebuilt && opcodes(rebuilt.blocks).includes(block.opcode);
    check(`${what} sitting on the canvas does not stop the sprite converting`,
        failed === null && kept, {failed, text, after: rebuilt && opcodes(rebuilt.blocks)});
}

let failed = 0;
for (const [name, ok, extra] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra !== undefined) console.log(`      got: ${JSON.stringify(extra).slice(0, 700)}`);
    }
}
console.log(failed === 0 ? '\nconversion hazards working' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
