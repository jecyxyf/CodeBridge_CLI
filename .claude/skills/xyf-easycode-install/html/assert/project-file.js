globalThis.EasyCode.register("project-file",function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const t = (key,params) => EC.I18n.t(key,params);
  const fileName = 'software_architecture.js';
  function validate(project) {
    const seen = new Set();
    function visit(value) {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
      if (typeof value === 'number' && Number.isFinite(value)) return;
      if (!value || typeof value !== 'object') throw new Error(t('projectFile.jsonDataOnly'));
      if (seen.has(value)) throw new Error(t('projectFile.circularReference'));
      if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error(t('projectFile.plainObjectsOnly'));
      if (Object.hasOwn(value,'__proto__')) throw new Error(t('projectFile.forbiddenPrototype'));
      seen.add(value);
      Object.values(value).forEach(visit);
      seen.delete(value);
    }
    visit(project);
    const result = EC.Model.validate(project);
    if (result.errors.length) throw new Error(result.errors.map(item => t('projectFile.validationDetail',{path:item.path,message:item.message})).join('\n'));
    return project;
  }
  function parse(content) {
    if (typeof content !== 'string') throw new Error(t('projectFile.textRequired'));
    const match = /^\s*globalThis\.softwareArchitecture\s*=\s*([\s\S]+?)\s*;\s*$/.exec(content.replace(/^\uFEFF/,''));
    if (!match) throw new Error(t('projectFile.assignmentRequired'));
    let project;
    try {project = JSON.parse(match[1]);}
    catch {throw new Error(t('projectFile.invalidAssignment'));}
    return validate(project);
  }
  function stringify(project) {
    validate(project);
    const json = JSON.stringify(project,null,2).replace(/[\u2028\u2029]/g,character => '\\u' + character.charCodeAt(0).toString(16));
    return `globalThis.softwareArchitecture = ${json};\n`;
  }
  EC.ProjectFile = {parse,stringify,validate,fileName};
});
