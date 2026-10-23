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
    if (errors.length) throw new Error(`无法确定：${errors[0].message}。请检查模块内容、层级和代码出处。`);
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
    let sectionId = 0;
    const itemName = item => [item.name,item.englishName].filter(value => value?.trim()).join(' / ');
    function fold(title,{open = false,key = '',className = ''} = {}) {
      const section = element('section',`editor-fold ${className}`.trim()), header = element('div','fold-heading');
      const toggle = element('button','fold-toggle'), icon = element('span','fold-icon'), name = element('span','fold-title'), count = element('span','fold-count');
      const body = element('div','fold-body'); body.id = `${module.id}-section-${++sectionId}`;
      toggle.type = 'button'; toggle.setAttribute('aria-controls',body.id); toggle.append(icon,name,count); header.append(toggle); section.append(header,body);
      if (key) section.dataset.editorGroup = key;
      function sync() {
        body.hidden = !open; icon.replaceChildren(EC.Icons.create(open ? 'chevron-down' : 'chevron-right'));
        name.textContent = title; toggle.setAttribute('aria-expanded',String(open)); toggle.setAttribute('aria-label',`${open ? '收起' : '展开'}${title}`);
      }
      function expand(value = true) {open = value; sync();}
      toggle.addEventListener('click',() => expand(!open)); sync();
      return {section,header,body,toggle,expand,setTitle(value) {title = value; sync();},setCount(value) {count.textContent = String(value);}};
    }
    function names(kind,item,patch) {
      const row = element('div','bilingual-fields');
      row.append(field(`${kind}中文名`,item.name,value => patch('name',value)),field(`${kind}英文名`,item.englishName,value => patch('englishName',value)));
      return row;
    }
    function collection({title,key,kind,getItems,setItems,createItem,build,confirmDelete = false,afterChange = () => {}}) {
      const group = fold(title,{key}), list = element('div','member-list'), empty = element('p','empty-note',`尚未添加${title}。`);
      group.body.append(empty,list);
      function syncCount() {group.setCount(getItems().length); empty.hidden = !!getItems().length; afterChange();}
      function append(item,open = false) {
        const row = fold(itemName(item) || `未命名${kind}`,{open,className:'member-editor'});
        row.section.dataset.memberId = item.id;
        if (key === 'methods') {
          row.section.classList.add('interface-editor'); row.section.dataset.interfaceId = item.id;
          row.body.classList.add('interface-body'); row.toggle.dataset.interfaceAction = 'toggle';
        } else if (kind === '参数') row.section.dataset.parameterId = item.id;
        row.header.append(button('trash',`删除${kind}`,() => {
          const current = getItems().find(value => value.id === item.id);
          if (confirmDelete && !confirm(`删除${kind}“${itemName(current) || `未命名${kind}`}”及其内容？`)) return;
          setItems(getItems().filter(value => value.id !== item.id)); row.section.remove(); syncCount(); group.toggle.focus({preventScroll:true});
        },'member-delete'));
        build(item,row.body,() => row.setTitle(itemName(getItems().find(value => value.id === item.id)) || `未命名${kind}`));
        list.append(row.section);
        if (open) row.body.querySelector('input,textarea,select')?.focus({preventScroll:true});
        return row;
      }
      group.header.append(button('add',`添加${title}`,() => {
        const item = createItem(); setItems([...getItems(),item]); group.expand(); const row = append(item,true); syncCount();
        row.section.scrollIntoView?.({block:'nearest'});
      },'group-add'));
      for (const item of getItems()) append(item);
      syncCount(); return group;
    }
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
    function parameterFields(item,body,patch,{required = false,defaults = false} = {}) {
      body.append(names('参数',item,patch),field('类型',item.type,value => patch('type',value)),field('参数说明',item.description,value => patch('description',value),'textarea'));
      if (defaults) body.append(field('默认值（选填）',item.defaultValue,value => patch('defaultValue',value)));
      if (required) body.append(check('必填',item.required,value => patch('required',value)));
    }
    function parameterGroup({title,key,getItems,setItems,required = false,defaults = false,afterChange}) {
      return collection({title,key,kind:'参数',getItems,setItems,createItem:EC.Model.createParameter,afterChange,
        build(item,body,rename) {
          parameterFields(item,body,(key,value) => {setItems(getItems().map(current => current.id === item.id ? {...current,[key]:value} : current)); rename();},{required,defaults});
        }});
    }
    function methodParameters(entry,direction) {
      const isInput = direction === 'inputs', title = isInput ? '输入参数' : '返回结果', confirmed = `${direction}Confirmed`, note = element('p','empty-note');
      function paintNote() {note.textContent = entry[confirmed] ? (entry[direction].length ? `已确认 ${entry[direction].length} 项${title}` : `已确认：无${title}`) : `${title}尚未确认，不代表没有。`;}
      const group = parameterGroup({title,key:direction,getItems:() => entry[direction],setItems:items => update(module,entry,{[direction]:items}),required:isInput,defaults:isInput,afterChange:paintNote});
      group.body.prepend(check(`已确认${title}`,entry[confirmed],value => {update(module,entry,{[confirmed]:value}); paintNote();}),note);
      return group.section;
    }
    function methodFields(entry,body,rename) {
      body.append(names('方法',entry,(key,value) => {update(module,entry,{[key]:value}); rename();}),field('方法用途',entry.purpose,value => update(module,entry,{purpose:value}),'textarea'));
      body.append(methodParameters(entry,'inputs'),methodParameters(entry,'outputs'));
      const flow = fold('实现流程',{key:'flow'});
      flow.body.append(field('实现流程（选填）',entry.flow,value => update(module,entry,{flow:value}),'textarea'));
      body.append(flow.section,field('可能的错误（选填）',entry.errors,value => update(module,entry,{errors:value}),'textarea'));
      const state = element('span','module-status',statusNames[entry.status]); state.dataset.editorStatus = entry.id;
      body.append(state,evidence(module,entry));
    }
    const basics = fold('模块信息',{open:true,key:'basics',className:'module-basics'});
    const location = field('代码位置',module.codeLocation ?? module.sources.map(source => `${source.path}${source.line ? `:${source.line}` : ''}`).join('\n'),value => update(module,null,{codeLocation:value}),'textarea');
    const state = element('span','module-status'); state.dataset.editorStatus = module.id;
    basics.body.append(names('模块',module,(key,value) => update(module,null,{[key]:value})),field('模块职责',module.purpose,value => update(module,null,{purpose:value}),'textarea'),location,select('所属层级',module.groupId,[['','不属于层级'],...project.groups.map(group => [group.id,group.name || '未命名层级'])],value => update(module,null,{groupId:value})),state,evidence(module,null));
    const parameters = parameterGroup({title:'参数',key:'parameters',getItems:() => module.parameters || [],setItems:items => update(module,null,{parameters:items}),defaults:true});
    const methods = collection({title:'方法',key:'methods',kind:'方法',getItems:() => module.interfaces,setItems:items => update(module,null,{interfaces:items}),createItem:EC.Model.createInterface,confirmDelete:true,build:methodFields});
    const events = collection({title:'消息事件',key:'events',kind:'事件',getItems:() => module.events || [],setItems:items => update(module,null,{events:items}),createItem:EC.Model.createEvent,confirmDelete:true,
      build(entry,body,rename) {
        const patch = (key,value) => {EC.Model.updateMember(project,module.id,'events',entry.id,{[key]:value}); refreshStatus();};
        body.append(names('事件',entry,(key,value) => {patch(key,value); rename();}),field('事件说明',entry.description,value => patch('description',value),'textarea'),select('事件方向',entry.direction,[['emit','发出'],['receive','接收']],value => patch('direction',value)),field('触发条件',entry.trigger,value => patch('trigger',value),'textarea'));
        body.append(parameterGroup({title:'携带的数据',key:'payload',getItems:() => entry.parameters,setItems:items => patch('parameters',items)}).section);
      }});
    const tests = collection({title:'测试项',key:'tests',kind:'测试项',getItems:() => module.tests || [],setItems:items => update(module,null,{tests:items}),createItem:EC.Model.createTest,confirmDelete:true,
      build(entry,body,rename) {
        const patch = (key,value) => {EC.Model.updateMember(project,module.id,'tests',entry.id,{[key]:value}); refreshStatus();};
        body.append(field('测试名称',entry.name,value => {patch('name',value); rename();}),field('测试步骤',entry.steps,value => patch('steps',value),'textarea'),field('预期结果',entry.expected,value => patch('expected',value),'textarea'));
      }});
    editor.append(element('p','dialog-note','点击组标题展开或收起。修改后点“确定”，再用顶部“保存”写入 HTML。'),basics.section,heading('对外接口'),parameters.section,methods.section,events.section,tests.section);
    refreshStatus(); return editor;
  }
  EC.ModuleEditor = {begin,hasChanges,commit,create};
})(globalThis);
