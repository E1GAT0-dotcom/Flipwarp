/**
 * Put the magic wand and the lasso into the paint editor.
 *
 * The paint editor is not part of this repository — it is scratch-paint,
 * pulled straight from TurboWarp, and npm rewrites it from scratch on every
 * install. So the two tools live in paint-tools/ here and are laid over it
 * afterwards, by this script, which npm runs at the end of every install.
 *
 * Two kinds of change. New files are copied, which is safe: nothing upstream
 * has that name. The handful of existing files that have to mention the new
 * tools are edited by looking for a piece of their text and putting something
 * in its place — not by overwriting them, which would freeze them at whatever
 * TurboWarp had written on the day this was set up and quietly stop every
 * later fix from arriving.
 *
 * Each edit is skipped if it has already been made, so running twice is
 * harmless. If a piece of text cannot be found, that means TurboWarp has
 * rewritten the part of the file this hooks into, and the script says exactly
 * which hook broke rather than leaving a paint editor with two dead buttons.
 */
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const FROM = path.join(HERE, 'paint-tools');
const INTO = path.join(HERE, 'node_modules', 'scratch-paint', 'src');

// Files that are ours alone and are simply copied in.
const COPY = [
    'helper/bit-tools/masked-selection.js',
    'helper/bit-tools/wand-tool.js',
    'helper/bit-tools/lasso-tool.js',
    'containers/bit-wand-mode.jsx',
    'containers/bit-lasso-mode.jsx',
    'reducers/wand-mode.js',
    'components/bit-wand-mode/bit-wand-mode.jsx',
    'components/bit-wand-mode/wand.svg',
    'components/bit-lasso-mode/bit-lasso-mode.jsx',
    'components/bit-lasso-mode/lasso.svg'
];

/**
 * An edit to one of TurboWarp's own files.
 *
 * `find` is the text to look for, `put` what goes in its place, and `named`
 * what to say if the text is not there any more.
 */
