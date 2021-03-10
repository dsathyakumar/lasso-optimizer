const { join } = require('path');
const { readFileSync, writeFileSync } = require('fs');
const { optimizeMultipleSourceFiles } = require('../index');

const codeFiles = ['head.js', 'inception.js', 'highline.js', 'jquery.js'].map(fileName => {
    const code = readFileSync(join(__dirname, 'mock-data', `./${fileName}`), 'utf8');
    return {fileName, code};
})


let resultArr;

try {
    resultArr = optimizeMultipleSourceFiles(codeFiles, '', true);
    
    resultArr.outputFileArr.forEach((result,idx) => {
        writeFileSync(join(__dirname, 'fixtures', `./${result.fileName}.js`), result.output.code, 'utf8');
    });
} catch(e) {
    console.error(e.message);
} finally {
    console.log('complete!');
}
