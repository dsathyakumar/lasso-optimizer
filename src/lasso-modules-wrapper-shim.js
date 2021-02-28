'use strict';

// const addWrapper = (code, varName) => `
// /* eslint-disable */
// !(function(win) {
//         if (!${varName} in win) {
//             console.debug('${varName} is not defined');
//             return;
//         }

//         var require = win.${varName}.require;
//         var run = win.${varName}.run;

//         ${code}

//     })(window);`;

const addWrapper = (code, varName) => `
/* eslint-disable */
${code}
`;

exports.addWrapper = addWrapper;
