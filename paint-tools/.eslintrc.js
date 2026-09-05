// These files are laid over scratch-paint rather than being part of this
// project's own source, so they are written to scratch-paint's rules — which
// allow the older React lifecycle methods the paint editor still uses, and
// import from paths that only exist once the files are in place.
module.exports = {
    root: true,
    extends: ['scratch', 'scratch/es6', 'scratch/react'],
    env: {
        browser: true
    },
    settings: {
        react: {
            version: '16.2'
        }
    }
};
