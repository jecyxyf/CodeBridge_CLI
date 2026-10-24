(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const hasText = value => typeof value === 'string' && !!value.trim();
  const items = (values,check) => Array.isArray(values) ? values.filter(value => value && check(value)) : [];
  const named = (item,kind) => hasText(item.name) ? item.name : `未命名${kind}`;
  const hasFields = (item,keys) => keys.some(key => hasText(item[key]));
  const hasParameter = item => hasFields(item,['name','description']);
  const hasMethod = item => hasFields(item,['name','purpose']) || items(item.inputs,hasParameter).length || items(item.outputs,hasParameter).length;
  const hasEvent = item => hasFields(item,['name','description']) || items(item.parameters,hasParameter).length;
  function element(tag,className,text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function properties(pairs) {
    const list = element('dl','module-properties');
    for (const [label,value] of pairs) {
      if (!hasText(value)) continue;
      const row = element('div','module-property'), content = element('dd');
      if (label === '代码位置') content.append(element('code','module-code-location',value));
      else content.textContent = value;
      row.append(element('dt','',label),content); list.append(row);
    }
    return list.children.length ? list : null;
  }
  function parameterList(values) {
    const list = element('dl','module-member-list module-parameter-list');
    for (const item of values) {
      const row = element('div','module-member module-member-row');
      row.append(element('dt','module-member-name',named(item,'参数')),element('dd','module-member-description',item.description || ''));
      list.append(row);
    }
    return list;
  }
  function parameterSection(body,title,values) {
    const entries = items(values,hasParameter); if (!entries.length) return;
    const section = element('div','module-subgroup');
    section.append(element('h5','module-subgroup-title',title),parameterList(entries)); body.append(section);
  }
  function memberList(values,kind,moduleId,openStates) {
    const list = element('div','module-member-list');
    for (const item of values) {
      const body = element('div','module-member-parameters'), isMethod = kind === 'method';
      if (isMethod) {parameterSection(body,'输入参数',item.inputs); parameterSection(body,'输出参数',item.outputs);}
      else parameterSection(body,'携带参数',item.parameters);
      const expandable = !!body.children.length;
      const row = element(expandable ? 'details' : 'div',expandable ? 'module-member module-disclosure' : 'module-member module-member-row');
      row.dataset[isMethod ? 'methodId' : 'eventId'] = item.id;
      const heading = expandable ? element('summary','module-member-row') : row;
      heading.append(element('span','module-member-name',named(item,isMethod ? '方法' : '事件')),
        element('span','module-member-description',(isMethod ? item.purpose : item.description) || ''));
      if (expandable) {
        const key = JSON.stringify([moduleId,kind,item.id]);
        row.dataset.disclosureKey = key; row.open = openStates.get(key) ?? true;
        heading.append(EC.Icons.create('chevron-down')); row.append(heading,body);
      }
      list.append(row);
    }
    return list;
  }
  function renderContent(container,module,project,openStates) {
    function group(key,title,body) {
      if (!body) return;
      const section = element('section','module-group');
      section.dataset.moduleGroup = key;
      body.classList.add('module-group-content');
      section.append(element('h3','module-group-title',title),body); container.append(section);
    }
    const layer = project.groups.find(item => item.id === module.groupId);
    const basics = element('div','module-basics');
    if (hasText(module.purpose)) basics.append(element('p','module-purpose',module.purpose));
    const metadata = properties([['代码位置',module.codeLocation],['所属层级',layer?.name]]);
    if (metadata) basics.append(metadata);
    group('basics','模块信息',basics.children.length ? basics : null);
    const requirements = (module.requirements || []).filter(hasText);
    if (requirements.length) {
      const list = element('ul','module-requirements');
      for (const value of requirements) list.append(element('li','',value));
      group('requirements','功能需求',list);
    }
    const parameters = items(module.parameters,hasParameter), methods = items(module.interfaces,hasMethod), events = items(module.events,hasEvent);
    if (parameters.length) group('parameters','参数',parameterList(parameters));
    if (methods.length) group('methods','方法',memberList(methods,'method',module.id,openStates));
    if (events.length) group('events','消息事件',memberList(events,'event',module.id,openStates));
  }
  function create({project,layer,template,onSelect = () => {},onEdit = () => {}}) {
    const elements = new Map();
    let selected = '';
    function render() {
      // Disclosure is a reading preference, not a project edit. Keep it across redraws.
      const openStates = new Map(Array.from(layer.querySelectorAll('.module-disclosure'),node => [node.dataset.disclosureKey,node.open]));
      layer.replaceChildren(); elements.clear();
      for (const module of project.modules) {
        const fragment = template.content.cloneNode(true), node = fragment.querySelector('.module-node');
        EC.Icons.hydrate(node);
        const moduleName = module.name?.trim() || '未命名模块';
        node.dataset.moduleId = module.id; node.setAttribute('aria-label',`模块：${moduleName}`);
        node.style.left = `${module.x}px`; node.style.top = `${module.y}px`; node.classList.toggle('selected',selected === module.id);
        const name = node.querySelector('.module-name'); name.textContent = moduleName; name.title = moduleName;
        const language = node.querySelector('.module-language');
        language.textContent = module.language?.trim() || ''; language.title = language.textContent; language.hidden = !language.textContent;
        renderContent(node.querySelector('.module-content'),module,project,openStates);
        node.querySelector('[data-node-action=edit]').addEventListener('click',() => onEdit(module.id));
        for (const port of node.querySelectorAll('[data-port]')) {
          port.setAttribute('aria-label',`${moduleName}：${port.getAttribute('aria-label')}`);
          port.setAttribute('aria-pressed','false');
        }
        node.addEventListener('pointerdown',() => {selected = module.id; for (const [id,item] of elements) item.classList.toggle('selected',id === selected); onSelect(module.id);});
        elements.set(module.id,node); layer.append(fragment);
      }
    }
    return {render,getElement:id => elements.get(id),destroy() {layer.replaceChildren(); elements.clear();}};
  }
  EC.Nodes = {create};
})(globalThis);
