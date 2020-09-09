'use strict'

const injectClient = (code, varName) => {
    return `!(function(win) {
        win.global = win;

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
            this.loaded = false;
            this.exports = {};
        }

        Module.cache = _cache;

        Module.prototype.load = function(factoryOrObject, require) {
            if (factoryOrObject && factoryOrObject.constructor === Function) {
                var exports = this.exports;

                var instanceRequire = function(target, refId) {
                    var reqMod = require(target, refId);
                    return reqMod.exports;
                };
                instanceRequire.resolve = function(target, refId) {
                    var resolvedMod = require(target, refId);
                    return resolvedMod.id;
                }
                instanceRequire.cache = _cache;
                instanceRequire.runtime = ${varName};

                factoryOrObject.call(null, instanceRequire, exports, moduleInstance, factoryOrObject.name);
            } else {
                this.exports = factoryOrObject;
            }
            moduleInstance.loaded = true;
        }

        function require(factoryOrObject, refId) {
            var name = '';

            if (factoryOrObject && factoryOrObject.constructor === Function) {
                name = factoryOrObject.name;
            } else if(typeof factoryOrObject === 'object' && refId) {
                name = refId;
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
                return runQueue.push([path, options]);
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
            }
        };

        win ? win.${varName} = ${varName} : module.exports = ${varName};

        ${code}

    })(window);`;
};

exports.injectClient = injectClient;
