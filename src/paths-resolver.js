/* eslint-disable no-console */
'use strict';

const isSemVer = () =>
    // eslint-disable-next-line max-len
    /(?<=^v?|\sv?)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*)(?:\.(?:0|[1-9]\d*|[\da-z-]*[a-z-][\da-z-]*))*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?(?=$|\s)/gi;

const nthIndex = (str, pattern, n) => {
    const len = str.length;
    let i = -1;

    while (n-- && i++ < len) {
        i = str.indexOf(pattern, i);
        if (i < 0) break;
    }

    return i;
};

// checks at 3 spots:
// - main
// - def
// - remap
const resolvePath = (path, meta) => {
    let resolvedVarName = '';

    if (path && meta) {
        if (meta.def[path]) {
            // now passes both the altID and the modulePathToVarRef
            resolvedVarName = {
                modulePathToVarRef: meta.def[path].modulePathToVarRef,
                altid: meta.def[path].altid,
                reserved: meta.def[path].reserved
            };
        } else if (meta.main[path]) {
            const mainPath = meta.main[path] + meta.main[path].main || '/index';
            resolvedVarName = resolvePath(mainPath, meta);
        } else if (meta.remap[path]) {
            const remappedPath = meta.remap[path];
            resolvedVarName = resolvePath(remappedPath, meta);
        } else {
            console.error(`Def Not available for Path ${path}`);
        }
    }

    return resolvedVarName;
};

const getInstalledVersion = (
    modNameAndVersion,
    depNameVersion,
    modNameVerPath,
    depNameVerPath,
    meta
) => {
    // get the entire installed List
    const installedList = meta.installed;

    // get the dependency name
    let depName;

    let installedDepsList;

    if (!modNameVerPath.startsWith('/@')) {
        // get the installed deps for that specific module
        installedDepsList = installedList[modNameAndVersion];
    } else {
        const updatedName = modNameVerPath.substr(
            1,
            nthIndex(modNameVerPath, '/', 3) - 1
        );
        installedDepsList = installedList[updatedName];
    }

    if (!depNameVerPath.startsWith('/@')) {
        if (depNameVersion.indexOf('$') > -1) {
            depName = depNameVersion.slice(0, depNameVersion.indexOf('$'));
        } else {
            console.error(
                `incorrect format of dependency. Versioning unavailable for ${depNameVersion}`
            );
        }
    } else {
        const endOfScoped = nthIndex(depNameVerPath, '/', 3);
        depName = depNameVerPath.substr(1, endOfScoped - 1);
        depName = depName.slice(0, depName.indexOf('$'));
    }

    if (typeof installedDepsList === 'undefined') {
        console.warn(`Nothing installed for module ${modNameVerPath} and ${modNameAndVersion}`);
        return '';
    }

    // retrieve the version of installed dependency (if exists)
    return installedDepsList[depName] || '';
};

const resolver = (modNameVerPath, depNameVerPath, meta) => {
    let resolvedVarName = '';

    let modNameAndVersion;
    let depNameAndVersion;
    let depVersion;

    if (modNameVerPath.startsWith('/@')) {
        const endOfScoped = nthIndex(modNameVerPath, '/', 2);
        const tempStr = modNameVerPath.substr(
            endOfScoped,
            modNameVerPath.length
        );
        modNameAndVersion = tempStr.split('/')[1] ? tempStr.split('/')[1] : '';
    } else {
        // note- remap, defs contains the FULL FP
        // For eg) marko$4.17.3
        modNameAndVersion = modNameVerPath.split('/')[1]
            ? modNameVerPath.split('/')[1]
            : '';
    }

    if (depNameVerPath.startsWith('/@')) {
        const endOfScoped = nthIndex(depNameVerPath, '/', 2);
        const tempStr = depNameVerPath.substr(
            endOfScoped,
            depNameVerPath.length
        );
        depNameAndVersion = tempStr.split('/')[1]
            ? tempStr.split('/')[1]
            : tempStr;
        depVersion = tempStr.split('/')[1]
            ? tempStr.split('/')[1].split('$')[1]
            : '';
    } else {
        // For eg) marko$4.17.3
        depNameAndVersion = depNameVerPath.split('/')[1]
            ? depNameVerPath.split('/')[1]
            : depNameVerPath;

        // For eg) 4.17.3
        depVersion = depNameVerPath.split('/')[1]
            ? depNameVerPath.split('/')[1].split('$')[1]
            : '';
    }

    if (!modNameAndVersion) {
        console.error(
            `Fully Resolved FP with version not present for ModuleName = ${modNameVerPath}`
        );
    }

    const isVersioned = isSemVer().test(depVersion);

    // if a module requires some internal file dependency within its file system
    // then its modNameAndVersion and depNameAndVersion will be the same
    // for eg) /marko$4.17.3/src/runtime/components/init-components is the moduleNameVerPath
    // that is requiring /marko$4.17.3/src/runtime/components/KeySequence (a part of its own fs)
    if (depNameAndVersion === modNameAndVersion) {
        resolvedVarName = resolvePath(depNameVerPath, meta);
    } else {
        // There are only 2 possibilities here
        // Either its an installed module
        // or its a builtin
        // its an installed module
        const installedVer = getInstalledVersion(
            modNameAndVersion,
            depNameAndVersion,
            modNameVerPath,
            depNameVerPath,
            meta
        );

        if (isVersioned) {
            if (depVersion === installedVer) {
                resolvedVarName = resolvePath(depNameVerPath, meta);
            } else {
                // some issue here with Lasso's bundling
                console.error(
                    `Incorrect dependency version of ${depNameAndVersion} installed for ${modNameAndVersion}`
                );
            }
        }
        if (!isVersioned || depVersion !== installedVer) {
            console.warn(`Trying to check if its a posible built-in`);
            // its possible its a builtin
            const builtInPath =
                meta.builtin[depNameVerPath] ||
                meta.builtin[
                    depNameAndVersion.substr(0, depNameAndVersion.indexOf('$'))
                ];
            if (builtInPath) {
                resolvedVarName = resolvePath(builtInPath, meta);
                if (!resolvedVarName) {
                    console.error(`Def not available in builtin for ${depNameVerPath}`);
                } else {
                    // eslint-disable-next-line no-console
                    console.info(`Def exists as builtin for ${depNameVerPath}`);
                }
            } else {
                console.error(`Def not available for ${depNameVerPath}`);
            }
        }

        // attempting a final passthrough here, to see if it can be resolved from .defs
        if (!resolvedVarName) {
            console.warn(`${depNameVerPath} is still not resolved. Attempting a final pass..`);
            resolvedVarName = resolvePath(depNameVerPath, meta);
        }
    }

    // eslint-disable-next-line no-console
    console.info(`${depNameVerPath} ----> ${JSON.stringify(resolvedVarName)}`);
    console.info('\n');

    return resolvedVarName;
};

