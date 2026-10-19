// TurboWarp's "is TurboWarp?" and "is compiled?": a boolean custom-block
// parameter with that exact name, used outside its custom block. to-text used
// to write it as the parameter's name, which then named nothing when read
// back, so a sprite using the trick could go to text and not come back. It is
// isTurboWarp() and isCompiled() now, in both directions.
//
// Runs without a browser.
import {parse} from '../../src/lib/flipwarp/parse.js';
import {buildTarget} from '../../src/lib/flipwarp/build.js';
import {targetToText} from '../../src/lib/flipwarp/to-text.js';
import {canonTarget} from '../../src/lib/flipwarp/canon.js';

let failures = 0;
const check = (ok, what) => {
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

const ctx = {globals: {variables: {}, lists: {}}, broadcasts: {}};
const target = blocks => ({isStage: false, name: 'S', variables: {}, lists: {}, broadcasts: {}, blocks, comments: {}});

const js = `@at(0, 0)
whenGreenFlagClicked {
  if (isTurboWarp()) {
    say("TurboWarp");
  } else {
    say("Scratch");
  }
  if (isCompiled() && !isTurboWarp()) {
    show();
  }
}`;

const built = buildTarget(parse(js, 'js'), target({}), ctx, 'js');
const detectors = Object.values(built.blocks).filter(b => b.opcode === 'argument_reporter_boolean');
check(detectors.length === 3, 'three detector blocks are built');
check(detectors.filter(b => b.fields.VALUE[0] === 'is TurboWarp?').length === 2 &&
    detectors.filter(b => b.fields.VALUE[0] === 'is compiled?').length === 1,
'named exactly as TurboWarp looks for them');

const back = targetToText(target(built.blocks), ctx, {style: 'js', indent: '  '}).text;
check(back.trim() === js.trim(), 'the text comes back exactly');

const py = targetToText(target(built.blocks), ctx, {style: 'python', indent: '  '}).text;
check(py.includes('is_turbo_warp()') && py.includes('is_compiled()'), 'the python style spells them its way');
const fromPy = buildTarget(parse(py, 'python'), target({}), ctx, 'python');
check(JSON.stringify(canonTarget(built.blocks, {})) === JSON.stringify(canonTarget(fromPy.blocks, {})),
    'and reads them back to the same blocks');

// A real variable called isTurboWarp is written under another name, so the
// text can never mix it up with the detector.
const withVariable = buildTarget(parse('variable flag as "isTurboWarp";\n\n@at(0, 0)\nwhenGreenFlagClicked {\n' +
    '  flag = 1;\n  if (isTurboWarp()) {\n    show();\n  }\n}', 'js'), target({}), ctx, 'js');
const varTarget = {...target(withVariable.blocks), variables: {}};
for (const c of withVariable.created) varTarget.variables[c.id] = [c.name, 0];
const varText = targetToText(varTarget, ctx, {style: 'js', indent: '  '}).text;
check(!/^variable isTurboWarp;/m.test(varText) && varText.includes('as "isTurboWarp"') &&
    varText.includes('if (isTurboWarp())'), 'a variable named isTurboWarp is kept apart from the detector');

if (failures) {
    console.log(`${failures} failure(s)`);
    process.exit(1);
}
console.log('isTurboWarp() and isCompiled() round trip');
