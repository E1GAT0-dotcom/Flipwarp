// The test that matters most for the text styles: a project written out as
// text and read back must come home as exactly the same blocks, in every
// style. If that ever stops being true, a person loses work.
//
// Runs without a browser — the conversion is plain JavaScript.
import {targetToText} from '../../src/lib/flipwarp/to-text.js';
import {parse} from '../../src/lib/flipwarp/parse.js';
import {buildTarget} from '../../src/lib/flipwarp/build.js';
import {canonTarget} from '../../src/lib/flipwarp/canon.js';
import {STYLES} from '../../src/lib/flipwarp/styles.js';

// A sprite that uses one of everything the styles disagree about: a hat, a
// C-block, if/else, a custom block with a parameter, an assignment, a boolean
// operator, a not, a comparison, a local and a global variable, a list, a
// message, a comment, and a nested body three deep.
const project = {
    targets: [
        {
            isStage: true,
            name: 'Stage',
            variables: {'g-1': ['high score', 0]},
            lists: {'l-1': ['past runs', []]},
            broadcasts: {'b-1': 'go time'},
            blocks: {},
            comments: {}
        },
        {
            isStage: false,
            name: 'Runner',
            variables: {'v-1': ['my speed', 0]},
            lists: {},
            comments: {c1: {blockId: 'move1', text: 'this is the bit that moves', x: 0, y: 0}},
            blocks: {
                hat: {
                    opcode: 'event_whenflagclicked',
                    next: 'set1', parent: null, inputs: {}, fields: {},
                    topLevel: true, shadow: false, x: 30, y: 40
                },
                set1: {
                    opcode: 'data_setvariableto',
                    next: 'rep1', parent: 'hat',
                    inputs: {VALUE: [1, [10, '0']]},
                    fields: {VARIABLE: ['my speed', 'v-1']},
                    topLevel: false, shadow: false
                },
                rep1: {
                    opcode: 'control_repeat',
                    next: 'bc1', parent: 'set1',
                    inputs: {TIMES: [1, [6, '10']], SUBSTACK: [2, 'if1']},
                    fields: {}, topLevel: false, shadow: false
                },
                if1: {
                    opcode: 'control_if_else',
                    next: null, parent: 'rep1',
                    inputs: {CONDITION: [2, 'and1'], SUBSTACK: [2, 'move1'], SUBSTACK2: [2, 'chg1']},
                    fields: {}, topLevel: false, shadow: false
                },
                and1: {
                    opcode: 'operator_and', next: null, parent: 'if1',
                    inputs: {OPERAND1: [2, 'gt1'], OPERAND2: [2, 'not1']},
                    fields: {}, topLevel: false, shadow: false
                },
                gt1: {
                    opcode: 'operator_gt', next: null, parent: 'and1',
                    inputs: {OPERAND1: [3, 'getspeed', [10, '']], OPERAND2: [1, [10, '5']]},
                    fields: {}, topLevel: false, shadow: false
                },
                getspeed: {
                    opcode: 'data_variable', next: null, parent: 'gt1',
                    inputs: {}, fields: {VARIABLE: ['my speed', 'v-1']},
                    topLevel: false, shadow: false
                },
                not1: {
                    opcode: 'operator_not', next: null, parent: 'and1',
                    inputs: {OPERAND: [2, 'touch1']}, fields: {},
                    topLevel: false, shadow: false
                },
                touch1: {
                    opcode: 'sensing_touchingobject', next: null, parent: 'not1',
                    inputs: {TOUCHINGOBJECTMENU: [1, 'touchmenu']}, fields: {},
                    topLevel: false, shadow: false
                },
                touchmenu: {
                    opcode: 'sensing_touchingobjectmenu', next: null, parent: 'touch1',
                    inputs: {}, fields: {TOUCHINGOBJECTMENU: ['_edge_', null]},
                    topLevel: false, shadow: true
                },
                move1: {
                    opcode: 'motion_movesteps', next: null, parent: 'if1',
                    inputs: {STEPS: [1, [4, '10']]}, fields: {},
                    topLevel: false, shadow: false
                },
                chg1: {
                    opcode: 'data_changevariableby', next: null, parent: 'if1',
                    inputs: {VALUE: [1, [4, '1']]},
                    fields: {VARIABLE: ['high score', 'g-1']},
                    topLevel: false, shadow: false
                },
                bc1: {
                    opcode: 'event_broadcast', next: 'add1', parent: 'rep1',
                    inputs: {BROADCAST_INPUT: [1, [11, 'go time', 'b-1']]},
                    fields: {}, topLevel: false, shadow: false
                },
                add1: {
                    opcode: 'data_addtolist', next: 'call1', parent: 'bc1',
                    inputs: {ITEM: [1, [10, 'done']]},
                    fields: {LIST: ['past runs', 'l-1']},
                    topLevel: false, shadow: false
                },
                call1: {
                    opcode: 'procedures_call', next: null, parent: 'add1',
                    inputs: {'arg-1': [1, [10, '3']]},
                    fields: {},
                    // A call carries only the proccode, the argument ids and
                    // warp — the names live on the prototype. Shaped the way
                    // Scratch shapes it, so the test cannot pass on a mutation
                    // Scratch would never write.
                    mutation: {
                        tagName: 'mutation', children: [],
                        proccode: 'jump %s times', argumentids: '["arg-1"]',
                        warp: 'false'
                    },
                    topLevel: false, shadow: false
                },
                def1: {
                    opcode: 'procedures_definition',
                    next: 'say1', parent: null,
                    inputs: {custom_block: [1, 'proto1']}, fields: {},
                    topLevel: true, shadow: false, x: 400, y: 40
                },
                proto1: {
                    opcode: 'procedures_prototype', next: null, parent: 'def1',
                    inputs: {'arg-1': [1, 'arged1']}, fields: {},
                    mutation: {
                        tagName: 'mutation', children: [],
                        proccode: 'jump %s times', argumentids: '["arg-1"]',
                        argumentnames: '["how many"]', argumentdefaults: '[""]',
                        warp: 'true'
                    },
                    topLevel: false, shadow: true
                },
                arged1: {
                    opcode: 'argument_reporter_string_number', next: null, parent: 'proto1',
                    inputs: {}, fields: {VALUE: ['how many', null]},
                    topLevel: false, shadow: true
                },
                say1: {
                    opcode: 'looks_say', next: null, parent: 'def1',
                    inputs: {MESSAGE: [3, 'argref1', [10, '']]}, fields: {},
                    topLevel: false, shadow: false
                },
                argref1: {
                    opcode: 'argument_reporter_string_number', next: null, parent: 'say1',
                    inputs: {}, fields: {VALUE: ['how many', null]},
                    topLevel: false, shadow: false
                }
            }
        }
    ]
};

