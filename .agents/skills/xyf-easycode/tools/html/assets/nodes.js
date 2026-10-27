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
  // Work in viewport pixels, independent of the world's pan and zoom transform.
  function previewPosition(anchor,size,bounds) {
    const gap = 12, left = bounds.left + gap, top = bounds.top + gap;
    const width = Math.min(size.width,Math.max(0,bounds.right - left - gap));
    const height = Math.min(size.height,Math.max(0,bounds.bottom - top - gap));
    const right = bounds.right - gap - width, bottom = bounds.bottom - gap - height;
    let x = anchor.right + gap, y = anchor.top;
    if (x > right) {
      if (anchor.left - gap - width >= left) x = anchor.left - gap - width;
      else {x = anchor.left; y = anchor.bottom + gap; if (y > bottom) y = anchor.top - gap - height;}
    }
    return {left:Math.max(left,Math.min(x,right)),top:Math.max(top,Math.min(y,bottom))};
  }
  function detailTitle(item,kind) {
    const name = hasText(item?.name) ? item.name.trim() : `未命名${kind}`;
    return hasText(item?.englishName) ? `${name} / ${item.englishName.trim()}` : name;
  }
  function detailParameters(values) {
    return Array.isArray(values) ? values.map(value => ({
      name:hasText(value?.name) ? value.name : '未命名参数',
      type:hasText(value?.type) ? value.type.trim() : '—',
      description:hasText(value?.description) ? value.description : '暂无说明'
    })) : [];
  }
  function methodDetails(method) {
    return {title:detailTitle(method,'方法'),description:method?.purpose || '',inputs:detailParameters(method?.inputs),outputs:detailParameters(method?.outputs)};
  }
  function eventDetails(event) {
    return {title:detailTitle(event,'事件'),description:event?.description || '',direction:event?.direction === 'receive' ? 'receive' : 'emit',parameters:detailParameters(event?.parameters)};
  }
  function parameterGroup(key,title,values,emptyText) {
    const section = element('section','module-preview-io'), heading = element('h5','module-preview-io-title',title);
    section.dataset.direction = key; heading.id = `ec-preview-${key}`; section.setAttribute('aria-labelledby',heading.id); section.append(heading);
    if (!values.length) {section.append(element('p','module-preview-empty',emptyText)); return section;}
    const list = element('dl','module-preview-parameters');
    for (const value of values) {
      const row = element('div','module-preview-parameter'), label = element('dt');
      label.append(element('span','module-preview-parameter-name',value.name),element('code','module-preview-type',value.type));
      row.append(label,element('dd','',value.description)); list.append(row);
    }
    section.append(list); return section;
  }
  function detailContent(title,description,details) {
    const method = details.method ? methodDetails(details.method) : null, event = details.event ? eventDetails(details.event) : null;
    const detail = method || event;
    if (detail) {title = detail.title; description = detail.description;}
    const content = element('div','module-preview-content'), heading = element('h4','module-preview-title',title);
    heading.id = 'ec-module-preview-title';
    if (event) {
      const header = element('div','module-preview-heading'), badge = element('span','module-preview-direction',event.direction === 'receive' ? '接受消息' : '发送消息');
      badge.dataset.direction = event.direction; header.append(heading,badge); content.append(header);
    } else content.append(heading);
    if (hasText(description)) content.append(element('p','module-preview-description',description));
    if (method) content.append(parameterGroup('inputs','输入',method.inputs,'无输入参数'),parameterGroup('outputs','输出',method.outputs,'无输出参数'));
    else if (event) content.append(parameterGroup('parameters','消息参数',event.parameters,'无消息参数'));
    return content;
  }
  function applyAppearance(node,module) {
    const colors = EC.Model.moduleAppearance(module);
    node.style.setProperty('--node-text',colors.textColor);
    node.style.setProperty('--node',colors.backgroundColor);
    node.style.setProperty('--node-header',colors.headerColor);
    const customText = colors.textColor !== EC.Model.moduleAppearance().textColor;
    node.style.setProperty('--node-icon',customText ? colors.textColor : '#347cff');
    node.style.setProperty('--node-event-icon',customText ? colors.textColor : '#8547e9');
  }
  function createPreview() {
    const panel = element('aside','module-preview'), listeners = [];
    panel.id = 'ec-module-preview'; panel.hidden = true; panel.setAttribute('role','region');
    panel.setAttribute('aria-labelledby','ec-module-preview-title'); document.body.append(panel);
    let active = null;
    function listen(target,type,callback,options) {
      target.addEventListener(type,callback,options); listeners.push(() => target.removeEventListener(type,callback,options));
    }
    function hide() {
      active?.setAttribute('aria-expanded','false'); active?.classList.remove('is-previewing'); active = null;
      panel.hidden = true; panel.replaceChildren();
    }
    function show(trigger,module,title,description,details) {
      if (!trigger.isConnected || document.querySelector('dialog[open]')) return;
      if (active === trigger) {hide(); return;}
      hide(); active = trigger; applyAppearance(panel,module); panel.append(detailContent(title,description,details));
      const viewport = document.getElementById('ec-viewport')?.getBoundingClientRect();
      const bounds = {left:Math.max(0,viewport?.left || 0),top:Math.max(0,viewport?.top || 0),right:Math.min(root.innerWidth,viewport?.right ?? root.innerWidth),bottom:Math.min(root.innerHeight,viewport?.bottom ?? root.innerHeight)};
      panel.style.width = `${Math.min(360,Math.max(0,bounds.right - bounds.left - 24))}px`;
      panel.style.maxHeight = `${Math.max(0,bounds.bottom - bounds.top - 24)}px`;
      panel.style.visibility = 'hidden'; panel.hidden = false; panel.scrollTop = 0;
      const row = trigger.getBoundingClientRect(), card = trigger.closest('.module-node').getBoundingClientRect();
      const position = previewPosition({left:card.left,right:card.right,top:row.top,bottom:row.bottom},panel.getBoundingClientRect(),bounds);
      panel.style.left = `${position.left}px`; panel.style.top = `${position.top}px`; panel.style.visibility = '';
      trigger.setAttribute('aria-expanded','true'); trigger.classList.add('is-previewing');
    }
    function bind(trigger,module,title,description,details = {}) {
      trigger.dataset.nodePreview = ''; trigger.tabIndex = 0; trigger.setAttribute('role','button');
      trigger.setAttribute('aria-controls',panel.id); trigger.setAttribute('aria-expanded','false');
      trigger.addEventListener('click',event => {if (event.button === 0) show(trigger,module,title,description,details);});
      trigger.addEventListener('keydown',event => {
        if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); event.stopPropagation(); show(trigger,module,title,description,details);}
        else if (active === trigger && ['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          panel.scrollTop += (event.key.endsWith('Down') ? 1 : -1) * (event.key.startsWith('Page') ? panel.clientHeight * .8 : 40);
        }
      });
    }
    listen(document,'pointerdown',event => {
      if (!panel.contains(event.target) && !event.target.closest?.('[data-node-preview]')) hide();
    },true);
    listen(document,'keydown',event => {
      if (event.key !== 'Escape' || !active) return;
      const trigger = active; hide(); trigger.focus({preventScroll:true}); event.preventDefault(); event.stopPropagation();
    },true);
    listen(root,'resize',hide); listen(root,'blur',hide);
    return {bind,hide,destroy() {hide(); listeners.forEach(remove => remove()); panel.remove();}};
  }
  function properties(module,preview) {
    if (!hasText(module.codeLocation)) return null;
    const list = element('dl','module-properties'), row = element('div','module-property'), content = element('dd');
    content.append(element('code','module-code-location',module.codeLocation));
    row.append(element('dt','','代码位置'),content); preview.bind(row,module,'代码位置',module.codeLocation); list.append(row);
    return list;
  }
  function parameterList(values,module,preview) {
    const list = element('dl','module-member-list module-parameter-list');
    for (const item of values) {
      const row = element('div','module-member module-member-row'), title = named(item,'参数');
      const type = hasText(item.type) ? item.type.trim() : '—';
      const kind = parameterKind(type); row.dataset.valueKind = kind;
      row.append(element('dt','module-member-name',title),element('dd','module-member-description',item.description || ''));
      const label = type.slice(0,3);
      const badge = element('dd','module-type-label',label); badge.title = type; badge.setAttribute('aria-label',`参数类型：${type}`); row.append(badge);
      const more = element('span','module-row-more','···'); more.setAttribute('aria-hidden','true'); row.append(more);
      preview.bind(row,module,title,item.description); list.append(row);
    }
    return list;
  }
  function parameterKind(type) {
    const value = type.toLowerCase().replace(/\s/g,'');
    if (/\[\]$|^(?:array|list|vector|std::vector)(?:<|\[|$)/.test(value)) return 'array';
    if (/^(?:bool|boolean)$/.test(value)) return 'boolean';
    if (/^(?:str|string|std::string|char(?:\*|\[\])?)$/.test(value)) return 'string';
    if (/^(?:number|u?int(?:8|16|32|64|128)?(?:_t)?|float(?:32|64)?|double|decimal|long|short|size_t)$/.test(value)) return 'number';
    if (/^(?:obj|object|map|dict|dictionary|record|struct|class)(?:<|\[|$)/.test(value)) return 'object';
    return 'other';
  }
  function memberList(values,kind,module,preview) {
    const list = element('div','module-member-list');
    for (const item of values) {
      const row = element('div','module-member module-member-row'), isMethod = kind === 'method';
      const title = named(item,isMethod ? '方法' : '事件'), description = isMethod ? item.purpose : item.description;
      row.dataset[isMethod ? 'methodId' : 'eventId'] = item.id;
      row.dataset.valueKind = isMethod ? 'method' : item.direction === 'receive' ? 'receive' : 'emit';
      if (!isMethod) row.setAttribute('aria-label',`${item.direction === 'receive' ? '接受消息' : '发送消息'}：${title}`);
      if (isMethod) {
        const symbol = element('span','module-method-symbol'); symbol.setAttribute('aria-hidden','true'); symbol.append(EC.Icons.create('function')); row.append(symbol);
      } else {const dot = element('span','module-event-dot'); dot.setAttribute('aria-hidden','true'); row.append(dot);}
      row.append(element('span','module-member-name',title),element('span','module-member-description',description || ''));
      const more = element('span','module-row-more','···'); more.setAttribute('aria-hidden','true'); row.append(more);
      preview.bind(row,module,title,description,isMethod ? {method:item} : {event:item}); list.append(row);
    }
    return list;
  }
  function renderContent(container,module,preview) {
    function group(key,title,body,count) {
      if (!body) return;
      const section = element('section','module-group'); section.dataset.moduleGroup = key; section.dataset.itemCount = count;
      const icons = {basics:'info',requirements:'list',dependencies:'list',parameters:'parameters',methods:'code',events:'event'};
      const heading = element('div','module-group-heading'), name = element('h3','module-group-title');
      const symbol = element('span','module-group-symbol'); symbol.append(EC.Icons.create(icons[key])); name.append(symbol,element('span','',title));
      name.setAttribute('aria-label',`${title}，${count} 项`);
      heading.append(name); body.classList.add('module-group-content'); section.append(heading,body); container.append(section);
    }
    const basics = element('div','module-basics');
    if (hasText(module.purpose)) {
      const purpose = element('p','module-purpose',module.purpose);
      preview.bind(purpose,module,named(module,'模块'),module.purpose); basics.append(purpose);
    }
    const metadata = properties(module,preview); if (metadata) basics.append(metadata);
    group('basics','模块信息',basics.children.length ? basics : null,Number(hasText(module.purpose)) + Number(!!metadata));
    const requirements = (module.requirements || []).filter(hasText);
    if (requirements.length) {
      const list = element('ul','module-requirements');
      for (const value of requirements) {const row = element('li','',value); preview.bind(row,module,'功能需求',value); list.append(row);}
      group('requirements','功能需求',list,requirements.length);
    }
    const dependencies = module.dependencies.filter(hasText);
    if (dependencies.length) {
      const list = element('ul','module-requirements');
      for (const value of dependencies) {const row = element('li','',value); preview.bind(row,module,'依赖项',value); list.append(row);}
      group('dependencies','依赖项',list,dependencies.length);
    }
    const parameters = items(module.parameters,hasParameter), methods = items(module.interfaces,hasMethod), events = items(module.events,hasEvent);
    if (parameters.length) group('parameters','参数',parameterList(parameters,module,preview),parameters.length);
    if (methods.length) group('methods','方法',memberList(methods,'method',module,preview),methods.length);
    if (events.length) group('events','消息事件',memberList(events,'event',module,preview),events.length);
  }
  function create({project,layer,template,onSelect = () => {},onEdit = () => {}}) {
    const elements = new Map(), preview = createPreview();
    let selected = '';
    function render() {
      preview.hide(); layer.replaceChildren(); elements.clear();
      for (const module of project.modules) {
        const fragment = template.content.cloneNode(true), node = fragment.querySelector('.module-node');
        EC.Icons.hydrate(node); applyAppearance(node,module);
        node.querySelector('.node-emblem').append(EC.Icons.create('node'));
        const moduleName = module.name?.trim() || '未命名模块';
        node.dataset.moduleId = module.id; node.setAttribute('aria-label',`模块：${moduleName}`);
        node.style.left = `${module.x}px`; node.style.top = `${module.y}px`; node.classList.toggle('selected',selected === module.id);
        const name = node.querySelector('.module-name'); name.textContent = moduleName; name.title = moduleName;
        const language = node.querySelector('.module-language');
        language.textContent = module.language?.trim() || ''; language.title = language.textContent; language.hidden = !language.textContent;
        renderContent(node.querySelector('.module-content'),module,preview);
        for (const action of node.querySelectorAll('[data-node-action]')) action.addEventListener('click',() => {preview.hide(); onEdit(module.id);});
        for (const port of node.querySelectorAll('[data-port]')) {
          port.setAttribute('aria-label',`${moduleName}：${port.getAttribute('aria-label')}`); port.setAttribute('aria-pressed','false');
        }
        node.addEventListener('pointerdown',event => {
          if (event.button !== 0) return;
          selected = module.id; for (const [id,item] of elements) item.classList.toggle('selected',id === selected); onSelect(module.id);
        });
        elements.set(module.id,node); layer.append(fragment);
      }
    }
    return {render,hidePreview:preview.hide,getElement:id => elements.get(id),destroy() {preview.destroy(); layer.replaceChildren(); elements.clear();}};
  }
  EC.Nodes = {create,previewPosition,methodDetails,eventDetails};
})(globalThis);
