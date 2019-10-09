/* eslint-disable no-console */

'use strict';
const { get } = require('@ebay/retriever');
const types = require('@babel/types');
const pruneLassoCJSModuleFuncExpr = require('./lasso-binding-utils');

const getLassoModuleData = (path, lassoModulesMeta) => {
    const returnables = {};
    const calleeObj = get(path, 'node.callee', {});
    const lassoProp = get(calleeObj, 'property.name', '');
    returnables.lassoProp = lassoProp;
    const args = get(path, 'node.arguments', []);
    if (lassoProp === 'def') {
        console.info(`Lasso prop type = def`);
        if (types.isStringLiteral(args[0])) {
            console.log(`path = ${args[0].value}`);
            // const modulePathToVarRef = args[0].value
            //     .replace(new RegExp('/', 'g'), '__')
            //     .replace('$', '_')
            //     .replace(/\./g, '_')
            //     .replace(/\-/g, '_');
            const modulePathToVarRef = global.___lassoPluginOptimizer.___varNamesArr.shift();
            returnables.modulePathToVarRef = modulePathToVarRef;
            lassoModulesMeta.defs[args[0].value] = modulePathToVarRef;
        }
        if (types.isFunctionExpression(args[1])) {
            pruneLassoCJSModuleFuncExpr(args[0].value, path, lassoModulesMeta);
            returnables.definition = args[1];
        }
    } else if (lassoProp === 'remap') {
        console.info(`Lasso prop type = remap`);
        if (types.isStringLiteral(args[0]) && types.isStringLiteral(args[1])) {
            // while resolving .require calls, it would have to check
            // remap before checking defs as defs would have the remapped only
            console.log(`path = ${args[0].value}`);
            // const modulePathToVarRef = args[1].value
            //     .replace(new RegExp('/', 'g'), '__')
            //     .replace('$', '_')
            //     .replace(/\./g, '_')
            //     .replace(/\-/g, '_');
            // returnables.modulePathToVarRef = modulePathToVarRef;
            // returnables.message = `Re-mapped ${args[0].value} to ${args[1].value}. Refer ${modulePathToVarRef}`;
            returnables.message = `Re-mapped ${args[0].value} to ${args[1].value}.`;
            lassoModulesMeta.remap[args[0].value] = args[1].value;
        }
    } else if (lassoProp === 'installed') {
        console.info(`Lasso prop type = installed`);
        if (types.isStringLiteral(args[0]) && types.isStringLiteral(args[1]) && types.isStringLiteral(args[2])) {
            // while resolving .require calls, for non file based imports
            // it would have to check the associated installed modules first
            lassoModulesMeta.installed[args[0].value] = lassoModulesMeta.installed[args[0].value] || {};
            if (lassoModulesMeta.installed[args[0].value]) {
                lassoModulesMeta.installed[args[0].value][args[1].value] = args[2].value;
                returnables.message = `${args[1].value} v${args[2].value} installed for ${args[0].value}`;
            }
        }
    } else if (lassoProp === 'main') {
        console.info(`Lasso prop type = main`);
        if (types.isStringLiteral(args[0]) && types.isStringLiteral(args[1])) {
            lassoModulesMeta.main[args[0].value] = args[1].value;
            returnables.message = `main for ${args[0].value} is ${args[1].value}`;
        }
    } else if (lassoProp === 'run') {
        console.info(`Lasso prop type = run`);
        if (types.isStringLiteral(args[0])) {
            let runnable = lassoModulesMeta.defs[args[0].value];
            if (!runnable) {
                runnable = lassoModulesMeta.remap[args[0].value];
                runnable = lassoModulesMeta.defs[runnable];
            }
            returnables.modulePathToVarRef = runnable;
            returnables.message = `Self invoke ${runnable}`;
        }
    } else if (lassoProp === 'searchPath') {
        // do nothing. Paths have already been resolved at build time
        console.info(`Lasso prop type = searchPath`);
        returnables.message = `Doing Nothing. Paths resolved at build time for ${args[0].value}}`;
    }
    return returnables;
};

module.exports = getLassoModuleData;
