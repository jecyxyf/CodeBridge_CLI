(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  // The draft owns its data. Nothing reaches the live project until a validated commit.
  function begin(project, moduleId, position = {}) {
    const draft = structuredClone(project);
    let module = draft.modules.find(item => item.id === moduleId);
    if (moduleId && !module) throw new Error('模块已不存在，请重新打开。');
    if (!module) {module = EC.Model.createModule({name:'新模块',...position}); draft.modules.push(module);}
    return {project:draft,module,id:module.id,existing:!!moduleId,snapshot:JSON.stringify(module)};
  }
  function hasChanges(session) {return JSON.stringify(session.module) !== session.snapshot;}
  function commit(project, session) {
    const current = project.modules.find(item => item.id === session.id);
    if (session.module.id !== session.id) throw new Error('模块标识不能修改。');
    if (session.existing && (!current || JSON.stringify(current) !== session.snapshot)) throw new Error('模块已发生变化，请取消后重新打开。');
    if (!session.existing && current) throw new Error('模块标识重复，请重新新建。');
    if (session.existing && !hasChanges(session)) return false;
    const trial = structuredClone(project), module = structuredClone(session.module);
    if (session.existing) trial.modules[trial.modules.findIndex(item => item.id === session.id)] = module;
    else trial.modules.push(module);
    // Keep legacy expansion data, removing only references to deleted interfaces.
    const removed = new Set(current?.interfaces.filter(entry => !module.interfaces.some(item => item.id === entry.id)).map(entry => entry.id));
    trial.view.expandedInterfaces = trial.view.expandedInterfaces.filter(id => !removed.has(id));
    const {errors} = EC.Model.validate(trial);
    if (errors.length) throw new Error(`无法确定：${errors[0].message}。请检查层级、接口和代码出处。`);
    if (current) Object.assign(current,module); else project.modules.push(module);
    project.view.expandedInterfaces = trial.view.expandedInterfaces;
    return true;
  }
  const statusNames = {planned:'方案',verified:'已核对源码',modified:'已修改 · 待核对'};
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(icon, label, action, className = '') {
    const node = element('button',className); EC.Icons.set(node,icon,label); node.type = 'button'; node.addEventListener('click',action); return node;
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
  function create({session,confirm = message => root.confirm(message)}) {
    const {project,module} = session, editor = element('div','module-editor');
    const expanded = new Set(project.view.expandedInterfaces);
    const interfaces = element('div','interface-list');
    function update(module, entry, patch) {
      if (entry) EC.Model.updateInterface(project,module.id,entry.id,patch);
      else EC.Model.updateModule(project,module.id,patch);
      refreshStatus();
    }
    function refreshStatus() {
      for (const label of editor.querySelectorAll('[data-editor-status]')) {
        const owner = label.dataset.editorStatus === module.id ? module : module.interfaces.find(item => item.id === label.dataset.editorStatus);
        if (owner) {label.textContent = statusNames[owner.status]; label.dataset.status = owner.status;}
      }
      for (const control of editor.querySelectorAll('[data-status-owner]')) {
        const owner = control.dataset.statusOwner === module.id ? module : module.interfaces.find(item => item.id === control.dataset.statusOwner);
        if (owner) control.value = owner.status;
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
          control.value = item.status; control.setCustomValidity('请先填写有效的代码出处，再标为已核对。'); control.reportValidity(); control.setCustomValidity(''); return;
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
          row.append(symbol,button('trash','移除出处',() => {update(module,entry,{sources:item.sources.filter((_,i) => i !== index)}); paintSources();},'danger-text'));
          sources.append(row);
        });
      }
      content.append(heading('代码出处',button('add','添加出处',() => {update(module,entry,{sources:[...item.sources,{path:''}]}); paintSources();})),sources);
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
          bottom.append(button('trash','删除参数',() => {update(module,entry,{[direction]:entry[direction].filter(item => item.id !== parameter.id)}); paintRows();},'danger-text'));
          row.append(bottom); list.append(row);
        });
      }
      section.append(heading(label,button('add',`添加${label}`,() => {update(module,entry,{[direction]:[...entry[direction],EC.Model.createParameter()]}); paintRows();})),check(`已确认${label}`,entry[confirmed],value => {update(module,entry,{[confirmed]:value}); paintNote();}),note,list);
      paintRows(); return section;
    }
    function interfaceEditor(module, entry) {
      const section = element('section','interface-editor'); section.dataset.interfaceId = entry.id;
      const header = element('div','interface-heading'), body = element('div','interface-body'), name = element('span','interface-name');
      const toggle = button('chevron-right','展开接口',() => {
        if (expanded.has(entry.id)) expanded.delete(entry.id); else expanded.add(entry.id);
        syncToggle();
      },'interface-toggle'); toggle.dataset.interfaceAction = 'toggle';
      function syncToggle() {
        body.hidden = !expanded.has(entry.id); name.textContent = entry.name || '未命名接口';
        EC.Icons.set(toggle,body.hidden ? 'chevron-right' : 'chevron-down',`${body.hidden ? '展开' : '收起'}接口：${name.textContent}`); toggle.setAttribute('aria-expanded',String(!body.hidden));
      }
      header.append(toggle,name,button('trash','删除接口',() => {
        if (!confirm(`删除接口“${entry.name || '未命名接口'}”及其参数？`)) return;
        update(module,null,{interfaces:module.interfaces.filter(item => item.id !== entry.id)}); expanded.delete(entry.id); paintInterfaces();
      },'danger-text'));
      body.append(field('接口名称 / 签名',entry.name,value => {update(module,entry,{name:value}); syncToggle();}),field('接口用途',entry.purpose,value => update(module,entry,{purpose:value}),'textarea'));
      const state = element('span','module-status',statusNames[entry.status]); state.dataset.editorStatus = entry.id; body.append(state);
      body.append(parameters(module,entry,'inputs'),parameters(module,entry,'outputs'),evidence(module,entry));
      section.append(header,body); syncToggle(); return section;
    }
    const basics = element('section','editor-section module-basics');
    const state = element('span','module-status'); state.dataset.editorStatus = module.id;
    basics.append(heading('基本信息'),field('模块名称',module.name,value => update(module,null,{name:value})),field('模块职责',module.purpose,value => update(module,null,{purpose:value}),'textarea'),select('所属层级',module.groupId,[['','不属于层级'],...project.groups.map(group => [group.id,group.name || '未命名层级'])],value => update(module,null,{groupId:value})),state);
    const apiSection = element('section','editor-section module-interfaces');
    function paintInterfaces() {
      interfaces.replaceChildren();
      if (!module.interfaces.length) interfaces.append(element('p','empty-note','尚未添加接口。'));
      for (const entry of module.interfaces) interfaces.append(interfaceEditor(module,entry));
      refreshStatus();
    }
    apiSection.append(heading('对外接口',button('add','添加接口',() => {
      const entry = EC.Model.createInterface(); update(module,null,{interfaces:[...module.interfaces,entry]}); expanded.add(entry.id); paintInterfaces();
    })),interfaces);
    editor.append(element('p','dialog-note','修改后点击“确定”更新模块，再用顶部“保存”写入 HTML。'),basics,apiSection,evidence(module,null));
    paintInterfaces(); return editor;
  }
  EC.ModuleEditor = {begin,hasChanges,commit,create};
})(globalThis);
