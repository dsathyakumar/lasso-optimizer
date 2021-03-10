'use strict';

const injectClient = (code, varName) => `
!(function(win){

    win.global = win;
    var _pvt = [];

    var ___$_set = function(func, options) {
        var _len = _pvt.push({
            o:options,
            def: func
        });
        if (options && options.globals) {
            var _target = win || global;
            var _fob = _pvt[(_len - 1)];
            var _globalMod = require({id: (_len - 1), obj: _fob});
            for(var counter = 0; counter < (options.globals.length); counter++) {
                _target[options.globals[counter]] = (_globalMod && _globalMod.exports);
            }
        }
    };

    var ___$_get = function(idx) {
        return {
            obj: _pvt[idx],
            id: idx
        };
    };

    var _cache = {};
    var ${varName};
    var _ready = false;
    var runQueue = [];
    var pendingCount = 0;

    if (window.${varName}) {
        return;
    }

    function Module(id) {
        this.id = id;
        this.filename = id;
        this.dirname = id;
        this.loaded = false;
        this.exports = {};
    }

    Module.cache = _cache;

    Module.prototype.load = function(factoryOrObject, require) {
        if (factoryOrObject && factoryOrObject.constructor === Function) {
            var exports = this.exports;

            // ths is the require passed to every function
            var instanceRequire = function(target) {
                var reqMod = require(target);
                return reqMod.exports;
            };

            // called when doing a require.resolve
            // require.resolve(func) or require.resolve(referentialId)
            // The idea being, funcs id can be accessed via fun.name
            // for other stuff we create a referentialID and access based on it.
            instanceRequire.resolve = function(path) {
                if (typeof path === 'number') {
                    var resolvedMod = require(path);
                    // only return the id or filename here
                    return resolvedMod.id;
                }
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
    function require(factoryOrObject) {
        var name = '';

        var id = factoryOrObject.id;
        var obj = factoryOrObject.obj.def;
        var opts = factoryOrObject.obj.o;

        // require.resolve calls
        if (typeof factoryOrObject === 'string') {
            name = factoryOrObject;
            return _cache[name];
        } else if(typeof id !== 'undefined') { // all other function definitions / object expressions
            name = id;
        } else {
            console.debug(factoryOrObject);
            console.debug('unknown type');
        }

        if (!_cache[name]) {
            var moduleInstance = new Module(name);
            _cache[name] = moduleInstance;
            moduleInstance.load(obj, require);

            // if (opts && opts.globals) {
                // var target = win || global;
                // var globalMod = require(factoryOrObject);
                // for (var i=0; i < opts.globals.length; i++) {
                    // target[opts.globals[i]] = globalMod;
                // }
            // }

            return moduleInstance;
        }

        return _cache[name];
    }

    function ___$_run(func, options) {
        var wait = !options || (options.wait !== false);
        if (wait && !_ready) {
            return runQueue.push([func, options]);
        }

        // this is added so that Minifers dont get rid of func names and inline stuff as anonymous funcs
        // we are replacing string caches by cache with func.prototype.name
        if (typeof func.obj.def !== 'function') {
            console.error('Must be a function');
            return;
        }

        if (options && options.obj && options.obj.def && typeof options.obj.def === 'function') {
            require(options);
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
                ___$_run(args[0], args[1]);
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
        run: ___$_run,
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
        set: ___$_set,
        get: ___$_get
    };

    win ? win.${varName} = ${varName} : module.exports = ${varName};

    ${code}
})(window);`;

exports.injectClient = injectClient;
