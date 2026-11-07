globalThis.EasyCode.register("dialogs",function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const t = (key, params) => EC.I18n.t(key, params);
  let confirmation = null;
  function confirm(message,{title = t('dialogs.confirmDeletion'),confirmLabel = t('dialogs.delete'),danger = true} = {}) {
    if (confirmation) return Promise.resolve(false);
    return new Promise(resolve => {
      const dialog = document.createElement('dialog'), heading = document.createElement('h2'), body = document.createElement('p');
      const actions = document.createElement('div'), cancel = document.createElement('button'), accept = document.createElement('button');
      const previousFocus = document.activeElement;
      dialog.id = 'ec-confirm'; dialog.className = 'confirmation-dialog'; dialog.setAttribute('role','alertdialog');
      heading.id = 'ec-confirm-title'; heading.textContent = title;
      body.id = 'ec-confirm-message'; body.textContent = message;
      dialog.setAttribute('aria-labelledby',heading.id); dialog.setAttribute('aria-describedby',body.id);
      actions.className = 'dialog-actions'; cancel.type = accept.type = 'button';
      cancel.textContent = t('dialogs.cancel'); accept.textContent = confirmLabel; accept.className = danger ? 'confirm-danger' : 'confirm-primary';
      cancel.dataset.confirmAction = 'cancel'; accept.dataset.confirmAction = 'accept';
      let settled = false;
      function finish(value) {
        if (settled) return;
        settled = true; confirmation = null; dialog.close(); dialog.remove();
        if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
        resolve(value);
      }
      cancel.addEventListener('click',() => finish(false)); accept.addEventListener('click',() => finish(true));
      dialog.addEventListener('cancel',event => {event.preventDefault(); finish(false);});
      dialog.addEventListener('close',() => finish(false));
      actions.append(cancel,accept); dialog.append(heading,body,actions); document.body.append(dialog);
      confirmation = dialog; dialog.showModal(); cancel.focus({preventScroll:true});
    });
  }
  function create({project,onChange = () => {},onOpen = () => {},confirm = EC.Dialogs.confirm}) {
    const dialog = document.getElementById('ec-dialog');
    let moduleSession = null, projectDraftChanged = null;
    function clearDraft() {moduleSession = null; projectDraftChanged = null;}
    function close() {clearDraft(); dialog.close();}
    dialog.oncancel = clearDraft;
    dialog.onclose = () => {if (!dialog.open) clearDraft();};
    function node(tag,text,className) {const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result;}
    function input(form,label,value,options) {
      const wrapper = node('label',undefined,'field'); wrapper.append(node('span',label));
      const control = node(options?.multiline ? 'textarea' : 'input');
      control.value = value ?? ''; control.setAttribute('aria-label',label);
      if (options?.required) control.required = true;
      if (options?.type) control.type = options.type;
      wrapper.append(control); form.append(wrapper); return control;
    }
    function names(form,label,item,kind) {
      const row = node('div',undefined,'bilingual-fields'); form.append(row);
      const name = input(row,t('dialogs.displayName',{label}),item?.name || '',{required:true});
      const englishName = input(row,t('dialogs.codeName',{label}),item?.englishName || '');
      EC.Translation.attach({source:name,target:englishName,kind});
      return {name,englishName};
    }
    function directory(form,value) {
      const wrapper = node('div',undefined,'field'), label = node('label',t('dialogs.codeDirectory'));
      const control = node('input'), row = node('div',undefined,'directory-control'), choose = node('button');
      control.id = 'ec-code-directory'; label.htmlFor = control.id; control.setAttribute('aria-label',t('dialogs.codeDirectory')); control.value = value;
      EC.Icons.set(choose,'folder',t('dialogs.chooseCodeDirectory')); choose.type = 'button';
      const supported = typeof root.showDirectoryPicker === 'function';
      const note = node('span',supported ? t('dialogs.directorySelectionNote') : t('dialogs.directoryUnsupported'),'directory-note');
      const message = node('span','', 'directory-status'); message.setAttribute('role','status'); message.id = 'ec-directory-status';
      note.id = 'ec-directory-note'; control.setAttribute('aria-describedby',`${note.id} ${message.id}`);
      choose.disabled = !supported;
      let revision = 0;
      control.addEventListener('input',() => {revision++; message.textContent = '';});
      choose.addEventListener('click',async () => {
        const version = revision, previous = control.value;
        choose.disabled = true; message.textContent = '';
        const current = () => dialog.open && control.isConnected && version === revision && control.value === previous;
        try {
          // Invoke directly in the click handler; only retain the selected name, never enumerate files.
          const handle = await root.showDirectoryPicker({id:'easycode-code-directory',mode:'read'});
          if (!current()) return;
          control.value = handle.name; control.dispatchEvent(new Event('input',{bubbles:true}));
        } catch (error) {
          if (current() && error.name !== 'AbortError') message.textContent = t('dialogs.directoryFailed');
        } finally {choose.disabled = !supported;}
      });
      row.append(control,choose); wrapper.append(label,row,note,message); form.append(wrapper); return control;
    }
    function open(title,build,submit,remove,options = {}) {
      if (onOpen() === false) return;
      if (dialog.open) close(); dialog.replaceChildren(); dialog.className = options.className || '';
      const form = node('form'), heading = node('h2',title); heading.id = 'ec-dialog-title'; form.append(heading);
      // Every form reports validation inside the page, without browser validation bubbles.
      form.noValidate = true;
      const body = node('div',undefined,'dialog-body'); form.append(body);
      const controls = build(body,heading), error = node('p','', 'dialog-error'); error.setAttribute('role','alert'); form.append(error);
      const actions = node('div',undefined,'dialog-actions');
      if (remove) {
        const button = node('button',undefined,'dialog-delete'); EC.Icons.set(button,remove.icon || 'trash',remove.label); button.type = 'button';
        button.addEventListener('click',async () => {
          button.disabled = true;
          try {if (await remove.run() !== false && form.isConnected && dialog.open) {close(); onChange({semantic:true,render:true});}}
          catch (issue) {error.textContent = issue.message;}
          finally {button.disabled = false; if (form.isConnected && dialog.open) button.focus({preventScroll:true});}
        }); actions.append(button);
      }
      const cancel = node('button'); EC.Icons.set(cancel,'close',t('dialogs.cancel')); cancel.type = 'button'; cancel.addEventListener('click',close);
      const save = node('button'); EC.Icons.set(save,'check',t('dialogs.ok')); save.type = 'submit'; actions.append(cancel,save); form.append(actions); dialog.append(form);
      form.addEventListener('submit',event => {event.preventDefault(); try {const changed = submit(controls); close(); if (changed !== false) onChange({semantic:true,render:true});} catch (issue) {error.textContent = issue.message || t('dialogs.editFailed');}});
      dialog.showModal();
    }
    function editModule(id,position) {
      const session = EC.ModuleEditor.begin(project,id,position);
      open('',(body,heading) => {
        const name = node('span',undefined,'module-dialog-name'), language = node('span',undefined,'module-dialog-language');
        heading.replaceChildren(name,language);
        function refreshTitle() {
          name.textContent = [session.module.name,session.module.englishName].map(value => value?.trim()).filter(Boolean).join(' / ') || t('dialogs.unnamedModule');
          name.title = name.textContent;
          language.textContent = session.module.language?.trim() || ''; language.title = language.textContent;
          language.hidden = !language.textContent;
        }
        body.append(EC.ModuleEditor.create({session,confirm,onSummaryChange:refreshTitle})); refreshTitle();
      },() => EC.ModuleEditor.commit(project,session),session.existing ? {label:t('dialogs.deleteModule'),async run() {
        const module = project.modules.find(item => item.id === id);
        if (!module) return false;
        const count = project.relations.filter(item => item.from === id || item.to === id).length;
        if (!await confirm(t('dialogs.deleteModuleConfirm',{name:EC.Model.displayName(module,t('dialogs.unnamedModule')),count}))) return false;
        return EC.Model.removeModule(project,id);
      }} : null,{className:'module-dialog'});
      moduleSession = session;
    }
    function editGroup(id) {
      const group = project.groups.find(item => item.id === id);
      open(group ? t('dialogs.editGroup') : t('dialogs.createGroup'),form => {
        const {name,englishName} = names(form,t('dialogs.layer'),group,'group');
        const color = input(form,t('dialogs.headingTextColor'),/^#[\da-f]{6}$/i.test(group?.color || '') ? group.color : '#ffffff',{type:'color'});
        const backgroundColor = input(form,t('dialogs.backgroundColor'),/^#[\da-f]{6}$/i.test(group?.backgroundColor || '') ? group.backgroundColor : '#81b3e9',{type:'color'});
        form.append(node('p',t('dialogs.opacityNote'),'dialog-note'));
        form.append(node('p',t('dialogs.layerUsage'),'dialog-note'));
        return {name,englishName,color,backgroundColor};
      },({name,englishName,color,backgroundColor}) => {
        if (!name.value.trim()) throw new Error(t('dialogs.groupNameRequired'));
        if (group) {
          group.name = name.value; group.color = color.value; group.backgroundColor = backgroundColor.value;
          if (englishName.value !== (group.englishName ?? '')) group.englishName = englishName.value;
        }
        else {
          const viewport = document.getElementById('ec-viewport');
          const position = EC.Canvas.snapPoint({x:(viewport.clientWidth / 2 - project.view.x) / project.view.scale - 200,y:(viewport.clientHeight / 2 - project.view.y) / project.view.scale - 85});
          project.groups.push({id:EC.Model.createModule().id.replace(/^module-/,'group-'),name:name.value,englishName:englishName.value,color:color.value,backgroundColor:backgroundColor.value,...position});
        }
      },group ? {label:t('dialogs.deleteLayer'),icon:'trash',async run() {
        if (!await confirm(t('dialogs.deleteLayerConfirm',{name:EC.Model.displayName(group,t('dialogs.unnamedLayer'))}))) return false;
        return EC.Model.removeGroup(project,group.id);
      }} : null);
    }
    function editProject() {
      const original = JSON.stringify({name:project.name,englishName:project.englishName ?? '',description:project.description,path:project.repository.path,revision:project.repository.revision});
      const values = controls => Object.fromEntries(Object.entries(controls).map(([key,control]) => [key,control.value]));
      open(t('dialogs.projectSettings'),form => {
        const controls = {
          ...names(form,t('dialogs.project'),project,'project'),
          description:input(form,t('dialogs.projectPurpose'),project.description,{multiline:true}),
          path:directory(form,project.repository.path),
          revision:input(form,t('dialogs.codeVersion'),project.repository.revision)
        };
        projectDraftChanged = () => JSON.stringify(values(controls)) !== original;
        return controls;
      },controls => {
        const next = values(controls);
        if (!next.name.trim()) throw new Error(t('dialogs.projectNameRequired'));
        if (JSON.stringify(next) === original) return false;
        project.name = next.name; project.description = next.description;
        if (next.englishName !== (project.englishName ?? '')) project.englishName = next.englishName;
        project.repository.path = next.path; project.repository.revision = next.revision;
      });
    }
    return {editModule,editGroup,editProject,
      isEditingModule:() => dialog.open && !!moduleSession,
      isEditingProject:() => dialog.open && !!projectDraftChanged,
      hasDraftChanges:() => dialog.open && (!!moduleSession && EC.ModuleEditor.hasChanges(moduleSession) || !!projectDraftChanged && projectDraftChanged()),
      showMessage(message) {const error = dialog.querySelector('.dialog-error'); if (error) error.textContent = message;}
    };
  }
  EC.Dialogs = {create,confirm,isConfirming:() => !!confirmation};
});
