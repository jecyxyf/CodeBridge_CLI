globalThis.EasyCode.register("feedback",function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const t = (key, params) => EC.I18n.t(key, params);
  const kindKeys = {"Group":"feedback.kind.group","Module":"feedback.kind.module","Method":"feedback.kind.method","Input parameters":"feedback.kind.inputs","Return values":"feedback.kind.outputs","Parameter":"feedback.kind.parameter","Data structures":"feedback.kind.structure","Field":"feedback.kind.field","Event":"feedback.kind.event","Tests":"feedback.kind.test"};
  const kindLabel = kind => kindKeys[kind] ? t(kindKeys[kind]) : kind;
  // Presentation only: Model.validate remains the source of validation rules.
  function formatWarnings(project, warnings) {
    const named = (kind,index,item) => t('feedback.namedItem',{kind:kindLabel(kind),index:index + 1,name:EC.Model.displayName(item,t('feedback.unnamed'))});
    function location(path) {
      if (path === 'name' || path === 'description') return t('feedback.projectLocation',{field:path === 'name' ? t('feedback.projectName') : t('feedback.projectPurpose')});
      let match = /^groups\[(\d+)\]\.name$/.exec(path);
      if (match) return t('feedback.groupLocation',{group:named('Group',Number(match[1]),project.groups[match[1]])});
      match = /^modules\[(\d+)\](.*)$/.exec(path);
      if (!match) return path;
      let item = project.modules[match[1]], rest = match[2], kind = 'Module';
      const parts = [named(kind,Number(match[1]),item)], groups = {interfaces:'Method',inputs:'Input parameters',outputs:'Return values',parameters:'Parameter',structures:'Data structures',fields:'Field',events:'Event',tests:'Tests'};
      while ((match = /^\.(interfaces|inputs|outputs|parameters|structures|fields|events|tests)\[(\d+)\]/.exec(rest))) {
        kind = groups[match[1]]; item = item?.[match[1]]?.[match[2]];
        parts.push(named(kind,Number(match[2]),item)); rest = rest.slice(match[0].length);
      }
      const labels = {name:t('feedback.name',{kind:kindLabel(kind)}),englishName:t('feedback.codeName',{kind:kindLabel(kind)}),purpose:kind === 'Module' ? t('feedback.modulePurpose') : t('feedback.methodPurpose'),type:kind === 'Field' ? t('feedback.dataType') : t('feedback.parameterType'),description:kind === 'Field' ? t('feedback.purpose') : kind === 'Event' ? t('feedback.eventDescription') : t('feedback.parameterDescription'),steps:t('feedback.testSteps'),expected:t('feedback.expectedResult')};
      const field = rest.slice(1);
      if (!Object.hasOwn(labels,field)) return path;
      parts.push(labels[field]); return parts.join(t('feedback.locationSeparator'));
    }
    return warnings.length ? t('feedback.incompleteDraft',{count:warnings.length,items:warnings.map(item => t('feedback.warningItem',{location:location(item.path),message:item.message})).join('\n')}) : '';
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
});