/**
 * This walks over the data to resolve paths such that
 * - def
 * - remap
 * - main
 * - installed
 * - builtin
 * - run
 * - searchPath
 * @param {Object} lassoModulesMeta
 */
const resolvePaths = lassoModulesMeta => {
    // eslint-disable-next-line compat/compat
    const meta = Object.assign({}, lassoModulesMeta);
    const reservedCollection = new Set();
    const dependencyPathToVarName = {};

    if (Object.keys(meta.def).length) {
        // loop over defs
        const defKeys = Object.keys(meta.def);
        try {
            defKeys.forEach(modulePath => {
                // ideally a def has to have a dependency, atleast in the form of an []
                // else, its a new un-recognized type yet.
                // So far we know a .def can contain either a FunctionExpression type or an ObjectExpressionType.
                if (!('dependencies' in meta.def[modulePath])) {
                    throw new Error(`"Dependencies" is undefined in ${modulePath}. Possibly a new type in .def`);
                }
                // loop over dependencies + resolve paths
                // all module dependencies paths and resolveables have to be resolved.
                let dependencies = meta.def[modulePath].dependencies.deps;
                dependencies = dependencies.concat(meta.def[modulePath].dependencies.resolve);
                if (dependencies.length) {
                    meta.def[modulePath].dependencies.finalize = {};
                    dependencies.forEach(dep => {
                        if (!dependencyPathToVarName[dep]) {
                            const resolvedVarName = resolver(modulePath, dep, meta);
                            dependencyPathToVarName[dep] = resolvedVarName;
                            meta.def[modulePath].dependencies.finalize[
                                dep
                            ] = resolvedVarName;
                            reservedCollection.add(resolvedVarName.reserved);
                        } else {
                            meta.def[modulePath].dependencies.finalize[dep] =
                                dependencyPathToVarName[dep];
                        }
                    });
                }
            });
        } catch (e) {
            console.error(`Resolution failed with ${e.message}`);
        }

        // check if every entry in the list of dependencies has been finalized
        try {
            defKeys.forEach(modulePath => {
                const dependencies = meta.def[modulePath].dependencies.deps;
                if (dependencies.length) {
                    const finalized = meta.def[modulePath].dependencies.finalize;
                    dependencies.forEach(dependency => {
                        if (!finalized[dependency]) {
                            throw new Error(`${dependency} not found in ${modulePath} finalized`);
                        }
                    });
                }
            });
        } catch (e) {
            console.error(`dependency resolution errored: ERR: ${e.message}`);
        }
    }

    // loop over runnables.
    if (Object.keys(meta.run).length) {
        const runKeys = Object.keys(meta.run);
        runKeys.forEach(runnableModPath => {
            if (!dependencyPathToVarName[runnableModPath]) {
                const resolvedPath = resolvePath(
                    runnableModPath,
                    meta
                )
                dependencyPathToVarName[runnableModPath] = resolvedPath;
                reservedCollection.add(resolvedPath.reserved);
            }
            // Then this runnable depends on another module, which also has to be resolved.
            if (typeof runKeys[runnableModPath] === 'string') {
                if (!dependencyPathToVarName[runKeys[runnableModPath]]) {
                    const resolvedPath = resolvePath(runKeys[runnableModPath], meta);
                    dependencyPathToVarName[
                        runKeys[runnableModPath]
                    ] = resolvedPath;
                    reservedCollection.add(resolvedPath.reserved);
                }
            }
        });
    }

    // we are really not bothered about .main, .remap, .installed, .builtin, .searchPaths anymore
    // They will all be removed and resolved compileTime.

    return {
        dependencyPathToVarName,
        meta,
        reservedCollection
    };
};

exports.resolvePaths = resolvePaths;
