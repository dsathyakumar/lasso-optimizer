/* eslint-disable no-console */

'use strict';

const { get } = require('@ebay/retriever');
const types = require('@babel/types');

const popParam = (param, paramsList) => {
    paramsList.forEach((p, idx, arr) => {
        if (types.isIdentifier(p) && p.name === param) {
            arr.splice(idx, 1);
        }
    });
    return paramsList;
};

const shouldIncludeBinding = (paramBinding) => {
    let includes = false;
    const functionExprPath = paramBinding.path.getFunctionParent();
    if (types.isFunctionExpression(functionExprPath)) {
        const callExprPath = functionExprPath.parentPath.node;
        if (types.isCallExpression(callExprPath)) {
            const calleeObj = callExprPath.callee;
            if (types.isMemberExpression(calleeObj)) {
                const obj = calleeObj.object;
                if (types.isIdentifier(obj) && obj.name.startsWith('$_mod')) {
                    includes = true;
                }
            }
        }
    }
    return includes;
};

const isLassoModule = path => {
    let isLassoCJSModule = false;
    const calleeObj = get(path, 'node.callee', {});
    if (types.isIdentifier(calleeObj.object) && calleeObj.object.name.startsWith('$_mod')) {
        isLassoCJSModule = true;
    }
    return isLassoCJSModule;
};

/** path.node can either be a ConditionalExpression or Assignment Expression */
const isLassoClientSideRuntime = path => {
    let hasModulesClient = false;
    // conditional expression will have a path-> node -> consequent
    if (types.isConditionalExpression(path.node)) {
        const consequent = get(path, 'node.consequent', {});
        if (types.isAssignmentExpression(path.node.consequent)
            && (get(consequent, 'left.property.name', '')).startsWith('$_mod')) {
            console.log('Lasso modules client runtime exists');
            hasModulesClient = true;
        }
    } else if (types.isAssignmentExpression(path.node)) {
        const rightIdentifier = path.node.right;
        if (rightIdentifier
            && types.isIdentifier(rightIdentifier)
            && rightIdentifier.name.startsWith('$_mod')) {
            console.log('Lasso modules client runtime exists');
            hasModulesClient = true;
        }
    }
    return hasModulesClient;
};

module.exports = {
    popParam,
    shouldIncludeBinding,
    isLassoModule,
    isLassoClientSideRuntime
};