const EDITS = [
    {
        file: 'lib/modes.js',
        named: 'the list of bitmap modes',
        find: '    BIT_SELECT: null\n};',
        put: '    BIT_SELECT: null,\n    BIT_WAND: null,\n    BIT_LASSO: null\n};'
    },
    {
        file: 'lib/modes.js',
        named: 'the list of modes that offer gradients',
        find: '    BIT_SELECT: null,\n    BIT_FILL: null,',
        put: '    BIT_SELECT: null,\n    BIT_WAND: null,\n    BIT_LASSO: null,\n    BIT_FILL: null,'
    },
    {
        file: 'lib/messages.js',
        named: 'the tool names',
        find: `    text: {
        defaultMessage: 'Text',
        description: 'Label for the text tool',
        id: 'paint.textMode.text'
    }
});`,
        put: `    text: {
        defaultMessage: 'Text',
        description: 'Label for the text tool',
        id: 'paint.textMode.text'
    },
    wand: {
        defaultMessage: 'Magic Wand',
        description: 'Label for the magic wand tool, which selects an area of similar colour',
        id: 'paint.wandMode.wand'
    },
    lasso: {
        defaultMessage: 'Lasso',
        description: 'Label for the lasso tool, which selects whatever a freehand loop encloses',
        id: 'paint.lassoMode.lasso'
    },
    tolerance: {
        defaultMessage: 'Tolerance',
        description: 'Label for the magic wand setting controlling how close a colour must be to be included',
        id: 'paint.wandMode.tolerance'
    }
});`
    },
    {
        file: 'reducers/scratch-paint-reducer.js',
        named: 'the reducer imports',
        find: `import viewBoundsReducer from './view-bounds';`,
        put: `import viewBoundsReducer from './view-bounds';\nimport wandModeReducer from './wand-mode';`
    },
    {
        file: 'reducers/scratch-paint-reducer.js',
        named: 'the combined reducer',
        find: '    viewBounds: viewBoundsReducer,',
        put: '    viewBounds: viewBoundsReducer,\n    wandMode: wandModeReducer,'
    },
    {
        file: 'components/paint-editor/paint-editor.jsx',
        named: 'the paint editor imports',
        find: `import BitSelectMode from '../../containers/bit-select-mode.jsx';`,
        put: `import BitSelectMode from '../../containers/bit-select-mode.jsx';
import BitWandMode from '../../containers/bit-wand-mode.jsx';
import BitLassoMode from '../../containers/bit-lasso-mode.jsx';`
    },
    {
        file: 'components/paint-editor/paint-editor.jsx',
        named: 'the row of bitmap tool buttons',
        find: `                    <BitSelectMode
                        onUpdateImage={props.onUpdateImage}
                    />
                </div>`,
        put: `                    <BitSelectMode
                        onUpdateImage={props.onUpdateImage}
                    />
                    <BitWandMode
                        onUpdateImage={props.onUpdateImage}
                    />
                    <BitLassoMode
                        onUpdateImage={props.onUpdateImage}
                    />
                </div>`
    },
    {
        file: 'containers/paint-editor.jsx',
        named: 'the tool to switch to when a costume is turned into a vector',
        find: `            case Modes.BIT_SELECT:
                this.props.changeMode(Modes.SELECT);
                break;`,
        put: `            case Modes.BIT_SELECT:
                /* falls through */
            case Modes.BIT_WAND:
                /* falls through */
            case Modes.BIT_LASSO:
                // Neither the wand nor the lasso has a vector twin — vectors
                // are shapes you click, not pixels you gather — so plain
                // select is the nearest thing to carry across.
                this.props.changeMode(Modes.SELECT);
                break;`
    },
    {
        file: 'hocs/keyboard-shortcuts-hoc.jsx',
        named: 'the bitmap keyboard shortcuts',
        find: '    e: Modes.BIT_ERASER,\n    s: Modes.BIT_SELECT\n};',
        put: '    e: Modes.BIT_ERASER,\n    s: Modes.BIT_SELECT,\n    w: Modes.BIT_WAND,\n    q: Modes.BIT_LASSO\n};'
    },
    {
        file: 'components/mode-tools/mode-tools.jsx',
        named: 'the mode tools imports',
        find: `import {setShapesFilled} from '../../reducers/fill-bitmap-shapes';`,
        put: `import {setShapesFilled} from '../../reducers/fill-bitmap-shapes';
import {changeWandTolerance, changeWandContiguous} from '../../reducers/wand-mode';`
    },
    {
        file: 'components/mode-tools/mode-tools.jsx',
        named: 'the mode tools icon imports',
        find: `import bitLineIcon from '../bit-line-mode/line.svg';`,
        put: `import bitLineIcon from '../bit-line-mode/line.svg';
import bitWandIcon from '../bit-wand-mode/wand.svg';`
    },
    {
        file: 'components/mode-tools/mode-tools.jsx',
        named: 'the mode tools labels',
        find: `        outlined: {
            defaultMessage: 'Outlined',`,
        put: `        tolerance: {
            defaultMessage: 'Tolerance',
            description: 'Label for how close a colour must be for the magic wand to include it',
            id: 'paint.modeTools.tolerance'
        },
        wandTouching: {
            defaultMessage: 'Touching only',
            description: 'Label for the magic wand setting that keeps the selection to one connected patch',
            id: 'paint.modeTools.wandTouching'
        },
        outlined: {
            defaultMessage: 'Outlined',`
    },
    {
        file: 'components/mode-tools/mode-tools.jsx',
        named: 'the row of tools shown under the select tool',
        find: `    case Modes.BIT_SELECT:
        /* falls through */
    case Modes.SELECT:
        return (
            <div className={classNames(props.className, styles.modeTools)}>
                <InputGroup className={classNames(styles.modDashedBorder, styles.modLabeledIconHeight)}>`,
        put: `    case Modes.BIT_WAND:
        return (
            <div className={classNames(props.className, styles.modeTools)}>
                <InputGroup className={classNames(styles.modDashedBorder)}>
                    <img
                        alt={props.intl.formatMessage(messages.tolerance)}
                        className={styles.modeToolsIcon}
                        draggable={false}
                        src={bitWandIcon}
                    />
                    <LiveInput
                        range
                        small
                        max="100"
                        min="0"
                        type="number"
                        value={props.wandTolerance}
                        onSubmit={props.onWandToleranceChange}
                    />
                </InputGroup>
                <InputGroup className={classNames(styles.modDashedBorder)}>
                    <Label text={props.intl.formatMessage(messages.wandTouching)}>
                        <input
                            checked={props.wandContiguous}
                            type="checkbox"
                            onChange={props.onWandContiguousChange}
                        />
                    </Label>
                </InputGroup>
                <InputGroup className={classNames(styles.modLabeledIconHeight)}>
                    <LabeledIconButton
                        hideLabel={hideLabel(props.intl.locale)}
                        imgSrc={deleteIcon}
                        title={props.intl.formatMessage(messages.delete)}
                        onClick={props.onDelete}
                    />
                </InputGroup>
            </div>
        );
    case Modes.BIT_LASSO:
        /* falls through */
    case Modes.BIT_SELECT:
        /* falls through */
    case Modes.SELECT:
        return (
            <div className={classNames(props.className, styles.modeTools)}>
                <InputGroup className={classNames(styles.modDashedBorder, styles.modLabeledIconHeight)}>`
    },
    {
        file: 'components/mode-tools/mode-tools.jsx',
        named: 'the mode tools property list',
        find: '    onUpdateImage: PropTypes.func.isRequired\n};',
        put: `    onUpdateImage: PropTypes.func.isRequired,
    onWandContiguousChange: PropTypes.func.isRequired,
    onWandToleranceChange: PropTypes.func.isRequired,
    wandContiguous: PropTypes.bool,
    wandTolerance: PropTypes.number
};`
    },
    {
        file: 'components/mode-tools/mode-tools.jsx',
        named: 'what the mode tools read from the store',
        find: '    eraserValue: state.scratchPaint.eraserMode.brushSize\n});',
        put: `    eraserValue: state.scratchPaint.eraserMode.brushSize,
    wandTolerance: state.scratchPaint.wandMode.tolerance,
    wandContiguous: state.scratchPaint.wandMode.contiguous
});`
    },
    {
        file: 'components/mode-tools/mode-tools.jsx',
        named: 'what the mode tools write to the store',
        find: `const mapDispatchToProps = dispatch => ({
    onBrushSliderChange: brushSize => {`,
        put: `const mapDispatchToProps = dispatch => ({
    onWandToleranceChange: tolerance => {
        dispatch(changeWandTolerance(tolerance));
    },
    onWandContiguousChange: event => {
        dispatch(changeWandContiguous(event.target.checked));
    },
    onBrushSliderChange: brushSize => {`
    }
];

