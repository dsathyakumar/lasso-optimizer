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

        function require(func) {
            if (!_cache[func.name]) {
                var moduleInstance = new Module(func.name);

                var exports = moduleInstance.exports;
                _cache[func.name] = moduleInstance;

                func.call(null, require, exports, moduleInstance);

                moduleInstance.loaded = true;
            }
            return _cache[func.name].exports;
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
