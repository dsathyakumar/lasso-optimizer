'use strict';

const { optimizeSingle } = require('./src/optimize-single');
const { optimizeMulti } = require('./src/optimize-multi');

/**
 * Optimize a single source File (assumes you have all the Lasso's output here)
 * Includes code-split bundles, async bundles.
 * @param {String} code
 * @param {String} noConflictLassoVar - The LassoModules Client Runtime variable For eg) $_mod_ua_fe
 * @param {*} shouldInjectClient - Should the miniature client be injected.
 */
// eslint-disable-next-line arrow-body-style
exports.optimizeSingleSourceFile = (code, noConflictLassoVar, shouldInjectClient) => {
    return optimizeSingle(code, noConflictLassoVar, shouldInjectClient);
};

/**
 * Optimize code-split multi source File bundles (assumes you have all the Lasso's output here)
 * Includes code-split bundles, async bundles.
 * @param {String} codeArr
 * @param {String} noConflictLassoVar - The LassoModules Client Runtime variable For eg) $_mod_ua_fe
 * @param {*} shouldInjectClient - Should the miniature client be injected.
 */
// eslint-disable-next-line arrow-body-style
exports.optimizeMultipleSourceFiles = (codeArr, noConflictLassoVar, shouldInjectClient) => {
    return optimizeMulti(codeArr, noConflictLassoVar, shouldInjectClient);
};
