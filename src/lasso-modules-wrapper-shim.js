'use strict';

const addWrapper = (code, varName) => `
/* eslint-disable */
!(function(_f, run) {
    ${code}
})(${varName}.l, ${varName}.run);
`;

exports.addWrapper = addWrapper;
