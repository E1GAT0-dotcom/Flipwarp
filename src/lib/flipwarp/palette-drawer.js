import {isTouch, onInputChanged} from './touch.js';

/**
 * The block palette as a drawer, on a phone.
 *
 * On a wide screen the palette sits beside the workspace and that is right: it
 * costs 310 pixels out of a thousand and you can see both. On a phone it costs
 * 310 out of 460, which leaves a strip of workspace too narrow to put a block
 * down in — the palette is not next to the workspace so much as instead of it.
 *
 * So on a phone it slides over the workspace instead. Tap a category to open
 * it, drag a block out and it closes behind you, tap the workspace and it
 * closes. The workspace has the whole screen the rest of the time.
 *
 * None of this changes scratch-blocks. Two of the numbers it lays out from are
 * properties on its prototypes, and the position of the drawer is one wrapped
 * method — the same way the right-click menu is already added to, in
 * src/lib/blocks.js.
 */

// The strip of coloured circles down the side. It is the toolbox's real width
// once the palette is not taking room of its own; the number is scratch-blocks'
// own, from its stylesheet.
const CATEGORY_WIDTH = 60;

const NARROW = '(max-width: 720px)';

/**
 * @return {boolean} Whether the palette should be a drawer right now.
 */
const wantsDrawer = () =>
    isTouch() && typeof window !== 'undefined' &&
    Boolean(window.matchMedia && window.matchMedia(NARROW).matches);

/**
 * Turn the palette into a drawer for as long as the screen is a phone's.
 *
 * @param {object} workspace The main Blockly workspace.
 * @param {object} Blockly The scratch-blocks namespace.
 * @return {function} Call it to put everything back.
 */
