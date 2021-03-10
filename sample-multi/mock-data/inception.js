/*
GOAL: This module should mirror the NodeJS module system according the documented behavior.
The module transport will send down code that registers module definitions by an assigned path. In addition,
the module transport will send down code that registers additional metadata to allow the module resolver to
resolve modules in the browser. Additional metadata includes the following:

- "mains": The mapping of module directory paths to a fully resolved module path
- "remaps": The remapping of one fully resolved module path to another fully resolved module path (used for browser overrides)
- "run": A list of entry point modules that should be executed when ready

Inspired by:
https://github.com/joyent/node/blob/master/lib/module.js
*/
(function() {
  var win;

  if (typeof window !== 'undefined') {
      win = window;

      // This lasso modules client has already been loaded on the page. Do nothing;
      if (win.$_mod) {
          return;
      }

      win.global = win;
  }

  /** the module runtime */
  var $_mod;

  // this object stores the module factories with the keys being module paths and
  // values being a factory function or object (e.g. "/baz$3.0.0/lib/index" --> Function)
  var definitions = Object.create(null);

  // Search path that will be checked when looking for modules
  var searchPaths = [];

  // The _ready flag is used to determine if "run" modules can
  // be executed or if they should be deferred until all dependencies
  // have been loaded
  var _ready = false;

  // If $_mod.run() is called when the page is not ready then
  // we queue up the run modules to be executed later
  var runQueue = [];

  // this object stores the Module instance cache with the keys being paths of modules (e.g., "/foo$1.0.0/bar" --> Module)
  var instanceCache = Object.create(null);

  // This object maps installed dependencies to specific versions
  //
  // For example:
  // {
  //   // The package "foo" with version 1.0.0 has an installed package named "bar" (foo/node_modules/bar") and
  //   // the version of "bar" is 3.0.0
  //   "/foo$1.0.0/bar": "3.0.0"
  // }
  var installed = Object.create(null);

  // Maps builtin modules such as "path", "buffer" to their fully resolved paths
  var builtins = Object.create(null);

  // this object maps a directory to the fully resolved module path
  //
  // For example:
  //
  var mains = Object.create(null);

  // used to remap a one fully resolved module path to another fully resolved module path
  var remapped = Object.create(null);

  function moduleNotFoundError(target, from) {
      var err = new Error('Cannot find module "' + target + '"' + (from ? ' from "' + from + '"' : ''));

      err.code = 'MODULE_NOT_FOUND';
      return err;
  }

  function Module(filename) {
     /*
      A Node module has these properties:
      - filename: The path of the module
      - id: The path of the module (same as filename)
      - exports: The exports provided during load
      - loaded: Has module been fully loaded (set to false until factory function returns)

      NOT SUPPORTED:
      - parent: parent Module
      - paths: The search path used by this module (NOTE: not documented in Node.js module system so we don't need support)
      - children: The modules that were required by this module
      */
      this.id = this.filename = filename;
      this.loaded = false;
      this.exports = undefined;
  }

  Module.cache = instanceCache;

  // temporary variable for referencing the Module prototype
  var Module_prototype = Module.prototype;

  Module_prototype.load = function(factoryOrObject) {
      var filename = this.id;

      if (typeof factoryOrObject === "function") {
          // find the value for the __dirname parameter to factory
          var dirname = filename.slice(0, filename.lastIndexOf('/'));
          // this is the require used by the module
          var instanceRequire = function(target) {
              return require(target, dirname);
          };

          // The require method should have a resolve method that will return the resolved
          // path but not actually instantiate the module.
          // This resolve function will make sure a definition exists for the corresponding
          // path of the target but it will not instantiate a new instance of the target.
          instanceRequire.resolve = function(target) {
              if (!target) {
                  throw moduleNotFoundError('');
              }

              var resolved = resolve(target, dirname);

              if (resolved === undefined) {
                  throw moduleNotFoundError(target, dirname);
              }

              return resolved;
          };

          // NodeJS provides access to the cache as a property of the "require" function
          instanceRequire.cache = instanceCache;

          // Expose the module system runtime via the `runtime` property
          // TODO: We should deprecate this in favor of `Module.prototype.__runtime`
          // @deprecated
          instanceRequire.runtime = $_mod;

          // $_mod.def("/foo$1.0.0/lib/index", function(require, exports, module, __filename, __dirname) {
          this.exports = {};

          // call the factory function
          factoryOrObject(instanceRequire, this.exports, this, filename, dirname);
      } else {
          // factoryOrObject is not a function so have exports reference factoryOrObject
          this.exports = factoryOrObject;
      }

      this.loaded = true;
  };

  /**
   * Defines a packages whose metadata is used by raptor-loader to load the package.
   */
  function define(path, factoryOrObject, options) {
      /*
      $_mod.def('/baz$3.0.0/lib/index', function(require, exports, module, __filename, __dirname) {
          // module source code goes here
      });
      */

      var globals = options && options.globals;

      definitions[path] = factoryOrObject;

      if (globals) {
          var target = win || global;
          var globalMod = require(path, "/");
          for (var i=0;i<globals.length; i++) {
              target[globals[i]] = globalMod;
          }
      }
  }

  function registerMain(path, relativePath) {
      mains[path] = relativePath;
  }

  function remap(fromPath, toPath) {
      remapped[fromPath] = toPath;
  }

  function builtin(name, target) {
      builtins[name] = target;
  }

  function registerInstalledDependency(parentPath, packageName, packageVersion) {
      // Example:
      // dependencies['/my-package$1.0.0/$/my-installed-package'] = '2.0.0'
      installed[parentPath + '/' + packageName] =  packageVersion;
  }

  function join(from, target) {
      var fromLen = from.length;
      var fromLastIndex = fromLen;
      var targetStartIndex = 0;
      var char;

      while ((char = target[targetStartIndex]) === ".") {
          targetStartIndex++;

          if ((char = target[targetStartIndex]) === ".") {
              targetStartIndex++;

              if (fromLastIndex) {
                  fromLastIndex = from.lastIndexOf("/", fromLastIndex - 1);

                  if (fromLastIndex === -1) {
                      fromLastIndex = 0;
                  }
              }
          }

          if ((char = target[targetStartIndex]) === "/") {
              targetStartIndex++;
          } else {
              break;
          }
      }

      if (char) {
          if (fromLastIndex) {
              return from.slice(0, fromLastIndex) + "/" + target.slice(targetStartIndex);
          }

          return target.slice(targetStartIndex);
      }
      
      if (fromLastIndex) {
          return fromLastIndex === fromLen ? from : from.slice(0, fromLastIndex);
      }

      return from[0] === "/" ? "/" : ".";
  }

  function withoutExtension(path) {
      var lastDotPos = path.lastIndexOf('.');
      var lastSlashPos;

      /* jshint laxbreak:true */
      return ((lastDotPos === -1) || ((lastSlashPos = path.lastIndexOf('/')) !== -1) && (lastSlashPos > lastDotPos))
          ? undefined // use undefined to indicate that returned path is same as given path
          : path.substring(0, lastDotPos);
  }

  function splitPackageIdAndSubpath(path) {
      path = path.substring(1); /* Skip past the first slash */
      // Examples:
      //     '/my-package$1.0.0/foo/bar' --> ['my-package$1.0.0', '/foo/bar']
      //     '/my-package$1.0.0' --> ['my-package$1.0.0', '']
      //     '/my-package$1.0.0/' --> ['my-package$1.0.0', '/']
      //     '/@my-scoped-package/foo/$1.0.0/' --> ['@my-scoped-package/foo$1.0.0', '/']
      var slashPos = path.indexOf('/');

      if (path[1] === '@') {
          // path is something like "/@my-user-name/my-scoped-package/subpath"
          // For scoped packages, the package name is two parts. We need to skip
          // past the second slash to get the full package name
          slashPos = path.indexOf('/', slashPos+1);
      }

      var packageIdEnd = slashPos === -1 ? path.length : slashPos;

      return [
          path.substring(0, packageIdEnd), // Everything up to the slash
          path.substring(packageIdEnd) // Everything after the package ID
      ];
  }

  function resolveInstalledModule(target, from) {
      // Examples:
      // target='foo', from='/my-package$1.0.0/hello/world'

      if (target[target.length-1] === '/') {
          // This is a hack because I found require('util/') in the wild and
          // it did not work because of the trailing slash
          target = target.slice(0, -1);
      }

      // Check to see if the target module is a builtin module.
      // For example:
      // builtins['path'] = '/path-browserify$0.0.0/index'
      var builtinPath = builtins[target];
      if (builtinPath) {
          return builtinPath;
      }

      var fromParts = splitPackageIdAndSubpath(from);
      var fromPackageId = fromParts[0];


      var targetSlashPos = target.indexOf('/');
      var targetPackageName;
      var targetSubpath;

      if (targetSlashPos < 0) {
          targetPackageName = target;
          targetSubpath = '';
      } else {

          if (target[0] === '@') {
              // target is something like "@my-user-name/my-scoped-package/subpath"
              // For scoped packages, the package name is two parts. We need to skip
              // past the first slash to get the full package name
              targetSlashPos = target.indexOf('/', targetSlashPos + 1);
          }

          targetPackageName = target.substring(0, targetSlashPos);
          targetSubpath = target.substring(targetSlashPos);
      }

      var targetPackageVersion = installed[fromPackageId + '/' + targetPackageName];
      if (targetPackageVersion) {
          var resolvedPath = '/' + targetPackageName + '$' + targetPackageVersion;
          if (targetSubpath) {
              resolvedPath += targetSubpath;
          }
          return resolvedPath;
      }
  }

  function resolve(target, from) {
      var resolvedPath;

      if (target[0] === '/') {
          // handle targets such as "/my/file" or "/$/foo/$/baz"
          resolvedPath = target;
      } else if (target[0] === '.') {
          // turn relative path into absolute path
          resolvedPath = join(from, target);
      } else {
          var len = searchPaths.length;
          for (var i = 0; i < len; i++) {
              // search path entries always end in "/";
              var candidate = searchPaths[i] + target;
              var resolved = resolve(candidate, from);
              if (resolved) {
                  return resolved;
              }
          }

          resolvedPath = resolveInstalledModule(target, from);
      }

      if (!resolvedPath) {
          return undefined;
      }

      // target is something like "/foo/baz"
      // There is no installed module in the path
      var relativePath = mains[resolvedPath];

      // check to see if "target" is a "directory" which has a registered main file
      if (relativePath !== undefined) {
          // there is a main file corresponding to the given target so add the relative path
          resolvedPath = join(resolvedPath, relativePath || 'index');
      }

      var remappedPath = remapped[resolvedPath];
      if (remappedPath) {
          resolvedPath = remappedPath;
      }

      if (definitions[resolvedPath] === undefined) {
          // check for definition for given path but without extension
          resolvedPath = withoutExtension(resolvedPath);

          if (resolvedPath !== undefined && definitions[resolvedPath] === undefined) {
              resolvedPath = undefined;
          }
      }

      return resolvedPath;
  }

  function requireModule(target, from) {
      if (!target) {
          throw moduleNotFoundError('');
      }

      var resolvedPath = resolve(target, from);

      if (resolvedPath === undefined) {
          throw moduleNotFoundError(target, from);
      }

      var module = instanceCache[resolvedPath];

      if (module === undefined) {
          // cache the instance before loading (allows support for circular dependency with partial loading)
          module = instanceCache[resolvedPath] = new Module(resolvedPath);
          module.load(definitions[resolvedPath]);
      }

      return module;
  }

  function require(target, from) {
      return requireModule(target, from).exports;
  }

  /*
  $_mod.run('/$/installed-module', '/src/foo');
  */
  function run(path, options) {
      var wait = !options || (options.wait !== false);
      if (wait && !_ready) {
          return runQueue.push([path, options]);
      }

      requireModule(path, '/');
  }

  /*
   * Mark the page as being ready and execute any of the
   * run modules that were deferred
   */
  function ready() {
      _ready = true;

      var len;
      while((len = runQueue.length)) {
          // store a reference to the queue before we reset it
          var queue = runQueue;

          // clear out the queue
          runQueue = [];

          // run all of the current jobs
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

  function addSearchPath(prefix) {
      searchPaths.push(prefix);
  }

  var pendingCount = 0;
  var onPendingComplete = function() {
      pendingCount--;
      if (!pendingCount) {
          // Trigger any "require-run" modules in the queue to run
          ready();
      }
  };

  /*
   * $_mod is the short-hand version that that the transport layer expects
   * to be in the browser window object
   */
  Module_prototype.__runtime = $_mod = {
      /**
       * Used to register a module factory/object (*internal*)
       */
      def: define,

      /**
       * Used to register an installed dependency (e.g. "/$/foo" depends on "baz") (*internal*)
       */
      installed: registerInstalledDependency,
      run: run,
      main: registerMain,
      remap: remap,
      builtin: builtin,
      require: require,
      resolve: function (target, from) {
          var resolved = resolve(target, from);
          if (resolved !== undefined) {
              return [resolved, definitions[resolved]];
          }
      },
      join: join,
      ready: ready,

      /**
       * Add a search path entry (internal)
       */
      searchPath: addSearchPath,

      /**
       * Sets the loader metadata for this build.
       *
       * @param asyncPackageName {String} name of asynchronous package
       * @param contentType {String} content type ("js" or "css")
       * @param bundleUrl {String} URL of bundle that belongs to package
       */
      loaderMetadata: function(data) {
          // We store loader metadata in the prototype of Module
          // so that `lasso-loader` can read it from
          // `module.__loaderMetadata`.
          Module_prototype.__loaderMetadata = data;
      },

      /**
       * Asynchronous bundle loaders should call `pending()` to instantiate
       * a new job. The object we return here has a `done` method that
       * should be called when the job completes. When the number of
       * pending jobs drops to 0, we invoke any of the require-run modules
       * that have been declared.
       */
      pending: function() {
          _ready = false;
          pendingCount++;
          return {
              done: onPendingComplete
          };
      }
  };

  if (win) {
      win.$_mod = $_mod;
  } else {
      module.exports = $_mod;
  }
})();

$_mod.def("/@ebay/skin$10.7.1/root", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/root/ds6/root.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/global", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/global/ds6/global.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/utility", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/utility/ds6/utility.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/core", function(require, exports, module, __filename, __dirname) { require('/@ebay/skin$10.7.1/root'/*'./root'*/);
require('/@ebay/skin$10.7.1/global'/*'./global'*/);
require('/@ebay/skin$10.7.1/utility'/*'./utility'*/);
});
$_mod.def("/@ebay/skin$10.7.1/dialog", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/dialog/ds6/dialog.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/button", function(require, exports, module, __filename, __dirname) { void 0/*require("./dist/button/ds6/button.css")*/;
});
$_mod.def("/@ebay/skin$10.7.1/checkbox", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/checkbox/ds6/checkbox.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/field", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/field/ds6/field.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/radio", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/radio/ds6/radio.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/select", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/select/ds6/select.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/switch", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/switch/ds6/switch.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/textbox", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/textbox/ds6/textbox.css')*/;
});
$_mod.def("/@ebay/skin$10.7.1/form", function(require, exports, module, __filename, __dirname) { require('/@ebay/skin$10.7.1/button'/*'./button'*/);
require('/@ebay/skin$10.7.1/checkbox'/*'./checkbox'*/);
require('/@ebay/skin$10.7.1/field'/*'./field'*/);
require('/@ebay/skin$10.7.1/radio'/*'./radio'*/);
require('/@ebay/skin$10.7.1/select'/*'./select'*/);
require('/@ebay/skin$10.7.1/switch'/*'./switch'*/);
require('/@ebay/skin$10.7.1/textbox'/*'./textbox'*/);
});
$_mod.def("/@ebay/skin$10.7.1/spinner", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/spinner/ds6/spinner.css')*/;
});
$_mod.def("/ebay-font$1.2.3/font/marketsans/fontloader", function(require, exports, module, __filename, __dirname) { /* global FontFaceObserver, Promise */
'use strict';

var fontFaceSet = document.fonts;
var FONT_CLASS_NAME = 'font-marketsans';
var FONT_FACE_OBSERVER_LIB = 'https://ir.ebaystatic.com/cr/v/c1/vendor/fontfaceobserver.js';

function lazyLoad(url, callback) {
  var scriptElem = document.createElement('script');
  scriptElem.type = 'application/javascript';
  scriptElem.async = true;
  scriptElem.onload = callback;
  scriptElem.src = url;

  var firstScript = document.getElementsByTagName('script')[0];
  firstScript.parentNode.insertBefore(scriptElem, firstScript);
}

function updateLocalStorage() {
  try {
      localStorage.setItem('ebay-font', FONT_CLASS_NAME);
  } catch (ex) {
      // Either localStorage not present or quota has exceeded
      // Another reason Safari private mode
      // https://stackoverflow.com/questions/14555347/html5-localstorage-error-with-safari-quota-exceeded-err-dom-exception-22-an
  }
}

/**
 * Check if FontFaceSet API is supported, along with some browser quirks
 * Mainly return false if the browser has the Safari 10 bugs. The
 * native font load API in Safari 10 has two bugs that cause
 * the document.fonts.load and FontFace.prototype.load methods
 * to return promises that don't reliably get fired.
 *
 * The bugs are described in more detail here:
 *  - https://bugs.webkit.org/show_bug.cgi?id=165037
 *  - https://bugs.webkit.org/show_bug.cgi?id=164902
 *
 * If the browser is made by Apple, and has native font
 * loading support, it is potentially affected. But the API
 * was fixed around AppleWebKit version 603, so any newer
 * versions that that does not contain the bug.
 *
 * @return {boolean}
*/
function isFontFaceSetCompatible() {
  var compatible = fontFaceSet && fontFaceSet.load;
  if (compatible && /Apple/.test(window.navigator.vendor)) {
      var match = /AppleWebKit\/([0-9]+)(?:\.([0-9]+))(?:\.([0-9]+))/.exec(window.navigator.userAgent);
      compatible = !(match && parseInt(match[1], 10) < 603);
  }
  return compatible;
}

function loadFont() {
  // check for fontfaceset else load polyfill before invoking fontloader
  if (isFontFaceSetCompatible()) {
      fontFaceSet.load('1em Market Sans');
      fontFaceSet.load('bold 1em Market Sans');
      fontFaceSet.ready.then(updateLocalStorage);
  } else {
      lazyLoad(FONT_FACE_OBSERVER_LIB, function () {
          var marketsansRegular = new FontFaceObserver('Market Sans');
          var marketsansBold = new FontFaceObserver('Market Sans', { weight: 'bold' });
          Promise.all([marketsansRegular.load(), marketsansBold.load()]).then(updateLocalStorage);
      });
  }
}

function isFontLoaded() {
  return 'fontDisplay' in document.documentElement.style || localStorage && localStorage.getItem('ebay-font') === FONT_CLASS_NAME;
}

function init() {
  // Initialize font loader only if it is not loaded previously
  if (!isFontLoaded()) {
      window.addEventListener('load', function () {
          if (requestAnimationFrame) {
              requestAnimationFrame(loadFont);
          } else {
              loadFont();
          }
      });
  }
}
init();
});
$_mod.run("/ebay-font$1.2.3/font/marketsans/fontloader");
$_mod.def("/@ebay/skin$10.7.1/marketsans", function(require, exports, module, __filename, __dirname) { void 0/*require('./dist/marketsans/marketsans.css')*/;
});
$_mod.installed("ebayui-inception$10.1.1", "cookies-browser", "0.0.2");
$_mod.main("/cookies-browser$0.0.2", "");
$_mod.def("/cookies-browser$0.0.2/index", function(require, exports, module, __filename, __dirname) { 
/**
* Reads and writes cookies for Marketplace domain page.
* <p>
* Note: This class is only used for eBay site.
*
*/

'use strict';

var DEFAULT_COOKIE_FORMAT = {
  "COOKIELET_DELIMITER": "^",
  "NAME_VALUE_DELIMITER": "/",
  "escapedValue": true
},
  DP_COOKIE_FORMAT = { // FORMAT: delim-persist
  "COOKIELET_DELIMITER": "^",
  "NAME_VALUE_DELIMITER": "/",
  "bUseExp": true,
  "startDelim": "b"
},
  SESSION_COOKIE_FORMAT = { // FORMAT: delimited
  "COOKIELET_DELIMITER": "^",
  "NAME_VALUE_DELIMITER": "=",
  "escapedValue": true,
  "startDelim": "^"
},
  DS_COOKIE_FORMAT = { // FORMAT: delim-session
  "COOKIELET_DELIMITER": "^",
  "NAME_VALUE_DELIMITER": "/"
},
  sPath = "/",
  aConversionMap = {
  'reg': ['dp1', 'reg'],
  'recent_vi': ['ebay', 'lvmn'],
  'ebaysignin': ['ebay', 'sin'],
  'p': ['dp1', 'p'],
  'etfc': ['dp1', 'etfc'],
  'keepmesignin': ['dp1', 'kms'],
  'ItemList': ['ebay', 'wl'],
  'BackToList': ['s', 'BIBO_BACK_TO_LIST']
},
  aFormatMap = {
  'r': DEFAULT_COOKIE_FORMAT,
  'dp1': DP_COOKIE_FORMAT,
  'npii': DP_COOKIE_FORMAT,
  'ebay': SESSION_COOKIE_FORMAT,
  'reg': SESSION_COOKIE_FORMAT,
  'apcCookies': SESSION_COOKIE_FORMAT,
  'ds2': DS_COOKIE_FORMAT
},
  sCOMPAT = "10",
  sCONVER = "01",
  sSTRICT = "00",
  sModesCookie = "ebay",
  sModesCookielet = "cv";

var api = {
  /**
  * Gets the value of the given cookielet from a specified cookie.
  *
  * @param {String} cookie
  *        a string name of the cookie
  * @param {String} cookielet
  *        a string name of the cookielet in the specified cookie
  * @return {String}
  *        the value of the cookielet
  */
  //>public String readCookie(String,String);
  readCookie: function readCookie(psCookie, psCookielet) {
      var rv = this.readCookieObj(psCookie, psCookielet).value;
      return rv ? decodeURIComponent(rv) : "";
  },

  //>private Object createDefaultCookieBean(String, String);
  createDefaultCookieBean: function createDefaultCookieBean(psCookie, psCookielet) {
      // define cookie bean
      var cookie = {};
      // string
      cookie.name = psCookie;
      // string
      cookie.cookieletname = psCookielet;
      // string
      cookie.value = "";
      // date in millisecs UTC
      cookie.maxage = 0;
      cookie.rawcookievalue = "";
      cookie.mode = "";
      return cookie;
  },

  // TODO make internal method to return cookie object readCookieObj
  //> private String readCookieObj(String,String);
  readCookieObj: function readCookieObj(psCookie, psCookielet) {
      var cookie = this.createDefaultCookieBean(psCookie, psCookielet);
      this.update();
      this.checkConversionMap(cookie);

      // returns the raw value of the cookie from document.cookie
      // raw value
      cookie.rawcookievalue = this.aCookies[cookie.name];

      // TODO - determine why this is required
      if (!cookie.name || !cookie.rawcookievalue) {
          cookie.value = "";
      } else if (!cookie.cookieletname) {
          // read cookie
          this.readCookieInternal(cookie);
      } else {
          // read cookielet
          this.readCookieletInternal(cookie);
      }

      // Check cookie corruption

      var guid = psCookielet && psCookielet.match(/guid$/);
      var object = typeof cookie !== 'undefined' ? cookie : '';

      var corrupted = object && guid && cookie.value.length > 32;
      if (corrupted) {
          cookie.value = cookie.value.substring(0, 32);
      }

      return object;
  },

  //> private void checkConversionMap(Object);
  checkConversionMap: function checkConversionMap(cookie) {
      //Check conversion map
      // 2 values returned - 2 values cookie + cookielet
      var cmap = aConversionMap[cookie.name];

      // if cookielet is in conversio map then do the following
      // reset cookie and cookielet names to old namesl
      /*
              raw cookies are being converted to cookielets
              this takes care of the moving cookies to cookielets
      */

      if (cmap) {
          // compatibility mode
          cookie.mode = this.getMode(cookie.name);
          cookie.name = cmap[0];
          cookie.cookieletname = cmap[1];
      }
  },

  //> private Object readCookieInternal(Object);
  readCookieInternal: function readCookieInternal(cookie) {
      // read raw cookie with compatibility modes to switch between raw cookie and cookielets
      cookie.value = cookie.rawcookievalue;
      return cookie;
  },

  //> private Object readCookieletInternal(Object);
  readCookieletInternal: function readCookieletInternal(cookie) {
      var clet = this.getCookielet(cookie.name, cookie.cookieletname, cookie.rawcookievalue);
      // handling formats of cookielets mentiond in aFormatMap
      var format = this.getFormat(cookie.name);
      if (clet && format.bUseExp) {
          //do not expire cookie on client
          var cletOrig = clet;
          clet = clet.substring(0, clet.length - 8);
          if (cletOrig.length > 8) {
              cookie.maxage = cletOrig.substring(cletOrig.length - 8);
          }
      }

      // All other modes and if mode is not available
      cookie.value = clet;
      // COMPAT mode
      if (cookie.mode == sCOMPAT) {
          // jshint ignore:line
          cookie.value = cookie.rawcookievalue;
      }
      return cookie;
  },

  /**
  * Gets multiple values from a cookielet. This function splits a cookielet
  * value by predefined delimiter and construct an array stores each value.
  *
  * @param {String} cookie
  *        a string name of the cookie
  * @param {String} cookielet
  *        a string name of the cookielet in the specified cookie
  * @return {Object}
  *        an array that stores the multiples value
  */
  //> public Object readMultiLineCookie(String,String);
  readMultiLineCookie: function readMultiLineCookie(psCookie, psCookielet) {
      // jshint ignore:line
      //this.update();
      if (!psCookie || !psCookielet) {
          return "";
      }
      var val,
          r = "";
      var cmap = aConversionMap[psCookie];
      if (cmap) {
          val = this.readCookieObj(cmap[0], cmap[1]).value || "";
      }
      if (val) {
          r = this.getCookielet(psCookie, psCookielet, val) || "";
      }
      return typeof r !== "undefined" ? r : "";
  },

  /**
  * Writes a value String to a given cookie. This function requires setting
  * an exact expire date. You can use {@link writeCookieEx} instead to set
  * the days that the cookie will be avaliable.
  *
  * @param {String} cookie
  *        a string name of the cookie to be written
  * @param {String} value
  *        a string value to be written in cookie
  * @param {String} exp
  *        an exact expired date of the cookie
  * @see #writeCookieEx
  */
  //> public void writeCookie(String,String,String);
  //> public void writeCookie(String,String,int);
  writeCookie: function writeCookie(psCookie, psVal, psExp) {
      //@param    pbSecure - secured? (optional)
      //Check conversion map
      var cmap = aConversionMap[psCookie];
      if (cmap) {
          this.writeCookielet(cmap[0], cmap[1], psVal, psExp);
          return;
      }
      var format = this.getFormat(psCookie);
      if (psVal && format.escapedValue) {
          psVal = encodeURIComponent(psVal);
      }
      this.writeRawCookie(psCookie, psVal, psExp);
  },

  //> private void writeRawCookie(String, String, String);
  //> private void writeRawCookie(String, String, int);
  writeRawCookie: function writeRawCookie(psCookie, psVal, psExp) {
      // jshint ignore:line
      if (psCookie && psVal !== undefined) {
          //    Uncomment secure related lines below and
          //    add to param list if it is being used
          //    var secure = pbSecure?"true":"";
          //    check for size limit
          if (isNaN(psVal) && psVal.length < 4000 || (psVal + '').length < 4000) {
              if (typeof psExp === 'number') {
                  psExp = this.getExpDate(psExp);
              }
              var expDate = psExp ? new Date(psExp) : new Date(this.getExpDate(730));
              var format = this.getFormat(psCookie);
              //TODO: refactor domain logic before E513
              var sHost = this.sCookieDomain;
              var dd = document.domain;
              //if (!dd.has(sHost)) {
              if (dd.indexOf(sHost) === -1) {
                  var index = dd.indexOf('.ebay.');
                  if (index > 0) {
                      // jshint ignore:line
                      this.sCookieDomain = dd.substring(index);
                  }
              }
              //Added check before writing the cookie
              if (document.cookie) {
                  document.cookie = psCookie + "=" + (psVal || "") + (psExp || format.bUseExp ? "; expires=" + expDate.toGMTString() : "") + "; domain=" + this.sCookieDomain + "; path=" + sPath;
                  //        "; secure=" + secure;
              }
          }
      }
  },

  /**
  * Writes a value String to a given cookie. You can put the days to expired
  * this cookie from the current time.
  *
  * @param {String} cookie
  *        a string name of the cookie to be written
  * @param {String} value
  *        a string value to be written in cookie
  * @param {int} expDays
  *        the number of days that represents how long the cookie will be
  *        expired
  * @see #writeCookie
  */
  //>public void writeCookieEx(String,String,int);
  writeCookieEx: function writeCookieEx(psCookie, psVal, piDays) {
      this.writeCookie(psCookie, psVal, this.getExpDate(piDays));
  },

  /**
  * Writes value to cookielet. You can use {@link writeMultiLineCookie} for
  * some multi-level cookielet.
  *
  * @param {String} cookie
  *        the name of the specified cookie which contains the cookielet to be
  *        write
  * @param {String} cookielet
  *        the name of the cookielet to be write
  * @param {String} val
  *        the value of the cookielet
  * @param {String} exp
  *        an expired date of the cookielet
  * @param {String} contExp
  *        an expired date of the cookie
  * @see #writeMultiLineCookie
  */
  //> public void writeCookielet(String,String,String,{int|String}?,{int|String}?);
  writeCookielet: function writeCookielet(psCookie, psCookielet, psVal, psExp, psContExp) {
      // jshint ignore:line
      //@param    pSec - secured? (optional)
      if (psCookie && psCookielet) {
          this.update();
          var format = this.getFormat(psCookie);
          if (format.bUseExp && psVal) {
              //Set the default exp date to 2 yrs from now
              if (typeof psExp === 'number') {
                  psExp = this.getExpDate(psExp);
              }
              var expDate = psExp ? new Date(psExp) : new Date(this.getExpDate(730)); //<Date
              var expDateUTC = Date.UTC(expDate.getUTCFullYear(), expDate.getUTCMonth(), expDate.getUTCDate(), expDate.getUTCHours(), expDate.getUTCMinutes(), expDate.getUTCSeconds()); // jshint ignore:line
              expDateUTC = Math.floor(expDateUTC / 1000);
              //psVal += expDateUTC.dec2Hex();
              psVal += parseInt(expDateUTC, 10).toString(16);
          }
          var val = this.createCookieValue(psCookie, psCookielet, psVal);
          this.writeRawCookie(psCookie, val, psContExp);
      }
  },

  /**
  * Writes value to some multi-level cookielet. Some cookielet contains sub
  * level, and you can use the name of the cookielet as cookie name and write
  * its sub level value.
  * These cookielet includes:
  * <p>
  * <pre>
  * Name as Cookie | name in cookielet         | upper level cookie
  * -------------- |---------------------------|----------------------
  * reg            | reg                       | dp1
  * recent_vi      | lvmn                      | ebay
  * ebaysignin     | sin                       | ebay
  * p              | p                         | dp1
  * etfc           | etfc                      | dp1
  * keepmesignin   | kms                       | dp1
  * BackToList     | BIBO_BACK_TO_LIST         | s
  * reg            | reg                       | dp1
  * </pre>
  * <p>
  * you need to use {@link writeCookielet} for other cookielet.
  *
  * @param {String} cookie
  *        the name of the specified cookie which contains the cookielet to be write
  * @param {String} cookielet
  *        the mame of the cookielet to be write
  * @param {String} val
  *        the value of the cookielet
  * @param {String} exp
  *        an expired date of the cookielet
  * @param {String} contExp
  *        an expired date of the cookie
  * @see #writeCookielet
  */
  //> public void writeMultiLineCookie(String,String,String,String,String);
  writeMultiLineCookie: function writeMultiLineCookie(psCookie, psCookielet, psVal, psExp, psContExp) {
      // jshint ignore:line
      this.update();
      var val = this.createCookieValue(psCookie, psCookielet, psVal);
      if (val) {
          var cmap = aConversionMap[psCookie];
          if (cmap) {
              this.writeCookielet(cmap[0], cmap[1], val, psExp, psContExp);
          }
      }
  },

  /**
  * Gets the bit flag value at a particular position.This function is
  * deprecated, use {@link #getBitFlag} instead.
  *
  * @deprecated
  * @param {String} dec
  *        a bit string that contains series of flags
  * @param {int} pos
  *        the flag position in the bit string
  * @return {int}
  *        the flag value
  * @see #getBitFlag
  */
  //> public int getBitFlagOldVersion(String, int);
  getBitFlagOldVersion: function getBitFlagOldVersion(piDec, piPos) {
      //converting to dec
      var dec = parseInt(piDec, 10); //<Number
      //getting binary value //getting char at position
      var b = dec.toString(2),
          r = dec ? b.charAt(b.length - piPos - 1) : "";
      return r == "1" ? 1 : 0; // jshint ignore:line
  },

  /**
  * Sets the bit flag at a particular position. This function is deprecated,
  * use {@link #setBitFlag} instead.
  *
  * @deprecated
  * @param {String} dec
  *        a bit string contains series of flags
  * @param {int} pos
  *        the flag position in the bit string
  * @param {int} val
  *        the flag value to be set. Flag will be set as 1 only if the value of
  *        this parameter is 1
  * @see #setBitFlag
  */
  //> public int setBitFlagOldVersion(int, int, int);
  setBitFlagOldVersion: function setBitFlagOldVersion(piDec, piPos, piVal) {
      var b = "",
          p,
          i,
          e,
          l;
      //converting to dec
      piDec = parseInt(piDec + "", 10);
      if (piDec) {
          //getting binary value
          b = piDec.toString(2);
      }
      l = b.length;
      if (l < piPos) {
          e = piPos - l;
          for (i = 0; i <= e; i++) {
              b = "0" + b;
          }
      }
      //finding position
      p = b.length - piPos - 1;
      //replacing value at pPos with pVal and converting back to decimal
      return parseInt(b.substring(0, p) + piVal + b.substring(p + 1), 2);
  },

  /**
  * Gets the bit flag value at a particular position.
  *
  * @param {String} dec
  *        a bit string which contains series of flags
  * @param {int} pos
  *        the flag position in the bit string
  * @return {int}
  *        the flag value
  */
  //> public int getBitFlag(String,int);
  getBitFlag: function getBitFlag(piDec, piPos) {

      if (piDec !== null && piDec.length > 0 && piDec.charAt(0) === '#') {
          var length = piDec.length;
          var q = piPos % 4;
          var hexPosition = Math.floor(piPos / 4) + 1;

          var absHexPosition = length - hexPosition;
          var hexValue = parseInt(piDec.substring(absHexPosition, absHexPosition + 1), 16);
          var hexFlag = 1 << q;

          return (hexValue & hexFlag) == hexFlag ? 1 : 0; // jshint ignore:line
      } else {
          //process by old format
          return this.getBitFlagOldVersion(piDec, piPos);
      }
  },

  /**
  * Set the bit flag at a particular position.
  *
  * @param {String} dec
  *        A bit string that contains series of flags
  * @param {int} pos
  *        the flag position in the bit string
  * @param {int} val
  *        the falg value to be set. Flag will be set as 1 only if the value of
  *        this parameter is 1.
  */
  //> public int setBitFlag(String,int,int);
  //> public int setBitFlag(int,int,int);
  setBitFlag: function setBitFlag(piDec, piPos, piVal) {
      // jshint ignore:line

      if (piDec !== null && piDec.length > 0 && piDec.charAt(0) === '#') {
          //process by new format
          var length = piDec.length;
          var q = piPos % 4;
          var hexPosition = Math.floor(piPos / 4) + 1;

          if (length <= hexPosition) {
              if (piVal != 1) {
                  // jshint ignore:line
                  return piDec;
              }

              var zeroCout = hexPosition - length + 1;
              var tmpString = piDec.substring(1, length);
              while (zeroCout > 0) {
                  tmpString = '0' + tmpString;
                  zeroCout--;
              }

              piDec = '#' + tmpString;
              length = piDec.length;
          }

          var absHexPosition = length - hexPosition;
          var hexValue = parseInt(piDec.substring(absHexPosition, absHexPosition + 1), 16);
          var hexFlag = 1 << q;

          if (piVal == 1) // jshint ignore:line
              {
                  hexValue |= hexFlag;
              } else {
              hexValue &= ~hexFlag;
          }

          piDec = piDec.substring(0, absHexPosition) + hexValue.toString(16) + piDec.substring(absHexPosition + 1, length); // jshint ignore:line

          return piDec;
      } else {
          if (piPos > 31) {
              return piDec;
          }
          //process by old format
          return this.setBitFlagOldVersion(piDec, piPos, piVal);
      }
  },

  //> private String  createCookieValue (String, String, String);
  createCookieValue: function createCookieValue(psName, psKey, psVal) {
      // jshint ignore:line
      var cmap = aConversionMap[psName],
          format = this.getFormat(psName),
          mode = this.getMode(psName),
          val;
      if (cmap && (mode == sSTRICT || mode == sCONVER)) {
          // jshint ignore:line
          val = this.readCookieObj(cmap[0], cmap[1]).value || "";
      } else {
          val = this.aCookies[psName] || "";
      }

      if (format) {
          var clts = this.getCookieletArray(val, format);
          clts[psKey] = psVal;
          var str = "";
          for (var i in clts) {
              if (clts.hasOwnProperty(i)) {
                  str += i + format.NAME_VALUE_DELIMITER + clts[i] + format.COOKIELET_DELIMITER;
              }
          }

          if (str && format.startDelim) {
              str = format.startDelim + str;
          }
          val = str;

          if (format.escapedValue) {
              val = encodeURIComponent(val);
          }
      }

      return val;
  },

  //> private void update();
  update: function update() {
      //store cookie values
      var aC = document.cookie.split("; ");
      this.aCookies = {};
      var regE = new RegExp('^"(.*)"$');
      for (var i = 0; i < aC.length; i++) {
          var sC = aC[i].split("=");

          var format = this.getFormat(sC[0]),
              cv = sC[1],
              sd = format.startDelim;
          if (sd && cv && cv.indexOf(sd) === 0) {
              sC[1] = cv.substring(sd.length, cv.length);
          }
          // check if the value is enclosed in double-quotes, then strip them
          if (sC[1] && sC[1].match(regE)) {
              sC[1] = sC[1].substring(1, sC[1].length - 1);
          }
          this.aCookies[sC[0]] = sC[1];
      }
  },

  //> private String getCookielet(String, String, String);
  getCookielet: function getCookielet(psCookie, psCookielet, psVal) {
      var format = this.getFormat(psCookie);
      var clts = this.getCookieletArray(psVal, format);
      return clts[psCookielet] || "";
  },

  //> private Object getFormat(String);
  getFormat: function getFormat(psCookie) {
      return aFormatMap[psCookie] || DEFAULT_COOKIE_FORMAT;
  },

  //> private Object getCookieletArray(String, Object);
  getCookieletArray: function getCookieletArray(psVal, poFormat) {
      var rv = [],
          val = psVal || "";
      if (poFormat.escapedValue) {
          val = decodeURIComponent(val);
      }
      var a = val.split(poFormat.COOKIELET_DELIMITER);
      for (var i = 0; i < a.length; i++) {
          //create cookielet array
          var idx = a[i].indexOf(poFormat.NAME_VALUE_DELIMITER);
          if (idx > 0) {
              rv[a[i].substring(0, idx)] = a[i].substring(idx + 1);
          }
      }
      return rv;
  },

  /**
  * Gets the date behind a given days from current date. This is used to set
  * the valid time when writing the cookie.
  *
  * @param {int} days
  *        the number of days that cookie is valid
  * @return {String}
  *        the expiration date in GMT format
  */
  //> public String getExpDate(int);
  getExpDate: function getExpDate(piDays) {
      var expires;
      if (typeof piDays === "number" && piDays >= 0) {
          var d = new Date();
          d.setTime(d.getTime() + piDays * 24 * 60 * 60 * 1000);
          expires = d.toGMTString();
      }
      return expires;
  },

  //> private Object getMode(String);
  getMode: function getMode(psCookie) {
      // jshint ignore:line
      var h = this.readCookieObj(sModesCookie, sModesCookielet).value,
          b,
          i;
      if (!(psCookie in aConversionMap)) {
          return null;
      }
      if (!h) {
          return "";
      }
      //default mode is STRICT when h is "0"
      if (h === 0) {
          return sSTRICT;
      }

      if (h && h != "0") {
          // jshint ignore:line
          //checking for h is having "." or not
          //if (h.has(".")){
          if (h.indexOf(".") !== -1) {
              //conversion cookie is having more than 15 cookie values
              var a = h.split(".");
              //looping through array
              for (i = 0; i < a.length; i++) {
                  //taking the first hex nubmer and converting to decimal
                  //and converting to binary
                  b = parseInt(a[i], 16).toString(2) + b;
              }
          } else {
              //converting to decimal
              //converting to binary number
              b = parseInt(h, 16).toString(2);
          }
          //fill the convArray with appropriate mode values
          i = 0;
          //getting total binary string length
          var l = b.length,
              j;
          //looping through each cookie and filling mode of the cookie
          for (var o in aConversionMap) {
              //find the position to read
              j = l - 2 * (i + 1);
              //reading backwards 2 digits at a time
              var f = b.substring(j, j + 2).toString(10);
              f = !f ? sSTRICT : f;
              if (psCookie == o) // jshint ignore:line
                  {
                      return f.length === 1 ? "0" + f : f;
                  }
              i++;
          }
          return null;
      }

      return null;
  },

  getMulti: function getMulti(piDec, piPos, piBits) {
      var r = "",
          i,
          _this = this;
      for (i = 0; i < piBits; i++) {
          r = _this.getBitFlag(piDec, piPos + i) + r;
      }
      return parseInt(r, 2);
  },

  setMulti: function setMulti(piDec, piPos, piBits, piVal) {
      var i = 0,
          _this = this,
          v,
          l,
          e;
      //convert to binary and take piBits out of it
      v = piVal.toString(2).substring(0, piBits);
      l = v.length;
      if (l < piBits) {
          e = piBits - l;
          for (var j = 0; j < e; j++) {
              v = "0" + v;
          }
          l = l + e;
      }
      for (i = 0; i < l; i++) {
          piDec = _this.setBitFlag(piDec, piPos + i, v.substring(l - i - 1, l - i));
      }
      return piDec;
  },

  setJsCookie: function setJsCookie() {
      this.writeCookielet('ebay', 'js', '1');
  }

};

function eventInit() {
  var callback = function callback() {
      api.setJsCookie();
  };

  if (window.addEventListener) {
      window.addEventListener('beforeunload', callback);
  } else if (window.attachEvent) {
      window.attachEvent('onbeforeunload', callback);
  }

  if (typeof jQuery !== 'undefined' && typeof $ !== 'undefined') {
      $(document).bind("ajaxSend", callback);
  }
}

// Initialize the events
eventInit();

// expose the API in windows for core platform services - Tracking & EP
window['cookies-browser'] = api;

// expose the API as CommonJS module
module.exports = api;
});
$_mod.run("/cookies-browser$0.0.2/index");
$_mod.installed("site-speed-ebay$5.4.3", "cookies-browser", "0.0.2");
$_mod.installed("site-speed-ebay$5.4.3", "core-site-speed-ebay", "1.0.14");
$_mod.main("/core-site-speed-ebay$1.0.14", "SiteSpeed");
$_mod.def("/core-site-speed-ebay$1.0.14/SiteSpeed", function(require, exports, module, __filename, __dirname) { module.exports = function (gaugeInfo, Uri, ebayCookies, metrics) {
  // jshint ignore:line 

  /*
  * Context of Site Speed:
  *   context: {
  *     gaugeInfo: <gaugeInfo>,
  *     beacon: <beacon uri>,
  *     cookies: <cookies>
  *   }
  *
  * Interface Spec:
  *  beacon should contain APIs:
  *    - function add(beacon, value) {...}
  *    - function remove(beacon) {...}
  *    - function getUrl() {...; return <url>; }
  *
  *  cookies should contain APIs:
  *    - function readCookie(cookie, cookielet) {...; return <value of cookielet>;}
  *    - function writeCookielet(cookie, cookielet, value) {...}
  *    - function getBitFlag(bits, position) {...; return <value of positioned bit>;}
  *    - function setBitFlag(bits, position, 1|0) {...}
  *
  *  errors should contain APIs:
  *    - function init() {...}
  *    - function getLength() {...; return <length of errors>;}
  *    - function getString() {...; return <error strings>;}
  *
  *  metrics should contain APIs:
  *    - function getEntries() {...; return <[{'key':<key>,'value':<value>},...] of metrics>;}
  *
  */

  function SiteSpeed(context) {

      function getResourceTimingTag() {

          var validInitiators = { 'all': 1, 'link': 2, 'script': 3, 'img': 4, 'css': 5, 'iframe': 6, 'object': 7, 'embed': 8, 'svg': 9, 'xmlhttprequest': 10 };

          function isValidInitiator(initiator) {
              return validInitiators.hasOwnProperty(initiator);
          }
          function sort(ranges) {
              if (!ranges) {
                  return [];
              }
              ranges.sort(function (a, b) {
                  var a_start = a[0],
                      a_end = a[1];
                  var b_start = b[0],
                      b_end = b[1];
                  return a_start == b_start ? a_end == b_end ? 0 : a_end < b_end ? -1 : 1 : a_start < b_start ? -1 : 1;
              });
              return ranges;
          }
          // Parameter ranges is a sorted range array: [[start, end], ... ]
          // Return startOffset_range_duration
          // startOffset is the minimum start of the ranges.
          // duration is 'maximum end' - 'minimum start' of the ranges.
          // range is all the ranges which remove the overlaps and gaps
          // for more refer
          function join(ranges) {
              function overlap(a, b) {
                  var left = Math.max(a[0], b[0]);
                  var right = Math.min(a[1], b[1]);
                  return left <= right ? true : false;
              }
              if (!ranges || ranges.length == 0) {
                  return '';
              }
              var range = 0;
              var current = [ranges[0][0], ranges[0][1]];
              var startOffset = ranges[0][0];
              var maxEnd = ranges[0][1];
              for (var i = 1; i < ranges.length; i++) {
                  var target = ranges[i];
                  maxEnd = Math.max(maxEnd, target[1]);
                  if (overlap(current, target)) {
                      current[1] = Math.max(current[1], target[1]);
                  } else {
                      range += current[1] - current[0];
                      current = [target[0], target[1]];
                  }
              }
              range += current[1] - current[0];
              //startOffset_range_duration
              return startOffset.toFixed(0) + '_' + range.toFixed(0) + '_' + (maxEnd - startOffset).toFixed(0);
          }

          //ignore if browser does not support resource timing API
          var performance = getPerformance();
          if (!performance || !('getEntriesByType' in performance) || !(performance.getEntriesByType('resource') instanceof Array)) {
              return '';
          }

          var entries = performance.getEntriesByType('resource');

          if (!entries) {
              return '';
          }
          var allHosts = {};
          var ebayHosts = {};
          var nonEbayHosts = {};
          var hosts = {};
          entries.forEach(function (entry, i) {
              var requestStart = entry.requestStart;
              //cross domain case, use fetchStart instead
              if (!requestStart) {
                  requestStart = entry.fetchStart;
              }

              //ignore not valid hostname case
              if (entry.name.indexOf("http://") != 0 && entry.name.indexOf("https://") != 0) return;

              var host = entry.name.split('/')[2];
              var theInitiatorType = entry.initiatorType;
              //work around since notice that firefox use 'subdocument' instead of 'iframe'
              if (theInitiatorType === 'subdocument') {
                  theInitiatorType = 'iframe';
              }

              //validate initiator type and range
              if (!isValidInitiator(theInitiatorType) || requestStart > entry.responseEnd) {
                  return;
              }

              // add to specific host case
              hosts[host] = hosts[host] || {};
              hosts[host][theInitiatorType] = hosts[host][theInitiatorType] || [];
              hosts[host][theInitiatorType].push([requestStart, entry.responseEnd]);
              hosts[host]['all'] = hosts[host]['all'] || [];
              hosts[host]['all'].push([requestStart, entry.responseEnd]);
              //  add to all hosts case
              allHosts[theInitiatorType] = allHosts[theInitiatorType] || [];
              allHosts[theInitiatorType].push([requestStart, entry.responseEnd]);
              allHosts['all'] = allHosts['all'] || [];
              allHosts['all'].push([requestStart, entry.responseEnd]);
              if (host.indexOf('ebay') > -1) {
                  ebayHosts[theInitiatorType] = ebayHosts[theInitiatorType] || [];
                  ebayHosts[theInitiatorType].push([requestStart, entry.responseEnd]);
                  ebayHosts['all'] = ebayHosts['all'] || [];
                  ebayHosts['all'].push([requestStart, entry.responseEnd]);
              } else {
                  nonEbayHosts[theInitiatorType] = nonEbayHosts[theInitiatorType] || [];
                  nonEbayHosts[theInitiatorType].push([requestStart, entry.responseEnd]);
                  nonEbayHosts['all'] = nonEbayHosts['all'] || [];
                  nonEbayHosts['all'].push([requestStart, entry.responseEnd]);
              }
          });

          var rsTimingTag = '';
          // generate beacon url for fixed part: nonEbayHosts, ebayHosts and allHosts
          [['nonebay', nonEbayHosts], ['ebay', ebayHosts], ['*', allHosts]].forEach(function (entry, i) {
              if (rsTimingTag) rsTimingTag += '!';
              rsTimingTag += entry[0];

              Object.keys(validInitiators).forEach(function (initiator, initiatorIndex) {
                  rsTimingTag += '~' + join(sort(entry[1][initiator]));
              });
          });
          // generate beacon url for all individual hosts
          Object.keys(hosts).forEach(function (host, i) {
              rsTimingTag += '!' + host;

              Object.keys(validInitiators).forEach(function (initiator, initiatorIndex) {
                  rsTimingTag += '~' + join(sort(hosts[host][initiator]));
              });
          });
          return rsTimingTag;
      }

      //Get 'window.performance.timing'
      function getTiming() {
          var performance = getPerformance();
          return performance ? performance.timing : 'undefined';
      }

      //Get 'window.performance'
      function getPerformance() {
          return window.performance || window.msPerformance || window.webkitPerformance || window.mozPerformance;
      }

      this.init = function () {

          // 1. initialize gaugeInfo: ut, bf, sent, ld, wt, ex3, ct21
          var gaugeInfo = context.gaugeInfo;
          if (typeof gaugeInfo != 'undefined') {
              var bf = 0;
              var ut = null;
              var cookies = context.cookies;
              if (cookies) {
                  var sbf = cookies.readCookie("ebay", "sbf");
                  if (sbf) {
                      bf = cookies.getBitFlag(sbf, 20);
                  }
                  if (!bf) {
                      cookies.writeCookielet("ebay", "sbf", cookies.setBitFlag(sbf, 20, 1));
                  }
                  ut = cookies.readCookie('ds2', 'ssts');
              }
              gaugeInfo.ut = ut;
              gaugeInfo.bf = bf;
              gaugeInfo.sent = false;
              gaugeInfo.ld = false;
              gaugeInfo.wt = 0;
              gaugeInfo.ex3 = 0;
              gaugeInfo.ct21 = 0;
              if (typeof gaugeInfo.iLoadST == 'undefined') {
                  gaugeInfo.iLoadST = Date.now();
              }

              var errors = context.errors;
              if (errors) {
                  errors.init();
              }

              // initialize resource timing buffer size
              var performance = getPerformance();
              if (gaugeInfo.bRsTiming && 'getEntriesByType' in performance) {
                  performance.setResourceTimingBufferSize = performance.setResourceTimingBufferSize || performance.webkitSetResourceTimingBufferSize || performance.mozSetResourceTimingBufferSize || performance.msSetResourceTimingBufferSize || performance.oSetResourceTimingBufferSize || performance.webkitSetResourceTimingBufferSize;
                  if (typeof performance.setResourceTimingBufferSize === "function") {
                      performance.setResourceTimingBufferSize(300); //expand the buffer to 300
                  }
              }
          }
      };

      this.onLoad = function () {

          // 1. initialize gaugeInfo: ld, wt, ex3, ct21, jseaa, jseap, ct1chnk, jsljgr3, svo, jsljgr1, slo, ua
          // 2. send beacon if browser is ff, Safari or Chrome
          var gaugeInfo = context.gaugeInfo;
          if (typeof gaugeInfo != 'undefined') {
              var cookies = context.cookies;
              if (cookies) {
                  var sbf = cookies.readCookie('ebay', 'sbf');
                  if (sbf) {
                      cookies.writeCookielet('ebay', 'sbf', cookies.setBitFlag(sbf, 20, 1));
                  }
              }

              gaugeInfo.ld = true;

              var now = Date.now();
              gaugeInfo.wt = now;
              gaugeInfo.ex3 = now;
              gaugeInfo.ct21 = now - gaugeInfo.iST;

              var timing = getTiming();
              var beacon = context.beacon;
              if (timing) {
                  beacon.add('ex3', now - timing.navigationStart); // end to end at client, also log to cal tx
                  beacon.add('jseaa', now - timing.responseStart); // client rendering = ct21, was ctidl before
                  beacon.add('jseap', timing.responseStart - timing.navigationStart); // first byte time (jsebca before not in batch)
                  beacon.add('ct1chnk', timing.domComplete - timing.responseStart); // dom complete
                  beacon.add('jsljgr3', timing.domainLookupEnd - timing.domainLookupStart); // dns lookup time
                  beacon.add('svo', timing.connectEnd - timing.connectStart); // connection time, also log to cal tx
                  beacon.add('jsljgr1', timing.responseStart - timing.requestStart); // request time
                  beacon.add('slo', timing.responseEnd - timing.responseStart); // content download time

                  // SSL negotiation time
                  if (timing.secureConnectionStart) {
                      var i_ssl = timing.connectEnd - timing.secureConnectionStart;
                      if (i_ssl > 0) {
                          beacon.add('i_ssl', i_ssl);
                      }
                  }
              }

              beacon.add('dcon', document.getElementsByTagName("*").length); // DOM count onload
              beacon.add('fsom', gaugeInfo.fsom ? 'y' : 'n'); // value from `_fsom` cookie (when available)

              // Adding signals by type
              var performance = getPerformance();
              if (performance && 'getEntriesByType' in performance) {
                  // Observer - longtask
                  var o_lt = 0,
                      o_ltn = '',
                      o_ltu = '',
                      o_cls = 0,
                      o_lcp = 0,
                      observerLongtask = new PerformanceObserver(function (list) {
                      var perfEntries = list.getEntries();
                      if (window.__tti && window.__tti.e) {
                          window.__tti.e = window.__tti.e.concat(perfEntries);
                      } else {
                          window.__tti = { e: [].concat(perfEntries) };
                      }
                      perfEntries.forEach(function (perfEntry) {
                          if (perfEntry && perfEntry.duration && perfEntry.duration > o_lt) {
                              o_lt = Math.round(perfEntry.duration);
                              o_ltn = perfEntry.name;
                              o_ltu = perfEntry.attribution && perfEntry.attribution[0] && perfEntry.attribution[0].containerSrc;
                          }
                      });
                      beacon.add('o_lt', o_lt); // Observer Longest Longtask
                      beacon.add('o_ltn', o_ltn); // Observer Longest Longtask Name
                      beacon.add('o_ltu', o_ltu); // Observer Longest Longtask URL
                      beacon.add('o_ltc', window.__tti.e.length || 0); // Observer Longtask Counter
                      beacon.add('dcpon', document.getElementsByTagName("*").length); // DOM count post onload II
                  }),
                      observerFirstInput = new PerformanceObserver(function (list) {
                      list.getEntries().forEach(function (entry) {
                          beacon.add('o_fid', entry.processingStart - entry.startTime); // Observer First Input Delay
                      });
                  }),
                      observerLayoutShift = new PerformanceObserver(function (list) {
                      list.getEntries().forEach(function (entry) {
                          if (!entry.hadRecentInput) {
                              o_cls += entry.value;
                              beacon.add('o_cls', o_cls); // Observer Cumulative Layout Shift
                          }
                      });
                  }),
                      observerLargetsContentfulPaint = new PerformanceObserver(function (list) {
                      list.getEntries().forEach(function (entry) {
                          if (o_lcp < entry.startTime) {
                              o_lcp = entry.startTime;
                              beacon.add('o_lcp', Math.round(o_lcp)); // Observer Largets Contentful Paint
                          }
                      });
                  });

                  try {
                      observerFirstInput.observe({ type: 'first-input', buffered: true });
                      observerLayoutShift.observe({ type: 'layout-shift', buffered: true });
                      observerLongtask.observe({ entryTypes: ['longtask'], buffered: true });
                      observerLargetsContentfulPaint.observe({ type: 'largest-contentful-paint', buffered: true });
                  } catch (e) {
                      // Do nothing if the browser doesn't support this API.
                  }
                  window.setTimeout(function () {
                      // Paint
                      var paintMetrics = performance.getEntriesByType('paint'),
                          firstContentfulPaint = 0;
                      if (paintMetrics !== undefined && paintMetrics.length > 0) {
                          paintMetrics.forEach(function (paintMetric) {
                              // provides first-paint & first-contentful-paint
                              // which will be convert to
                              // i_firstpaint & i_firstcontentfulpaint respectively
                              beacon.add('i_' + paintMetric.name.replace(/\-/g, ''), Math.round(paintMetric.startTime));
                              if (paintMetric.name === 'first-contentful-paint') {
                                  firstContentfulPaint = Math.round(paintMetric.startTime);
                              }
                          });
                      }
                      // Navigation
                      var navMetrics = performance.getEntriesByType('navigation'),
                          navCaptured = navMetrics[navMetrics.length - 1];
                      if (navCaptured) {
                          beacon.add('nvt_dcl', Math.round(navCaptured.domContentLoadedEventEnd - navCaptured.domContentLoadedEventStart)); // DOM content loaded
                          beacon.add('nvt_di', Math.round(navCaptured.domInteractive)); // DOM interactive
                          beacon.add('nvt_dc', Math.round(navCaptured.domComplete)); // DOM complete
                          beacon.add('nvt_oe', Math.round(navCaptured.loadEventEnd - navCaptured.loadEventStart)); // Onload execution
                          beacon.add('nvt_rc', navCaptured.redirectCount || '0'); // Redirect count
                      }

                      if ("ttiPolyfill" in window) {
                          ttiPolyfill.getFirstConsistentlyInteractive().then(function (tti) {
                              beacon.add('o_tti', Math.round(tti)); // Observer Time to Interactive
                              if (window.__tti && window.__tti.e) {
                                  var firstCPUIdle,
                                      longtaskCollection = [];
                                  window.__tti.e.forEach(function (e, i) {
                                      if (e.startTime > firstContentfulPaint && (firstCPUIdle === undefined || e.startTime + e.duration + 50 < firstCPUIdle)) {
                                          firstCPUIdle = e.startTime + e.duration;
                                      }
                                      longtaskCollection.push('s_' + Math.round(e.startTime) + '|t_' + Math.round(e.duration) + '|n_' + e.name + '|u_' + (e.attribution && e.attribution[0] && e.attribution[0].containerSrc));
                                  });
                                  if (firstCPUIdle) {
                                      beacon.add('o_fci', Math.round(firstCPUIdle)); // Observer First CPU Idle
                                  }
                                  if (longtaskCollection.length > 0) {
                                      beacon.add('o_lcd', longtaskCollection.join(',')); // Observer Longtask Collection Details
                                  }
                              }
                          });
                      }
                  }, 1);
              }

              var defer = 0;
              if (gaugeInfo.deferExecInMs) {
                  defer = gaugeInfo.deferExecInMs;
              }

              // lock down resource timing buffer size upon onload event
              var performance = getPerformance();
              if (gaugeInfo.bRsTiming && 'getEntriesByType' in performance) {
                  performance.setResourceTimingBufferSize = performance.setResourceTimingBufferSize || performance.webkitSetResourceTimingBufferSize || performance.mozSetResourceTimingBufferSize || performance.msSetResourceTimingBufferSize || performance.oSetResourceTimingBufferSize || performance.webkitSetResourceTimingBufferSize;
                  if (typeof performance.setResourceTimingBufferSize === "function") {
                      var max = performance.getEntriesByType('resource').length;
                      performance.setResourceTimingBufferSize(max - 1 > 0 ? max - 1 : 0);
                  }
              }
              // Fire beacon onload when `_FireBeaconOnload=true`
              if (URLSearchParams && new URLSearchParams(window.location.search).get('_FireBeaconOnload') === 'true') {
                  fireSpeedBeacon = false;
                  this.sendBeacon('onload', false, isSendBeaconAPIAvailable());
              }
              //Mobile Safari does not call beforeunload and pagehide has a bug with sendBeacon API
              // if (isMobileSafari() || ((isSafari() || isFireFox()) && !isSendBeaconAPIAvailable())) { //For old FireFox and current Safari
              // var this_ = this;
              // setTimeout(function () {
              //    this_.sendBeacon('onload', false, isSendBeaconAPIAvailable());
              // }, defer);
              // }
          }
      };

      this.onBeforeunload = function () {

          // 1. write cookie
          // 2. send beacon

          var cookies = context.cookies;
          if (cookies) {
              cookies.writeCookielet("ds2", "ssts", Date.now());
          }

          this.sendBeacon("unload", false, isSendBeaconAPIAvailable());
      };

      this.sendBeacon = function (event, immediate, useSendBeaconAPI) {

          // 1. set params: ex2, ex1, ct21, ctb, st1a, jslcom, jseo, jsllib1, jsllib2, jsllib3, jslpg, jslss, jslsys, sgwt, i_30i, (s_rstm), sgbld, emsg, i_nev2elc
          // 2. send beacons
          var gaugeInfo = context.gaugeInfo;
          if (typeof gaugeInfo == 'undefined' || gaugeInfo.sent == 1) {
              return;
          }

          var beacon = context.beacon;

          if (immediate) {

              if (gaugeInfo.bRsTiming) {
                  var s_rstm = getResourceTimingTag();
                  if (s_rstm) {
                      beacon.add('s_rstm', s_rstm);
                  }
              }

              var errors = context.errors;
              if (errors && errors.getLength()) {
                  beacon.add('sgbld', errors.getLength());
                  beacon.add('emsg', errors.getString());
              }

              var timing = getTiming();
              if (timing) {
                  var i_nve2elc = timing.loadEventEnd - timing.navigationStart;
                  if (i_nve2elc > 0) {
                      beacon.add('i_nve2elc', i_nve2elc);
                  }
              }

              if (gaugeInfo.bf) {
                  beacon.remove('st1');
              }

              var beaconURL = beacon.getUrl();
              if (beaconURL.indexOf('?') < 0) {
                  beaconURL += '?now=' + Date.now();
              }

              var metrics = context.metrics;
              if (metrics) {
                  var entries = metrics.getEntries();
                  for (var index in entries) {
                      beaconURL += '&' + entries[index].key + '=' + entries[index].value;
                  }
              }

              // fire beacon
              if (useSendBeaconAPI) {
                  navigator.sendBeacon(beaconURL);
              } else {
                  new Image().src = beaconURL;
              }

              // mark sent
              gaugeInfo.sent = 1;

              return;
          }

          // earlier exit case
          if (!gaugeInfo.ld) {
              beacon.add('ex2', Date.now() - gaugeInfo.iST);
              this.sendBeacon(event, true, useSendBeaconAPI);
              return;
          }

          if (gaugeInfo.bf) {
              // cached page case
              beacon.add('ex1', '1');
          } else {
              beacon.add('ct21', gaugeInfo.ct21);
              if (gaugeInfo.iLoadST) {
                  beacon.add('ctb', gaugeInfo.iLoadST - gaugeInfo.iST);
              }
              if (gaugeInfo.st1a) {
                  beacon.add('st1a', gaugeInfo.st1a);
              }
              if (gaugeInfo.aChunktimes && gaugeInfo.aChunktimes.length) {
                  // progressive rendering chunks
                  beacon.add('jslcom', gaugeInfo.aChunktimes.length);
                  var chunkTimeParamNames = ["jseo", "jsllib1", "jsllib2", "jsllib3", "jslpg", "jslss", "jslsys"];
                  var chunkTimesLen = gaugeInfo.aChunktimes.length;
                  for (var i = 0, chunkTimeParamName; i < chunkTimesLen; i++) {
                      // jshint ignore:line
                      if (chunkTimeParamName = chunkTimeParamNames[i]) {
                          beacon.add(chunkTimeParamName, gaugeInfo.aChunktimes[i]);
                      }
                  }
              }
          }

          if (event == 'onload') {
              if (gaugeInfo.deferExecInMs > 0) {
                  gaugeInfo.wt = Date.now() - gaugeInfo.wt;
                  beacon.add('sgwt', gaugeInfo.wt);
                  beacon.add('i_30i', gaugeInfo.wt);
              } else {
                  gaugeInfo.wt = 0;
              }
          } else {
              gaugeInfo.wt = Date.now() - gaugeInfo.wt;
              beacon.add('sgwt', gaugeInfo.wt);
          }

          if (gaugeInfo.wt < 60000 * 20) {
              // ignore > 20 min to prevent incorrect st21
              this.sendBeacon(event, true, useSendBeaconAPI);
          }
      };

      // function isMobileSafari() {
      //     return /iP(ad|hone|od).+Version\/[\d\.]+.*Safari/i.test(navigator.userAgent);
      // }

      function isSendBeaconAPIAvailable() {
          return 'sendBeacon' in navigator;
      }

      // function isFireFox() {
      //     return navigator.userAgent.indexOf("Firefox/") > 0;
      // }

      // function isSafari() {
      //     return navigator.userAgent.indexOf("Safari") > 0 && navigator.userAgent.indexOf("Chrome") < 0;
      // }
  }

  var uri = Uri.create(gaugeInfo.sUrl);
  var errors = [];
  var context = {
      gaugeInfo: gaugeInfo,
      cookies: ebayCookies,
      beacon: {
          add: function add(beacon, value) {
              return uri.params[beacon] = value;
          },
          remove: function remove(beacon) {
              delete uri.params[beacon];
          },
          getUrl: function getUrl() {
              for (var ps in uri.params) {
                  if (Array.isArray(uri.params[ps])) {
                      var undefinedIndex = uri.params[ps].indexOf(undefined);
                      if (undefinedIndex > -1) {
                          uri.params[ps].splice(undefinedIndex, 1);
                      }
                  }
              }
              return uri.getUrl();
          }
      },
      errors: {
          init: function init() {
              window.onerror = function (oldHandler, errors) {
                  return function (message, url, lineNumber) {
                      errors.push({ message: message, url: url, lineNumber: lineNumber });
                      if (oldHandler) {
                          return oldHandler.apply(this, arguments);
                      } else {
                          return false;
                      }
                  };
              }(window.onerror, errors);
          },
          getLength: function getLength() {
              return errors.length;
          },
          getString: function getString() {
              return function (errors) {
                  var parts = [];
                  for (var i = 0, len = errors.length; i < len; i++) {
                      var err = errors[i];
                      parts.push("js-err-line-" + err.lineNumber + "-msg-" + err.message + "-url-" + err.url);
                  }
                  return parts.join("|");
              }(errors);
          }
      },
      metrics: {
          getEntries: function getEntries() {
              var entries = [];
              var _metrics = metrics.get();
              if (typeof _metrics != "undefined") {
                  for (var key in _metrics) {
                      if (_metrics.hasOwnProperty(key)) {
                          entries.push({ "key": key, "value": _metrics[key] });
                      }
                  }
              }
              return entries;
          }
      }
  };

  var script = new SiteSpeed(context);
  script.init();

  var fireSpeedBeacon = true;
  window.addEventListener('load', function () {
      script.onLoad();
  });
  window.addEventListener('onpagehide' in window ? 'pagehide' : 'beforeunload', function () {
      if (fireSpeedBeacon) {
          fireSpeedBeacon = false;
          script.onBeforeunload();
      }
  });
  window.addEventListener('unload', function () {
      if (fireSpeedBeacon) {
          script.onBeforeunload();
      }
  });
};
});
$_mod.def("/site-speed-ebay$5.4.3/client/uri", function(require, exports, module, __filename, __dirname) { //jscs:disable safeContextKeyword
'use strict';
/**
* Gets the meta tag with specified attribute name and value.
*
* @param {String} name
*        the attribute name of the meta tag
* @param {String} value
*        the value of the specified attribute
* @return {String}
*        the reference of the meta tag. If no such meta exists, return
*        <code>null</code>
*/
//> public Object meta(String, String);

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var meta = function meta(name, value) {
  var tags = document.getElementsByTagName('meta');
  for (var idx = 0, len = tags.length; idx < len; idx++) {
      if (tags[idx].getAttribute(name) == value) {
          // jshint ignore:line
          return tags[idx];
      }
  }
  return null;
};

var content = meta('http-equiv', 'Content-Type') || meta('httpEquiv', 'Content-Type');
var charset = content ? content.getAttribute('content') : null;

var encodeUri = charset && charset.match(/utf/gi) ? encodeURI : window.escape;
var decodeUri = charset && charset.match(/utf/gi) ? decodeURI : window.unescape;

var _encodeParam = charset && charset.match(/utf/gi) ? encodeURIComponent : window.escape;
var decodeParam = charset && charset.match(/utf/gi) ? decodeURIComponent : window.unescape;

var uriMatch = new RegExp('(([^:]*)://([^:/?]*)(:([0-9]+))?)?([^?#]*)([?]([^#]*))?(#(.*))?');

// as Object.assign has issues only on IE11
// the following is from extend in 'raptor-util'.
function extend(target, source) {
  if (!target) {
      // Check if a target was provided, otherwise create a new empty object to return
      target = {};
  }
  if (source) {
      for (var propName in source) {
          if (source.hasOwnProperty(propName)) {
              // Only look at source properties that are not inherited
              target[propName] = source[propName]; // Copy the property
          }
      }
  }
  return target;
}

/**
* @construct
* @param {String} href
*        a uri string to be parsed
*/
//> public void Uri(String href);
var Uri = function Uri(href) {

  var self = this;self.params = {};
  var match = href.match(uriMatch);
  if (match === null) {
      return;
  }

  self.protocol = self.match(match, 2);

  self.host = self.match(match, 3);
  self.port = self.match(match, 5);

  self.href = self.match(match, 6);
  self.query = self.match(match, 8);

  if (self.href.match(/eBayISAPI.dll/i)) {
      self.decodeIsapi(self.query);
  } else {
      self.decodeParams(self.query);
  }

  self.href = decodeUri(self.href);
  self.hash = self.match(match, 10);
};

extend(Uri.prototype, {

  //> private String match(Object match,int idx);
  match: function match(_match, idx) {
      return _match.length > idx && _match[idx] ? _match[idx] : '';
  },

  //> private void decodeIsapi(String);
  decodeIsapi: function decodeIsapi(query) {
      var params = query ? query.split('&') : [];
      this.isapi = params.shift();this.query = params.join('&');
      this.decodeParams(this.query);
  },

  /**
  * Adds a name-value pair as a parameter. The function allows duplicate
  * attributes with different values. The name-value pair is registered in a
  * parameter array. You can specify this parameter array and by default this
  * class has a internal array which is used to build the uri.
  *
  * @param {String} name
  *        the name of the parameter
  * @param {String} value
  *        the value of the parameter
  */
  //> public void appendParam(String name,String value);
  appendParam: function appendParam(name, value) {
      var params = this.params;
      if (!params[name]) {
          params[name] = value;
      } else if (_typeof(params[name]) === 'object') {
          params[name].push(value);
      } else {
          params[name] = [params[name], value];
      }
  },

  /**
  * Adds all paramters from a parameter array to this buider's internal
  * paramter array, which is used to build the uri.
  * <p>
  * Notes: This will not overwrite the existing paramters. If the paramters
  * are duplicate with the existing one, the value will be appended as an
  * other value of the same paramter name.
  *
  * @param {Object} params
  *        the custom parameter array from which the parameter will be added
  *        to the builder's internal array
  */
  //> public void appendParams(Object);
  appendParams: function appendParams(params) {
      for (var name in params) {
          var param = params[name];
          if ((typeof param === 'undefined' ? 'undefined' : _typeof(param)) !== 'object') {
              this.appendParam(name, param);
          } else {
              for (var idx = 0; idx < param.length; idx++) {
                  this.appendParam(name, param[idx]);
              }
          }
      }
  },

  /**
  * Parses the paramters from the query string to the builder's internal
  * parameter array.
  *
  * @param {String} query
  *        the qurey string to be parsed
  */
  //> public void decodeParams(String);
  decodeParams: function decodeParams(query) {

      var pairs = query ? query.split('&') : [];
      for (var idx = 0; idx < pairs.length; idx++) {

          var pair = pairs[idx].split('='),
              name = decodeParam(pair[0]);
          var value = pair.length > 1 ? decodeParam(pair[1].replace(/\+/g, '%20')) : '';

          if (name) {
              this.appendParam(name, value);
          }
      }
  },

  encodeParam: function encodeParam(name, value) {
      var param = _encodeParam(name);
      return value ? param.concat('=', _encodeParam(value)) : param;
  },

  /**
  * Builds the qurey string from a parameter array.
  *
  * @param {Object} params
  *        a specified parameter array. This function will use the builder's
  *        internal parameter array if you leave this parameter as
  *        <code>null</code>
  * @String {String}
  *        the combined query string
  */
  //> public String encodeParams(Object);
  encodeParams: function encodeParams(params) {
      // jshint ignore:line

      var self = this,
          pairs = [];
      params = params ? params : this.params;

      for (var name in params) {
          if (params.hasOwnProperty(name)) {
              if (_typeof(params[name]) !== 'object') {
                  pairs.push(self.encodeParam(name, params[name]));
              } else {
                  var param = params[name],
                      len = typeof param !== 'undefined' ? param.length : 0;
                  for (var idx = 0; idx < len; idx++) {
                      // jshint ignore:line
                      if (params[name][idx]) {
                          pairs.push(self.encodeParam(name, params[name][idx]));
                      }
                  }
              }
          }
      }

      return pairs.join('&');
  },

  /**
  * Parses the paramters from the form element to a parameter array.
  *
  * @param {Object} form
  *        the form element to be parsed
  */
  //> public Object decodeForm(Object);
  decodeForm: function decodeForm(form) {
      // jshint ignore:line

      var self = this,
          elems = form.elements,
          params = {};
      var idx, len;

      for (idx = 0, len = elems.length; idx < len; idx++) {
          delete self.params[elems[idx].name];
      }

      for (idx = 0, len = elems.length; idx < len; idx++) {

          var elem = elems[idx];
          if (elem.disabled) {
              continue;
          }

          var type = elem.type,
              name = elem.name,
              value = elem.value; //<String
          if (type.match(/text|hidden|textarea|password|file/)) {
              self.appendParam(name, value);
          } else if (type.match(/radio|checkbox/) && elem.checked) {
              self.appendParam(name, value);
          } else if (type.match(/select-one|select-multiple/)) {
              self.appendSelect(elem);
          }

          params[name] = self.params[name];
      }

      return params;
  },

  /**
  * Gets the options from a select HTML control to a parameter array.
  *
  * @param {Object} select
  *        the select HTML control to be parsed
  */
  //> public void appendSelect(Object, Object);
  appendSelect: function appendSelect(select) {
      var options = select.options;
      for (var idx = 0, len = options.length; idx < len; idx++) {
          if (options[idx].selected) {
              this.appendParam(select.name, options[idx].value);
          }
      }
  },

  /**
  * Gets the combined uri from the known information.
  *
  * @return {String}
  *         the combined uri string
  */
  //> public String getUrl();
  getUrl: function getUrl() {
      // jshint ignore:line

      var self = this;
      var url = self.protocol ? self.protocol.concat('://') : '';

      if (self.host) {
          url = url.concat(self.host);
      }
      if (self.port) {
          url = url.concat(':', self.port);
      }
      if (self.href) {
          url = url.concat(encodeUri(self.href));
      }
      if (self.isapi) {
          url = url.concat('?', self.isapi);
      }

      var query = self.encodeParams(self.params);
      if (query) {
          url = url.concat(self.isapi ? '&' : '?', query);
      }
      if (self.hash) {
          url = url.concat('#', self.hash);
      }

      return url;
  }

});

Uri.create = function (href) {
  return new Uri(href);
};

module.exports = Uri;
});
$_mod.def("/site-speed-ebay$5.4.3/client/metrics", function(require, exports, module, __filename, __dirname) { 'use strict';

module.exports = function metrics() {
  var _metrics = {};

  document.addEventListener('site-speed-ebay.metricsData', function (evt) {
      var data = evt.detail;
      for (var key in data) {
          if (key) {
              _metrics[key] = data[key];
          }
      }
  });

  return {
      get: function get() {
          var metricSet = _metrics;
          _metrics = {};
          return metricSet;
      }
  };
};
});
$_mod.def("/site-speed-ebay$5.4.3/client/sitespeed", function(require, exports, module, __filename, __dirname) { window.$ssg = function (gaugeInfo) {
  // jshint ignore:line

  var metrics = require('/site-speed-ebay$5.4.3/client/metrics'/*'./metrics'*/)();
  var Uri = require('/site-speed-ebay$5.4.3/client/uri'/*'./uri'*/);
  var ebayCookies = require('/cookies-browser$0.0.2/index'/*'cookies-browser'*/);
  var sitespeed = require('/core-site-speed-ebay$1.0.14/SiteSpeed'/*'core-site-speed-ebay'*/);

  return sitespeed(gaugeInfo, Uri, ebayCookies, metrics);
};
});
$_mod.run("/site-speed-ebay$5.4.3/client/sitespeed");