// A stand-in for Node's file system, for code that runs in both places.
//
// The packager is a library that works in Node and in a browser. Its Node
// half caches the large downloads a desktop build needs, and it wraps
// fs.readFile and friends in promisify the moment it is loaded — before
// anything has asked it to do anything. Told simply that there is no file
// system, promisify is handed undefined and throws while the module is still
// being read, so the whole thing fails before it can be asked for the one
// thing it is being asked for, which is a web page.
//
// So the functions exist and refuse. Anything that genuinely needs to read a
// file gets a clear answer rather than a puzzle about arguments to a function
// nobody called.
const nope = name => (...args) => {
    // The last argument of a Node-style call is its callback; failing through
    // it keeps promisify's contract, which is what wraps these.
    const callback = args[args.length - 1];
    const error = new Error(`A web page cannot ${name} files.`);
    if (typeof callback === 'function') {
        callback(error);
        return undefined;
    }
    throw error;
};

module.exports = {
    readFile: nope('read'),
    writeFile: nope('write'),
    mkdir: nope('make folders for'),
    readdir: nope('list'),
    stat: nope('look at'),
    unlink: nope('delete'),
    existsSync: () => false,
    promises: {}
};