const stage = project.targets[0];
const target = project.targets[1];
const ctx = {
    globals: {variables: stage.variables, lists: stage.lists},
    broadcasts: stage.broadcasts
};

const before = JSON.stringify(canonTarget(target.blocks, target.comments));

let failed = 0;
const check = (name, ok, extra) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
        failed++;
        if (extra) console.log(extra);
    }
};

const texts = {};

for (const [id, style] of Object.entries(STYLES)) {
    let text;
    try {
        text = targetToText(target, ctx, {style, indent: '    '}).text;
    } catch (e) {
        check(`${id}: blocks convert to text`, false, `    ${e.message}`);
        continue;
    }
    texts[id] = text;
    check(`${id}: blocks convert to text`, true);

    let rebuilt;
    try {
        rebuilt = buildTarget(parse(text, style), target, ctx, style);
    } catch (e) {
        check(`${id}: the text reads back`, false,
            `    line ${e.line}: ${e.message}\n    ${(e.text || '').trim()}`);
        continue;
    }
    check(`${id}: the text reads back`, true);

    const after = JSON.stringify(canonTarget(rebuilt.blocks, rebuilt.comments));
    check(`${id}: the blocks came home identical`, before === after,
        before === after ? null : `    before: ${before.slice(0, 300)}\n    after:  ${after.slice(0, 300)}`);
}

// The two styles must genuinely differ, or the test above proves nothing.
check('the styles produce different text', texts.js !== texts.python);
check('JavaScript uses braces and semicolons',
    texts.js.includes('{') && texts.js.includes(';'));
check('Python uses colons and no braces',
    texts.python.includes(':') && !texts.python.includes('{') && !texts.python.includes(';'));
check('Python spells block names with underscores', /turn_right|go_to_xy|when_flag|move\(/.test(texts.python));
check('Python writes and / not as words',
    texts.python.includes(' and ') && texts.python.includes('not '));
check('JavaScript still writes && and !',
    texts.js.includes(' && ') && texts.js.includes('!'));
check('Python writes def, JavaScript writes define',
    /(^|\n)def /.test(texts.python) && /(^|\n)define /.test(texts.js));

console.log('\n--- JavaScript ---');
console.log(texts.js);
console.log('--- Python ---');
console.log(texts.python);

console.log(failed === 0 ? '\nround trip working in both styles' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
