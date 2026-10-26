(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  // Presentation only: Model.validate remains the source of validation rules.
  function formatWarnings(project, warnings) {
    const named = (kind,index,item) => `${kind} ${index + 1}“${EC.Model.displayName(item,'未命名')}”`;
    function location(path) {
      if (path === 'name' || path === 'description') return `项目 / ${path === 'name' ? '项目名称' : '项目用途'}`;
      let match = /^groups\[(\d+)\]\.name$/.exec(path);
      if (match) return `${named('分组',Number(match[1]),project.groups[match[1]])} / 分组名称`;
      match = /^modules\[(\d+)\](.*)$/.exec(path);
      if (!match) return path;
      let item = project.modules[match[1]], rest = match[2], kind = '模块';
      const parts = [named(kind,Number(match[1]),item)], groups = {interfaces:'方法',inputs:'输入参数',outputs:'返回结果',parameters:'参数',structures:'数据结构',fields:'字段',events:'事件',tests:'测试项'};
      while ((match = /^\.(interfaces|inputs|outputs|parameters|structures|fields|events|tests)\[(\d+)\]/.exec(rest))) {
        kind = groups[match[1]]; item = item?.[match[1]]?.[match[2]];
        parts.push(named(kind,Number(match[2]),item)); rest = rest.slice(match[0].length);
      }
      const labels = {name:`${kind}名称`,englishName:`${kind}英文名`,purpose:kind === '模块' ? '模块功能' : '方法用途',type:kind === '字段' ? '变量类型' : '参数类型',description:kind === '字段' ? '作用' : kind === '事件' ? '事件说明' : '参数说明',steps:'测试步骤',expected:'预期结果'};
      const field = rest.slice(1);
      if (!Object.hasOwn(labels,field)) return path;
      parts.push(labels[field]); return parts.join(' / ');
    }
    return warnings.length ? `草稿还有 ${warnings.length} 处待补充（可以保存）：\n${warnings.map(item => `${location(item.path)}：${item.message}`).join('\n')}` : '';
  }
  function createWarningNotice({show,hide,schedule = callback => root.setTimeout(callback,5000),cancel = timer => root.clearTimeout(timer)}) {
    let timer = null, lastMessage = '', lastScope;
    function dismiss() {if (timer !== null) cancel(timer); timer = null; hide();}
    return {
      update(message,scope) {
        if (scope === lastScope && message === lastMessage) return;
        dismiss(); lastScope = scope; lastMessage = message;
        if (!message) return;
        show(message); timer = schedule(dismiss);
      },
      dismiss
    };
  }
  EC.Feedback = {formatWarnings,createWarningNotice};
})(globalThis);
