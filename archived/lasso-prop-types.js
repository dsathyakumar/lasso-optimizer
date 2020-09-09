/* eslint-disable max-len */
'use strict';

/** *
 * Lasso inlines Filepaths in the output bundles.
 * Based on your bundle sizes, this can consume ~10KB for a page.
 * Also, it performs path resolution at runtime on the browser.
 * These filepaths, closesly resemble the filesystem of your project.
 *
 * This module takes care of holdng the paths to perform
 * resolution of paths for Lasso Module Types
 * at build / compile time.
 *
 * The various Lasso Props:
 * - `installed`: if modA requires modB@^1 and modC requires modB@^2,
 *                then it resolves accordingly.
 * - `remap`: If modA requires modB. But modB has mentioned a different file,
 *           for browser
 * - `defs`; The module definiton for modA
 * - `main`: The main file for an installed module.
 * - `run`: Modules that have to be run. Paths resolved from defs itself.
 *          No special holder prop for this. This assumes runnable modules
 *          have no dependencies.
 * - `require`: This is shimmed by `./lasso-module-resolver-runtime.js`
 * - `resolve`: This would replace the existing path itself
 *
 * @todo:// we only see these props being used. Not sure what is the following:
 * - `searchPaths`
 * - `builtin` - (This is most likely to polyfill server modules like Buffer etc.,)
 * - `loaderMetaData`
 * - `ready` - (marking modules as ready. Needed if runnabe modules have deps)
 * - `pending` - (may be needed if we are loading bundles async)
 */

/** *
lassoModulesMeta = {
    installed: {
        'globalheaderfrontend$25.1.0' : {
            'marko': '4.17.3',
        },
        'marko$4.17.3' : {
            'warp10': '2.0.1',
            'raptor-util': '3.2.0'
        }
    },
    remap: {
        '/marko$4.17.3/src/runtime/components/init-components': '/marko$4.17.3/src/runtime/components/init-components-browser'
    },
    main: {
        '/error-stack-parser$2.0.2': 'error-stack-parser',
        '/complain$1.4.0': ''
    },
    defs: {
        '/marko$4.17.3/src/runtime/components/KeySequence': '__marko_4_17_3__src__runtime__components__KeySequence',
        '/marko$4.17.3/src/runtime/components/ComponentDef': '__marko_4_17_3__src__runtime__components__ComponentDef'
    }
}
 */

const lassoModulesMeta = {
    installed: {},
    remap: {},
    main: {},
    defs: {}
};

module.exports = lassoModulesMeta;
