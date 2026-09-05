import React from 'react';
import bindAll from 'lodash.bindall';
import {FormattedMessage, defineMessages, injectIntl, intlShape} from 'react-intl';

import {getSettings, onSettingsChanged} from '../../lib/flipwarp/settings.js';
import {isFrozen, setFrozen, stepOneFrame, onFrozenChanged} from '../../lib/flipwarp/gameplay.js';
import styles from './step-control.css';

const messages = defineMessages({
    hold: {
        defaultMessage: 'Hold the project still',
        description: 'Title of the button that stops a project mid-frame',
        id: 'flipwarp.step.hold'
    },
    carryOn: {
        defaultMessage: 'Let the project carry on',
        description: 'Title of the button that resumes a held project',
        id: 'flipwarp.step.carryOn'
    },
    step: {
        defaultMessage: 'Run one frame',
        description: 'Title of the button that runs a single frame',
        id: 'flipwarp.step.step'
    }
});

/**
 * Hold, and one frame at a time.
 *
 * Separate from the Pause addon on purpose. That one stops each script where
 * it stands, between one block and the next, which is what you want when you
 * are reading a script; this stops the project between one frame and the
 * next, which is what you want when you are watching something move. Turning
 * both on gives you two pause buttons, and the help under the setting says
 * so.
 */
class StepControl extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleHold',
            'handleStep',
            'handleSettingsChange',
            'handleFrozenChange'
        ]);
        this.state = {
            shown: getSettings().stepButton,
            held: isFrozen()
        };
    }

    componentDidMount () {
        this.stopWatchingSettings = onSettingsChanged(this.handleSettingsChange);
        this.stopWatchingFrozen = onFrozenChanged(this.handleFrozenChange);
    }

    componentWillUnmount () {
        if (this.stopWatchingSettings) this.stopWatchingSettings();
        if (this.stopWatchingFrozen) this.stopWatchingFrozen();
    }

    handleSettingsChange (settings) {
        // Turning the buttons off must not leave a project held still with
        // nothing on screen to say why.
        if (!settings.stepButton && isFrozen()) setFrozen(false);
        this.setState({shown: settings.stepButton});
    }

    handleFrozenChange (held) {
        this.setState({held});
    }

    handleHold () {
        setFrozen(!isFrozen());
    }

    handleStep () {
        stepOneFrame();
    }

    render () {
        if (!this.state.shown) return null;
        const {intl} = this.props;
        const held = this.state.held;
        return (
            <div className={styles.group}>
                <button
                    className={styles.button}
                    onClick={this.handleHold}
                    title={intl.formatMessage(held ? messages.carryOn : messages.hold)}
                >
                    {held ? '▶' : '❚❚'}
                </button>
                <button
                    className={styles.button}
                    onClick={this.handleStep}
                    title={intl.formatMessage(messages.step)}
                >
                    {'❚▶'}
                </button>
                {held && (
                    <span className={styles.note}>
                        <FormattedMessage
                            defaultMessage="Held"
                            description="Shown beside the buttons while a project is held still"
                            id="flipwarp.step.held"
                        />
                    </span>
                )}
            </div>
        );
    }
}

StepControl.propTypes = {
    intl: intlShape.isRequired
};

export default injectIntl(StepControl);
