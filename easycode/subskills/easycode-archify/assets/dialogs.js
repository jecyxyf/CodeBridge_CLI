(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  function create({project,onChange = () => {},confirm = message => root.confirm(message)}) {
    const dialog = document.getElementById('ec-dialog');
    function node(tag,text,className) {const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result;}
    function input(form,label,value,options) {
      const wrapper = node('label',undefined,'field'); wrapper.append(node('span',label));
      const control = node(options?.choices ? 'select' : options?.multiline ? 'textarea' : 'input');
      if (options?.choices) for (const [value,label] of options.choices) {const option = node('option',label); option.value = value; control.append(option);}
      control.value = value ?? ''; control.setAttribute('aria-label',label);
      if (options?.required) control.required = true;
      if (options?.type) control.type = options.type;
      wrapper.append(control); form.append(wrapper); return control;
    }
    function open(title,build,submit,remove) {
      if (dialog.open) dialog.close(); dialog.replaceChildren();
      const form = node('form'), heading = node('h2',title); heading.id = 'ec-dialog-title'; form.append(heading);
      const controls = build(form), error = node('p','', 'dialog-error'); error.setAttribute('role','alert'); form.append(error);
      const actions = node('div',undefined,'dialog-actions');
      if (remove) {const button = node('button',undefined,'dialog-delete'); EC.Icons.set(button,remove.icon || 'trash',remove.label); button.type = 'button'; button.addEventListener('click',() => {try {if (remove.run() !== false) {dialog.close(); onChange({semantic:true,render:true});}} catch (issue) {error.textContent = issue.message;}}); actions.append(button);}
      const cancel = node('button'); EC.Icons.set(cancel,'close','取消'); cancel.type = 'button'; cancel.addEventListener('click',() => dialog.close());
      const save = node('button'); EC.Icons.set(save,'check','确定'); save.type = 'submit'; actions.append(cancel,save); form.append(actions); dialog.append(form);
      form.addEventListener('submit',event => {event.preventDefault(); try {submit(controls); dialog.close(); onChange({semantic:true,render:true});} catch (issue) {error.textContent = issue.message || '修改失败，请检查填写内容。';}});
      dialog.showModal();
    }
    function editGroup(id) {
      const group = project.groups.find(item => item.id === id);
      open(group ? '编辑分组' : '创建分组',form => {
        const name = input(form,'分组名称',group?.name || '',{required:true});
        const color = input(form,'标题字体颜色',/^#[\da-f]{6}$/i.test(group?.color || '') ? group.color : '#ffffff',{type:'color'});
        const backgroundColor = input(form,'背景颜色',/^#[\da-f]{6}$/i.test(group?.backgroundColor || '') ? group.backgroundColor : '#81b3e9',{type:'color'});
        form.append(node('p','背景透明度固定为 50%。','dialog-note'));
        form.append(node('p','展开模块，在“所属分组”中选择此组。拖动组标题可一起移动组内模块。','dialog-note'));
        return {name,color,backgroundColor};
      },({name,color,backgroundColor}) => {
        if (!name.value.trim()) throw new Error('请填写分组名称。');
        if (group) {group.name = name.value; group.color = color.value; group.backgroundColor = backgroundColor.value;}
        else {
          const viewport = document.getElementById('ec-viewport');
          const position = EC.Canvas.snapPoint({x:(viewport.clientWidth / 2 - project.view.x) / project.view.scale - 200,y:(viewport.clientHeight / 2 - project.view.y) / project.view.scale - 85});
          project.groups.push({id:EC.Model.createModule().id.replace(/^module-/,'group-'),name:name.value,color:color.value,backgroundColor:backgroundColor.value,...position});
        }
      },group ? {label:'删除层级',icon:'trash',run() {EC.Model.removeGroup(project,group.id);}} : null);
    }
    function editRelation(id,fromId) {
      const relation = project.relations.find(item => item.id === id);
      const choices = project.modules.map(module => [module.id,module.name || '未命名模块']);
      open(relation ? '编辑模块关系' : '连接模块',form => {
        if (choices.length < 2) form.append(node('p','至少需要两个模块才能创建关系。','dialog-note'));
        const from = input(form,'起点模块',relation?.from || fromId || choices[0]?.[0],{choices,required:true});
        const to = input(form,'目标模块',relation?.to || choices.find(([id]) => id !== from.value)?.[0],{choices,required:true});
        const type = input(form,'关系类型',relation?.type || 'call',{choices:[['call','调用'],['dependency','依赖']]});
        const label = input(form,'关系说明',relation?.label || '',{multiline:true});
        return {from,to,type,label};
      },controls => {
        const patch = Object.fromEntries(Object.entries(controls).map(([key,control]) => [key,control.value]));
        if (relation) {
          if (!project.modules.some(module => module.id === patch.from) || !project.modules.some(module => module.id === patch.to) || patch.from === patch.to) throw new Error('请选择两个不同的模块。');
          if (project.relations.some(item => item.id !== relation.id && ['from','to','type','label'].every(key => item[key] === patch[key]))) throw new Error('这条关系已经存在。');
          if (Object.entries(patch).some(([key,value]) => relation[key] !== value)) {Object.assign(relation,patch); EC.Model.markEdited(relation);}
        } else EC.Model.addRelation(project,patch);
      },relation ? {label:'删除关系',run() {
        if (!project.relations.includes(relation)) return false;
        const name = id => project.modules.find(module => module.id === id)?.name || '未命名模块';
        if (!confirm(`删除关系“${name(relation.from)} → ${name(relation.to)}”（${relation.type === 'call' ? '调用' : '依赖'}：${relation.label || '无说明'}）？`)) return false;
        project.relations = project.relations.filter(item => item.id !== relation.id);
      }} : null);
    }
    function editProject() {
      open('项目设置',form => ({
        name:input(form,'项目名称',project.name,{required:true}),
        description:input(form,'项目用途',project.description,{multiline:true}),
        mode:input(form,'当前工作',project.mode,{choices:[['design','设计方案'],['change','修改规划'],['analysis','分析源码']]}),
        path:input(form,'代码目录',project.repository.path),
        revision:input(form,'代码版本',project.repository.revision)
      }),({name,description,mode,path,revision}) => {
        if (!name.value.trim()) throw new Error('请填写项目名称。');
        project.name = name.value; project.description = description.value; project.mode = mode.value;
        project.repository.path = path.value; project.repository.revision = revision.value;
      });
    }
    return {editGroup,editRelation,editProject};
  }
  EC.Dialogs = {create};
})(globalThis);
