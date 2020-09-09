const { join } = require('path');
const { readFileSync, writeFileSync } = require('fs');
const { optimizeSingleSourceFile } = require('../');

const code = readFileSync(join(__dirname, './input.js'), 'utf8');
let result = '';
try {
    result = optimizeSingleSourceFile(code);
    writeFileSync(join(__dirname, './output.js'), result, 'utf8');
} catch(e) {
    console.error(e.message);
}
