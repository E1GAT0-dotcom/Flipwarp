// Fixes to what a saved project holds, for every save (File > Save as well
// as Claude's save_project).
//
// Scratch saves a list monitor's value as [] when it holds a list, and as 0
// otherwise. A list monitor that was never shown can hold "" or nothing, so it
// was saved as 0. The first "show list" in the saved project then draws a list
// whose length is undefined, which crashes TurboWarp's page. So before saving,
// every list monitor holds a list.

const fixListMonitors = runtime => {
    const monitors = runtime._monitorState;
    if (!monitors) return;
    // This VM's own monitor state: a JS Map of records with plain fields.
    if (monitors.map instanceof Map) {
        for (const record of monitors.map.values()) {
            if (record && record.mode === 'list' && !Array.isArray(record.value)) record.value = [];
        }
        return;
    }
    // Scratch's: an Immutable.js map of records.
    if (typeof monitors.map !== 'function') return;
    let changed = false;
    const fixed = monitors.map(record => {
        if (record.get('mode') !== 'list' || Array.isArray(record.get('value'))) return record;
        changed = true;
        return record.set('value', []);
    });
    if (changed) runtime._monitorState = fixed;
};

/**
 * Wrap the VM's project JSON so saved list monitors always hold a list.
 * @param {object} vm the VM
 */
export const installSaveFixes = vm => {
    if (vm.__flipwarpSaveFixes) return;
    vm.__flipwarpSaveFixes = true;
    const toJSON = vm.toJSON;
    vm.toJSON = function (...args) {
        try {
            fixListMonitors(this.runtime);
        } catch (e) {
            // Save as it is rather than not at all.
        }
        return toJSON.apply(this, args);
    };
};

export {fixListMonitors};
