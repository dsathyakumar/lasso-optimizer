/* eslint-disable no-console */

'use strict';

/* if (idx === 0) { // require (may have may refPaths)
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
                    refPath.parentPath.replaceWith(types.identifier(swappableVarDeclarator));
                    // update scope and binding here
                    // remove the binding & update the scope
                    // path.scope.removeOwnBinding(param);
                    // path.node.params = popParam(param, path.node.params);
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
                        // path.scope.removeOwnBinding(param);
                        // path.node.params = popParam(param, path.node.params);
                    }
                }
            }
        }
    } else if (idx === 1) { // exports
        console.log('binding type: exports');
        // 'exports' is 'object' of MemberExpression & is of type 'Identifier'
        if (types.isIdentifier(refPath.node)
            && types.isMemberExpression(refPath.parent)) {
            // get the Member Expression & from it, the 'property'
            const exportableProp = refPath.parent.property;
            console.log(`exportableProp = ${exportableProp.name}`);
            // property has to be of type 'Identifier'
            if (types.isIdentifier(exportableProp)) {
                // exports.something = <something> is of type AssignmentExpression
                const parentAssignementExprPath = refPath.find(p => p.isAssignmentExpression());
                if (parentAssignementExprPath) {
                    // exports.something => AssignmentExpression.node.left = MemberExpression
                    // so the right side is AssignmentExpression.node.right
                    const rightAssign = parentAssignementExprPath.node.right;
                    if (types.isAssignmentExpression(rightAssign)) {
                        // exports.NOOP = win.$W10NOOP = win.$W10NOOP || function () {};
                        // we take out only win.$W10NOOP and export it
                        const exprStatsPath = parentAssignementExprPath.find(p => p.isExpressionStatement());
                        // replace the parent ExpressionStatement with this Assignment
                        if (exprStatsPath) {
                            exprStatsPath.replaceWith(rightAssign);
                        }
                        // export the win.$W10NOOP
                        exportables.push(types.objectProperty(exportableProp, rightAssign.left));
                    } else if (types.isIdentifier(rightAssign)
                        || types.isNumericLiteral(rightAssign)
                        || types.isBooleanLiteral(rightAssign)
                        || types.isStringLiteral(rightAssign)
                        || types.isFunctionExpression(rightAssign)) {
                        const exprStatsPath = parentAssignementExprPath.find(p => p.isExpressionStatement());
                        // replace the parent ExpressionStatement with this Assignment
                        if (exprStatsPath) {
                            exprStatsPath.remove();
                        }
                        exportables.push(types.objectProperty(exportableProp, rightAssign));
                    }
                }
            }
        }
    } else if (idx === 2) { // module
        console.log('binding type: module');
        const parentAssignmentExprPath = refPath.find(p => p.isAssignmentExpression());
        if (parentAssignmentExprPath
            && types.isExpressionStatement(parentAssignmentExprPath.parentPath.node)) {
            const exportable = parentAssignmentExprPath.node.right;
            const ret = types.returnStatement(exportable);
            const parentExprStatPath = refPath.find(p => p.isExpressionStatement());
            if (parentExprStatPath) {
                parentExprStatPath.replaceWith(ret);
                // update scope and binding here
                // remove the binding & update the scope
                path.scope.removeOwnBinding(param);
                path.node.params = popParam(param, path.node.params);
            }
        } else if (parentAssignmentExprPath
            && types.isVariableDeclarator(parentAssignmentExprPath.parentPath.node)) {
            const varDeclaratorNode = parentAssignmentExprPath.parentPath.node;
            const varName = varDeclaratorNode.id;
            const assignable = parentAssignmentExprPath.node.right;
            if (varName && types.isIdentifier(varName)) {
                const varDeclarationPath = parentAssignmentExprPath.parentPath.parentPath;
                if (types.isVariableDeclaration(varDeclarationPath.node)) {
                    varDeclarationPath.replaceWith(types.variableDeclaration(
                        'var',
                        [
                            types.variableDeclarator(
                                varName,
                                assignable
                            )
                        ]
                    ));
                    const funcParent = refPath.getFunctionParent();
                    if (types.isFunctionExpression(funcParent)) {
                        funcParent.get('body').node.body.push(
                            types.returnStatement(types.identifier(varName.name))
                        );
                        path.scope.removeOwnBinding(param);
                        path.node.params = popParam(param, path.node.params);
                    }
                }
            }
            // this is something like
            // var x = module.exports = <something>;
            // we have to modify this to var x = <something>
            // return x; (pushed as last stat into def Func expr)
        }
    } */

const types = require('@babel/types');
// const { popParam } = require('./lasso-optimizer-utils');
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
    } else { // __dirname, __filename
        console.log('Skipping binding type: __dirname, __filename');
    }
};

module.exports = pruneReferencedPaths;
