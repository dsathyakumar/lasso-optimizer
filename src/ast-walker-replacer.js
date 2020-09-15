/* eslint-disable no-console */
'use strict';

const { get } = require('@ebay/retriever');
const traverse = require('@babel/traverse');
const types = require('@babel/types');
const { isLassoModule } = require('./utils');

const getPathToVarRef = (moduleNameAndPath, argsZero, meta) => {
    if (!moduleNameAndPath || !argsZero || !meta) {
        throw new Error(`All args to be present for getPathToVarRef()`);
    }
    // from the finalized list, get what this path maps to
    // For eg) require('/marko$4.20.1/dist/components/runtime')
    let pathToVariableRef =
        meta.def[moduleNameAndPath]
            .dependencies.finalize[
                argsZero.value
            ];

    // ideally it should have been resolved already. Else throw
    if (!pathToVariableRef) {
        throw new Error(
            `Unresolved dependency ${moduleNameAndPath}`
        );
    }

    // check if it was scoped, get rid of @ and replace with 9999
    if (
        pathToVariableRef.indexOf(
            '@'
        ) !== -1
    ) {
        console.info(
            `old pathToVariableRef = ${pathToVariableRef}`
        );
        pathToVariableRef = pathToVariableRef.replace(
            '@',
            '9999'
        );
        console.info(
            `old pathToVariableRef = ${pathToVariableRef}`
        );
    }
    console.info(
        // eslint-disable-next-line max-len
        `Replaced require('${argsZero.value}') with require(${pathToVariableRef})`
    );

    return pathToVariableRef;
};

const isRootFuncExpression = path => {
    let stopAfter = false;

    if (path) {
        const callExprPath = path.parentPath.node;
        if (types.isCallExpression(callExprPath)) {
            const calleeObj = callExprPath.callee;
            if (types.isMemberExpression(calleeObj)) {
                const obj = calleeObj.object;
                if (types.isIdentifier(obj) && obj.name.startsWith('$_mod')) {
                    stopAfter = true;
                }
            }
        }
    }
    return stopAfter;
};

const walkForDependencies = (traversalPath, meta, moduleNameAndPath) => {
    const paramBindings = traversalPath.scope.getAllBindingsOfKind('param');
    const paramsNodes = traversalPath.node.params;

    // require, exports, module, __filename, __dirname in this order
    const paramNames = paramsNodes.map(node => node.name);
    Object.keys(paramBindings).forEach(paramBindingName => {
        if (traversalPath.scope.hasOwnBinding(paramBindingName)) {
            if (
                paramBindings[paramBindingName].referenced &&
                paramBindings[paramBindingName].references > 0
            ) {
                // in minified output, we cannot find the names
                // we are basically checking dependencies via .require
                if (
                    paramBindings[paramBindingName].identifier.name ===
                    paramNames[0]
                ) {
                    const referencedPaths =
                        paramBindings[paramBindingName].referencePaths;

                    referencedPaths.forEach(refPath => {
                        const refPathNode = refPath.node;

                        if (types.isIdentifier(refPathNode)) {
                            const refPathNodeParent = refPath.parent;

                            if (types.isCallExpression(refPathNodeParent)) {
                                const callee = refPathNodeParent.callee;

                                if (types.isIdentifier(callee)) {
                                    // check if its the arg we are looking for
                                    if (
                                        callee.name ===
                                        paramBindings[paramBindingName]
                                            .identifier.name
                                    ) {
                                        // This should have only 1 argument accessed at arguments[0]
                                        const argsZero =
                                            refPathNodeParent.arguments[0];

                                        // check if its a String based path and if there's only 1 argument
                                        if (
                                            types.isStringLiteral(argsZero) &&
                                            refPathNodeParent.arguments
                                                .length === 1
                                        ) {
                                            const pathToVariableRef =
                                                getPathToVarRef(moduleNameAndPath, argsZero, meta);

                                            refPathNodeParent.arguments.pop();
                                            refPathNodeParent.arguments.push(
                                                types.identifier(
                                                    pathToVariableRef
                                                )
                                            );

                                            // push the refId as well if its a JSON type require.
                                            if (meta.def[argsZero.value].subtype === 'ObjectExpression'
                                                && meta.def[argsZero.value].referentialId) {
                                                refPathNodeParent.arguments.push(
                                                    types.stringLiteral(
                                                        meta.def[argsZero.value].referentialId
                                                    )
                                                );
                                            }
                                        }
                                    }
                                } else if (types.isMemberExpression(callee)) {
                                    // This is for types require.resolve.
                                    // require.resolve('/marko$4.20.2/src/components/index-browser.marko');
                                    if (
                                        callee.object.name ===
                                            paramBindings[paramBindingName]
                                                .identifier.name &&
                                        callee.property.name === 'resolve'
                                    ) {
                                        const argsZero =
                                            refPathNodeParent.arguments[0];

                                        if (types.isStringLiteral(argsZero) &&
                                            refPathNodeParent.arguments
                                                .length === 1
                                        ) {
                                            let identifierName = '';
                                            refPathNodeParent.arguments.pop();

                                            if (meta.def[argsZero.value].subtype === 'ObjectExpression') {
                                                if (meta.def[argsZero.value].referentialId) {
                                                    identifierName = meta.def[argsZero.value].referentialId;
                                                    // replace the args of require.resolve call with either
                                                    // refID -> StringLiteral
                                                    // Fr eg) require.resolve('_e53tybxw');
                                                    refPathNodeParent.arguments.push(
                                                        types.stringLiteral(
                                                            identifierName
                                                        )
                                                    );
                                                } else {
                                                    throw new Error(`RefID not found`);
                                                }
                                            } else if (meta.def[argsZero.value].subtype === 'FunctionExpression') {
                                                identifierName = getPathToVarRef(moduleNameAndPath, argsZero, meta);
                                                if (!identifierName) {
                                                    throw new Error(`${moduleNameAndPath} not resolved in require()`);
                                                }
                                                // here it should be replaced by a MemberExpression of
                                                // identifierName.name
                                                // Fr eg) require.resolve(__webresourcejs_1_0_1__dist__file.name);
                                                // Runtime, __webresourcejs_1_0_1__dist__file.name will resolve
                                                // to a string of the function declaration name
                                                refPathNodeParent.arguments.push(
                                                    types.memberExpression(
                                                        types.identifier(identifierName),
                                                        types.identifier('name')
                                                    )
                                                );
                                            }
                                        } else {
                                            throw new Error(`Either is a dynamic .resolve() or has more than 1 args`);
                                        }
                                    } else {
                                        console.warn(`Not a .resolve() type. Unknown require.X type`);
                                    }
                                } else {
                                    // log
                                    console.warn('unknown type of require');
                                }
                            }
                        }
                    });
                }
            }
        }
    });
};