const main = () => {
    if (!fs.existsSync(INTO)) {
        // A bare checkout with nothing installed yet. Nothing to lay over.
        console.log('paint tools: scratch-paint is not installed, nothing to do');
        return;
    }

    for (const file of COPY) {
        const target = path.join(INTO, file);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.copyFileSync(path.join(FROM, file), target);
    }

    const missing = [];
    const touched = new Set();
    for (const edit of EDITS) {
        const target = path.join(INTO, edit.file);
        const before = fs.readFileSync(target, 'utf8');
        if (before.includes(edit.put)) continue; // already done
        if (!before.includes(edit.find)) {
            missing.push(`${edit.file}: ${edit.named}`);
            continue;
        }
        fs.writeFileSync(target, before.replace(edit.find, edit.put));
        touched.add(edit.file);
    }

    if (missing.length) {
        console.error('\npaint tools: could not find where to add the magic wand and lasso.');
        console.error('TurboWarp has rewritten these parts of the paint editor:\n');
        for (const one of missing) console.error(`  ${one}`);
        console.error('\nUpdate scripts/flipwarp-paint-tools.js to match, then install again.');
        process.exit(1);
    }

    console.log(`paint tools: magic wand and lasso added (${COPY.length} files copied, ` +
        `${touched.size} changed)`);
};

main();
