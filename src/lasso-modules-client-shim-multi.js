'use strict';

const injectClient = (code, varName) => `
/* eslint-disable */
!(function(win) {
        win.global = win;
        var _f = {};
        var _cache = {};
        var ${varName};
        var _ready = false;
        var runQueue = [];
        var pendingCount = 0;

        if (window.${varName}) {
            return;
        }

        function Module(funcName) {
            this.id = funcName;
            this.filename = funcName;
            this.dirname = funcName;
            this.loaded = false;
            this.exports = {};
        }

        Module.cache = _cache;

        Module.prototype.load = function(factoryOrObject, require) {
            if (factoryOrObject && factoryOrObject.constructor === Function) {
                var exports = this.exports;

                // ths is the require passed to every function
                var instanceRequire = function(target, refId) {
                    var reqMod = require(target, refId);
                    return reqMod.exports;
                };

                // called when doing a require.resolve
                // require.resolve(func) or require.resolve(referentialId)
                // The idea being, funcs id can be accessed via fun.name
                // for other stuff we create a referentialID and access based on it.
                instanceRequire.resolve = function(path) {
                    if (typeof path !== 'string' && typeof path.constructor === Function) {
                        path = path.name;
                    }
                    var resolvedMod = require(path);

                    // only return the id or filename here
                    return resolvedMod.id;
                }
                instanceRequire.cache = _cache;
                instanceRequire.runtime = ${varName};

                factoryOrObject.call(null, instanceRequire, exports, this, factoryOrObject.name, factoryOrObject.name);
            } else {
                this.exports = factoryOrObject;
            }
            this.loaded = true;
        }

        // factoryOrObject can be a factory function (function declaration) => require(someFunctionDeclarationReference)
        // factoryOrObject can be a POJS object (of require types for JSON files) => require(someJSObj, refId)
        // factoryOrObject can be the path from a require.resolve() => require.Resolve(FuncNameOrObjRefID)
        // For objectReferences since we cannot access it similar to function.name or get
        // object variable identifier.toString
        // we create a referentialID compileTime and use it to store the object in the requireCache
        function require(factoryOrObject, refId) {
            var name = '';

            if (factoryOrObject && factoryOrObject.constructor === Function) {
                name = factoryOrObject.name;
            } else if(typeof factoryOrObject === 'object' && refId) {
                name = refId;
            } else if (typeof factoryOrObject === 'string') {
                name = factoryOrObject;
                return _cache[name];
            } else {
                console.debug('unknown type');
            }

            if (!_cache[name]) {
                var moduleInstance = new Module(name);
                _cache[name] = moduleInstance;
                moduleInstance.load(factoryOrObject, require);
                return moduleInstance;
            }

            return _cache[name];
        }

        function run(func, options) {
            var wait = !options || (options.wait !== false);
            if (wait && !_ready) {
                return runQueue.push([func, options]);
            }

            // this is added so that Minifers dont get rid of func names and inline stuff as anonymous funcs
            // we are replacing string caches by cache with func.prototype.name
            if (typeof func !== 'function' || func.name === '') {
                console.error('Cannot cache anonymous funcs');
                return;
            }

            require(func);
        }

        function ready() {
            _ready = true;

            var len;
            while((len = runQueue.length)) {
                var queue = runQueue;

                runQueue = [];

                for (var i = 0; i < len; i++) {
                    var args = queue[i];
                    run(args[0], args[1]);
                }

                // stop running jobs in the queue if we change to not ready
                if (!_ready) {
                    break;
                }
            }
        }

        function onPendingComplete() {
            pendingCount--;
            if (!pendingCount) {
                // Trigger any "require-run" modules in the queue to run
                ready();
            }
        };

        Module.prototype.__runtime = ${varName} = {
            ready: ready,
            run: run,
            require: require,
            pending: function() {
                _ready = false;
                pendingCount++;
                return {
                    done: onPendingComplete
                };
            },
            loaderMetadata: function(data) {
                Module.prototype.__loaderMetadata = data;
            },
            c: _cache,
            l: _f
        };

        win ? win.${varName} = ${varName} : module.exports = ${varName};

        ${code}

    })(window);`;

exports.injectClient = injectClient;