const fixDependencies = (moduleNameAndPath, path, meta) => {
    if (moduleNameAndPath && path) {
        path.traverse({
            FunctionExpression(traversalPath) {
                if (isRootFuncExpression(traversalPath)) {
                    try {
                        walkForDependencies(
                            traversalPath,
                            meta,
                            moduleNameAndPath
                        );
                    } catch (e) {
                        console.error(e.message);
                    } finally {
                        // cos for a given Lasso Module, we know there is only one root CallExpression
                        // which has only 1 root FuncExpression
                        traversalPath.stop();
                    }
                }
            }
        });
    }

    return;
};

const getLassoModulesDataAndDefs = (path, meta) => {
    const data = {};

    if (path) {
        const calleeObj = get(path, 'node.callee', {});
        const lassoModuleType = get(calleeObj, 'property.name', '');
        const args = get(path, 'node.arguments', []);

        data.type = lassoModuleType;

        if (lassoModuleType === 'def') {
            if (types.isStringLiteral(args[0])) {
                data.path = args[0].value;
                if (types.isFunctionExpression(args[1])) {
                    console.info(`Def for ${args[0].value}`);
                    // fix required dependencies within the functionExpression
                    // These dependencies have already been resolved.
                    // we ultimately need the params list and func body
                    // so that the func expression can be transformed to a func declaration
                    // and we only need to fix dependencies if they existed (if a require call existed)
                    if (meta.def[args[0].value].dependencies.deps.length) {
                        console.info(`Fixing deps for ${args[0].value}`);
                        fixDependencies(args[0].value, path, meta);
                    }
                    data.defParams = args[1].params;
                    data.defBodyDefn = args[1].body;
                } else if (types.isObjectExpression(args[1])) {
                    // This is when a JSON file is part of the require.
                    data.objExpr = args[1];
                }
            }
        } else if (lassoModuleType === 'remap') {
            // $_mod.remap("/marko$4.15.0/components", "/marko$4.15.0/components-browser.marko");
            if (
                types.isStringLiteral(args[0]) &&
                types.isStringLiteral(args[1])
            ) {
                data.from = args[0].value;
                data.to = args[1].value;
            }
        } else if (lassoModuleType === 'run') {
            /** Fr eg)
             *  $_mod.run("/raptor-amd$1.1.8/lib/init", {
                    wait: !1
                });
                */
            if (types.isStringLiteral(args[0])) {
                data.path = args[0].value;

                if (types.isObjectExpression(args[1])) {
                    // could either be options.wait
                    data.runOptions = args[1];
                } else if (types.isStringLiteral(args[1])) {
                    // or a path to another module that has to be resolved.
                    data.runOptions = args[1].value;
                }
            }
        } else if (lassoModuleType === 'main') {
            // For eg) $_mod.main("/i18n-ebay$4.0.3", "lib/index");
            // If the main file path is empty, it defaults to Node's standard protocal of /index
            if (
                types.isStringLiteral(args[0]) &&
                types.isStringLiteral(args[1])
            ) {
                data.modulePath = args[0].value;
                data.mainFilePath = args[1].value;
            }
        } else if (lassoModuleType === 'installed') {
            // For eg) $_mod.installed("i18n-ebay$4.0.3", "raptor-util", "1.1.2");
            if (
                types.isStringLiteral(args[0]) &&
                types.isStringLiteral(args[1]) &&
                types.isStringLiteral(args[2])
            ) {
                data.bundleName = args[0].value;
                data.moduleName = args[1].value;
                data.version = args[2].value;
            }
        } else if (lassoModuleType === 'searchPath') {
            // For eg) $_mod_gh_fe.searchPath("/globalheaderfrontend$37.0.0/"),
            if (types.isStringLiteral(args[0])) {
                data.searchPath = args[0].value;
            }
        } else if (lassoModuleType === 'builtin') {
            // For eg) $_mod.builtin("lasso-loader", "/lasso-loader$3.0.2/src/index");
            if (
                types.isStringLiteral(args[0]) &&
                types.isStringLiteral(args[1])
            ) {
                data.moduleName = args[0].value;
                data.mainFilePath = args[1].value;
            }
        } else if (lassoModuleType === 'loaderMetadata') {
            /** For eg) *
             * $_mod.loaderMetadata({
                    "onboarding-dialog-large": {
                        css: ["https://ir.ebaystatic.com/rs/c/highlnfe-async-ti9Bv3J-.css"],
                        js: ["https://ir.ebaystatic.com/rs/c/highlnfe-async-3CzT5n7D.js"]
                    },
                    "onboarding-dialog-small": {},
                    _eedb99: {
                        css: ["https://ir.ebaystatic.com/rs/c/highlnfe-async-ti9Bv3J-.css"],
                        js: ["https://ir.ebaystatic.com/rs/c/highlnfe-async-3CzT5n7D.js"]
                    },
                    _16556d: {
                        css: ["https://ir.ebaystatic.com/rs/c/highlnfe-async-ti9Bv3J-.css"],
                        js: ["https://ir.ebaystatic.com/rs/c/highlnfe-async-3CzT5n7D.js"]
                    }
                });
                */
            // do nothing. The loaderMetadata info is already collected
        }
    }

    return data;
};

