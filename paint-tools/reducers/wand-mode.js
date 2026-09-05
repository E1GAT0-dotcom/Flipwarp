import log from '../log/log';

// How close a colour has to be to the one that was clicked before the magic
// wand takes it too, and whether the wand stays within one patch of colour or
// takes every matching pixel on the board.
const CHANGE_WAND_TOLERANCE = 'scratch-paint/wand-mode/CHANGE_WAND_TOLERANCE';
const CHANGE_WAND_CONTIGUOUS = 'scratch-paint/wand-mode/CHANGE_WAND_CONTIGUOUS';

// Not zero: Scratch's own drawings have soft edges, and an exact match picks
// up the middle of a shape while leaving a fringe of its own outline behind.
const initialState = {tolerance: 20, contiguous: true};

const reducer = function (state, action) {
    if (typeof state === 'undefined') state = initialState;
    switch (action.type) {
    case CHANGE_WAND_TOLERANCE:
        if (isNaN(action.tolerance)) {
            log.warn(`Invalid wand tolerance: ${action.tolerance}`);
            return state;
        }
        return {...state, tolerance: Math.max(0, Math.min(100, action.tolerance))};
    case CHANGE_WAND_CONTIGUOUS:
        return {...state, contiguous: !!action.contiguous};
    default:
        return state;
    }
};

const changeWandTolerance = function (tolerance) {
    return {
        type: CHANGE_WAND_TOLERANCE,
        tolerance: tolerance
    };
};

const changeWandContiguous = function (contiguous) {
    return {
        type: CHANGE_WAND_CONTIGUOUS,
        contiguous: contiguous
    };
};

export {
    reducer as default,
    changeWandTolerance,
    changeWandContiguous
};
