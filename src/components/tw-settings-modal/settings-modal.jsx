import {defineMessages, FormattedMessage, intlShape, injectIntl} from 'react-intl';
import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import bindAll from 'lodash.bindall';
import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';
import FancyCheckbox from '../tw-fancy-checkbox/checkbox.jsx';
import Input from '../forms/input.jsx';
import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import DocumentationLink from '../tw-documentation-link/documentation-link.jsx';
import styles from './settings-modal.css';
import {getSettings, setSettings} from '../../lib/flipwarp/settings.js';
import {STYLES, STYLE_IDS} from '../../lib/flipwarp/styles.js';
import helpIcon from './help-icon.svg';
import {APP_NAME} from '../../lib/brand.js';

/* eslint-disable react/no-multi-comp */

const BufferedInput = BufferedInputHOC(Input);

const messages = defineMessages({
    title: {
        defaultMessage: 'Advanced Settings',
        description: 'Title of settings modal',
        id: 'tw.settingsModal.title'
    },
    help: {
        defaultMessage: 'Click for help',
        description: 'Hover text of help icon in settings',
        id: 'tw.settingsModal.help'
    }
});

const LearnMore = props => (
    <React.Fragment>
        {' '}
        <DocumentationLink {...props}>
            <FormattedMessage
                defaultMessage="Learn more."
                id="gui.alerts.cloudInfoLearnMore"
            />
        </DocumentationLink>
    </React.Fragment>
);

class UnwrappedSetting extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleClickHelp'
        ]);
        this.state = {
            helpVisible: false
        };
    }
    componentDidUpdate (prevProps) {
        if (this.props.active && !prevProps.active) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({
                helpVisible: true
            });
        }
    }
    handleClickHelp () {
        this.setState(prevState => ({
            helpVisible: !prevState.helpVisible
        }));
    }
    render () {
        return (
            <div
                className={classNames(styles.setting, {
                    [styles.active]: this.props.active
                })}
            >
                <div className={styles.label}>
                    {this.props.primary}
                    <button
                        className={styles.helpIcon}
                        onClick={this.handleClickHelp}
                        title={this.props.intl.formatMessage(messages.help)}
                    >
                        <img
                            src={helpIcon}
                            draggable={false}
                        />
                    </button>
                </div>
                {this.state.helpVisible && (
                    <div className={styles.detail}>
                        {/* Written either way: TurboWarp's own settings pass
                            their help as a prop, Flipwarp's put it inside the
                            setting. Only the prop was ever read, so every "?"
                            in the Flipwarp section opened an empty box. */}
                        {this.props.help || this.props.children}
                        {this.props.slug && <LearnMore slug={this.props.slug} />}
                    </div>
                )}
                {this.props.secondary}
            </div>
        );
    }
}
UnwrappedSetting.propTypes = {
    intl: intlShape,
    active: PropTypes.bool,
    children: PropTypes.node,
    help: PropTypes.node,
    primary: PropTypes.node,
    secondary: PropTypes.node,
    slug: PropTypes.string
};
const Setting = injectIntl(UnwrappedSetting);

const BooleanSetting = ({value, onChange, label, ...props}) => (
    <Setting
        {...props}
        active={value}
        primary={
            <label className={styles.label}>
                <FancyCheckbox
                    className={styles.checkbox}
                    checked={value}
                    onChange={onChange}
                />
                {label}
            </label>
        }
    />
);
BooleanSetting.propTypes = {
    children: PropTypes.node,
    onChange: PropTypes.func.isRequired,
    value: PropTypes.bool.isRequired,
    label: PropTypes.node.isRequired
};

const HighQualityPen = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="High Quality Pen"
                description="High quality pen setting"
                id="tw.settingsModal.highQualityPen"
            />
        }
        help={
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Allows pen projects to render at higher resolutions and disables some coordinate rounding in the editor. Not all projects benefit from this setting and it may impact performance."
                description="High quality pen setting help"
                id="tw.settingsModal.highQualityPenHelp"
            />
        }
        slug="high-quality-pen"
    />
);