const traverseExpressionStatement = (exprStatementPathNode, meta) => {
    let isLassoModuleType = false;
    let data = null;

    if (exprStatementPathNode) {
        exprStatementPathNode.traverse({
            CallExpression: {
                enter(traversalPath) {
                    if (isLassoModule(traversalPath)) {
                        isLassoModuleType = true;
                        data = getLassoModulesDataAndDefs(traversalPath, meta);
                        traversalPath.stop();
                    }
                }
            }
        });
    }

    return {
        isLassoModuleType,
        data
    };
};

const walkAstAndReplace = (ast, dependencyPathToVarName, noconflict, meta) => {
    if (ast) {
        traverse.default(ast, {
            enter(traversalPath) {
                if (types.isExpressionStatement(traversalPath.node)) {
                    const {
                        isLassoModuleType,
                        data
                    } = traverseExpressionStatement(traversalPath, meta);

                    if (isLassoModuleType) {
                        // here since we are collecting info, we are only interested in Lasso Modules
                        // and not the lasso-moudles-client runtime.
                        const {
                            type,
                            path,
                            from,
                            objExpr,
                            defParams,
                            defBodyDefn,
                            modulePath,
                            bundleName,
                            moduleName,
                            version,
                            searchPath
                        } = data;

                        let { runOptions } = data;

                        if (type === 'def') {
                            console.info(`Replacing Def for ${path}`);
                            let modulePathToVarRef =
                                dependencyPathToVarName[path] ||
                                meta.def[path].modulePathToVarRef;
                            if (!modulePathToVarRef) {
                                throw new Error(
                                    `Ast-modification failed. ${path} missing modulePathToVarRef`
                                );
                            }

                            // This is because functionNames cannot contain @, which are used in scoped packages
                            if (modulePathToVarRef.indexOf('@') !== -1) {
                                console.info(
                                    `old modulePathToVarRef = ${modulePathToVarRef}`
                                );
                                modulePathToVarRef = modulePathToVarRef.replace(
                                    '@',
                                    '9999'
                                );
                                console.info(
                                    `new modulePathToVarRef = ${modulePathToVarRef}`
                                );
                            }

                            // when its a factory function
                            if (defParams && defBodyDefn) {
                                traversalPath.parentPath.addComment(
                                    'leading',
                                    // eslint-disable-next-line max-len
                                    `Removing type: ${type} of ${path}. Replaced with function declaration ${modulePathToVarRef}`
                                );

                                // replace function expr to func decl here.
                                // we are no longer pruning params here.
                                // any minifier / obfuscator like uglify / terser will clean it
                                const funcDeclr = types.functionDeclaration(
                                    types.identifier(modulePathToVarRef),
                                    defParams,
                                    defBodyDefn
                                );
                                traversalPath.replaceWith(funcDeclr);
                            } else if (objExpr) {
                                const refId = meta.def[path].referentialId;

                                if (!refId) {
                                    throw new Error(`referentialId missing for object expression of ${path}`);
                                }

                                traversalPath.parentPath.addComment(
                                    'leading',
                                    // eslint-disable-next-line max-len
                                    `Removing type: ${type} of ${path}. Replaced with variable declaration ${modulePathToVarRef} & refId = ${refId}`
                                );
                                // when its an object expression
                                // say when a JSON file is required.
                                // even this we store with the modulePathToVarRef, but a require to this
                                // will also pass the refID, so we check for refID above. Cos, this cannot be
                                // accessed as func.name & there is no way to get the name of the variable Identifier
                                const varDeclaration = types.variableDeclaration('var', [
                                    types.variableDeclarator(
                                        types.identifier(modulePathToVarRef),
                                        objExpr
                                    )
                                ]);
                                traversalPath.replaceWith(varDeclaration);
                            }
                        } else if (type === 'main') {
                            traversalPath.parentPath.addComment(
                                'leading',
                                `Removing type: ${type} of ${modulePath}`
                            );
                            traversalPath.remove();
                        } else if (type === 'installed') {
                            traversalPath.parentPath.addComment(
                                'leading',
                                `Removing type: ${type} of ${moduleName} with v${version} installed in ${bundleName}`
                            );
                            traversalPath.remove();
                        } else if (type === 'remap') {
                            traversalPath.parentPath.addComment(
                                'leading',
                                `Removing type: ${type} of ${from}`
                            );
                            traversalPath.remove();
                        } else if (type === 'builtin') {
                            traversalPath.parentPath.addComment(
                                'leading',
                                `Removing type: ${type} of ${moduleName}`
                            );
                            traversalPath.remove();
                        } else if (type === 'run') {
                            traversalPath.parentPath.addComment(
                                'leading',
                                `Removing type: ${type} of ${path}. Self-invocation injected`
                            );

                            let modulePathToVarRef =
                                dependencyPathToVarName[path] ||
                                meta.def[path].modulePathToVarRef;

                            if (!modulePathToVarRef) {
                                throw new Error(
                                    `Ast-modification failed. ${path} missing modulePathToVarRef`
                                );
                            }

                            if (modulePathToVarRef.indexOf('@') !== -1) {
                                console.info(
                                    `old modulePathToVarRef = ${modulePathToVarRef}`
                                );
                                modulePathToVarRef = modulePathToVarRef.replace(
                                    '@',
                                    '9999'
                                );
                                console.info(
                                    `new modulePathToVarRef = ${modulePathToVarRef}`
                                );
                            }

                            // if not a string, by default runOption is an ObjectExpression
                            // with a wait property set.
                            if (typeof runOptions === 'string') {
                                // this is a path & has to be resolved
                                runOptions =
                                    dependencyPathToVarName[runOptions];
                                // it has to be an identifier
                                runOptions = types.identifier(runOptions);
                            }

                            const callExprArgs = [
                                types.identifier(modulePathToVarRef)
                            ];

                            if (typeof runOptions !== 'undefined') {
                                callExprArgs.push(runOptions);
                            }

                            // replace function expr to func decl here.
                            traversalPath.replaceWith(
                                types.expressionStatement(
                                    types.callExpression(
                                        types.identifier('run'),
                                        callExprArgs
                                    )
                                )
                            );
                        } else if (type === 'searchPath') {
                            traversalPath.parentPath.addComment(
                                'leading',
                                `Removing type: ${type} of ${searchPath}`
                            );
                            traversalPath.remove();
                        } else if (type === 'loaderMetadata') {
                            traversalPath.parentPath.addComment(
                                'leading',
                                `Retaining type: ${type} of ${JSON.stringify(
                                    meta.loaderMetadata
                                )}`
                            );
                        }

                        traversalPath.skip();
                    }
                }
            }
        });
    }
    return ast;
};

exports.walkAstAndReplace = walkAstAndReplace;
