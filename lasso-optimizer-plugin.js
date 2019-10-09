'use strict';

const parseAndGenerateCode = require('./lib');

module.exports = (lasso, pluginConfig) => {
    lasso.addTransform({
        // Only apply to JS code
        contentType: 'js',

        // Give your module a friendly name
        // (helpful for debugging in case something goes wrong in your code)
        name: module.id,

        // If stream is set to false then a String will be provided.
        // Otherwise, a readable stream will be provided
        stream: false,

        // Do the magic:
        transform: (code, lassoContext) => parseAndGenerateCode(code, pluginConfig, lassoContext)
    });
};
