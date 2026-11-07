globalThis.EasyCode.register("module-editor",function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const t = (key, params) => EC.I18n.t(key, params);
  const kindKeys = {"Module":"moduleEditor.kind.module","Parameter":"moduleEditor.kind.parameter","Method":"moduleEditor.kind.method","Data structures":"moduleEditor.kind.structure","Event":"moduleEditor.kind.event","Tests":"moduleEditor.kind.test"};
  const kindLabel = kind => kindKeys[kind] ? t(kindKeys[kind]) : kind;
  // The draft owns its data. Nothing reaches the live project until a validated commit.
  function begin(project, moduleId, position = {}) {
    const draft = structuredClone(project);
    let module = draft.modules.find(item => item.id === moduleId);
    if (moduleId && !module) throw new Error(t('moduleEditor.error.moduleMissing'));
    if (!module) {module = EC.Model.createModule({...position,items:draft.modules}); draft.modules.push(module);}
    return {project:draft,module,id:module.id,existing:!!moduleId,snapshot:JSON.stringify(module)};
  }
  function hasChanges(session) {return JSON.stringify(session.module) !== session.snapshot;}
  function commit(project, session) {
    const current = project.modules.find(item => item.id === session.id);
    if (session.module.id !== session.id) throw new Error(t('moduleEditor.error.immutableId'));
    if (session.existing && (!current || JSON.stringify(current) !== session.snapshot)) throw new Error(t('moduleEditor.error.moduleChanged'));
    if (!session.existing && current) throw new Error(t('moduleEditor.error.duplicateId'));
    if (session.existing && !hasChanges(session)) return false;
    const trial = structuredClone(project), module = structuredClone(session.module);
    if (module.codeLocation !== undefined && (!session.existing || module.codeLocation !== current.codeLocation)) {
      module.codeLocation = EC.Model.normalizeCodeLocation(module.codeLocation);
    }
    if (session.existing) trial.modules[trial.modules.findIndex(item => item.id === session.id)] = module;
    else trial.modules.push(module);
    // Keep legacy expansion data, removing only references to deleted interfaces.
    const removed = new Set(current?.interfaces.filter(entry => !module.interfaces.some(item => item.id === entry.id)).map(entry => entry.id));
    trial.view.expandedInterfaces = trial.view.expandedInterfaces.filter(id => !removed.has(id));
    const {errors} = EC.Model.validate(trial);
    if (errors.length) throw new Error(t('moduleEditor.error.invalidContent',{message:errors[0].message}));
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
    const itemName = item => [item.name,item.englishName].filter(value => value?.trim()).join(t('moduleEditor.nameSeparator'));
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
        name.textContent = title; toggle.setAttribute('aria-expanded',String(open)); toggle.setAttribute('aria-label',t(open ? 'moduleEditor.collapseSection' : 'moduleEditor.expandSection',{title}));
      }
      function expand(value = true) {open = value; sync();}
      toggle.addEventListener('click',() => expand(!open)); sync();
      return {section,header,body,toggle,expand,setTitle(value) {title = value; sync();},setCount(value) {count.textContent = String(value);}};
    }
    function names(kind,item,patch) {
      const row = element('div','bilingual-fields');
      row.append(field(t('moduleEditor.displayName',{kind:kindLabel(kind)}),item.name,value => patch('name',value)),field(t('moduleEditor.codeName',{kind:kindLabel(kind)}),item.englishName,value => patch('englishName',value)));
      const [source,target] = row.querySelectorAll('input');
      EC.Translation.attach({source,target,kind:kind === 'Module' ? 'module' : kind === 'Data structures' ? 'class' : 'parameter'});
      return row;
    }
    function collection({title,key,kind,getItems,setItems,createItem,build,confirmDelete = false,afterChange = () => {}}) {
      const group = fold(title,{key}), list = element('div','member-list'), empty = element('p','empty-note',t('moduleEditor.emptyCollection',{title:title.toLowerCase()}));
      group.body.append(empty,list);
      function syncCount() {group.setCount(getItems().length); empty.hidden = !!getItems().length; afterChange();}
      function append(item) {
        const row = fold(itemName(item) || t('moduleEditor.unnamedItem',{kind:kindLabel(kind)}),{className:'member-editor'});
        row.section.dataset.memberId = item.id;
        if (key === 'methods') {
          row.section.classList.add('interface-editor'); row.section.dataset.interfaceId = item.id;
          row.body.classList.add('interface-body'); row.toggle.dataset.interfaceAction = 'toggle';
        } else if (kind === 'Parameter') row.section.dataset.parameterId = item.id;
        row.header.append(button('trash',t('moduleEditor.deleteItem',{kind:kindLabel(kind)}),async () => {
          const current = getItems().find(value => value.id === item.id);
          if (confirmDelete && !await confirm(t('moduleEditor.confirmDeleteItem',{kind:kindLabel(kind),name:itemName(current) || t('moduleEditor.unnamedItem',{kind:kindLabel(kind)})}))) return;
          if (!row.section.isConnected) return;
          setItems(getItems().filter(value => value.id !== item.id)); row.section.remove(); syncCount(); group.toggle.focus({preventScroll:true});
        },'member-delete'));
        build(item,row.body,() => row.setTitle(itemName(getItems().find(value => value.id === item.id)) || t('moduleEditor.unnamedItem',{kind:kindLabel(kind)})));
        list.append(row.section);
        return row;
      }
      const add = button('add',t('moduleEditor.addItem',{title}),() => addInPlace(add,() => {
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
      values.append(field(t('moduleEditor.type'),item.type,value => patch('type',value)),field(t('moduleEditor.defaultValue'),item.defaultValue,value => patch('defaultValue',value)));
      body.append(names('Parameter',item,patch),values,field(t('moduleEditor.parameterDescription'),item.description,value => patch('description',value),'textarea'));
      if (required) body.append(check(t('moduleEditor.required'),item.required,value => patch('required',value)));
    }
    function parameterGroup({title,key,getItems,setItems,required = false,afterChange}) {
      return collection({title,key,kind:'Parameter',getItems,setItems,createItem:EC.Model.createParameter,afterChange,
        build(item,body,rename) {
          parameterFields(item,body,(key,value) => {setItems(getItems().map(current => current.id === item.id ? {...current,[key]:value} : current)); rename();},{required});
        }});
    }
    function methodParameters(entry,direction) {
      const isInput = direction === 'inputs', title = isInput ? t('moduleEditor.inputs') : t('moduleEditor.outputs');
      return parameterGroup({title,key:direction,getItems:() => entry[direction],setItems:items => update(module,entry,{[direction]:items}),required:isInput}).section;
    }
    function stepGroup(entry,key,setValue) {
      const flow = key === 'flow', title = flow ? t('moduleEditor.flow') : t('moduleEditor.errors'), item = flow ? t('moduleEditor.step') : t('moduleEditor.errors'), label = flow ? t('moduleEditor.implementationSteps') : t('moduleEditor.errors');
      const group = fold(title,{key}), list = element('div','flow-step-list');
      const empty = element('p','empty-note',t('moduleEditor.emptySteps',{label}));
      const values = entry[key] ? entry[key].split(/\r\n|\r|\n/) : [];
      const separator = entry[key]?.match(/\r\n|\r|\n/)?.[0] || '\n';
      const save = () => setValue(values.join(separator));
      function sync() {
        group.setCount(values.length); empty.hidden = !!values.length; list.hidden = !values.length;
        [...list.children].forEach((row,index) => {
          row.querySelector('.flow-step-index').textContent = String(index + 1);
          row.querySelector('input').setAttribute('aria-label',t('moduleEditor.numberedLabel',{label,index:index + 1}));
          const remove = row.querySelector('button'), removeLabel = t('moduleEditor.deleteNumberedStep',{item,index:index + 1});
          remove.setAttribute('aria-label',removeLabel); remove.title = removeLabel;
        });
      }
      function append(value) {
        const row = element('div','flow-step-row'), index = element('span','flow-step-index'), input = element('input');
        index.setAttribute('aria-hidden','true'); input.value = value; input.placeholder = flow ? t('moduleEditor.flowPlaceholder') : t('moduleEditor.errorPlaceholder');
        input.addEventListener('input',() => {
          const position = [...list.children].indexOf(row); if (position < 0) return;
          values[position] = input.value; save();
        });
        row.append(index,input,button('trash',t('moduleEditor.deleteStep',{item}),() => {
          const position = [...list.children].indexOf(row); if (position < 0) return;
          values.splice(position,1); save(); row.remove(); sync();
          (list.children[position]?.querySelector('input') || list.lastElementChild?.querySelector('input') || add).focus({preventScroll:true});
        },'member-delete'));
        list.append(row);
      }
      const add = button('add',t('moduleEditor.addStep',{item}),() => addInPlace(add,() => {
        const value = t('moduleEditor.newStepValue',{item,index:values.length + 1}); values.push(value); save(); append(value); sync();
      }),'group-add');
      group.header.append(add); group.body.append(empty,list);
      for (const value of values) append(value);
      sync(); return group.section;
    }
    function methodFields(entry,body,rename) {
      body.append(names('Method',entry,(key,value) => {update(module,entry,{[key]:value}); rename();}),field(t('moduleEditor.methodPurpose'),entry.purpose,value => update(module,entry,{purpose:value}),'textarea'));
      body.append(methodParameters(entry,'inputs'),methodParameters(entry,'outputs'));
      body.append(stepGroup(entry,'flow',value => update(module,entry,{flow:value})),stepGroup(entry,'errors',value => update(module,entry,{errors:value})));
    }
    function structureFields(entry,patch) {
      const section = element('section','structure-fields'), heading = element('div','structure-fields-heading');
      const list = element('div','structure-field-list'), empty = element('p','empty-note',t('moduleEditor.emptyFields'));
      const items = () => entry.fields;
      function sync() {
        empty.hidden = items().length > 0;
        [...list.children].forEach((row,index) => {
          const remove = row.querySelector('.member-delete'), label = t('moduleEditor.deleteNumberedField',{index:index + 1});
          remove.setAttribute('aria-label',label); remove.title = label;
        });
      }
      function append(item) {
        const row = element('div','structure-field-row'); row.dataset.fieldId = item.id;
        const change = (key,value) => patch('fields',items().map(current => current.id === item.id ? {...current,[key]:value} : current));
        row.append(field(t('moduleEditor.fieldName'),item.name,value => change('name',value)),field(t('moduleEditor.fieldCodeName'),item.englishName,value => change('englishName',value)),field(t('moduleEditor.dataType'),item.type,value => change('type',value)),field(t('moduleEditor.purpose'),item.description,value => change('description',value)));
        const [source,target] = row.querySelectorAll('input');
        EC.Translation.attach({source,target,kind:'parameter'});
        row.append(button('trash',t('moduleEditor.deleteField'),() => {
          const index = items().findIndex(value => value.id === item.id);
          patch('fields',items().filter(value => value.id !== item.id)); row.remove(); sync();
          (list.children[index]?.querySelector('input') || list.lastElementChild?.querySelector('input') || add).focus({preventScroll:true});
        },'member-delete'));
        list.append(row); return source;
      }
      const add = button('add',t('moduleEditor.addField'),() => {
        const item = EC.Model.createStructureField(items()); patch('fields',[...items(),item]);
        const input = append(item); sync(); input.focus({preventScroll:true}); input.scrollIntoView?.({block:'nearest'});
      },'group-add');
      heading.append(element('span','',t('moduleEditor.structureDefinition')),add); section.append(heading,empty,list);
      for (const item of items()) append(item);
      sync(); return section;
    }
    function requirementGroup() {
      const group = fold(t('moduleEditor.requirements'),{key:'requirements'}), list = element('div','requirement-list');
      const empty = element('p','empty-note',t('moduleEditor.emptyRequirements'));
      const items = () => module.requirements || [];
      function sync() {
        const count = items().length;
        group.setCount(count); empty.hidden = count > 0; list.hidden = count === 0;
        [...list.children].forEach((row,index) => {
          row.querySelector('textarea').setAttribute('aria-label',t('moduleEditor.numberedRequirement',{index:index + 1}));
          const remove = row.querySelector('button'), label = t('moduleEditor.deleteNumberedRequirement',{index:index + 1});
          remove.setAttribute('aria-label',label); remove.title = label;
        });
      }
      function append(value) {
        const row = element('div','requirement-row'), input = element('textarea');
        input.value = value; input.rows = 2; input.placeholder = t('moduleEditor.requirementPlaceholder');
        const rowIndex = () => [...list.children].indexOf(row);
        input.addEventListener('input',() => {
          const index = rowIndex(); if (index < 0) return;
          update(module,null,{requirements:items().map((value,i) => i === index ? input.value : value)});
        });
        row.append(input,button('trash',t('moduleEditor.deleteRequirement'),() => {
          const index = rowIndex(); if (index < 0) return;
          update(module,null,{requirements:items().filter((_,i) => i !== index)});
          row.remove(); sync();
          (list.children[index]?.querySelector('textarea') || list.lastElementChild?.querySelector('textarea') || add).focus({preventScroll:true});
        },'member-delete'));
        list.append(row); return input;
      }
      const add = button('add',t('moduleEditor.addRequirement'),() => addInPlace(add,() => {
        update(module,null,{requirements:[...items(),'']});
        append(''); sync();
      }),'group-add');
      group.header.append(add); group.body.append(empty,list);
      for (const value of items()) append(value);
      sync(); return group;
    }
    function dependencyGroup() {
      const group = fold(t('moduleEditor.dependencies'),{key:'dependencies'}), list = element('div','flow-step-list');
      const empty = element('p','empty-note',t('moduleEditor.emptyDependencies'));
      const items = () => module.dependencies;
      function sync() {
        group.setCount(items().length); empty.hidden = !!items().length; list.hidden = !items().length;
        [...list.children].forEach((row,index) => {
          row.querySelector('.flow-step-index').textContent = String(index + 1);
          row.querySelector('input').setAttribute('aria-label',t('moduleEditor.numberedDependency',{index:index + 1}));
          const remove = row.querySelector('button'), label = t('moduleEditor.deleteNumberedDependency',{index:index + 1});
          remove.setAttribute('aria-label',label); remove.title = label;
        });
      }
      function append(value) {
        const row = element('div','flow-step-row'), index = element('span','flow-step-index'), input = element('input');
        index.setAttribute('aria-hidden','true'); input.value = value; input.placeholder = t('moduleEditor.dependencyPlaceholder');
        const position = () => [...list.children].indexOf(row);
        input.addEventListener('input',() => {const i = position(); if (i >= 0) update(module,null,{dependencies:items().map((item,n) => n === i ? input.value : item)});});
        row.append(index,input,button('trash',t('moduleEditor.deleteDependency'),() => {
          const i = position(); if (i < 0) return;
          update(module,null,{dependencies:items().filter((_,n) => n !== i)}); row.remove(); sync();
          (list.children[i]?.querySelector('input') || list.lastElementChild?.querySelector('input') || add).focus({preventScroll:true});
        },'member-delete'));
        list.append(row);
      }
      const add = button('add',t('moduleEditor.addDependency'),() => addInPlace(add,() => {update(module,null,{dependencies:[...items(),'']}); append(''); sync();}),'group-add');
      group.header.append(add); group.body.append(empty,list);
      for (const value of items()) append(value);
      sync(); return group;
    }
    const appearance = fold(t('moduleEditor.appearance'),{key:'appearance'});
    appearance.body.classList.add('module-appearance-fields');
    for (const [key,label] of [['textColor',t('moduleEditor.textColor')],['backgroundColor',t('moduleEditor.backgroundColor')],['headerColor',t('moduleEditor.headerColor')]]) {
      const wrapper = element('label','field'), input = element('input'), value = element('span','color-value');
      input.type = 'color'; input.value = EC.Model.moduleAppearance(module)[key]; input.setAttribute('aria-label',label);
      value.id = `${module.id}-${key}-value`; value.textContent = input.value.toUpperCase(); input.setAttribute('aria-describedby',value.id);
      input.addEventListener('input',() => {
        update(module,null,{appearance:{...EC.Model.moduleAppearance(module),[key]:input.value}});
        value.textContent = input.value.toUpperCase();
      });
      wrapper.append(element('span','',label),input,value); appearance.body.append(wrapper);
    }
    const basics = fold(t('moduleEditor.moduleInformation'),{key:'basics',className:'module-basics'});
    const location = field(t('moduleEditor.codeLocation'),module.codeLocation,value => update(module,null,{codeLocation:value}),'textarea');
    const locationInput = location.querySelector('textarea');
    locationInput.placeholder = t('moduleEditor.codeLocationPlaceholder'); locationInput.spellcheck = false;
    const locationNote = element('span','field-note',t('moduleEditor.codeLocationHint'));
    locationNote.id = `${module.id}-location-note`; locationInput.setAttribute('aria-describedby',locationNote.id); location.append(locationNote);
    const language = field(t('moduleEditor.language'),module.language,value => update(module,null,{language:value}));
    const languageInput = language.querySelector('input'), languages = element('datalist'); languages.id = `${module.id}-languages`;
    languageInput.setAttribute('list',languages.id); languageInput.placeholder = t('moduleEditor.languagePlaceholder');
    for (const [value,key] of [["C","moduleEditor.languageName.c"],["C++","moduleEditor.languageName.cpp"],["C#","moduleEditor.languageName.csharp"],["Java","moduleEditor.languageName.java"],["JavaScript","moduleEditor.languageName.javascript"],["TypeScript","moduleEditor.languageName.typescript"],["Python","moduleEditor.languageName.python"],["Go","moduleEditor.languageName.go"],["Rust","moduleEditor.languageName.rust"],["Kotlin","moduleEditor.languageName.kotlin"],["Swift","moduleEditor.languageName.swift"],["Dart","moduleEditor.languageName.dart"],["PHP","moduleEditor.languageName.php"],["Ruby","moduleEditor.languageName.ruby"],["Lua","moduleEditor.languageName.lua"]]) {
      const option = element('option'); option.value = value; option.label = t(key); languages.append(option);
    }
    language.append(languages);
    basics.body.append(names('Module',module,(key,value) => update(module,null,{[key]:value})),field(t('moduleEditor.modulePurpose'),module.purpose,value => update(module,null,{purpose:value}),'textarea'),language,location,select(t('moduleEditor.layer'),module.groupId,[['',t('moduleEditor.noLayer')],...project.groups.map(group => [group.id,group.name || t('moduleEditor.unnamedLayer')])],value => update(module,null,{groupId:value})));
    const requirements = requirementGroup(), dependencies = dependencyGroup();
    const parameters = parameterGroup({title:t('moduleEditor.kind.parameter'),key:'parameters',getItems:() => module.parameters || [],setItems:items => update(module,null,{parameters:items})});
    const structures = collection({title:t('moduleEditor.kind.structure'),key:'structures',kind:'Data structures',getItems:() => module.structures || [],setItems:items => update(module,null,{structures:items}),createItem:EC.Model.createStructure,confirmDelete:true,
      build(entry,body,rename) {
        const patch = (key,value) => EC.Model.updateMember(project,module.id,'structures',entry.id,{[key]:value});
        body.append(names('Data structures',entry,(key,value) => {patch(key,value); rename();}),structureFields(entry,patch));
      }});
    const methods = collection({title:t('moduleEditor.kind.method'),key:'methods',kind:'Method',getItems:() => module.interfaces,setItems:items => update(module,null,{interfaces:items}),createItem:EC.Model.createInterface,confirmDelete:true,build:methodFields});
    const events = collection({title:t('moduleEditor.messageEvents'),key:'events',kind:'Event',getItems:() => module.events || [],setItems:items => update(module,null,{events:items}),createItem:EC.Model.createEvent,confirmDelete:true,
      build(entry,body,rename) {
        const patch = (key,value) => {EC.Model.updateMember(project,module.id,'events',entry.id,{[key]:value});};
        body.append(names('Event',entry,(key,value) => {patch(key,value); rename();}),field(t('moduleEditor.eventDescription'),entry.description,value => patch('description',value),'textarea'),select(t('moduleEditor.eventDirection'),entry.direction,[['emit',t('moduleEditor.emitMessage')],['receive',t('moduleEditor.receiveMessage')]],value => patch('direction',value)));
        body.append(parameterGroup({title:t('moduleEditor.messageParameters'),key:'payload',getItems:() => entry.parameters,setItems:items => patch('parameters',items)}).section);
        body.append(stepGroup(entry,'flow',value => patch('flow',value)));
      }});
    const tests = collection({title:t('moduleEditor.kind.test'),key:'tests',kind:'Tests',getItems:() => module.tests || [],setItems:items => update(module,null,{tests:items}),createItem:EC.Model.createTest,confirmDelete:true,
      build(entry,body,rename) {
        const patch = (key,value) => {EC.Model.updateMember(project,module.id,'tests',entry.id,{[key]:value});};
        body.append(names('Tests',entry,(key,value) => {patch(key,value); rename();}),field(t('moduleEditor.testSteps'),entry.steps,value => patch('steps',value),'textarea'),field(t('moduleEditor.expectedResult'),entry.expected,value => patch('expected',value),'textarea'));
      }});
    editor.append(element('p','dialog-note',t('moduleEditor.editingHint')),appearance.section,basics.section,requirements.section,dependencies.section,parameters.section,structures.section,methods.section,events.section,tests.section);
    return editor;
  }
  EC.ModuleEditor = {begin,hasChanges,commit,create};
});