const CustomFPS = props => (
    <BooleanSetting
        value={props.framerate !== 30}
        onChange={props.onChange}
        label={
            <FormattedMessage
                defaultMessage="60 FPS (Custom FPS)"
                description="FPS setting"
                id="tw.settingsModal.fps"
            />
        }
        help={
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Runs scripts 60 times per second instead of 30. Most projects will not work properly with this enabled. You should try Interpolation with 60 FPS mode disabled if that is the case. {customFramerate}."
                description="FPS setting help"
                id="tw.settingsModal.fpsHelp"
                values={{
                    customFramerate: (
                        <a
                            onClick={props.onCustomizeFramerate}
                            tabIndex="0"
                        >
                            <FormattedMessage
                                defaultMessage="Click to use a framerate other than 30 or 60"
                                description="FPS settings help"
                                id="tw.settingsModal.fpsHelp.customFramerate"
                            />
                        </a>
                    )
                }}
            />
        }
        slug="custom-fps"
    />
);
CustomFPS.propTypes = {
    framerate: PropTypes.number,
    onChange: PropTypes.func,
    onCustomizeFramerate: PropTypes.func
};

const Interpolation = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="Interpolation"
                description="Interpolation setting"
                id="tw.settingsModal.interpolation"
            />
        }
        help={
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Makes projects appear smoother by interpolating sprite motion. Interpolation should not be used on 3D projects, raytracers, pen projects, and laggy projects as interpolation will make them run slower without making them appear smoother."
                description="Interpolation setting help"
                id="tw.settingsModal.interpolationHelp"
            />
        }
        slug="interpolation"
    />
);

const InfiniteClones = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="Infinite Clones"
                description="Infinite Clones setting"
                id="tw.settingsModal.infiniteClones"
            />
        }
        help={
            <FormattedMessage
                defaultMessage="Disables Scratch's 300 clone limit."
                description="Infinite Clones setting help"
                id="tw.settingsModal.infiniteClonesHelp"
            />
        }
        slug="infinite-clones"
    />
);

const RemoveFencing = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="Remove Fencing"
                description="Remove Fencing setting"
                id="tw.settingsModal.removeFencing"
            />
        }
        help={
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Allows sprites to move offscreen, become as large or as small as they want, and makes touching blocks work offscreen."
                description="Remove Fencing setting help"
                id="tw.settingsModal.removeFencingHelp"
            />
        }
        slug="remove-fencing"
    />
);

const RemoveMiscLimits = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="Remove Miscellaneous Limits"
                description="Remove Miscellaneous Limits setting"
                id="tw.settingsModal.removeMiscLimits"
            />
        }
        help={
            <FormattedMessage
                defaultMessage="Removes sound effect limits and pen size limits."
                description="Remove Miscellaneous Limits setting help"
                id="tw.settingsModal.removeMiscLimitsHelp"
            />
        }
        slug="remove-misc-limits"
    />
);

const WarpTimer = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="Warp Timer"
                description="Warp Timer setting"
                id="tw.settingsModal.warpTimer"
            />
        }
        help={
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Makes scripts check if they are stuck in a long or infinite loop and run at a low framerate instead of getting stuck until the loop finishes. This fixes most crashes but has a significant performance impact, so it's only enabled by default in the editor."
                description="Warp Timer help"
                id="tw.settingsModal.warpTimerHelp"
            />
        }
        slug="warp-timer"
    />
);

const DisableCompiler = props => (
    <BooleanSetting
        {...props}
        label={
            <FormattedMessage
                defaultMessage="Disable Compiler"
                description="Disable Compiler setting"
                id="tw.settingsModal.disableCompiler"
            />
        }
        help={
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Disables the {APP_NAME} compiler. You may want to enable this while editing projects so that scripts update immediately. Otherwise, you should never enable this."
                description="Disable Compiler help"
                id="tw.settingsModal.disableCompilerHelp"
                values={{
                    APP_NAME
                }}
            />
        }
        slug="disable-compiler"
    />
);

