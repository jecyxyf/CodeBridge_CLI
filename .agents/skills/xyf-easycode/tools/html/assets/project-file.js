(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  function validate(project) {
    // Configuration contains data only, including when imported from a browser.
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
    let project;
    try {project = JSON.parse(content.replace(/^\uFEFF/,''));}
    catch {throw new Error('archify.json 不是有效的 JSON，请检查引号、逗号和括号。');}
    return validate(project);
  }
  function stringify(project) {
    validate(project);
    return JSON.stringify(project,null,2) + '\n';
  }
  EC.ProjectFile = {parse,stringify,validate};
})(globalThis);
