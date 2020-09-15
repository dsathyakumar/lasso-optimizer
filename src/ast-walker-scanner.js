/* eslint-disable no-console */
'use strict';

const { get } = require('@ebay/retriever');
const traverse = require('@babel/traverse');
const types = require('@babel/types');
const nanoid = require('nanoid');
const {
    isLassoModule,
    getObjectInfo,
    getLoaderObjectInfo
} = require('./utils');

const LASSO_PROP_TYPES = {
    installed: {}, // this will be resolved build-time and will be removed
    remap: {}, // this will be resolved build-time and will be removed
    main: {}, // this will be resolved build-time and will be removed
    def: {},
    run: {},
    builtin: {}, // this will be resolved build-time and will be removed
    searchPath: [], // this will be resolved build-time and will be removed
    loaderMetadata: {}
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

const walkForDependencies = traversalPath => {
    global.___deps = {
        deps: [],
        resolve: []
    };
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
                                    if (
                                        callee.name ===
                                        paramBindings[paramBindingName]
                                            .identifier.name
                                    ) {
                                        const argsZero =
                                            refPathNodeParent.arguments[0];
                                        if (
                                            types.isStringLiteral(argsZero) &&
                                            refPathNodeParent.arguments
                                                .length === 1
                                        ) {
                                            global.___deps.deps.push(
                                                argsZero.value
                                            );
                                        } else {
                                            if (refPathNodeParent.arguments.length > 1) {
                                                // require call is not a String Literal
                                                throw new Error(`Cannot optimize multi-argument require()`);
                                            } else if (refPathNodeParent.arguments.length === 0) {
                                                throw new Error(`Cannot optimize empty require()`);
                                            } else if (!(types.isStringLiteral(argsZero))) {
                                                // require call is not a String Literal
                                                throw new Error(`Cannot optimize Dynamic require()`);
                                            }
                                        }
                                    }
                                } else if (types.isMemberExpression) {
                                    // This is for types require.resolve.
                                    if (
                                        callee.object.name ===
                                            paramBindings[paramBindingName]
                                                .identifier.name &&
                                        callee.property.name === 'resolve'
                                    ) {
                                        const argsZero =
                                            refPathNodeParent.arguments[0];
                                        if (
                                            types.isStringLiteral(argsZero) &&
                                            refPathNodeParent.arguments
                                                .length === 1
                                        ) {
                                            // gather the string path in require.resolve()
                                            // we cannot handle dynamic require's here.
                                            // Its upto teams to be able to require both and then conditionally choose.
                                            global.___deps.resolve.push(
                                                argsZero.value
                                            );
                                        } else {
                                            throw new Error('Cannot optimize dynamic require.resolve()');
                                        }
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

const getDependencies = (moduleNameAndPath, path) => {
    const data = {};
    if (moduleNameAndPath && path) {
        path.traverse({
            FunctionExpression(traversalPath) {
                if (isRootFuncExpression(traversalPath)) {
                    try {
                        walkForDependencies(traversalPath);
                    } catch (e) {
                        console.error(e.message);
                        console.error(`moduleNameAndPath = ${moduleNameAndPath}`);
                        global.___deps = undefined;
                    } finally {
                        // cos for a given Lasso Module, we know there is only one root CallExpression
                        // which has only 1 root FuncExpression
                        traversalPath.stop();
                    }
                }
            }
        });
    }

    if (global.___deps) {
        Object.assign(data, global.___deps);
        global.___deps = undefined;
    }

    return data;
};

const getLassoModulesData = path => {
    const data = {};

    if (path) {
        const calleeObj = get(path, 'node.callee', {});
        const lassoModuleType = get(calleeObj, 'property.name', '');
        const args = get(path, 'node.arguments', []);

        data.type = lassoModuleType;

        if (lassoModuleType === 'def') {
            if (types.isStringLiteral(args[0])) {
                const modulePathToVarRef = args[0].value
                    .replace(new RegExp('/', 'g'), '__')
                    .replace('$', '_')
                    .replace('[', '_')
                    .replace(']', '_')
                    .replace(/\./g, '_')
                    .replace(/\-/g, '_');

                data.path = args[0].value;
                data.modulePathToVarRef = modulePathToVarRef;

                if (types.isFunctionExpression(args[1])) {
                    data.dependencies = getDependencies(args[0].value, path);
                    data.subtype = 'FunctionExpression';
                } else if (types.isObjectExpression(args[1])) {
                    // this is when a JSON file is required and Lasso will not wrap it
                    // with a function expression as its type JSON.
                    // we are really not bothered what is exported by this JSON type
                    // The only ones we are interested is in .loaderMetadata and runoptions
                    data.dependencies = {
                        deps: [],
                        resolve: []
                    };
                    data.subtype = 'ObjectExpression';
                }
                // todo, there may be args[2] here which is an options
                // and has the options of setting options.global
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
                    data.runOptions = getObjectInfo(args[1]);
                } else if (types.isStringLiteral(args[1])) {
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
            if (types.isObjectExpression(args[0])) {
                data.loaderMetadata = getLoaderObjectInfo(args[0]);
            }
        }
    }

    return data;
};

const traverseCallExpression = callExprPath => {
    let isLassoModulesClient = false;
    let lassoVariableName = '';
    let isRaptorModulesClient = false;
    let raptorVariableName = '';

    if (callExprPath) {
        callExprPath.traverse({
            IfStatement: {
                enter(traversalPath) {
                    const consequent = traversalPath.node.consequent;
                    const alternate = traversalPath.node.alternate;
                    if (
                        types.isBlockStatement(consequent) &&
                        types.isBlockStatement(alternate)
                    ) {
                        const ifBody = consequent.body[0];
                        const elseBody = alternate.body[0];
                        if (
                            types.isExpressionStatement(ifBody) &&
                            types.isExpressionStatement(elseBody)
                        ) {
                            const ifExpr = ifBody.expression;
                            const elseExpr = elseBody.expression;
                            if (
                                types.isAssignmentExpression(ifExpr) &&
                                types.isAssignmentExpression(elseExpr)
                            ) {
                                if (
                                    types.isIdentifier(ifExpr.right) &&
                                    types.isIdentifier(elseExpr.right)
                                ) {
                                    if (
                                        ifExpr.right.name ===
                                        elseExpr.right.name
                                    ) {
                                        if (
                                            ifExpr.right.name.startsWith(
                                                '$_mod'
                                            )
                                        ) {
                                            console.log(
                                                `Lasso Modules CLient found in IF`
                                            );
                                            isLassoModulesClient = true;
                                            lassoVariableName =
                                                ifExpr.right.name;
                                            traversalPath.stop();
                                        } else if (
                                            ifExpr.right.name.startsWith(
                                                '$rmod'
                                            )
                                        ) {
                                            console.log(
                                                `Raptor Modules CLient found in IF`
                                            );
                                            isRaptorModulesClient = true;
                                            raptorVariableName =
                                                ifExpr.right.name;
                                            traversalPath.stop();
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            ConditionalExpression: {
                enter(traversalPath) {
                    const consequent = traversalPath.node.consequent;
                    if (types.isAssignmentExpression(consequent)) {
                        if (types.isMemberExpression(consequent.left)) {
                            if (types.isIdentifier(consequent.left.property)) {
                                if (
                                    consequent.left.property.name.startsWith(
                                        '$_mod'
                                    )
                                ) {
                                    console.log(
                                        'Found Lasso Modules Client Conditional'
                                    );
                                    isLassoModulesClient = true;
                                    lassoVariableName =
                                        consequent.left.property.name;
                                    traversalPath.stop();
                                } else if (
                                    consequent.left.property.name.startsWith(
                                        '$rmod'
                                    )
                                ) {
                                    console.log(
                                        'Found Raptor Modules Client Conditional'
                                    );
                                    isRaptorModulesClient = true;
                                    raptorVariableName =
                                        consequent.left.property.name;
                                    traversalPath.stop();
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    return {
        isLassoModulesClient,
        lassoVariableName,
        isRaptorModulesClient,
        raptorVariableName
    };
};

const traverseExpressionStatement = exprStatementPathNode => {
    let isLassoModuleType = false;
    let isLassoModulesClient = false;
    let raptorVariableName = '';
    let isRaptorModulesClient = false;
    let data = null;
    let variableName = '';

    if (exprStatementPathNode) {
        exprStatementPathNode.traverse({
            CallExpression: {
                enter(traversalPath) {
                    if (isLassoModule(traversalPath)) {
                        isLassoModuleType = true;
                        data = getLassoModulesData(traversalPath);
                        traversalPath.stop();
                    } else {
                        const calleeObj = get(traversalPath, 'node.callee', {});
                        if (
                            types.isFunctionExpression(calleeObj) &&
                            calleeObj.id === null
                        ) {
                            const result = traverseCallExpression(
                                traversalPath
                            );
                            if (result.isLassoModulesClient) {
                                isLassoModulesClient = true;
                                variableName = result.lassoVariableName;
                            } else if (result.isRaptorModulesClient) {
                                isRaptorModulesClient = true;
                                raptorVariableName = result.raptorVariableName;
                            }
                        }
                        traversalPath.stop();
                    }
                }
            }
        });
    }

    return {
        isLassoModuleType,
        data,
        isLassoModulesClient,
        variableName,
        isRaptorModulesClient,
        raptorVariableName
    };
};

const grabInfoFromAst = (ast, noconflict) => {
    if (ast) {
        const lassoModulesMeta = Object.assign({}, LASSO_PROP_TYPES);

        traverse.default(ast, {
            enter(traversalPath) {
                if (types.isExpressionStatement(traversalPath.node)) {
                    const {
                        variableName,
                        isLassoModuleType,
                        isLassoModulesClient,
                        data,
                        isRaptorModulesClient,
                        raptorVariableName
                    } = traverseExpressionStatement(traversalPath);

                    if (isRaptorModulesClient) {
                        // eslint-disable-next-line prettier/prettier
                        console.info(`Raptor modules client. Not resolving this. Skipping..`);
                        lassoModulesMeta.raptorVariableName = raptorVariableName;
                        traversalPath.parentPath.addComment(
                            'leading',
                            'Raptor-modules-client exists'
                        );
                        traversalPath.insertAfter(
                            types.expressionStatement(
                                types.callExpression(
                                    types.memberExpression(
                                        types.identifier(
                                            `$_mod${
                                                noconflict
                                                    ? `_${noconflict}`
                                                    : ''
                                            }`
                                        ),
                                        types.identifier('builtin')
                                    ),
                                    [
                                        types.stringLiteral(
                                            'raptor-modules/client'
                                        ),
                                        types.stringLiteral(
                                            '/raptor-modules$0.0.0/client/index'
                                        )
                                    ]
                                )
                            )
                        );
                        traversalPath.insertAfter(
                            types.expressionStatement(
                                types.callExpression(
                                    types.memberExpression(
                                        types.identifier(
                                            `$_mod${
                                                noconflict
                                                    ? `_${noconflict}`
                                                    : ''
                                            }`
                                        ),
                                        types.identifier('def')
                                    ),
                                    [
                                        types.stringLiteral(
                                            '/raptor-modules$0.0.0/client/index'
                                        ),
                                        types.functionExpression(
                                            null,
                                            [],
                                            types.blockStatement([])
                                        )
                                    ]
                                )
                            )
                        );
                    } else if (isLassoModulesClient) {
                        console.log(`Removing Lasso Modules Client`);
                        traversalPath.parentPath.addComment(
                            'leading',
                            'Removed Lasso-modules-client'
                        );
                        lassoModulesMeta.variableName = variableName;
                        traversalPath.remove();
                        traversalPath.skip();
                    } else if (isLassoModuleType) {
                        // here since we are collecting info, we are only interested in Lasso Modules
                        // and not the lasso-moudles-client runtime.
                        const {
                            type,
                            subtype,
                            path,
                            modulePathToVarRef,
                            dependencies,
                            from,
                            to,
                            runOptions,
                            modulePath,
                            mainFilePath,
                            bundleName,
                            moduleName,
                            version,
                            searchPath,
                            loaderMetadata
                        } = data;

                        if (type === 'def') {
                            let referentialId = '';
                            if (subtype !== 'FunctionExpression' && subtype === 'ObjectExpression') {
                                referentialId = nanoid(7);
                            }
                            lassoModulesMeta.def[path] = {
                                modulePathToVarRef,
                                dependencies,
                                subtype,
                                referentialId
                            };
                        } else if (type === 'main') {
                            lassoModulesMeta.main[modulePath] = {
                                main: mainFilePath
                            };
                        } else if (type === 'installed') {
                            if (!lassoModulesMeta.installed[bundleName]) {
                                lassoModulesMeta.installed[bundleName] = {};
                            }
                            lassoModulesMeta.installed[bundleName][
                                moduleName
                            ] = version;
                        } else if (type === 'remap') {
                            lassoModulesMeta.remap[from] = to;
                        } else if (type === 'builtin') {
                            lassoModulesMeta.builtin[moduleName] = mainFilePath;
                        } else if (type === 'run') {
                            // runOptions can be a unaryExpression { wait: !0 } etc,
                            // or can be a path, in which case it depends on another module.
                            // so until that module loads, this cannot be run
                            lassoModulesMeta.run[path] = runOptions || {
                                __isEmpty: true
                            };
                        } else if (type === 'searchPath') {
                            lassoModulesMeta.searchPath.push(searchPath);
                        } else if (type === 'loaderMetadata') {
                            lassoModulesMeta.loaderMetadata = loaderMetadata;
                        }
                        traversalPath.skip();
                    }

                    // traversalPath.skip();
                }
            }
        });

        return lassoModulesMeta;
    }
};

exports.getLassoModulesData = getLassoModulesData;
exports.grabInfoFromAst = grabInfoFromAst;
exports.traverseExpressionStatement = traverseExpressionStatement;
