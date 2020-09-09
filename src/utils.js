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
