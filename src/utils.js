/* eslint-disable max-len */
/* eslint-disable no-console */
'use strict';

const { get } = require('@ebay/retriever');
const types = require('@babel/types');

exports.getObjectInfo = objExpr => {
    const data = {};
    if (objExpr && types.isObjectExpression(objExpr)) {
        const props = objExpr.properties;
        if (props.length) {
            props.forEach(prop => {
                if (types.isObjectProperty(prop)) {
                    if (
                        types.isIdentifier(prop.key) &&
                        types.isUnaryExpression(prop.value)
                    ) {
                        data[prop.key.name] = {};
                        if (
                            types.isNumericLiteral(prop.value.argument) ||
                            types.isBooleanLiteral(prop.value.argument)
                        ) {
                            data[
                                prop.key.name
                            ] = `${prop.value.operator}${prop.value.argument.value}`;
                        }
                    }
                }
            });
        }
    }
    return data;
};

exports.getLoaderObjectInfo = objExpr => {
    const data = {};

    if (objExpr && types.isObjectExpression(objExpr)) {
        const props = objExpr.properties;
        if (props.length) {
            props.forEach(prop => {
                if (types.isObjectProperty(prop)) {
                    // this is specifically for .loaderMetadata
                    if (
                        (types.isStringLiteral(prop.key) ||
                            types.isIdentifier(prop.key)) &&
                        types.isObjectExpression(prop.value)
                    ) {
                        // every prop in loaderMeta is an object
                        const key = prop.key.value || prop.key.name;
                        data[key] = {};
                        const childProperties = prop.value.properties;
                        if (childProperties.length) {
                            childProperties.forEach(childProp => {
                                if (types.isObjectProperty(childProp)) {
                                    if (
                                        types.isIdentifier(childProp.key) &&
                                        types.isArrayExpression(childProp.value)
                                    ) {
                                        data[key][childProp.key.name] = [];
                                        if (childProp.value.elements.length) {
                                            childProp.value.elements.forEach(
                                                asset => {
                                                    if (
                                                        types.isStringLiteral(
                                                            asset
                                                        )
                                                    ) {
                                                        data[key][
                                                            childProp.key.name
                                                        ].push(asset.value);
                                                    }
                                                }
                                            );
                                        }
                                    }
                                }
                            });
                        }
                    }
                }
            });
        }
    }
    return data;
};

exports.isLassoModule = path => {
    let isLassoCJSModule = false;

    const calleeObj = get(path, 'node.callee', {});
    if (
        types.isIdentifier(calleeObj.object) &&
        calleeObj.object.name.startsWith('$_mod')
    ) {
        isLassoCJSModule = true;
        console.log('Its a lasso module.');
    }

    return isLassoCJSModule;
};

// Uglify and Terser tend to re-use same variable, once their task is done.
// In such cases, we'd never be able to say if the reference is a re-assigned reference
// or still the require reference. In such cases, Babel will report it as a constant violation.
// So, here we loop over constant violations and based on line numbers, we understand which all
// referencePaths are fake (due to violation by constants) & are not actually "require" types.
// All such referencePaths will be pruned away!
// some times we will have a = a('/marko$4.20.2/src/components/runtime')
// meaning require is used and the returned result is assigned to itself. These occurences
// are needed, to resolve the require call.
exports.pruneReferencePaths = (referencedPaths = [], constantViolations = [], moduleNameAndPath) => {
    console.warn(`Pruning "require" for ${moduleNameAndPath}`);

    constantViolations.forEach(violationPath => {
        const violationNode = violationPath.node;
        const violationLine = violationNode.loc.start.line;
        const violationCol = violationNode.loc.start.column;
        referencedPaths = referencedPaths.filter(refPath => {
            const refNode = refPath.node;
            const refLine = refNode.loc.start.line;
            const refCol = refNode.loc.start.column;

            // this is not re-assigned yet. So can be taken safely
            if (refLine < violationLine) {
                return true;
            } else if (refLine === violationLine) {
                // its still not re-assigned, so can be taken safely
                if (refCol < violationCol) {
                    return true;
                }

                // Stuff below are all re-assignments while being used
                // like a = a('/marko/src/dist/components')
                // require()
                // if un-minified, the func args would nt be changed yet and its easy
                // else this is the best guesstimate
                if (
                    (types.isCallExpression(refPath.parent)) &&
                    (refPath.parent.arguments.length === 1) &&
                    (types.isStringLiteral(refPath.parent.arguments[0]))
                ) {
                    console.warn(`Including a possible require call: ${refPath.parent.arguments[0].value}`);
                    return true;
                }

                // dynamic require()
                if (
                    (types.isCallExpression(refPath.parent)) &&
                    (refPath.parent.arguments.length === 1) &&
                    (types.isIdentifier(refPath.parent.arguments[0]))
                ) {
                    console.warn(`Including a possible DYNAMIC require call: ${refPath.parent.arguments[0].name}`);
                    return true;
                }

                // require.resolve()
                if (
                    types.isMemberExpression(refPath.parent) &&
                    types.isCallExpression(refPath.parentPath.parentPath) &&
                    (types.isIdentifier(refPath.parent.property)) &&
                    (refPath.parent.property.name === 'resolve') &&
                    (refPath.parentPath.parentPath.node.arguments.length === 1) &&
                    (types.isStringLiteral(refPath.parentPath.parentPath.node.arguments[0]))
                ) {
                    console.warn(
                        `Including a possible require.resolve(): ${refPath.parentPath.parentPath.node.arguments[0].value}`
                    );
                    return true;
                }

                // dynamic require.resolve
                if (
                    types.isMemberExpression(refPath.parent) &&
                    types.isCallExpression(refPath.parentPath.parentPath) &&
                    (types.isIdentifier(refPath.parent.property)) &&
                    (refPath.parent.property.name === 'resolve') &&
                    (refPath.parentPath.parentPath.node.arguments.length === 1) &&
                    (types.isIdentifier(refPath.parentPath.parentPath.node.arguments[0]))
                ) {
                    console.warn(
                        `Including a possible DYNAMIC require.resolve(): ${refPath.parentPath.parentPath.node.arguments[0].name}`
                    );
                    return true;
                }

                console.log('Excluding unknown Type');
            }
            // return refLine <= violationLine;
        });
    });

    return referencedPaths;
};

exports.isRootFuncExpression = path => {
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