const CustomStageSize = ({
    customStageSizeEnabled,
    stageWidth,
    onStageWidthChange,
    stageHeight,
    onStageHeightChange
}) => (
    <Setting
        active={customStageSizeEnabled}
        primary={(
            <div className={classNames(styles.label, styles.customStageSize)}>
                <FormattedMessage
                    defaultMessage="Custom Stage Size:"
                    description="Custom Stage Size option"
                    id="tw.settingsModal.customStageSize"
                />
                <BufferedInput
                    value={stageWidth}
                    onSubmit={onStageWidthChange}
                    className={styles.customStageSizeInput}
                    type="number"
                    min="0"
                    max="1024"
                    step="1"
                />
                <span>{'×'}</span>
                <BufferedInput
                    value={stageHeight}
                    onSubmit={onStageHeightChange}
                    className={styles.customStageSizeInput}
                    type="number"
                    min="0"
                    max="1024"
                    step="1"
                />
            </div>
        )}
        secondary={
            (stageWidth >= 1000 || stageHeight >= 1000) && (
                <div className={styles.warning}>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Using a custom stage size this large is not recommended! Instead, use a lower size with the same aspect ratio and let fullscreen mode upscale it to match the user's display."
                        description="Warning about using stages that are too large in settings modal"
                        id="tw.settingsModal.largeStageWarning"
                    />
                    <LearnMore slug="custom-stage-size" />
                </div>
            )
        }
        help={(
            <FormattedMessage
                // eslint-disable-next-line max-len
                defaultMessage="Changes the size of the Scratch stage from 480x360 to something else. Try 640x360 to make the stage widescreen. Very few projects will handle this properly."
                description="Custom Stage Size option"
                id="tw.settingsModal.customStageSizeHelp"
            />
        )}
        slug="custom-stage-size"
    />
);
CustomStageSize.propTypes = {
    customStageSizeEnabled: PropTypes.bool,
    stageWidth: PropTypes.number,
    onStageWidthChange: PropTypes.func,
    stageHeight: PropTypes.number,
    onStageHeightChange: PropTypes.func
};

const StoreProjectOptions = ({onStoreProjectOptions}) => (
    <div className={styles.setting}>
        <div>
            <button
                onClick={onStoreProjectOptions}
                className={styles.button}
            >
                <FormattedMessage
                    defaultMessage="Store settings in project"
                    description="Button in settings modal"
                    id="tw.settingsModal.storeProjectOptions"
                />
            </button>
            <p>
                <FormattedMessage
                    // eslint-disable-next-line max-len
                    defaultMessage="Saves these settings inside the project file, so they are applied automatically the next time Flipwarp opens it. Warp timer and disable compiler are not saved."
                    description="Help text for the store settings in project button"
                    id="tw.settingsModal.storeProjectOptionsHelp"
                />
            </p>
        </div>
    </div>
);
StoreProjectOptions.propTypes = {
    onStoreProjectOptions: PropTypes.func
};

const Header = props => (
    <div className={styles.header}>
        {props.children}
        <div className={styles.divider} />
    </div>
);
Header.propTypes = {
    children: PropTypes.node
};

