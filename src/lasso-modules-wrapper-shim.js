'use strict';

const addWrapper = (code, varName) => `
/* eslint-disable */
!(function(___$_get, ___$_set, ___$_run) {
    ${code}
})(${varName}.get, ${varName}.set, ${varName}.run);
`;

exports.addWrapper = addWrapper;
