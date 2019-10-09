/* eslint-disable no-console */

'use strict';

const types = require('@babel/types');
const requireFromLassoModulesMeta = require('./lasso-import-resolver-util');

const pruneReferencedPaths = (modName, path, idx, refPath, param, exportables, lassoModulesMeta) => {
    if (idx === 0) { // require (may have may refPaths)
        console.log('binding type: require');
        if (types.isIdentifier(refPath.node)
            && types.isCallExpression(refPath.parent)) {
            if (types.isIdentifier(refPath.parent.callee)) {
                console.log(`modName = ${modName}`);
                // a plain require(). Every require call resolves 1 dep
                const depsArray = refPath.parent.arguments;
                if (depsArray.length === 1 && types.isStringLiteral(depsArray[0])) {
                    // get the associated variable name from lassoModulesMeta.defs
                    const swappableVarDeclarator = requireFromLassoModulesMeta(
                        modName,
                        depsArray[0].value,
                        lassoModulesMeta
                    );
                    // replace CallExpression with Variable declaration
                    // refPath.parentPath.replaceWith(types.identifier(swappableVarDeclarator));
                    refPath.parentPath.node.arguments.pop();
                    refPath.parentPath.node.arguments.push(types.identifier(swappableVarDeclarator));
                }
            }
        } else if (types.isIdentifier(refPath.node)
            && types.isMemberExpression(refPath.parent)) {
            console.info('not a plain require call');
            // may be require.resolve()
            if (types.isIdentifier(refPath.parent.property)
                && refPath.parent.property.name === 'resolve') {
                const callExprPath = refPath.find(p => p.isCallExpression());
                const argsLiteralArr = callExprPath.node.arguments;
                if (argsLiteralArr.length === 1) {
                    const resolvablePath = argsLiteralArr[0];
                    if (types.isStringLiteral(resolvablePath)) {
                        callExprPath.replaceWith(types.stringLiteral(resolvablePath.value));
                    }
                }
            }
        }
    } else { // __dirname, __filename, _module, _exports
        console.log('Skipping binding type: __dirname, __filename');
    }
};

module.exports = pruneReferencedPaths;