// Flipwarp's own settings live at the top of Advanced Settings, kept apart
// from TurboWarp's so it is clear which project each one belongs to.
const FlipwarpSettings = () => {
    const [settings, setLocal] = React.useState(getSettings());
    const change = changes => {
        setSettings(changes);
        setLocal(getSettings());
    };
    return (
        <React.Fragment>
            <BooleanSetting
                value={settings.suggestions}
                onChange={e => change({suggestions: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Suggest blocks while typing"
                    description="Flipwarp setting"
                    id="flipwarp.settings.suggestions"
                />}
            >
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Offers matching block names as you type in the text editor. Press Tab to fill in the highlighted one."
                        description="Help text for the suggestions setting"
                        id="flipwarp.settings.suggestionsHelp"
                    />
                </p>
            </BooleanSetting>
            <BooleanSetting
                value={settings.showPositions}
                onChange={e => change({showPositions: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Show where each script sits"
                    description="Flipwarp setting"
                    id="flipwarp.settings.showPositions"
                />}
            >
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Adds an @at(x, y) line above each script in the text, saying where it sits on the canvas. The positions are kept either way; this only decides whether you see them."
                        description="Help text for the show positions setting"
                        id="flipwarp.settings.showPositionsHelp"
                    />
                </p>
            </BooleanSetting>
            <BooleanSetting
                value={settings.searchProject}
                onChange={e => change({searchProject: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Search all sprites"
                    description="Flipwarp setting"
                    id="flipwarp.settings.searchProject"
                />}
            >
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Adds a Tools button beside the Text button, with a search that looks through every sprite at once and jumps to what it finds."
                        description="Help text for the search setting"
                        id="flipwarp.settings.searchProjectHelp"
                    />
                </p>
            </BooleanSetting>
            <BooleanSetting
                value={settings.findReplace}
                onChange={e => change({findReplace: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Find and replace across sprites"
                    description="Flipwarp setting"
                    id="flipwarp.settings.findReplace"
                />}
            >
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Renames something everywhere at once. Every line it would change is listed first with a tick box, and nothing is changed until you press the button — and then either every ticked line changes or, if one of them would break a sprite, none of them do."
                        description="Help text for the find and replace setting"
                        id="flipwarp.settings.findReplaceHelp"
                    />
                </p>
            </BooleanSetting>
            <BooleanSetting
                value={settings.copyAsText}
                onChange={e => change({copyAsText: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Copy a script as text"
                    description="Flipwarp setting"
                    id="flipwarp.settings.copyAsText"
                />}
            >
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Adds Copy as text to the menu you get when you right-click a script, putting that one script on the clipboard in Flipwarp's text form."
                        description="Help text for the copy as text setting"
                        id="flipwarp.settings.copyAsTextHelp"
                    />
                </p>
            </BooleanSetting>
            <BooleanSetting
                value={settings.pasteAsBlocks}
                onChange={e => change({pasteAsBlocks: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Paste text as blocks"
                    description="Flipwarp setting"
                    id="flipwarp.settings.pasteAsBlocks"
                />}
            >
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Adds Paste as blocks to the menu you get when you right-click the workspace — the other half of Copy as text. The scripts are added to the sprite you are in; nothing already there is removed."
                        description="Help text for the paste as blocks setting"
                        id="flipwarp.settings.pasteAsBlocksHelp"
                    />
                </p>
            </BooleanSetting>
            <BooleanSetting
                value={settings.blockSheet}
                onChange={e => change({blockSheet: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Block sheet"
                    description="Flipwarp setting"
                    id="flipwarp.settings.blockSheet"
                />}
            >
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="A searchable list under Tools of every block and how to write it, built from the editor's own table so it cannot go out of date."
                        description="Help text for the block sheet setting"
                        id="flipwarp.settings.blockSheetHelp"
                    />
                </p>
            </BooleanSetting>
            <BooleanSetting
                value={settings.musicPlayer}
                onChange={e => change({musicPlayer: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Background radio"
                    description="Flipwarp setting"
                    id="flipwarp.settings.musicPlayer"
                />}
            >
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Adds play and pause beside the green flag, with stations from the Radio Browser directory. It is a public directory anyone can add to, so what a station plays is up to whoever runs it. Nothing is fetched until you open the list."
                        description="Help text for the background radio setting"
                        id="flipwarp.settings.musicPlayerHelp"
                    />
                </p>
            </BooleanSetting>
            {settings.musicPlayer ? (
                <div className={styles.setting}>
                    <label>
                        <FormattedMessage
                            defaultMessage="While a project is running"
                            description="Flipwarp setting"
                            id="flipwarp.settings.musicWhileRunning"
                        />
                        {' '}
                        <select
                            value={settings.musicWhileRunning}
                            onChange={e => change({musicWhileRunning: e.target.value})}
                        >
                            <option value="duck">{'Turn the radio down'}</option>
                            <option value="mute">{'Silence the radio'}</option>
                            <option value="nothing">{'Leave the radio alone'}</option>
                        </select>
                    </label>
                    <p>
                        <FormattedMessage
                            defaultMessage="So a project's own sounds can be heard over the music. The radio goes back to normal when the project stops."
                            description="Help text for what the radio does while a project runs"
                            id="flipwarp.settings.musicWhileRunningHelp"
                        />
                    </p>
                </div>
            ) : null}
            <div className={styles.setting}>
                <label>
                    <FormattedMessage
                        defaultMessage="Text style"
                        description="Flipwarp setting"
                        id="flipwarp.settings.textStyle"
                    />
                    {' '}
                    <select
                        value={settings.textStyle}
                        onChange={e => change({textStyle: e.target.value})}
                    >
                        {STYLE_IDS.map(id => (
                            <option
                                key={id}
                                value={id}
                            >{STYLES[id].label}</option>
                        ))}
                    </select>
                </label>
                <p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="How the text is written. The blocks are the same either way — only the spelling changes, and Blocks turns either one back into the same project."
                        description="Help text for the text style setting"
                        id="flipwarp.settings.textStyleHelp"
                    />
                </p>
            </div>
            <div className={styles.setting}>
                <label>
                    <FormattedMessage
                        defaultMessage="Indent size"
                        description="Flipwarp setting"
                        id="flipwarp.settings.indent"
                    />
                    {' '}
                    <select
                        value={settings.indentSize}
                        onChange={e => change({indentSize: Number(e.target.value)})}
                    >
                        <option value={2}>{'2 spaces'}</option>
                        <option value={4}>{'4 spaces'}</option>
                    </select>
                </label>
                <p>
                    <FormattedMessage
                        defaultMessage="How far one step of indent goes, both in the text you are shown and when Tab and Enter add one."
                        description="Help text for the indent size setting"
                        id="flipwarp.settings.indentHelp"
                    />
                </p>
            </div>
        </React.Fragment>
    );
};

// A choice rather than a switch, written so the explanation goes behind the
// "?" like every other setting rather than sitting under the control taking
// up room whether or not anyone wanted it.
const ChoiceSetting = ({value, onChange, label, help, options}) => (
    <Setting
        active={options.findIndex(o => o.value === value) > 0}
        help={help}
        primary={
            <label className={styles.label}>
                {label}
                {' '}
                <select
                    value={value}
                    onChange={onChange}
                >
                    {options.map(option => (
                        <option
                            key={String(option.value)}
                            value={option.value}
                        >{option.label}</option>
                    ))}
                </select>
            </label>
        }
    />
);
ChoiceSetting.propTypes = {
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    onChange: PropTypes.func.isRequired,
    label: PropTypes.node.isRequired,
    help: PropTypes.node,
    options: PropTypes.arrayOf(PropTypes.shape({
        value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        label: PropTypes.string
    })).isRequired
};

// The settings that change how a project runs rather than how the editor
// looks. Every one is off to begin with: a project made here should behave
// the way it behaves everywhere else until somebody decides otherwise.
//
// The labels are deliberately two or three words. What each one actually does
// takes a paragraph, and a paragraph belongs behind the "?" — a column of
// sentences is a column nobody reads.
const GameplaySettings = () => {
    const [settings, setLocal] = React.useState(getSettings());
    const change = changes => {
        setSettings(changes);
        setLocal(getSettings());
    };
    return (
        <React.Fragment>
            <BooleanSetting
                value={settings.pauseOffScreen}
                onChange={e => change({pauseOffScreen: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Pause off-screen"
                    description="Flipwarp gameplay setting"
                    id="flipwarp.settings.pauseOffScreen"
                />}
                help={<p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Holds the project still while its tab is in the background, and starts it again when you come back. Without this a phone half-runs it — sound keeps playing, timers keep counting — and you return to a game that carried on without you."
                        description="Help text for the pause off-screen setting"
                        id="flipwarp.settings.pauseOffScreenHelp"
                    />
                </p>}
            />
            <BooleanSetting
                value={settings.hidePointer}
                onChange={e => change({hidePointer: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Hide pointer"
                    description="Flipwarp gameplay setting"
                    id="flipwarp.settings.hidePointer"
                />}
                help={<p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Takes the mouse pointer away over the stage, for games that draw their own with a sprite. It is still there — clicking works exactly as before — you just cannot see two of them."
                        description="Help text for the hide pointer setting"
                        id="flipwarp.settings.hidePointerHelp"
                    />
                </p>}
            />
            <ChoiceSetting
                value={settings.slowMotion}
                onChange={e => change({slowMotion: Number(e.target.value)})}
                label={<FormattedMessage
                    defaultMessage="Slow motion"
                    description="Flipwarp gameplay setting"
                    id="flipwarp.settings.slowMotion"
                />}
                options={[
                    {value: 1, label: 'Normal speed'},
                    {value: 2, label: 'Half speed'},
                    {value: 4, label: 'Quarter speed'},
                    {value: 8, label: 'An eighth'}
                ]}
                help={<p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Runs the whole project slower so you can see what it is doing. Waits and timers slow down with it, so a wait of one second still lasts one second as far as the project is concerned — nothing gets out of step with anything else, it all just takes longer to watch."
                        description="Help text for the slow motion setting"
                        id="flipwarp.settings.slowMotionHelp"
                    />
                </p>}
            />
            <BooleanSetting
                value={settings.stepButton}
                onChange={e => change({stepButton: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Step buttons"
                    description="Flipwarp gameplay setting"
                    id="flipwarp.settings.stepButton"
                />}
                help={<p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Puts two buttons beside the green flag: one holds the project still, the other runs exactly one frame. Between them you can walk a project forward a frame at a time and watch what moves. This stops the project between frames; the Pause addon stops each script between blocks, so with both on you get two pause buttons that do different things."
                        description="Help text for the step buttons setting"
                        id="flipwarp.settings.stepButtonHelp"
                    />
                </p>}
            />
            <BooleanSetting
                value={settings.fixedRandom}
                onChange={e => change({fixedRandom: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Fixed randomness"
                    description="Flipwarp gameplay setting"
                    id="flipwarp.settings.fixedRandom"
                />}
                help={<p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Makes pick random give the same answers every run, so the same project with the same inputs does the same thing twice. That is what makes a bug you only saw once findable. Change the number to get a different run that also repeats."
                        description="Help text for the fixed randomness setting"
                        id="flipwarp.settings.fixedRandomHelp"
                    />
                </p>}
            />
            {settings.fixedRandom ? (
                <Setting
                    active
                    primary={
                        <label className={styles.label}>
                            <FormattedMessage
                                defaultMessage="Seed"
                                description="Flipwarp gameplay setting"
                                id="flipwarp.settings.randomSeed"
                            />
                            {' '}
                            <BufferedInput
                                value={settings.randomSeed}
                                onSubmit={value => change({randomSeed: Math.round(Number(value)) || 1})}
                                className={styles.customStageSizeInput}
                                type="number"
                                step="1"
                            />
                        </label>
                    }
                    help={<p>
                        <FormattedMessage
                            // eslint-disable-next-line max-len
                            defaultMessage="Which repeatable run you get. Any whole number will do, and every number gives a different run — this is the number to change when you want a different set of random answers that still repeats."
                            description="Help text for the random seed"
                            id="flipwarp.settings.randomSeedHelp"
                        />
                    </p>}
                />
            ) : null}
            <BooleanSetting
                value={settings.fastCollisions}
                onChange={e => change({fastCollisions: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Fast collisions"
                    description="Flipwarp gameplay setting"
                    id="flipwarp.settings.fastCollisions"
                />}
                help={<p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="Touching checks whether two sprites' rectangles overlap instead of comparing every pixel. It is the single most expensive thing a busy project does, so this can be the difference between a game that keeps up and one that does not — but sprites touch a little sooner than they look like they do, which matters most for thin or oddly shaped costumes."
                        description="Help text for the fast collisions setting"
                        id="flipwarp.settings.fastCollisionsHelp"
                    />
                </p>}
            />
            <BooleanSetting
                value={settings.skipFrames}
                onChange={e => change({skipFrames: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Skip frames"
                    description="Flipwarp gameplay setting"
                    id="flipwarp.settings.skipFrames"
                />}
                help={<p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="When a frame takes longer than it had, leave the drawing out rather than letting the whole project fall behind. The project keeps its speed and the picture updates every other frame instead of every frame — the difference between a game that looks slightly choppy and one that runs in slow motion."
                        description="Help text for the skip frames setting"
                        id="flipwarp.settings.skipFramesHelp"
                    />
                </p>}
            />
            <ChoiceSetting
                value={settings.renderScale}
                onChange={e => change({renderScale: Number(e.target.value)})}
                label={<FormattedMessage
                    defaultMessage="Render scale"
                    description="Flipwarp gameplay setting"
                    id="flipwarp.settings.renderScale"
                />}
                options={[
                    {value: 0.5, label: 'Half — faster'},
                    {value: 1, label: 'Normal'},
                    {value: 2, label: 'Double — sharper'}
                ]}
                help={<p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="How many pixels the stage is drawn with. Double is sharper on a good screen and costs four times as much to draw; half is blurry and costs a quarter, which is often what keeps a phone at full speed. The project itself cannot tell the difference — coordinates and sizes are unchanged."
                        description="Help text for the render scale setting"
                        id="flipwarp.settings.renderScaleHelp"
                    />
                </p>}
            />
            <BooleanSetting
                value={settings.inputBuffering}
                onChange={e => change({inputBuffering: e.target.checked})}
                label={<FormattedMessage
                    defaultMessage="Input buffering"
                    description="Flipwarp gameplay setting"
                    id="flipwarp.settings.inputBuffering"
                />}
                help={<p>
                    <FormattedMessage
                        // eslint-disable-next-line max-len
                        defaultMessage="A project only looks at the keyboard once a frame, so a tap shorter than a frame can happen entirely between two looks and never be seen at all. This holds a key down until the project has had one look at it. Nothing is invented — the press really happened; this only decides when the release is allowed to."
                        description="Help text for the input buffering setting"
                        id="flipwarp.settings.inputBufferingHelp"
                    />
                </p>}
            />
        </React.Fragment>
    );
};

const SettingsModalComponent = props => (
    <Modal
        className={styles.modalContent}
        onRequestClose={props.onClose}
        contentLabel={props.intl.formatMessage(messages.title)}
        id="settingsModal"
    >
        <Box className={styles.body}>
            <Header>
                {'Flipwarp'}
            </Header>
            <FlipwarpSettings />
            <Header>
                {'Gameplay'}
            </Header>
            <GameplaySettings />
            <Header>
                <FormattedMessage
                    defaultMessage="Featured"
                    description="Settings modal section"
                    id="tw.settingsModal.featured"
                />
            </Header>
            <CustomFPS
                framerate={props.framerate}
                onChange={props.onFramerateChange}
                onCustomizeFramerate={props.onCustomizeFramerate}
            />
            <Interpolation
                value={props.interpolation}
                onChange={props.onInterpolationChange}
            />
            <HighQualityPen
                value={props.highQualityPen}
                onChange={props.onHighQualityPenChange}
            />
            <WarpTimer
                value={props.warpTimer}
                onChange={props.onWarpTimerChange}
            />
            <Header>
                <FormattedMessage
                    defaultMessage="Remove Limits"
                    description="Settings modal section"
                    id="tw.settingsModal.removeLimits"
                />
            </Header>
            <InfiniteClones
                value={props.infiniteClones}
                onChange={props.onInfiniteClonesChange}
            />
            <RemoveFencing
                value={props.removeFencing}
                onChange={props.onRemoveFencingChange}
            />
            <RemoveMiscLimits
                value={props.removeLimits}
                onChange={props.onRemoveLimitsChange}
            />
            <Header>
                <FormattedMessage
                    defaultMessage="Danger Zone"
                    description="Settings modal section"
                    id="tw.settingsModal.dangerZone"
                />
            </Header>
            {!props.isEmbedded && (
                <CustomStageSize
                    {...props}
                />
            )}
            <DisableCompiler
                value={props.disableCompiler}
                onChange={props.onDisableCompilerChange}
            />
            {!props.isEmbedded && (
                <StoreProjectOptions
                    {...props}
                />
            )}
        </Box>
    </Modal>
);

SettingsModalComponent.propTypes = {
    intl: intlShape,
    onClose: PropTypes.func,
    isEmbedded: PropTypes.bool,
    framerate: PropTypes.number,
    onFramerateChange: PropTypes.func,
    onCustomizeFramerate: PropTypes.func,
    highQualityPen: PropTypes.bool,
    onHighQualityPenChange: PropTypes.func,
    interpolation: PropTypes.bool,
    onInterpolationChange: PropTypes.func,
    infiniteClones: PropTypes.bool,
    onInfiniteClonesChange: PropTypes.func,
    removeFencing: PropTypes.bool,
    onRemoveFencingChange: PropTypes.func,
    removeLimits: PropTypes.bool,
    onRemoveLimitsChange: PropTypes.func,
    warpTimer: PropTypes.bool,
    onWarpTimerChange: PropTypes.func,
    disableCompiler: PropTypes.bool,
    onDisableCompilerChange: PropTypes.func
};

export default injectIntl(SettingsModalComponent);
