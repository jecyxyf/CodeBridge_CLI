(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const statusNames = {planned:'方案',verified:'已核对源码',modified:'已修改 · 待核对'};
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, className = '') {
    const node = element('button',className,text); node.type = 'button'; node.addEventListener('click',action); return node;
  }
  function field(label, value, change, kind = 'input') {
    const wrapper = element('label','field'); wrapper.append(element('span','',label));
    const input = element(kind); input.value = value ?? ''; input.setAttribute('aria-label',label);
    input.addEventListener('input',() => change(input.value)); wrapper.append(input); return wrapper;
  }
  function select(label, value, options, change) {
    const wrapper = element('label','field'); wrapper.append(element('span','',label));
    const input = element('select'); input.setAttribute('aria-label',label);
    for (const [key,text] of options) {const option = element('option','',text); option.value = key; input.append(option);}
    input.value = value; input.addEventListener('change',() => change(input.value,input)); wrapper.append(input); return wrapper;
  }
  function check(label, value, change) {
    const wrapper = element('label','check-label'), input = element('input'); input.type = 'checkbox'; input.checked = value;
    input.addEventListener('change',() => change(input.checked)); wrapper.append(input,document.createTextNode(label)); return wrapper;
  }
  function heading(text, action) {const node = element('div','section-heading',text); if (action) node.append(action); return node;}
  function create({project,layer,template,onChange = () => {},onSelect = () => {},onRelation = () => {},confirm = message => root.confirm(message)}) {
    const elements = new Map();
    let selected = '';
    const notify = (render = false, semantic = true) => onChange({render,semantic});
    function update(module, entry, patch) {
      if (entry) EC.Model.updateInterface(project,module.id,entry.id,patch);
      else EC.Model.updateModule(project,module.id,patch);
      refreshSummary(module); notify();
    }
    function refreshSummary(module) {
      const node = elements.get(module.id); if (!node) return;
      node.querySelector('.module-name').textContent = module.name || '未命名模块';
      node.querySelector('.module-purpose').textContent = module.purpose || '展开模块，补充它负责的事情。';
      const state = node.querySelector('.module-status'); state.textContent = statusNames[module.status]; state.dataset.status = module.status;
      const summary = node.querySelector('.module-summary'); summary.replaceChildren();
      if (!module.interfaces.length) summary.append(element('span','empty-note','尚未添加对外接口'));
      for (const entry of module.interfaces) summary.append(element('div','interface-preview',entry.name || '未命名接口'));
      for (const label of node.querySelectorAll('[data-interface-status]')) {
        const entry = module.interfaces.find(item => item.id === label.dataset.interfaceStatus);
        if (entry) label.textContent = statusNames[entry.status];
      }
      // Updating badges never replaces the control receiving keystrokes.
      for (const control of node.querySelectorAll('[data-status-owner]')) {
        const owner = control.dataset.statusOwner === module.id ? module : module.interfaces.find(item => item.id === control.dataset.statusOwner);
        if (owner && control !== document.activeElement) control.value = owner.status;
      }
    }
    function evidence(module, entry) {
      const item = entry || module, details = element('details','evidence-editor');
      details.append(element('summary','','代码出处与待确认事项'));
      const content = element('div','evidence-content'); details.append(content);
      const status = select('核对状态',item.status,Object.entries(statusNames),(value,control) => {
        const trial = {...item,status:value};
        const validSource = trial.sources.some(source => typeof source.path === 'string' && source.path.trim() &&
          (source.line === undefined || Number.isSafeInteger(source.line) && source.line > 0) &&
          (source.endLine === undefined || Number.isSafeInteger(source.endLine) && source.endLine >= source.line));
        if (value === 'verified' && !validSource) {
          control.value = item.status; control.setCustomValidity('请先填写有效的代码出处，再标为已核对。'); control.reportValidity(); return;
        }
        control.setCustomValidity(''); update(module,entry,{status:value});
      });
      status.querySelector('select').dataset.statusOwner = item.id;
      content.append(status);
      const sources = element('div','parameter-list');
      function paintSources() {
        sources.replaceChildren();
        item.sources.forEach((source,index) => {
          const row = element('div','source-row');
          const change = (key,value) => {
            const next = item.sources.map(value => ({...value}));
            if ((key === 'line' || key === 'endLine') && value === '') delete next[index][key];
            else next[index][key] = key === 'line' || key === 'endLine' ? Number(value) : value;
            update(module,entry,{sources:next});
          };
          const path = field('文件路径',source.path,value => change('path',value)); path.classList.add('wide');
          row.append(path);
          for (const [key,label] of [['line','起始行'],['endLine','结束行']]) {
            const input = field(label,source[key],value => change(key,value)); input.querySelector('input').type = 'number'; input.querySelector('input').min = '1'; row.append(input);
          }
          const symbol = field('函数或类名',source.symbol,value => change('symbol',value)); symbol.classList.add('wide');
          row.append(symbol,button('移除出处',() => {update(module,entry,{sources:item.sources.filter((_,i) => i !== index)}); paintSources();},'danger-text'));
          sources.append(row);
        });
      }
      content.append(heading('代码出处',button('＋ 添加出处',() => {update(module,entry,{sources:[...item.sources,{path:''}]}); paintSources();})),sources);
      paintSources();
      content.append(field('待确认事项（每行一项）',item.unknowns.join('\n'),value => update(module,entry,{unknowns:value.split('\n').filter(line => line.trim())}),'textarea'));
      return details;
    }
    function parameters(module, entry, direction) {
      const isInput = direction === 'inputs', label = isInput ? '输入' : '输出', confirmed = `${direction}Confirmed`;
      const section = element('section','editor-section'), list = element('div','parameter-list'), note = element('p','empty-note');
      function paintNote() {note.textContent = entry[confirmed] ? (entry[direction].length ? `已确认 ${entry[direction].length} 项${label}` : `已确认：无${label}参数`) : `${label}尚未确认${entry[direction].length ? '，下方为已记录的草稿' : '，不代表无参数'}`;}
      function paintRows() {
        list.replaceChildren(); paintNote();
        entry[direction].forEach(parameter => {
          const row = element('div','parameter-row'); row.dataset.parameterId = parameter.id;
          const patch = (key,value) => update(module,entry,{[direction]:entry[direction].map(item => item.id === parameter.id ? {...item,[key]:value} : item)});
          row.append(field('参数名',parameter.name,value => patch('name',value)),field('类型',parameter.type,value => patch('type',value)));
          const description = field('参数说明',parameter.description,value => patch('description',value),'textarea'); description.classList.add('wide'); row.append(description);
          const bottom = element('div','row-bottom wide');
          if (isInput) bottom.append(check('必填',parameter.required,value => patch('required',value)));
          bottom.append(button('删除参数',() => {update(module,entry,{[direction]:entry[direction].filter(item => item.id !== parameter.id)}); paintRows();},'danger-text'));
          row.append(bottom); list.append(row);
        });
      }
      section.append(heading(label,button(`＋ 添加${label}`,() => {update(module,entry,{[direction]:[...entry[direction],EC.Model.createParameter()]}); paintRows();})),check(`已确认${label}`,entry[confirmed],value => {update(module,entry,{[confirmed]:value}); paintNote();}),note,list);
      paintRows(); return section;
    }
    function interfaceEditor(module, entry) {
      const section = element('section','interface-editor'); section.dataset.interfaceId = entry.id;
      const header = element('div','interface-heading'), body = element('div','interface-body');
      const toggle = button('',() => {
        const ids = project.view.expandedInterfaces, open = ids.includes(entry.id);
        project.view.expandedInterfaces = open ? ids.filter(id => id !== entry.id) : [...ids,entry.id];
        syncToggle(); notify(false,false);
      },'interface-toggle'); toggle.dataset.interfaceAction = 'toggle';
      function syncToggle() {body.hidden = !project.view.expandedInterfaces.includes(entry.id); toggle.textContent = `${body.hidden ? '▸' : '▾'} ${entry.name || '未命名接口'}`; toggle.setAttribute('aria-expanded',String(!body.hidden));}
      header.append(toggle,button('删除',() => {
        if (!confirm(`删除接口“${entry.name || '未命名接口'}”及其参数？`)) return;
        EC.Model.updateModule(project,module.id,{interfaces:module.interfaces.filter(item => item.id !== entry.id)}); notify(true);
      },'danger-text'));
      body.append(field('接口名称 / 签名',entry.name,value => {update(module,entry,{name:value}); syncToggle();}),field('接口用途',entry.purpose,value => update(module,entry,{purpose:value}),'textarea'));
      const state = element('span','module-status',statusNames[entry.status]); state.dataset.interfaceStatus = entry.id; body.append(state);
      body.append(parameters(module,entry,'inputs'),parameters(module,entry,'outputs'),evidence(module,entry));
      section.append(header,body); syncToggle(); return section;
    }
    function details(module) {
      const body = element('div','editor-section');
      body.append(field('模块名称',module.name,value => update(module,null,{name:value})),field('模块职责',module.purpose,value => update(module,null,{purpose:value}),'textarea'),select('所属分组',module.groupId,[['','不分组'],...project.groups.map(group => [group.id,group.name || '未命名分组'])],value => update(module,null,{groupId:value})));
      body.append(heading('对外接口',button('＋ 添加接口',() => {
        const entry = EC.Model.createInterface(); EC.Model.updateModule(project,module.id,{interfaces:[...module.interfaces,entry]}); project.view.expandedInterfaces.push(entry.id); notify(true);
      })));
      for (const entry of module.interfaces) body.append(interfaceEditor(module,entry));
      body.append(evidence(module,null)); return body;
    }
    function render() {
      // Called only for structural edits; normal input edits update small labels in place.
      layer.replaceChildren(); elements.clear();
      for (const module of project.modules) {
        const fragment = template.content.cloneNode(true), node = fragment.querySelector('.module-node');
        node.dataset.moduleId = module.id; node.setAttribute('aria-label',`模块：${module.name || '未命名'}`);
        node.style.left = `${module.x}px`; node.style.top = `${module.y}px`; node.classList.toggle('selected',selected === module.id);
        const body = node.querySelector('.module-details'); body.append(details(module));
        const toggle = node.querySelector('[data-node-action=toggle]');
        function syncToggle() {body.hidden = !project.view.expanded.includes(module.id); toggle.textContent = body.hidden ? '⌄' : '⌃'; toggle.setAttribute('aria-expanded',String(!body.hidden)); toggle.setAttribute('aria-label',body.hidden ? '展开模块' : '收起模块');}
        toggle.addEventListener('click',() => {project.view.expanded = body.hidden ? [...project.view.expanded,module.id] : project.view.expanded.filter(id => id !== module.id); syncToggle(); notify(false,false);});
        node.querySelector('[data-node-action=relation]').addEventListener('click',() => onRelation(module.id));
        node.querySelector('[data-node-action=delete]').addEventListener('click',() => {
          const count = project.relations.filter(item => item.from === module.id || item.to === module.id).length;
          if (confirm(`删除模块“${module.name || '未命名模块'}”？同时删除 ${count} 条关联关系及模块内全部接口。`)) {EC.Model.removeModule(project,module.id); notify(true);}
        });
        node.addEventListener('pointerdown',() => {selected = module.id; for (const [id,item] of elements) item.classList.toggle('selected',id === selected); onSelect(module.id);});
        elements.set(module.id,node); layer.append(fragment); refreshSummary(module); syncToggle();
      }
    }
    return {render,getElement:id => elements.get(id),destroy() {layer.replaceChildren(); elements.clear();}};
  }
  EC.Nodes = {create};
})(globalThis);
