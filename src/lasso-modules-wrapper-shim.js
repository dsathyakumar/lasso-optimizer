'use strict';

const addWrapper = (code, varName) => `
/* eslint-disable */
!(function(get, set, run) {
    ${code}
})(${varName}.get, ${varName}.set, ${varName}.run);
`;

exports.addWrapper = addWrapper;
