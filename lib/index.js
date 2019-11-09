/* eslint-disable no-console */
'use strict';

const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse');
const types = require('@babel/types');
const generate = require('@babel/generator');
const lassoModulesMeta = require('./lasso-prop-types');
const { isLassoModule,
    isLassoClientSideRuntime
} = require('./lasso-optimizer-utils');
const getLassoModuleData = require('./lasso-module-data-extractor');
const genVarsByGroupSize = require('./var-name-gen');
const lassoModuleResolverRuntime = require('./lasso-module-resolver-runtime');
global.___lassoPluginOptimizer = {
    ___varNamesArr: genVarsByGroupSize(2),
    __hasIndependentRunnables: true
};

// node, scope, state, nodepath
const traverseExpressionStatement = path => {
    const assertables = {
        hasModulesClient: false,
        lassoModule: {
            isLassoModule: false,
            data: {}
        }
    };
    traverse.default(path.node, {
        enter(traversalPath) {
            if (types.isConditionalExpression(traversalPath.node)) {
                if (isLassoClientSideRuntime(traversalPath)) {
                    assertables.hasModulesClient = true;
                    traversalPath.stop();
                }
            } else if (types.isCallExpression(traversalPath.node)) {
                if (isLassoModule(traversalPath)) {
                    assertables.lassoModule.isLassoModule = true;
                    const data = getLassoModuleData(traversalPath, lassoModulesMeta);
                    assertables.lassoModule.data = data;
                    traversalPath.stop();
                }
            } else if (types.isAssignmentExpression(traversalPath.node)) {
                if (isLassoClientSideRuntime(traversalPath)) {
                    assertables.hasModulesClient = true;
                    traversalPath.stop();
                }
            }
        }
    }, path.scope, path.state, path);
    return assertables;
};

const traverseAST = (ast) => {
    traverse.default(ast, {
        enter(path) {
            if (types.isExpressionStatement(path.node)) {
                const { hasModulesClient, lassoModule } = traverseExpressionStatement(path);
                if (hasModulesClient) {
                    path.parentPath.addComment('leading', 'Removed Lasso-modules-client');
                    path.remove();
                    return;
                } else if (lassoModule.isLassoModule && lassoModule.data.lassoProp === 'def') {
                    console.log('its a lasso def module');
                    console.log(lassoModule.data);
                    // eslint-disable-next-line max-len
                    c// const varDeclarator = types.variableDeclarator(
                    //     types.identifier(lassoModule.data.modulePathToVarRef), lassoModule.data.definition
                    // );
                    const funcDeclr = types.functionDeclaration(
                        types.identifier(lassoModule.data.modulePathToVarRef),
                        lassoModule.data.definition.params,
                        lassoModule.data.definition.body
                    );
                    // path.replaceWith(types.variableDeclaration('var', [varDeclarator]));
                    path.replaceWith(funcDeclr);
                    path.addComment('leading', lassoModule.data.modulePathToVarRef);
                    // what to do when its a lasso module
                } else if (lassoModule.isLassoModule
                    && (lassoModule.data.lassoProp === 'remap'
                        || lassoModule.data.lassoProp === 'main'
                        || lassoModule.data.lassoProp === 'installed'
                        || lassoModule.data.lassoProp === 'searchPath')) {
                    console.log('its a lasso remap module');
                    console.log(lassoModule.data);
                    path.parentPath.addComment('leading', ` ${lassoModule.data.message} `);
                    path.remove();
                } else if (lassoModule.isLassoModule && lassoModule.data.lassoProp === 'run') {
                    console.log('its a lasso runnable');
                    path.replaceWith(types.expressionStatement(
                        types.callExpression(
                            types.identifier('require'),
                            [
                                types.identifier(lassoModule.data.modulePathToVarRef)
                            ]
                        )
                    ));
                    path.addComment('leading', `${lassoModule.data.message}`);
                }
            }
        }
    });
};

module.exports = code => {
    try {
        let result = '';
        const ast = parse(code, {
            sourceType: 'script'
        });
        traverseAST(ast);
        const output = generate.default(ast);
        if (global.___lassoPluginOptimizer.__hasIndependentRunnables) {
            result = lassoModuleResolverRuntime.independentRunnablesRunTime(output.code);
        } else {
            // todo: take care of dependent runnables.
        }
        delete global.___lassoPluginOptimizer;
        return result;
    } catch (e) {
        console.error(e.message);
    }
};
