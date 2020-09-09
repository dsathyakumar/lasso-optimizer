'use strict';

const { parse } = require('@babel/parser');
const generate = require('@babel/generator');
const { grabInfoFromAst } = require('./src/ast-walker-scanner');
const { resolvePaths } = require('./src/paths-resolver');
const { walkAstAndReplace } = require('./src/ast-walker-replacer');
const { injectClient } = require('./src/lasso-modules-client-shim');

const init = code => {
    if (!code) {
        return;
    }

    if (typeof code !== 'string') {
        return;
    }

    let output = null;
    let pathInfo = null;

    try {
        const ast = parse(code, {
            sourceType: 'script'
        });

        pathInfo = grabInfoFromAst(ast);

        const { dependencyPathToVarName, meta } = resolvePaths(pathInfo);

        const modifiedAst = walkAstAndReplace(
            ast,
            dependencyPathToVarName,
            pathInfo.variableName,
            meta
        );

        output = generate.default(modifiedAst, {
            sourcemaps: true
        });
    } catch (e) {
        console.error(e.message);
        console.error(`Resetting output to undefined so that default code is returned`);
        output = undefined;
    }

    return {
        output,
        lassoVariableName: pathInfo.variableName
    };
};

const optimize = (code, noConflictLassoVar, shouldInjectClient = true) => {
    let {
        output,
        lassoVariableName
    } = init(code, noConflictLassoVar);

    if (typeof output === 'undefined') {
        console.error(`Lasso-optimizer errored out. Returing code as-is`);
        return code;
    }

    if (typeof output !== 'object' || !('code' in output)) {
        console.error(`Lasso-optimizer errored out. Returing code as-is`);
        return code;
    }

    if (shouldInjectClient) {
        output = injectClient(output.code, (noConflictLassoVar || lassoVariableName));
    } else {
        output = output.code;
    }

    return output;
};

const optimizeSingleSourceFile = (code, noConflictLassoVar, shouldInjectClient) => {
    return optimize(code, noConflictLassoVar, shouldInjectClient);
};

exports.optimizeSingleSourceFile = optimizeSingleSourceFile;
