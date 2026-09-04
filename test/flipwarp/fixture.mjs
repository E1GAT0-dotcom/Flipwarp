// The little fake gallery the checker tests run against.
//
// It used to be a handful of files placed in build/ by hand, which meant the
// checker, bundle and thumbnail tests all passed until the next `npm run
// build` emptied that folder and then failed for a reason that had nothing to
// do with the code. It is written out here instead, so running a test always
// finds it.
//
// Deliberately small and local: the point of these tests is the checker's own
// behaviour, so nothing here should reach PenguinMod or the network.
import fs from 'node:fs';
import path from 'node:path';
import {repoPath} from './launch.mjs';

// Seven extensions, because that number is what the tests assert on: six that
// exercise a compatibility hook each, and one plain one that owns the only
// picture in the fixture.
//
// The paths are shaped the way PenguinMod's registry shapes them —
// <author>/<file> for both the code and the picture — because the bundle
// keeps that layout inside the zip, and a flat fixture would let a bundle
// that flattened everything pass.
const EXTENSIONS = [
    {name: 'Test', code: 'Test/main.js', banner: 'Test/icon.svg'},
    // Named in the thumbnails test: it claims a picture that is not there, to
    // prove a missing file leaves the entry without one rather than dropping
    // the extension from the list.
    {name: 'Uses PM Shapes', code: 'Shapes/main.js', banner: 'Missing/none.svg'},
    {name: 'Uses gui.getBlockly', code: 'Blockly/main.js'},
    {name: 'Uses Serializer', code: 'Serializer/main.js'},
    {name: 'Uses VARIABLE argument', code: 'Variable/main.js'},
    {name: 'Uses OUTPUT block', code: 'Output/main.js'},
    {name: 'Uses Compiled Blocks', code: 'Compiled/main.js'}
];

// Each one registers a single block and reaches for the one hook it is named
// after, which is all the checker looks at.
const SOURCES = {
    'Test/main.js': `
        class Test {
            getInfo () {
                return {id: 'fixtureTest', name: 'Test', blocks: [
                    {opcode: 'go', blockType: Scratch.BlockType.COMMAND, text: 'go'}
                ]};
            }
            go () {}
        }
        Scratch.extensions.register(new Test());
    `,
    'Shapes/main.js': `
        class Shapes {
            getInfo () {
                return {id: 'fixtureShapes', name: 'Uses PM Shapes', blocks: [
                    {
                        opcode: 'shaped',
                        blockType: Scratch.BlockType.COMMAND,
                        blockShape: Scratch.BlockShape.ROUND,
                        text: 'shaped'
                    }
                ]};
            }
            shaped () {}
        }
        Scratch.extensions.register(new Shapes());
    `,
    'Blockly/main.js': `
        class UsesBlockly {
            getInfo () {
                return {id: 'fixtureBlockly', name: 'Uses gui.getBlockly', blocks: [
                    {opcode: 'poke', blockType: Scratch.BlockType.COMMAND, text: 'poke'}
                ]};
            }
            poke () {
                return Scratch.gui.getBlockly();
            }
        }
        Scratch.extensions.register(new UsesBlockly());
    `,
    'Serializer/main.js': `
        class UsesSerializer {
            constructor (runtime) {
                runtime.registerSerializer('fixture', () => ({}), () => ({}));
            }
            getInfo () {
                return {id: 'fixtureSerializer', name: 'Uses Serializer', blocks: [
                    {opcode: 'keep', blockType: Scratch.BlockType.COMMAND, text: 'keep'}
                ]};
            }
            keep () {}
        }
        Scratch.extensions.register(new UsesSerializer(Scratch.vm && Scratch.vm.runtime));
    `,
    'Variable/main.js': `
        class UsesVariable {
            getInfo () {
                return {id: 'fixtureVariable', name: 'Uses VARIABLE argument', blocks: [
                    {
                        opcode: 'setIt',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'set [VAR]',
                        arguments: {VAR: {type: Scratch.ArgumentType.VARIABLE}}
                    }
                ]};
            }
            setIt () {}
        }
        Scratch.extensions.register(new UsesVariable());
    `,
    'Output/main.js': `
        class UsesOutput {
            getInfo () {
                return {id: 'fixtureOutput', name: 'Uses OUTPUT block', blocks: [
                    {opcode: 'give', blockType: Scratch.BlockType.OUTPUT, text: 'give'}
                ]};
            }
            give () {
                return 1;
            }
        }
        Scratch.extensions.register(new UsesOutput());
    `,
    'Compiled/main.js': `
        class UsesCompiled {
            constructor (runtime) {
                runtime.registerCompiledExtensionBlocks('fixtureCompiled', {});
            }
            getInfo () {
                return {id: 'fixtureCompiled', name: 'Uses Compiled Blocks', blocks: [
                    {opcode: 'fast', blockType: Scratch.BlockType.COMMAND, text: 'fast'}
                ]};
            }
            fast () {}
        }
        Scratch.extensions.register(new UsesCompiled(Scratch.vm && Scratch.vm.runtime));
    `
};

// A picture small enough to read at a glance, for the one entry that has one.
const ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
    '<rect width="16" height="16" fill="#00b300"/></svg>\n';

/**
 * Write the fixture into the built site, which is what the tests are served.
 *
 * Called by each test rather than by a setup step, so a single test run on its
 * own works the same as the whole suite.
 *
 * @returns {string} the folder it wrote into
 */
export const writeFixture = () => {
    const build = repoPath('build');
    if (!fs.existsSync(build)) {
        throw new Error('There is no build/ to put the fixture in. Run `npm run build` first.');
    }

    // The registry is a JavaScript module in the real thing, and the checker
    // pulls the array out of the text rather than running it, so this is
    // shaped the same way.
    fs.writeFileSync(
        path.join(build, 'fake-list.js'),
        `// Written by test/flipwarp/fixture.mjs. Not part of the site.\n` +
        `export default ${JSON.stringify(EXTENSIONS, null, 4)};\n`
    );

    // Each one sits in its own author folder, so the base URL plus the entry's
    // own `code` reaches it exactly as it would on PenguinMod.
    for (const [name, source] of Object.entries(SOURCES)) {
        const file = path.join(build, name);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, `${source.trim()}\n`);
    }

    // Only one extension's picture exists. The other one names a file that is
    // deliberately absent.
    const images = path.join(build, 'images', 'Test');
    fs.mkdirSync(images, {recursive: true});
    fs.writeFileSync(path.join(images, 'icon.svg'), ICON);

    return build;
};

export default writeFixture;
