# lasso-optimizer-plugin
>A build / compile time optimizer transform for Lasso JS. Gives (Lasso JS)[http://www.github.com/lasso-js/lasso] some extra arms.

## What is this?
- (Lasso JS)[http://www.github.com/lasso-js/lasso] produces output bundles similar to the NODEJS common-js style syntax on the browser.
- This is one of the transform stage plugins for (Lasso JS)[http://www.github.com/lasso-js/lasso], that is applied on the final aggregated output of (Lasso JS)[http://www.github.com/lasso-js/lasso].
- It performs code transformations

## Why is this needed?
- This plugin helps in further optimizing Lasso JS output bundles under certain  conditions, while resolving modules & circular dependencies.
- Currrently, Lasso JS inlines the filepaths of modules like

```javascript
$_mod.def("/marko$4.17.3/components/runtime", function (require, exports, module, __filename, __dirname) {
    // code here
});
$_mod_gh_fe.remap("/marko$4.17.3/components", "/marko$4.17.3/components-browser.marko");
$_mod_gh_fe.installed("globalheaderfrontend$25.1.0", "marko", "4.17.3");
$_mod_gh_fe.remap("/marko$4.17.3/src/runtime/components/index", "/marko$4.17.3/src/runtime/components/index-browser");
```
- While they provide a mirror representation of your projects file system, this tends to be of an overhead & bloat for projects.
- Further, these are resolved on the browser by [Lasso Modules Client Side Run Time](https://github.com/lasso-js/lasso-modules-client) that performs a Node JS style module resolution.
- Inlined filepaths & the client side runtime take upto ~30KB in your output bundle.

## What does this do?
- This plugin applies an output transform on the code
- It attempts to resolve all filepaths and module dependencies at build time
- It transform modules into simple function expressions

```javascript
$_mod.def("/marko$4.17.3/components/runtime", function (require, exports, module, __filename, __dirname) {
    // code here
});
$_mod.run("/marko$4.17.3/components/runtime");
$_mod_gh_fe.remap("/marko$4.17.3/components", "/marko$4.17.3/components-browser.marko");
$_mod_gh_fe.installed("globalheaderfrontend$25.1.0", "marko", "4.17.3");
$_mod_gh_fe.main("/process$4.17.3", "src/runtime/components/index-browser");
```

to 

```javascript
var __marko_4_17_3__components__runtime = function (require, exports, module) {
    // code here
});
require(__marko_4_17_3__components__runtime);
```
- The `.remap`, `.installed`, `.main`, `.run`, `.builtin`, `resolve`, `require`, `def` are all resolved at build / asset bundling phase.
- On the browser, the bundle doesn't have to resolve these anymore.
- By doing this, it gets rid of the [Lasso Modules Client Side Run Time](https://github.com/lasso-js/lasso-modules-client) & uses a miniature version of it.

## Usage
This has to be applied as `transform` in the Lasso config.

```json
{
    "plugins": [
        "lasso-less",
        "lasso-autoprefixer",
        "lasso-marko",
        "lasso-minify-transpile-inline",
        "rollup-plugin-lasso",
        {
            "plugin": "lasso-inline-slots",
            "config": {
                "inlineSlots": [
                    "inline"
                ]
            }
        }
    ],
    "require": {
        "lastSlot": "inline",
        "transforms": [
            "lasso-babel-env",
            "lasso-optimizer-plugin"
        ]
    },
    "minify": true,
    "minifyInlineOnly": false,
    "bundlingEnabled": true,
    "resolveCssUrls": true,
    "noConflict": "gh-fe",
    "cacheProfile": "production"
}
```