/* eslint-disable no-console */
'use strict';
const { writeFileSync, readFileSync } = require('fs');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse');
const types = require('@babel/types');
const generate = require('@babel/generator');
// const code = require('./code/index');
const lassoModulesMeta = require('./lasso-prop-types');
const { isLassoModule,
    isLassoClientSideRuntime
} = require('./lasso-optimizer-utils');
const getLassoModuleData = require('./lasso-module-data-extractor');
const genVarsByGroupSize = require('./var-name-gen');
global.___varNamesArr = genVarsByGroupSize(2);
const fullCode = readFileSync('./code/code-full-dist.js', 'utf8');

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

const ast = parse(fullCode, {
    sourceType: 'script'
});
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
                const varDeclarator = types.variableDeclarator(
                    types.identifier(lassoModule.data.modulePathToVarRef), lassoModule.data.definition
                );
                path.replaceWith(types.variableDeclaration('var', [varDeclarator]));
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

const output = generate.default(ast);
// console.log(output.code);
// writeFileSync('__output.js', output.code, 'utf8');
delete global.___varNamesArr;

const buildRequire = `
!(function (win) {
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
})(this);
`;

console.log(buildRequire);
writeFileSync('__output.js', buildRequire, 'utf8');
