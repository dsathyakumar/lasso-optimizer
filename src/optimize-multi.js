'use strict';

const { parse } = require('@babel/parser');
const generate = require('@babel/generator');
const { grabInfoFromAst, LASSO_PROP_TYPES } = require('./ast-walker-scanner');
const { resolvePaths } = require('./paths-resolver');
const { walkAstAndReplace } = require('./ast-walker-replacer');
const { injectClient } = require('./lasso-modules-client-shim-multi');
const { addWrapper } = require('./lasso-modules-wrapper-shim');
const { version } = require('../package.json');
const { propGenerator } = require('./generator');

const init = (codeArr, noConflictLassoVar) => {
    const generator = propGenerator(2);

    if (!codeArr) {
        return;
    }

    if (!Array.isArray(codeArr)) {
        console.error('Expects an array of files & code');
        return;
    }

    let outputFileArr = null;
    const pathInfo = Object.assign({}, LASSO_PROP_TYPES);

    try {
        const astFileArr = codeArr.map(codeFile => {
            const ast = parse(codeFile.code, {
                sourceType: 'script'
            });
            return {
                ...codeFile,
                ast
            };
        });

        if (astFileArr.length) {
            astFileArr.forEach(astFileObj => {
                grabInfoFromAst(
                    astFileObj.ast,
                    noConflictLassoVar,
                    pathInfo,
                    generator
                );
            });
        }

        const { dependencyPathToVarName, meta } = resolvePaths(pathInfo);

        const modifiedAstFileArr = astFileArr.map(astFileObj => {
            const modifiedAst = walkAstAndReplace(
                astFileObj.ast,
                dependencyPathToVarName,
                pathInfo.variableName,
                meta
            );
            return {
                ...astFileObj,
                modifiedAst
            };
        });

        outputFileArr = modifiedAstFileArr.map(modifiedAstFileObj => {
            const output = generate.default(modifiedAstFileObj.modifiedAst, {
                sourceMaps: true
            });
            return {
                ...modifiedAstFileObj,
                output
            };
        });
    } catch (e) {
        console.error(e.message);
        console.error(
            `Resetting output to undefined so that default code is returned`
        );
        outputFileArr = undefined;
    }

    return {
        outputFileArr,
        lassoVariableName: pathInfo.variableName
    };
};

exports.optimizeMulti = (
    codeArr,
    noConflictLassoVar,
    shouldInjectClient = true
) => {
    const {
        outputFileArr,
        // eslint-disable-next-line prefer-const
        lassoVariableName
    } = init(codeArr, noConflictLassoVar);

    if (typeof outputFileArr === 'undefined') {
        console.error(`Lasso-optimizer errored out. Returing codeArr as-is`);
        return codeArr;
    }

    if (typeof outputFileArr !== 'object') {
        console.error(`Lasso-optimizer errored out. Returing codeArr as-is`);
        return codeArr;
    }

    if (shouldInjectClient) {
        outputFileArr.forEach((outFile, idx) => {
            if (idx === 0) {
                outFile.output.code = injectClient(
                    outFile.output.code,
                    noConflictLassoVar || lassoVariableName
                );
            } else {
                outFile.output.code = addWrapper(
                    outFile.output.code,
                    noConflictLassoVar || lassoVariableName
                );
            }
        });
    }

    return {
        outputFileArr
    };
};
