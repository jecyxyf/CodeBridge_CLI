(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  function create({project,onChange = () => {},onOpen = () => {},confirm = message => root.confirm(message)}) {
    const dialog = document.getElementById('ec-dialog');
    let moduleSession = null;
    function close() {moduleSession = null; dialog.close();}
    dialog.oncancel = () => {moduleSession = null;};
    dialog.onclose = () => {if (!dialog.open) moduleSession = null;};
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
    function open(title,build,submit,remove,options = {}) {
      if (onOpen() === false) return;
      if (dialog.open) close(); dialog.replaceChildren(); dialog.className = options.className || '';
      const form = node('form'), heading = node('h2',title); heading.id = 'ec-dialog-title'; form.append(heading);
      form.noValidate = !!options.noValidate;
      const body = node('div',undefined,'dialog-body'); form.append(body);
      const controls = build(body), error = node('p','', 'dialog-error'); error.setAttribute('role','alert'); form.append(error);
      const actions = node('div',undefined,'dialog-actions');
      if (remove) {const button = node('button',undefined,'dialog-delete'); EC.Icons.set(button,remove.icon || 'trash',remove.label); button.type = 'button'; button.addEventListener('click',() => {try {if (remove.run() !== false) {close(); onChange({semantic:true,render:true});}} catch (issue) {error.textContent = issue.message;}}); actions.append(button);}
      const cancel = node('button'); EC.Icons.set(cancel,'close','取消'); cancel.type = 'button'; cancel.addEventListener('click',close);
      const save = node('button'); EC.Icons.set(save,'check','确定'); save.type = 'submit'; actions.append(cancel,save); form.append(actions); dialog.append(form);
      form.addEventListener('submit',event => {event.preventDefault(); try {const changed = submit(controls); close(); if (changed !== false) onChange({semantic:true,render:true});} catch (issue) {error.textContent = issue.message || '修改失败，请检查填写内容。';}});
      dialog.showModal();
    }
    function editModule(id,position) {
      const session = EC.ModuleEditor.begin(project,id,position);
      open(session.existing ? '编辑模块' : '新建模块',body => {
        body.append(EC.ModuleEditor.create({session,confirm}));
      },() => EC.ModuleEditor.commit(project,session),session.existing ? {label:'删除模块',run() {
        const module = project.modules.find(item => item.id === id);
        if (!module) return false;
        const count = project.relations.filter(item => item.from === id || item.to === id).length;
        if (!confirm(`删除模块“${EC.Model.displayName(module,'未命名模块')}”？同时删除 ${count} 条关联关系及模块内全部对外接口内容。`)) return false;
        return EC.Model.removeModule(project,id);
      }} : null,{className:'module-dialog',noValidate:true});
      moduleSession = session;
    }
    function editGroup(id) {
      const group = project.groups.find(item => item.id === id);
      open(group ? '编辑分组' : '创建分组',form => {
        const name = input(form,'分组名称',group?.name || '',{required:true});
        const color = input(form,'标题字体颜色',/^#[\da-f]{6}$/i.test(group?.color || '') ? group.color : '#ffffff',{type:'color'});
        const backgroundColor = input(form,'背景颜色',/^#[\da-f]{6}$/i.test(group?.backgroundColor || '') ? group.backgroundColor : '#81b3e9',{type:'color'});
        form.append(node('p','背景透明度固定为 50%。','dialog-note'));
        form.append(node('p','点击模块的编辑按钮，在“所属层级”中选择此层级。拖动层级标题可一起移动其中的模块。','dialog-note'));
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
    return {editModule,editGroup,editProject,
      isEditingModule:() => dialog.open && !!moduleSession,
      hasDraftChanges:() => dialog.open && !!moduleSession && EC.ModuleEditor.hasChanges(moduleSession),
      showMessage(message) {const error = dialog.querySelector('.dialog-error'); if (error) error.textContent = message;}
    };
  }
  EC.Dialogs = {create};
})(globalThis);
