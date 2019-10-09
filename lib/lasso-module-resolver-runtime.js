'use strict';

/**
 * This is the miniature runtime that will replace
 * `lasso-modules-client` run time.
 * `${output.code}` is no longer the typical Lasso Module System
 * output, that resembles the Node JS module System.
 *
 * So, code will no longer be of the form
 * $_mod.def('/myProject$0.0.0/my/awesome/feature', function (require, exports, module, __filename, __dirname) {
 * // code here
 * });
 *
 * It has already been transformed to:
 * var _$A = function (require, exports, module) {
 *  // usual code here
 * }
 * This miniature runtime, takes care of module resolution
 * and any cyclic dependencies that may be present, per the Node JS module system.
 */

module.exports = (output) => `!(function (win) {
    win.global = win;
    const cache = {};
    function require(func) {
        if (!cache[func.name]) {
            func.loaded = false;
            const mod = {
                exports: {}
            };
            let exportss = mod.exports;
            cache[func.name] = mod;
            func.call(null, require, exportss, mod);
            func.loaded = true;
        }
        return cache[func.name].exports;
    }
    ${output.code}
})(this);`;
