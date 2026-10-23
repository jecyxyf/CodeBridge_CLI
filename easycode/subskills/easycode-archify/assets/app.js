(function (root) {
  'use strict';
  const EC = root.EasyCode;
  function boot() {
    const get = id => document.getElementById(id), notice = get('ec-notice');
    function showError(error) {notice.textContent = error?.message || String(error); notice.hidden = false;}
    root.addEventListener('error',event => showError(event.error || event.message));
    root.addEventListener('unhandledrejection',event => {event.preventDefault(); showError(event.reason);});
    try {
      EC.Icons.hydrate(document);
      const project = JSON.parse(get('ec-project').textContent), bundle = JSON.parse(get('ec-bundle').textContent);
      const validation = EC.Model.validate(project);
      if (validation.errors.length) throw new Error(`项目数据有问题：${validation.errors[0].message}`);
      function refreshWarnings() {
        const warnings = get('ec-warnings');
        warnings.textContent = EC.Feedback.formatWarnings(project,EC.Model.validate(project).warnings);
        warnings.hidden = !warnings.textContent;
      }
      const fileTypes = [{description:'模块画布 HTML',accept:{'text/html':['.html']}}];
      const supported = typeof root.showOpenFilePicker === 'function' && typeof root.showSaveFilePicker === 'function';
      // Capture the original embedded project before any layout, fit or UI edits.
      const storage = EC.Storage.createController({
        getProject:() => project,
        buildDocument:snapshot => EC.Serialization.buildDocument(bundle,snapshot),
        readProject:EC.Serialization.readProject,validate:EC.Model.validate,
        pickExisting:() => root.showOpenFilePicker({types:fileTypes,multiple:false}).then(handles => handles[0]),
        pickNew:suggestedName => root.showSaveFilePicker({types:fileTypes,suggestedName}),
        onState(state) {
          get('ec-status').textContent = state.message; get('ec-status').dataset.status = state.status;
          get('ec-file-name').textContent = state.fileName || '尚未选定文件';
          if (state.status === 'error') showError(state.message);
          refreshWarnings();
          document.title = `${state.dirty ? '● ' : ''}${project.name || '模块画布'}`;
        }
      });
      let canvas, nodes;
      function refreshHeader() {
        get('ec-project-name').textContent = project.name || '未命名项目';
        get('ec-project-description').textContent = project.description || '用编辑按钮填写项目用途';
        get('ec-empty').hidden = project.modules.length > 0 || project.groups.length > 0;
        document.title = `${storage.isDirty() ? '● ' : ''}${project.name || '模块画布'}`;
      }
      function onChange(change = {}) {
        storage.markDirty();
        if (change.render) nodes.render();
        canvas?.refresh(); refreshHeader();
      }
      const dialogs = EC.Dialogs.create({project,onChange});
      nodes = EC.Nodes.create({project,layer:get('ec-nodes'),template:get('ec-module-template'),onChange,onRelation:from => dialogs.editRelation(undefined,from),confirm:message => root.confirm(message)});
      nodes.render();
      canvas = EC.Canvas.create({project,viewport:get('ec-viewport'),world:get('ec-world'),groupLayer:get('ec-groups'),edgeLayer:get('ec-edges'),nodes,onChange,onGroupEdit:dialogs.editGroup,onRelationEdit:dialogs.editRelation});
      refreshHeader();
      // Preserve a saved view. New projects with the default view start with all modules visible.
      if (project.view.x === 0 && project.view.y === 0 && project.view.scale === 1 && project.modules.length) canvas.fit({notify:false});
      function save(asNew) {
        if (!supported) {showError('此浏览器不能直接写入本地文件。请使用新版桌面 Chrome 或 Edge 打开此 HTML。'); return;}
        notice.hidden = true;
        // Do not await anything before calling Storage: native pickers require this click stack.
        try {
          const operation = asNew ? storage.saveAs() : storage.save();
          operation.catch(error => {if (error?.name !== 'AbortError') showError(error);});
        } catch (error) {if (error?.name !== 'AbortError') showError(error);}
      }
      const actions = {
        'add-module'() {
          const center = canvas.centerPoint(), module = EC.Model.createModule({name:'新模块',x:center.x - 180,y:center.y - 100});
          project.modules.push(module); project.view.expanded.push(module.id); onChange({render:true});
          nodes.getElement(module.id)?.querySelector('[aria-label="模块名称"]')?.focus();
        },
        'add-group':() => dialogs.editGroup(), 'add-relation':() => dialogs.editRelation(),
        'edit-project':() => dialogs.editProject(), 'zoom-in':() => canvas.zoomBy(1.2), 'zoom-out':() => canvas.zoomBy(1 / 1.2),
        fit:() => canvas.fit(), save:() => save(false), 'save-as':() => save(true)
      };
      for (const control of document.querySelectorAll('[data-action]')) control.addEventListener('click',() => {
        try {actions[control.dataset.action]?.();} catch (error) {showError(error);}
      });
      root.addEventListener('keydown',event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {event.preventDefault(); save(event.shiftKey);}
      });
      root.addEventListener('beforeunload',event => {if (storage.isDirty()) {event.preventDefault(); event.returnValue = '';}});
      if (!supported) showError('此浏览器不能直接写入本地文件。请使用新版桌面 Chrome 或 Edge 打开此 HTML。');
      // A small explicit integration surface for diagnostics and browser interaction tests.
      EC.app = {project,storage,nodes,canvas,dialogs};
    } catch (error) {
      showError(error); get('ec-status').textContent = '无法打开项目'; get('ec-status').dataset.status = 'error';
      for (const control of document.querySelectorAll('[data-action]')) control.disabled = true;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})(globalThis);
