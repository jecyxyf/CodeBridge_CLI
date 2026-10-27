(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  function validate(project) {
    // JSON and a JavaScript object literal must represent the same data.
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('配置只能包含普通数据对象。');
      if (Object.hasOwn(value,'__proto__')) throw new Error('配置不能包含 __proto__ 字段。');
      Object.values(value).forEach(visit);
    }
    visit(project);
    const result = EC.Model.validate(project);
    if (result.errors.length) throw new Error(result.errors.map(item => `${item.path}: ${item.message}`).join('\n'));
    return project;
  }
  function parse(content) {
    if (typeof content !== 'string') throw new Error('配置文件应为文字。');
    const match = /^\s*window\.ARCHIFY_DATA\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(content.replace(/^\uFEFF/,''));
    if (!match) throw new Error('配置格式不正确，应为 window.ARCHIFY_DATA = { ... };，仅支持 archify.js 格式。');
    let project;
    try {project = JSON.parse(match[1]);}
    catch {throw new Error('archify.js 中的数据不是有效的 JSON 对象，请检查引号、逗号和括号。');}
    return validate(project);
  }
  function stringify(project) {
    validate(project);
    const data = JSON.stringify(project,null,2).replace(/[<>&\u2028\u2029]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4,'0'));
    return `window.ARCHIFY_DATA = ${data};\n`;
  }
  EC.ProjectFile = {parse,stringify,validate};
})(globalThis);
