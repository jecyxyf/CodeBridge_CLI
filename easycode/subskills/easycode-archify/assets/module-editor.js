(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  // The draft owns its data. Nothing reaches the live project until a validated commit.
  function begin(project, moduleId, position = {}) {
    const draft = structuredClone(project);
    let module = draft.modules.find(item => item.id === moduleId);
    if (moduleId && !module) throw new Error('模块已不存在，请重新打开。');
    if (!module) {module = EC.Model.createModule({...position,items:draft.modules}); draft.modules.push(module);}
    return {project:draft,module,id:module.id,existing:!!moduleId,snapshot:JSON.stringify(module)};
  }
  function hasChanges(session) {return JSON.stringify(session.module) !== session.snapshot;}
  function commit(project, session) {
    const current = project.modules.find(item => item.id === session.id);
    if (session.module.id !== session.id) throw new Error('模块标识不能修改。');
    if (session.existing && (!current || JSON.stringify(current) !== session.snapshot)) throw new Error('模块已发生变化，请取消后重新打开。');
    if (!session.existing && current) throw new Error('模块标识重复，请重新新建。');
    const trial = structuredClone(project), module = structuredClone(session.module);
    if (module.codeLocation !== undefined) module.codeLocation = EC.Model.normalizeCodeLocation(module.codeLocation);
    if (session.existing) trial.modules[trial.modules.findIndex(item => item.id === session.id)] = module;
    else trial.modules.push(module);
    // Keep legacy expansion data, removing only references to deleted interfaces.
    const removed = new Set(current?.interfaces.filter(entry => !module.interfaces.some(item => item.id === entry.id)).map(entry => entry.id));
    trial.view.expandedInterfaces = trial.view.expandedInterfaces.filter(id => !removed.has(id));
    const {errors} = EC.Model.validate(trial);
    if (errors.length) throw new Error(`无法确定：${errors[0].message}。请检查模块内容、层级和代码出处。`);
    EC.Model.fillModuleDefaults(module,trial.modules);
    if (session.existing && JSON.stringify(module) === session.snapshot) return false;
    if (current) Object.assign(current,module); else project.modules.push(module);
    project.view.expandedInterfaces = trial.view.expandedInterfaces;
    return true;
  }
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
  function create({session,confirm = message => EC.Dialogs.confirm(message),onSummaryChange = () => {}}) {
    const {project,module} = session, editor = element('div','module-editor');
    let sectionId = 0;
    const itemName = item => [item.name,item.englishName].filter(value => value?.trim()).join(' / ');
    function addInPlace(control,insert) {
      const form = control.closest('.module-dialog form'), scroller = control.closest('.dialog-body');
      const scrollTop = scroller?.scrollTop, scrollLeft = scroller?.scrollLeft;
      // Freeze only this form's height so the centered dialog cannot move the add button.
      if (form) form.style.height = `${form.getBoundingClientRect().height}px`;
      insert(); control.focus({preventScroll:true});
      if (scroller) {scroller.scrollTop = scrollTop; scroller.scrollLeft = scrollLeft;}
    }
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
      const [source,target] = row.querySelectorAll('input');
      EC.Translation.attach({source,target,kind:kind === '模块' ? 'module' : kind === '数据结构' ? 'class' : 'parameter'});
      return row;
    }
    function collection({title,key,kind,getItems,setItems,createItem,build,confirmDelete = false,afterChange = () => {}}) {
      const group = fold(title,{key}), list = element('div','member-list'), empty = element('p','empty-note',`尚未添加${title}。`);
      group.body.append(empty,list);
      function syncCount() {group.setCount(getItems().length); empty.hidden = !!getItems().length; afterChange();}
      function append(item) {
        const row = fold(itemName(item) || `未命名${kind}`,{className:'member-editor'});
        row.section.dataset.memberId = item.id;
        if (key === 'methods') {
          row.section.classList.add('interface-editor'); row.section.dataset.interfaceId = item.id;
          row.body.classList.add('interface-body'); row.toggle.dataset.interfaceAction = 'toggle';
        } else if (kind === '参数') row.section.dataset.parameterId = item.id;
        row.header.append(button('trash',`删除${kind}`,async () => {
          const current = getItems().find(value => value.id === item.id);
          if (confirmDelete && !await confirm(`删除${kind}“${itemName(current) || `未命名${kind}`}”及其内容？`)) return;
          if (!row.section.isConnected) return;
          setItems(getItems().filter(value => value.id !== item.id)); row.section.remove(); syncCount(); group.toggle.focus({preventScroll:true});
        },'member-delete'));
        build(item,row.body,() => row.setTitle(itemName(getItems().find(value => value.id === item.id)) || `未命名${kind}`));
        list.append(row.section);
        return row;
      }
      const add = button('add',`添加${title}`,() => addInPlace(add,() => {
        const item = createItem(getItems()); setItems([...getItems(),item]);
        append(item); syncCount();
      }),'group-add');
      group.header.append(add);
      for (const item of getItems()) append(item);
      syncCount(); return group;
    }
    function update(module, entry, patch) {
      if (entry) EC.Model.updateInterface(project,module.id,entry.id,patch);
      else EC.Model.updateModule(project,module.id,patch);
      if (!entry) onSummaryChange(module);
    }
    function parameterFields(item,body,patch,{required = false} = {}) {
      const values = element('div','parameter-value-fields');
      values.append(field('类型',item.type,value => patch('type',value)),field('默认值（选填）',item.defaultValue,value => patch('defaultValue',value)));
      body.append(names('参数',item,patch),values,field('参数说明',item.description,value => patch('description',value),'textarea'));
      if (required) body.append(check('必填',item.required,value => patch('required',value)));
    }
    function parameterGroup({title,key,getItems,setItems,required = false,afterChange}) {
      return collection({title,key,kind:'参数',getItems,setItems,createItem:EC.Model.createParameter,afterChange,
        build(item,body,rename) {
          parameterFields(item,body,(key,value) => {setItems(getItems().map(current => current.id === item.id ? {...current,[key]:value} : current)); rename();},{required});
        }});
    }
    function methodParameters(entry,direction) {
      const isInput = direction === 'inputs', title = isInput ? '输入参数' : '返回结果';
      return parameterGroup({title,key:direction,getItems:() => entry[direction],setItems:items => update(module,entry,{[direction]:items}),required:isInput}).section;
    }
    function methodSteps(entry,key) {
      const flow = key === 'flow', title = flow ? '实现流程' : '错误处理', item = flow ? '步骤' : '错误处理', label = flow ? '实现步骤' : '错误处理';
      const group = fold(title,{key}), list = element('div','flow-step-list');
      const empty = element('p','empty-note',`点击右上角“＋”添加${label}。`);
      const values = entry[key] ? entry[key].split(/\r\n|\r|\n/) : [];
      const separator = entry[key]?.match(/\r\n|\r|\n/)?.[0] || '\n';
      const save = () => update(module,entry,{[key]:values.join(separator)});
      function sync() {
        group.setCount(values.length); empty.hidden = !!values.length; list.hidden = !values.length;
        [...list.children].forEach((row,index) => {
          row.querySelector('.flow-step-index').textContent = String(index + 1);
          row.querySelector('input').setAttribute('aria-label',`${label} ${index + 1}`);
          const remove = row.querySelector('button'), removeLabel = `删除${item} ${index + 1}`;
          remove.setAttribute('aria-label',removeLabel); remove.title = removeLabel;
        });
      }
      function append(value) {
        const row = element('div','flow-step-row'), index = element('span','flow-step-index'), input = element('input');
        index.setAttribute('aria-hidden','true'); input.value = value; input.placeholder = flow ? '填写一个实现步骤' : '填写一条错误处理';
        input.addEventListener('input',() => {
          const position = [...list.children].indexOf(row); if (position < 0) return;
          values[position] = input.value; save();
        });
        row.append(index,input,button('trash',`删除${item}`,() => {
          const position = [...list.children].indexOf(row); if (position < 0) return;
          values.splice(position,1); save(); row.remove(); sync();
          (list.children[position]?.querySelector('input') || list.lastElementChild?.querySelector('input') || add).focus({preventScroll:true});
        },'member-delete'));
        list.append(row);
      }
      const add = button('add',`新增${item}`,() => addInPlace(add,() => {
        const value = `${item}${values.length + 1}`; values.push(value); save(); append(value); sync();
      }),'group-add');
      group.header.append(add); group.body.append(empty,list);
      for (const value of values) append(value);
      sync(); return group.section;
    }
    function methodFields(entry,body,rename) {
      body.append(names('方法',entry,(key,value) => {update(module,entry,{[key]:value}); rename();}),field('方法用途',entry.purpose,value => update(module,entry,{purpose:value}),'textarea'));
      body.append(methodParameters(entry,'inputs'),methodParameters(entry,'outputs'));
      body.append(methodSteps(entry,'flow'),methodSteps(entry,'errors'));
    }
    function structureFields(entry,patch) {
      const section = element('section','structure-fields'), heading = element('div','structure-fields-heading');
      const list = element('div','structure-field-list'), empty = element('p','empty-note','点击“＋”添加字段。');
      const items = () => entry.fields;
      function sync() {
        empty.hidden = items().length > 0;
        [...list.children].forEach((row,index) => {
          const remove = row.querySelector('.member-delete'), label = `删除字段 ${index + 1}`;
          remove.setAttribute('aria-label',label); remove.title = label;
        });
      }
      function append(item) {
        const row = element('div','structure-field-row'); row.dataset.fieldId = item.id;
        const change = (key,value) => patch('fields',items().map(current => current.id === item.id ? {...current,[key]:value} : current));
        row.append(field('中文名',item.name,value => change('name',value)),field('英文名',item.englishName,value => change('englishName',value)),field('变量类型',item.type,value => change('type',value)),field('作用',item.description,value => change('description',value)));
        const [source,target] = row.querySelectorAll('input');
        EC.Translation.attach({source,target,kind:'parameter'});
        row.append(button('trash','删除字段',() => {
          const index = items().findIndex(value => value.id === item.id);
          patch('fields',items().filter(value => value.id !== item.id)); row.remove(); sync();
          (list.children[index]?.querySelector('input') || list.lastElementChild?.querySelector('input') || add).focus({preventScroll:true});
        },'member-delete'));
        list.append(row); return source;
      }
      const add = button('add','新增字段',() => {
        const item = EC.Model.createStructureField(items()); patch('fields',[...items(),item]);
        const input = append(item); sync(); input.focus({preventScroll:true}); input.scrollIntoView?.({block:'nearest'});
      },'group-add');
      heading.append(element('span','','结构定义'),add); section.append(heading,empty,list);
      for (const item of items()) append(item);
      sync(); return section;
    }
    function requirementGroup() {
      const group = fold('功能需求',{key:'requirements'}), list = element('div','requirement-list');
      const empty = element('p','empty-note','点击右上角“＋”添加具体需求。');
      const items = () => module.requirements || [];
      function sync() {
        const count = items().length;
        group.setCount(count); empty.hidden = count > 0; list.hidden = count === 0;
        [...list.children].forEach((row,index) => {
          row.querySelector('textarea').setAttribute('aria-label',`功能需求 ${index + 1}`);
          const remove = row.querySelector('button'), label = `删除需求 ${index + 1}`;
          remove.setAttribute('aria-label',label); remove.title = label;
        });
      }
      function append(value) {
        const row = element('div','requirement-row'), input = element('textarea');
        input.value = value; input.rows = 2; input.placeholder = '填写一条具体的模块需求';
        const rowIndex = () => [...list.children].indexOf(row);
        input.addEventListener('input',() => {
          const index = rowIndex(); if (index < 0) return;
          update(module,null,{requirements:items().map((value,i) => i === index ? input.value : value)});
        });
        row.append(input,button('trash','删除需求',() => {
          const index = rowIndex(); if (index < 0) return;
          update(module,null,{requirements:items().filter((_,i) => i !== index)});
          row.remove(); sync();
          (list.children[index]?.querySelector('textarea') || list.lastElementChild?.querySelector('textarea') || add).focus({preventScroll:true});
        },'member-delete'));
        list.append(row); return input;
      }
      const add = button('add','新增需求',() => addInPlace(add,() => {
        update(module,null,{requirements:[...items(),'']});
        append(''); sync();
      }),'group-add');
      group.header.append(add); group.body.append(empty,list);
      for (const value of items()) append(value);
      sync(); return group;
    }
    const appearance = fold('外观',{key:'appearance'});
    appearance.body.classList.add('module-appearance-fields');
    for (const [key,label] of [['textColor','字体颜色'],['backgroundColor','背景颜色'],['headerColor','标题栏颜色']]) {
      const wrapper = element('label','field'), input = element('input'), value = element('span','color-value');
      input.type = 'color'; input.value = EC.Model.moduleAppearance(module)[key]; input.setAttribute('aria-label',label);
      value.id = `${module.id}-${key}-value`; value.textContent = input.value.toUpperCase(); input.setAttribute('aria-describedby',value.id);
      input.addEventListener('input',() => {
        update(module,null,{appearance:{...EC.Model.moduleAppearance(module),[key]:input.value}});
        value.textContent = input.value.toUpperCase();
      });
      wrapper.append(element('span','',label),input,value); appearance.body.append(wrapper);
    }
    const basics = fold('模块信息',{key:'basics',className:'module-basics'});
    const location = field('代码位置',module.codeLocation,value => update(module,null,{codeLocation:value}),'textarea');
    const locationInput = location.querySelector('textarea');
    locationInput.placeholder = './testmodel.cpp\n./testmodel.h'; locationInput.spellcheck = false;
    const locationNote = element('span','field-note','相对项目代码目录，每行一个文件或目录。');
    locationNote.id = `${module.id}-location-note`; locationInput.setAttribute('aria-describedby',locationNote.id); location.append(locationNote);
    const language = field('编程语言',module.language,value => update(module,null,{language:value}));
    const languageInput = language.querySelector('input'), languages = element('datalist'); languages.id = `${module.id}-languages`;
    languageInput.setAttribute('list',languages.id); languageInput.placeholder = '选择或输入语言';
    for (const value of ['C','C++','C#','Java','JavaScript','TypeScript','Python','Go','Rust','Kotlin','Swift','Dart','PHP','Ruby','Lua']) {
      const option = element('option'); option.value = value; languages.append(option);
    }
    language.append(languages);
    basics.body.append(names('模块',module,(key,value) => update(module,null,{[key]:value})),field('模块功能',module.purpose,value => update(module,null,{purpose:value}),'textarea'),language,location,select('所属层级',module.groupId,[['','无'],...project.groups.map(group => [group.id,group.name || '未命名层级'])],value => update(module,null,{groupId:value})));
    const requirements = requirementGroup();
    const parameters = parameterGroup({title:'参数',key:'parameters',getItems:() => module.parameters || [],setItems:items => update(module,null,{parameters:items})});
    const structures = collection({title:'数据结构',key:'structures',kind:'数据结构',getItems:() => module.structures || [],setItems:items => update(module,null,{structures:items}),createItem:EC.Model.createStructure,confirmDelete:true,
      build(entry,body,rename) {
        const patch = (key,value) => EC.Model.updateMember(project,module.id,'structures',entry.id,{[key]:value});
        body.append(names('数据结构',entry,(key,value) => {patch(key,value); rename();}),structureFields(entry,patch));
      }});
    const methods = collection({title:'方法',key:'methods',kind:'方法',getItems:() => module.interfaces,setItems:items => update(module,null,{interfaces:items}),createItem:EC.Model.createInterface,confirmDelete:true,build:methodFields});
    const events = collection({title:'消息事件',key:'events',kind:'事件',getItems:() => module.events || [],setItems:items => update(module,null,{events:items}),createItem:EC.Model.createEvent,confirmDelete:true,
      build(entry,body,rename) {
        const patch = (key,value) => {EC.Model.updateMember(project,module.id,'events',entry.id,{[key]:value});};
        body.append(names('事件',entry,(key,value) => {patch(key,value); rename();}),field('事件说明',entry.description,value => patch('description',value),'textarea'),select('事件方向',entry.direction,[['emit','发出'],['receive','接收']],value => patch('direction',value)));
        body.append(parameterGroup({title:'携带的数据',key:'payload',getItems:() => entry.parameters,setItems:items => patch('parameters',items)}).section);
      }});
    const tests = collection({title:'测试项',key:'tests',kind:'测试项',getItems:() => module.tests || [],setItems:items => update(module,null,{tests:items}),createItem:EC.Model.createTest,confirmDelete:true,
      build(entry,body,rename) {
        const patch = (key,value) => {EC.Model.updateMember(project,module.id,'tests',entry.id,{[key]:value});};
        body.append(names('测试项',entry,(key,value) => {patch(key,value); rename();}),field('测试步骤',entry.steps,value => patch('steps',value),'textarea'),field('预期结果',entry.expected,value => patch('expected',value),'textarea'));
      }});
    editor.append(element('p','dialog-note','点击组标题展开或收起。修改后点“确定”，再用顶部“保存”写入 HTML。'),appearance.section,basics.section,requirements.section,parameters.section,structures.section,methods.section,events.section,tests.section);
    return editor;
  }
  EC.ModuleEditor = {begin,hasChanges,commit,create};
})(globalThis);
