/* eslint-disable no-console */

'use strict';

const getFromDefs = (depNameVerPath, lassoModulesMeta) => {
    let varName;
    varName = lassoModulesMeta.defs[depNameVerPath];
    if (!varName) {
        // within this check if this is remapped
        const filePath = lassoModulesMeta.remap[depNameVerPath];
        if (filePath) {
            varName = lassoModulesMeta.defs[filePath];
        } else {
            console.error(`--- FILE ${depNameVerPath} NOT FOUND --- in definitions & remaps`);
            console.warn('Performing Deterministic replace of path with Identifer. Possible Cyclic dependency..');
            varName = depNameVerPath.replace(new RegExp('/', 'g'), '__')
                .replace('$', '_')
                .replace(/\./g, '_')
                .replace(/\-/g, '_');
        }
    }
    return varName;
};

const getInstalledVersion = (modNameVersion, depNameVersion, lassoModulesMeta) => {
    // get the entire installed List
    const installedList = lassoModulesMeta.installed;
    // get the dependency name
    let depName;
    if (depNameVersion.indexOf('$') > -1) {
        depName = depNameVersion.slice(0, depNameVersion.indexOf('$'));
    } else {
        depName = depNameVersion;
    }

    // get the installed deps for that specific module
    const installedDepsList = installedList[modNameVersion];
    // retrieve the version of installed dependency (if exists)
    const installedVersion = installedDepsList[depName];
    return installedVersion || '';
};

const computeMainFilePath = (depNameVersion, lassoModulesMeta) => {
    const mainFileList = lassoModulesMeta.main;
    const mainFile = mainFileList[`/${depNameVersion}`];
    let mainFilePath;
    if (mainFile) {
        mainFilePath = `/${depNameVersion}/${mainFile}`;
    } else {
        mainFilePath = `/${depNameVersion}/index`;
    }
    return mainFilePath;
};

/**
 * This resolves a .require() call
 * @param {String} modNameVerPath - eg)/marko$4.17.3/src/runtime/components/init-components
 * @param {String} depNameVerPath - eg)'/marko$4.17.3/src/runtime/components/KeySequence'
 * @param {Object} lassoModulesMeta - Available Map of defs, main, remaps, installed
 */
const importResolver = (modNameVerPath, depNameVerPath, lassoModulesMeta) => {
    // note- remap, defs contains the FULL FP
    let varDeclName = '';
    let depNameVersion = (depNameVerPath.split('/')[1]) ? depNameVerPath.split('/')[1] : depNameVerPath;
    const reqDepVersion = (depNameVerPath.split('/')[1]) ? (depNameVerPath.split('/')[1]).split('$')[1] : '';
    const modNameVersion = modNameVerPath.split('/')[1];

    // if a module requires some internal file dependency within its file system
    if ((depNameVersion === modNameVersion)) {
        console.info(`Attempting to require file in self-dir`);
        varDeclName = getFromDefs(depNameVerPath, lassoModulesMeta);
    } else {
        // its an installed module
        const installedVer = getInstalledVersion(modNameVersion, depNameVersion, lassoModulesMeta);
        // if a version number exists
        if (installedVer) {
            if (installedVer === reqDepVersion) {
                // dep version is right
                if (depNameVerPath.split('/').length > 2) { // its a specific path
                    varDeclName = getFromDefs(depNameVerPath, lassoModulesMeta);
                } else { // load the main file path
                    const mainFilePath = computeMainFilePath(depNameVersion, lassoModulesMeta);
                    varDeclName = getFromDefs(mainFilePath, lassoModulesMeta);
                }
            } else {
                // ERROR: incorrect dep version installed
                console.error(`
                ${modNameVerPath} Expected ${depNameVersion}
                but found ${installedVer} to be installed`);
                console.warn(`Trying to require available version ${installedVer}`);
                if (reqDepVersion === '') {
                    console.warn(`${depNameVersion} is without a version. Requiring installed = ${installedVer}`);
                    depNameVersion = `${depNameVersion}$${installedVer}`;
                }
                const mainFilePath = computeMainFilePath(depNameVersion, lassoModulesMeta);
                varDeclName = getFromDefs(mainFilePath, lassoModulesMeta);
            }
        } else {
            // ERROR: installed version number not available - ''
            console.error(`Installed Version number empty for ${depNameVersion} in ${modNameVerPath}`);
        }
    }
    return varDeclName;
};

const requireFromLassoModulesMeta = importResolver;

module.exports = requireFromLassoModulesMeta;
