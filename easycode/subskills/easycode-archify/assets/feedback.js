(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  // Presentation only: Model.validate remains the source of validation rules.
  function formatWarnings(project, warnings) {
    const named = (kind,index,item) => `${kind} ${index + 1}“${item?.name || '未命名'}”`;
    function location(path) {
      if (path === 'name' || path === 'description') return `项目 / ${path === 'name' ? '项目名称' : '项目用途'}`;
      let match = /^groups\[(\d+)\]\.name$/.exec(path);
      if (match) return `${named('分组',Number(match[1]),project.groups[match[1]])} / 分组名称`;
      match = /^modules\[(\d+)\](?:\.interfaces\[(\d+)\])?(?:\.(inputs|outputs)\[(\d+)\])?\.(name|purpose|type|description)$/.exec(path);
      if (!match) return path;
      const [,moduleIndex,interfaceIndex,direction,parameterIndex,field] = match, module = project.modules[moduleIndex];
      const parts = [named('模块',Number(moduleIndex),module)];
      const entry = module?.interfaces[interfaceIndex];
      if (interfaceIndex !== undefined) parts.push(named('接口',Number(interfaceIndex),entry));
      if (direction) parts.push(named(direction === 'inputs' ? '输入参数' : '输出参数',Number(parameterIndex),entry?.[direction][parameterIndex]));
      const labels = direction ? {name:'参数名',type:'参数类型',description:'参数说明'} : interfaceIndex !== undefined ? {name:'接口名称',purpose:'接口用途'} : {name:'模块名称',purpose:'模块职责'};
      parts.push(labels[field] || field); return parts.join(' / ');
    }
    return warnings.length ? `草稿还有 ${warnings.length} 处待补充（可以保存）：\n${warnings.map(item => `${location(item.path)}：${item.message}`).join('\n')}` : '';
  }
  EC.Feedback = {formatWarnings};
})(globalThis);
