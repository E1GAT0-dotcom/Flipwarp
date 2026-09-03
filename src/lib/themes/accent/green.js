// Flipwarp's accent, taken from the logo.
//
// The logo's fill is pure #00FF00 with a black outline. Pure #00FF00 cannot
// carry the white text the editor puts on its accent, so the hue is kept and
// the lightness dropped to where white still reads — the same green, at a
// depth the interface can actually use.

const guiColors = {
    'motion-primary': '#00b300',
    'motion-primary-transparent': '#00b300e6',
    'motion-tertiary': '#008400',

    'looks-secondary': '#00b300',
    'looks-transparent': '#00b30059',
    'looks-light-transparent': '#00b30026',
    'looks-secondary-dark': 'hsla(120, 42%, 38%, 1)',

    'extensions-primary': 'hsla(130, 85%, 45%, 1)',
    'extensions-tertiary': 'hsla(130, 85%, 28%, 1)',
    'extensions-transparent': 'hsla(130, 85%, 45%, 0.35)',
    'extensions-light': 'hsla(130, 57%, 85%, 1)',

    'drop-highlight': '#66e066',

    // The page behind a dialog is dimmed with a dark wash of the accent's own
    // hue. Scratch uses 90% of the accent itself, which at any saturated
    // colour is blinding; this keeps the tint and loses the glare.
    'ui-modal-overlay': 'rgba(4, 40, 8, 0.55)'
};

const blockColors = {
    checkboxActiveBackground: '#00b300',
    checkboxActiveBorder: '#008400'
};

export {
    guiColors,
    blockColors
};
