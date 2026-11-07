(function installRuntime(root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const entries = [];
  EC.register = function (name,install) {
    entries.push({name,source:install.toString()});
    install(root);
  };
  EC.runtimeSource = function () {
    return `(${installRuntime.toString()})(globalThis);\n` + entries.map(entry => `globalThis.EasyCode.register(${JSON.stringify(entry.name)},${entry.source});`).join('\n');
  };
})(globalThis);
