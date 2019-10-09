/* eslint-disable no-console */

'use strict';

// const types = require('@babel/types');
const { popParam, shouldIncludeBinding } = require('./lasso-optimizer-utils');
const pruneReferencedPaths = require('./prune-param-props');

const pruneLassoCJSModuleFuncExpr = (modName, path, lassoModulesMeta) => {
    // prune the function expression here
    path.traverse({
        FunctionExpression(traversalPath) {
            const bindings = traversalPath.scope.getAllBindingsOfKind('param');
            Object.keys(bindings).forEach((param, idx) => {
                console.log(`param = ${param}`);
                // remove the binding & update the scope
                // remove the args from this function expression
                if (traversalPath.scope.hasOwnBinding(param)
                    && shouldIncludeBinding(bindings[param])) {
                    const paramBinding = bindings[param];
                    if (paramBinding.referenced) {
                        const refPaths = paramBinding.referencePaths;
                        // cannot be creating exportables for each ref traversalPath
                        // all exportables will be replaced by a return stat
                        const exportables = [];
                        refPaths.forEach((refPath) => {
                            pruneReferencedPaths(modName,
                                traversalPath,
                                idx,
                                refPath,
                                param,
                                exportables,
                                lassoModulesMeta
                            );
                        });
                    } else {
                        // what to do if binding is non-referenced?
                        // remove the binding & update the scope
                        if (param === '__dirname' || param === '__filename') {
                            console.log('non-referenced param binding. Removing..');
                            traversalPath.scope.removeOwnBinding(param);
                            traversalPath.node.params = popParam(param, traversalPath.node.params);
                        }
                    }
                } else {
                    // we dont even know what this is. Just leave it
                    console.log(`not a param: ${param} . Skipping..`);
                }
            });
        }
    }, path.state);
};

module.exports = pruneLassoCJSModuleFuncExpr;
