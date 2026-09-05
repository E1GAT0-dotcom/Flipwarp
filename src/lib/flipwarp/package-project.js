// Turning the project you are looking at into something you can give
// somebody.
//
// TurboWarp's packager is a whole second website with about sixty settings on
// it, and the reason it has to ask so many questions is that it has never
// seen your project — you arrive with a file and it knows nothing else. This
// one is inside the editor, so nearly every one of those questions already
// has an answer sitting in front of it: the framerate, whether the compiler
// is on, the stage size, the clone limit, the fencing. Copying them is both
// simpler and more likely to be right than asking again.
//
// So this asks three things — what kind of file, what to call it, and whether
// it should start on its own — and takes the rest from the project. Anything
// it cannot do, which is Windows, macOS, Linux and Android, is still the
// packager's job, and the dialog says so and links to it.
//
// The packager itself is the real one, the same code the website runs, pulled
// in as a library. It is loaded only when somebody actually packages
// something: it is several megabytes, and most sessions never open this at
// all.

// What the "kind of file" question offers. Anything not here needs a program
// downloaded and built, which a web page cannot do.
export const KINDS = [
    {
        id: 'html',
        label: 'A web page',
        detail: 'One file. Open it in any browser, or put it on a website.'
    },
    {
        id: 'zip',
        label: 'A web page, in pieces',
        detail: 'A zip of separate files. Bigger to handle, but a website can ' +
            'send the parts as they are needed, so it starts faster.'
    }
];

// Where people go for the things this cannot do here.
const FULL_PACKAGER = 'https://packager.turbowarp.org';

/**
 * The address of the full packager, asking it to fetch the project from here
 * rather than making somebody save a file and upload it again. The editor is
 * already listening for the request that address causes it to send.
 * @returns {string} the address
 */
export const fullPackagerUrl = () => `${FULL_PACKAGER}/?import_from=${location.origin}`;

/**
 * Everything about how the project runs, taken from the editor rather than
 * asked for again.
 * @param {object} vm the VM
 * @returns {object} options to hand the packager
 */
export const settingsFromProject = vm => {
    const runtime = vm.runtime;
    const runtimeOptions = runtime.runtimeOptions || {};
    const compilerOptions = runtime.compilerOptions || {};
    const [stageWidth, stageHeight] = runtime.stageWidth && runtime.stageHeight ?
        [runtime.stageWidth, runtime.stageHeight] :
        [480, 360];
    return {
        framerate: runtime.frameLoop ? runtime.frameLoop.framerate : 30,
        turbo: Boolean(runtime.turboMode),
        interpolation: Boolean(runtime.interpolationEnabled),
        highQualityPen: Boolean(runtime.renderer && runtime.renderer.useHighQualityRender),
        maxClones: typeof runtimeOptions.maxClones === 'number' ? runtimeOptions.maxClones : 300,
        fencing: runtimeOptions.fencing !== false,
        miscLimits: runtimeOptions.miscLimits !== false,
        stageWidth,
        stageHeight,
        compiler: {
            enabled: compilerOptions.enabled !== false,
            warpTimer: Boolean(compilerOptions.warpTimer)
        }
    };
};

// A file name somebody can actually save. Windows objects to rather a lot of
// characters and so does every other system, so anything doubtful becomes a
// dash rather than being silently dropped, which would run words together.
const tidyName = name => {
    const cleaned = String(name || '')
        // The control characters are in there deliberately: a name carrying
        // one is refused by every file system there is.
        // eslint-disable-next-line no-control-regex
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
    return cleaned || 'project';
};

/**
 * Package the project currently in the VM.
 *
 * @param {object} args what to make
 * @param {object} args.vm the VM
 * @param {string} args.title what to call it
 * @param {string} args.kind one of KINDS
 * @param {boolean} args.autoplay whether it starts on its own
 * @param {function} [args.onProgress] called with ({stage, percent})
 * @returns {Promise<{name: string, type: string, data: Uint8Array}>} the file
 */
export const packageProject = async ({vm, title, kind, autoplay, onProgress}) => {
    const say = (stage, percent) => {
        if (onProgress) onProgress({stage, percent});
    };

    say('reading', 0);
    const projectData = await vm.saveProjectSb3('arraybuffer');

    say('loading', 0);
    // Loaded here rather than at the top of the file: the packager is several
    // megabytes and most sessions never package anything, so it is fetched
    // the first time somebody asks for it and not before.
    const Packager = await import(/* webpackChunkName: "packager" */ '@turbowarp/packager');

    const loaded = await Packager.loadProject(projectData, (type, a, b) => {
        say(type, typeof b === 'number' && b > 0 ? a / b : a);
    });

    const packager = new Packager.Packager();
    packager.project = loaded;

    // Only the properties being changed, never the whole object: the packager
    // warns that replacing it wholesale breaks whenever it grows a new
    // setting, and it grows new settings often.
    const fromProject = settingsFromProject(vm);
    packager.options.framerate = fromProject.framerate;
    packager.options.turbo = fromProject.turbo;
    packager.options.interpolation = fromProject.interpolation;
    packager.options.highQualityPen = fromProject.highQualityPen;
    packager.options.maxClones = fromProject.maxClones;
    packager.options.fencing = fromProject.fencing;
    packager.options.miscLimits = fromProject.miscLimits;
    packager.options.stageWidth = fromProject.stageWidth;
    packager.options.stageHeight = fromProject.stageHeight;
    packager.options.compiler.enabled = fromProject.compiler.enabled;
    packager.options.compiler.warpTimer = fromProject.compiler.warpTimer;

    packager.options.target = kind === 'zip' ? 'zip' : 'html';
    packager.options.autoplay = Boolean(autoplay);
    // A project that does not start on its own needs something to start it,
    // and a project that does still needs a way to stop it.
    packager.options.controls.greenFlag.enabled = !autoplay;
    packager.options.controls.stopAll.enabled = true;
    packager.options.controls.fullscreen.enabled = true;
    packager.options.app.windowTitle = tidyName(title);
    packager.options.app.packageName = tidyName(title);

    packager.addEventListener('zip-progress', ({detail}) => {
        say('packing', detail && detail.total ? detail.written / detail.total : 0);
    });
    packager.addEventListener('large-asset-fetch', ({detail}) => {
        say('fetching', detail && detail.total ? detail.loaded / detail.total : 0);
    });

    say('packing', 0);
    const result = await packager.package();
    say('done', 1);

    // The packager's own suggested name is not sanitised — its documentation
    // says so — so the name is built here from the title instead.
    const extension = result.type === 'application/zip' ? 'zip' : 'html';
    return {
        name: `${tidyName(title)}.${extension}`,
        type: result.type,
        data: result.data
    };
};
