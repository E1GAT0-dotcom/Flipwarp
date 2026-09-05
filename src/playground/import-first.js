import './public-path';
import '../lib/tw-polyfill';
import '../lib/normalize.css';

// Say on the <html> element whether a finger or a mouse was last used, so that
// the rules which make things finger-sized have something to hang off. It has
// to run before anything is drawn, or a phone would get mouse-sized buttons
// for the first moment.
import {watchInput} from '../lib/flipwarp/touch.js';

watchInput();
