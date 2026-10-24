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
  function signatureName(item,fallback,method = false) {
    if (hasText(item?.englishName)) return item.englishName.trim();
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const legacy = method ? name.split('(')[0].trim() : name;
    return /^[A-Za-z_$][\w$]*$/.test(legacy) ? legacy : fallback;
  }
  function methodSignature(method) {
    const inputs = Array.isArray(method?.inputs) ? method.inputs : [];
    const outputs = Array.isArray(method?.outputs) ? method.outputs : [];
    const types = outputs.map(value => hasText(value?.type) ? value.type.trim() : 'unknown');
    const result = types.length > 1 ? `(${types.join(', ')})` : types[0] || 'void';
    return `${result} ${signatureName(method,'method',true)}(${inputs.map((value,index) => signatureName(value,`param${index + 1}`)).join(', ')})`;
  }
  function detailContent(title,description,details) {
    const content = element('div','module-preview-content'), heading = element('h4','module-preview-title',title);
    heading.id = 'ec-module-preview-title'; content.append(heading);
    if (hasText(description)) content.append(element('p','module-preview-description',description));
    if (details.method) content.append(element('code','module-preview-signature',methodSignature(details.method)));
    const values = Array.isArray(details.parameters) ? details.parameters : [];
    if (values.length) {
      const parameters = element('dl','module-preview-parameters');
      for (const [index,value] of values.entries()) {
        const row = element('div','module-preview-parameter'), label = element('dt');
        label.append(element('code','',signatureName(value,`param${index + 1}`)),document.createTextNode('：'));
        row.append(label,element('dd','',hasText(value?.description) ? value.description : '暂无说明'));
        parameters.append(row);
      }
      content.append(parameters);
    }
    return content;
  }
  function applyAppearance(node,module) {
    const colors = EC.Model.moduleAppearance(module);
    node.style.setProperty('--node-text',colors.textColor);
    node.style.setProperty('--node',colors.backgroundColor);
    node.style.setProperty('--node-header',colors.headerColor);
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
      row.append(element('dt','module-member-name',title),element('dd','module-member-description',item.description || ''));
      preview.bind(row,module,title,item.description); list.append(row);
    }
    return list;
  }
  function memberList(values,kind,module,preview) {
    const list = element('div','module-member-list');
    for (const item of values) {
      const row = element('div','module-member module-member-row'), isMethod = kind === 'method';
      const title = named(item,isMethod ? '方法' : '事件'), description = isMethod ? item.purpose : item.description;
      row.dataset[isMethod ? 'methodId' : 'eventId'] = item.id;
      row.append(element('span','module-member-name',title),element('span','module-member-description',description || ''));
      preview.bind(row,module,title,description,{method:isMethod ? item : null,parameters:isMethod ? item.inputs : item.parameters}); list.append(row);
    }
    return list;
  }
  function renderContent(container,module,preview) {
    function group(key,title,body) {
      if (!body) return;
      const section = element('section','module-group'); section.dataset.moduleGroup = key;
      body.classList.add('module-group-content'); section.append(element('h3','module-group-title',title),body); container.append(section);
    }
    const basics = element('div','module-basics');
    if (hasText(module.purpose)) {
      const purpose = element('p','module-purpose',module.purpose);
      preview.bind(purpose,module,named(module,'模块'),module.purpose); basics.append(purpose);
    }
    const metadata = properties(module,preview); if (metadata) basics.append(metadata);
    group('basics','模块信息',basics.children.length ? basics : null);
    const requirements = (module.requirements || []).filter(hasText);
    if (requirements.length) {
      const list = element('ul','module-requirements');
      for (const value of requirements) {const row = element('li','',value); preview.bind(row,module,'功能需求',value); list.append(row);}
      group('requirements','功能需求',list);
    }
    const parameters = items(module.parameters,hasParameter), methods = items(module.interfaces,hasMethod), events = items(module.events,hasEvent);
    if (parameters.length) group('parameters','参数',parameterList(parameters,module,preview));
    if (methods.length) group('methods','方法',memberList(methods,'method',module,preview));
    if (events.length) group('events','消息事件',memberList(events,'event',module,preview));
  }
  function create({project,layer,template,onSelect = () => {},onEdit = () => {}}) {
    const elements = new Map(), preview = createPreview();
    let selected = '';
    function render() {
      preview.hide(); layer.replaceChildren(); elements.clear();
      for (const module of project.modules) {
        const fragment = template.content.cloneNode(true), node = fragment.querySelector('.module-node');
        EC.Icons.hydrate(node); applyAppearance(node,module);
        const moduleName = module.name?.trim() || '未命名模块';
        node.dataset.moduleId = module.id; node.setAttribute('aria-label',`模块：${moduleName}`);
        node.style.left = `${module.x}px`; node.style.top = `${module.y}px`; node.classList.toggle('selected',selected === module.id);
        const name = node.querySelector('.module-name'); name.textContent = moduleName; name.title = moduleName;
        const language = node.querySelector('.module-language');
        language.textContent = module.language?.trim() || ''; language.title = language.textContent; language.hidden = !language.textContent;
        renderContent(node.querySelector('.module-content'),module,preview);
        node.querySelector('[data-node-action=edit]').addEventListener('click',() => {preview.hide(); onEdit(module.id);});
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
  EC.Nodes = {create,previewPosition,methodSignature};
})(globalThis);