const installPaletteDrawer = (workspace, Blockly) => {
    if (!workspace || !Blockly || !Blockly.Toolbox || !Blockly.VerticalFlyout) {
        return () => {};
    }

    const fullWidth = Blockly.Toolbox.prototype.width;
    const originalPosition = Blockly.VerticalFlyout.prototype.position;
    let drawerMode = false;
    let open = false;
    let gone = false;

    const flyoutOf = () => (workspace.getFlyout ? workspace.getFlyout() : null);
    const toolboxOf = () => workspace.toolbox_ || null;

    // Where the drawer sits when it is open. Blockly works this out by taking
    // the flyout's width off the toolbox's, which lands it off the left of the
    // screen once the toolbox is only as wide as the category strip — correct
    // arithmetic for a layout that is no longer the one being used.
    Blockly.VerticalFlyout.prototype.position = function () {
        originalPosition.call(this);
        if (!drawerMode || !this.isVisible() || !this.svgGroup_) return;
        Blockly.utils.setCssTransform(this.svgGroup_, `translate(${CATEGORY_WIDTH}px,0px)`);
        if (this.scrollbar_) {
            this.scrollbar_.setOrigin(CATEGORY_WIDTH, 0);
            this.scrollbar_.resize();
        }
    };

    const show = shown => {
        const flyout = flyoutOf();
        if (!flyout) return;
        open = shown;
        flyout.setVisible(shown);
        if (shown) flyout.position();
        // The palette is also where a block is dropped to delete it, and that
        // area is measured once when a drag starts. The drawer closes in the
        // middle of that drag, so the measurement has to be taken again or the
        // left half of the workspace goes on swallowing blocks.
        if (workspace.recordCachedAreas) workspace.recordCachedAreas();
        document.documentElement.dataset.palette = shown ? 'open' : 'shut';
    };

    const enter = () => {
        if (drawerMode) return;
        drawerMode = true;
        Blockly.Toolbox.prototype.width = CATEGORY_WIDTH;
        const toolbox = toolboxOf();
        if (toolbox) toolbox.width = CATEGORY_WIDTH;
        Blockly.svgResize(workspace);
        show(false);
    };

    const leave = () => {
        if (!drawerMode) return;
        drawerMode = false;
        Blockly.Toolbox.prototype.width = fullWidth;
        const toolbox = toolboxOf();
        if (toolbox) toolbox.width = fullWidth;
        show(true);
        Blockly.svgResize(workspace);
        delete document.documentElement.dataset.palette;
    };

    const decide = () => {
        if (gone) return;
        if (wantsDrawer()) enter();
        else leave();
    };

    // Dropping a block on the palette is how you throw it away, and the area
    // that counts is worked out from where the palette is. With the drawer
    // shut the palette is the strip of categories and nothing else — without
    // this, the whole left half of the workspace still swallows blocks, which
    // is a block vanishing for no visible reason.
    const originalToolboxRect = Blockly.Toolbox.prototype.getClientRect;
    Blockly.Toolbox.prototype.getClientRect = function () {
        const rect = originalToolboxRect.call(this);
        if (!drawerMode || open || !rect || !this.HtmlDiv) return rect;
        const strip = this.HtmlDiv.getBoundingClientRect();
        if (!strip.height) return rect;
        rect.top = strip.top;
        rect.height = strip.height;
        rect.width = Math.max(0, strip.right - rect.left);
        return rect;
    };

    // The editor refills the palette whenever the blocks available change — a
    // new extension, a new variable — and filling it is the same call as
    // showing it. The contents still need refreshing while the drawer is shut,
    // so it is filled and then put away again rather than not filled.
    const originalShow = Blockly.Flyout.prototype.show;
    Blockly.Flyout.prototype.show = function (contents) {
        originalShow.call(this, contents);
        if (drawerMode && !open && this === flyoutOf()) this.setVisible(false);
    };

    // Taking a block out puts the drawer away, so you are looking at where the
    // block landed rather than at the palette it came from.
    const originalCreate = Blockly.Flyout.prototype.createBlock;
    Blockly.Flyout.prototype.createBlock = function (originalBlock) {
        const made = originalCreate.call(this, originalBlock);
        if (drawerMode && this === flyoutOf()) show(false);
        return made;
    };

    // Opening and closing is driven by the tap itself rather than by the
    // toolbox telling us a category was selected. It tells us that during its
    // own setup too, and a drawer that opens itself the moment the editor
    // loads is the thing this is meant to stop.
    let lastCategory = null;
    const injection = workspace.getInjectionDiv ? workspace.getInjectionDiv() : null;
    const onPress = e => {
        if (!drawerMode) return;
        const target = e.target;
        if (!target || !target.closest) return;

        const category = target.closest('.scratchCategoryMenuItem');
        if (category) {
            // The same category twice puts it away — otherwise there would be
            // no way to close it except taking a block or tapping behind it.
            if (open && category === lastCategory) show(false);
            else show(true);
            lastCategory = category;
            return;
        }

        // A tap inside the open drawer is someone reading it, not dismissing it.
        if (open && !target.closest('.blocklyFlyout')) show(false);
    };
    if (injection) injection.addEventListener('pointerdown', onPress, true);

    const stopWatchingInput = onInputChanged(decide);
    const narrow = window.matchMedia(NARROW);
    const onNarrowChange = () => decide();
    if (narrow.addEventListener) narrow.addEventListener('change', onNarrowChange);
    else narrow.addListener(onNarrowChange);

    decide();

    return () => {
        gone = true;
        leave();
        Blockly.VerticalFlyout.prototype.position = originalPosition;
        Blockly.Flyout.prototype.createBlock = originalCreate;
        Blockly.Flyout.prototype.show = originalShow;
        Blockly.Toolbox.prototype.getClientRect = originalToolboxRect;
        if (injection) injection.removeEventListener('pointerdown', onPress, true);
        stopWatchingInput();
        if (narrow.removeEventListener) narrow.removeEventListener('change', onNarrowChange);
        else narrow.removeListener(onNarrowChange);
    };
};

export {installPaletteDrawer, CATEGORY_WIDTH};
