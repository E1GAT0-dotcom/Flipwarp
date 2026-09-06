// Keeping the project's settings in the project, without being asked twice.
//
// TurboWarp writes the settings into a comment on the stage, and offers a
// button to do it. A button is the wrong shape for this: the settings it saves
// are exactly the ones somebody fiddles with, so every fiddle has to be
// followed by remembering to press it, and the failure when you forget is
// silent. The project opens somewhere else at thirty frames a second and you
// find out from whoever you sent it to.
//
// So it is a switch. On, the comment is kept up to date by itself; off, it is
// taken out, because a stale comment saying the wrong thing is worse than no
// comment at all.
//
// What is stored is TurboWarp's own list and not a word more. The comment is
// read by TurboWarp and by anything else built on it, so putting Flipwarp's
// own settings in there would be writing in somebody else's format and hoping.

import {getSettings, onSettingsChanged} from './settings.js';

// The VM says when each of these changes. Interpolation and the framerate come
// through separately from the runtime options, which is why there are five
// rather than one.
const WHEN_THEY_CHANGE = [
    'RUNTIME_OPTIONS_CHANGED',
    'COMPILER_OPTIONS_CHANGED',
    'FRAMERATE_CHANGED',
    'INTERPOLATION_CHANGED',
    'STAGE_SIZE_CHANGED'
];

// Several of those events arrive together when one switch is flipped, and
// writing the comment marks the project as changed, so writing it once per
// event would both waste the work and light up the unsaved-changes warning
// several times over.
const SETTLE = 250;

let installed = false;

// The VM's own way of finding the comment reaches through the stage without
// checking there is one, and there is not one until a project has loaded. The
// editor is on screen before that, so anything asking this question early has
// to be able to be told "no" rather than thrown at.
const settingsComment = vm => {
    const runtime = vm && vm.runtime;
    if (!runtime || !runtime.findProjectOptionsComment) return null;
    if (!runtime.getTargetForStage || !runtime.getTargetForStage()) return null;
    return runtime.findProjectOptionsComment();
};

/**
 * Take the settings comment out of the project.
 * @param {object} vm the VM
 * @returns {boolean} whether there was one to take out
 */
const forgetSettings = vm => {
    const runtime = vm.runtime;
    const comment = settingsComment(vm);
    if (!comment) return false;
    const stage = runtime.getTargetForStage();
    if (!stage || !stage.comments) return false;
    delete stage.comments[comment.id];
    runtime.emitProjectChanged();
    vm.emitWorkspaceUpdate();
    return true;
};

/**
 * Watch the settings and keep the project's copy of them in step.
 * @param {object} vm the VM
 */
export const installProjectSettings = vm => {
    if (installed || !vm || !vm.runtime) return;
    installed = true;
    const runtime = vm.runtime;

    let timer = null;
    const writeSoon = () => {
        if (!getSettings().keepSettingsInProject) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            // Checked again rather than only above: a quarter of a second is
            // long enough for somebody to have turned the switch off.
            if (!getSettings().keepSettingsInProject) return;

            // A project running on every default has nothing to say, and
            // saying it anyway leaves a comment on the stage reading "{}".
            // Loading a project announces all of these settings whether or not
            // any of them differ, so without this every project opened with
            // the switch on grew an empty comment for no reason.
            const differing = runtime.generateDifferingProjectOptions ?
                runtime.generateDifferingProjectOptions() : null;
            if (differing && Object.keys(differing).length === 0) {
                forgetSettings(vm);
                return;
            }
            vm.storeProjectOptions();
        }, SETTLE);
    };

    for (const event of WHEN_THEY_CHANGE) runtime.on(event, writeSoon);

    onSettingsChanged(settings => {
        if (settings.keepSettingsInProject) writeSoon();
        else forgetSettings(vm);
    });
};

