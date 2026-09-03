// Shared setup for the browser tests.
//
// These tests drive a real browser against a built copy of the site, so they
// need two things that differ from machine to machine: where Playwright is,
// and where the repository is. Both are worked out here rather than written
// into every test.
//
// Running them:
//     npm install --no-save playwright && npx playwright install chromium
//     npm run build
//     (cd build && python3 -m http.server 8099)
//     node test/flipwarp/<name>.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * A path inside the repository.
 * @param {...string} parts path pieces relative to the repository root
 * @returns {string} the absolute path
 */
export const repoPath = (...parts) => path.join(here, '..', '..', ...parts);

// Playwright is not a dependency of this project — it is only needed to run
// these tests — so it may be installed here, or globally, or not at all.
const importPlaywright = async () => {
    try {
        return await import('playwright');
    } catch (e) {
        // A global install is not on the module path, so it has to be found.
        try {
            const { execSync } = await import('node:child_process');
            const globalRoot = execSync('npm root -g', {encoding: 'utf8'}).trim();
            const entry = path.join(globalRoot, 'playwright', 'index.js');
            if (fs.existsSync(entry)) return await import(pathToFileURL(entry).href);
        } catch (e2) {
            // fall through to the message below
        }
        throw new Error(
            'These tests need Playwright, which is not installed.\n' +
            '  npm install --no-save playwright && npx playwright install chromium'
        );
    }
};

/**
 * Start a browser, using a preinstalled one if the environment names it.
 * @param {object} options passed through to Playwright
 * @returns {Promise<object>} the browser
 */
export const launchBrowser = async (options = {}) => {
    // A CommonJS build imported as a module puts its exports under .default.
    const playwright = await importPlaywright();
    const chromium = playwright.chromium || (playwright.default && playwright.default.chromium);
    if (!chromium) throw new Error('Playwright loaded but has no chromium export.');
    // A prepared environment can point at a browser it already has; otherwise
    // Playwright uses whichever one it downloaded for itself.
    const preinstalled = process.env.FLIPWARP_CHROMIUM ||
        (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
    return chromium.launch(preinstalled ? { executablePath: preinstalled, ...options } : options);
};

/**
 * Where the built site is being served. Override with FLIPWARP_TEST_URL.
 * @type {string}
 */
export const SITE = (process.env.FLIPWARP_TEST_URL || 'http://127.0.0.1:8099').replace(/\/$/, '');
