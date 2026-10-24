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
      let project = JSON.parse(get('ec-project').textContent);
      const bundle = JSON.parse(get('ec-bundle').textContent);
      const validation = EC.Model.validate(project);
      if (validation.errors.length) throw new Error(`项目数据有问题：${validation.errors[0].message}`);
      function refreshWarnings() {
        const warnings = get('ec-warnings');
        warnings.textContent = EC.Feedback.formatWarnings(project,EC.Model.validate(project).warnings);
        warnings.hidden = !warnings.textContent;
      }
      const fileTypes = [{description:'软件框架图 HTML',accept:{'text/html':['.html']}}];
      const supported = typeof root.showOpenFilePicker === 'function' && typeof root.showSaveFilePicker === 'function';
      // Capture the original embedded project before any layout, fit or UI edits.
      const storage = EC.Storage.createController({
        getProject:() => project,
        buildDocument:snapshot => EC.Serialization.buildDocument(bundle,snapshot),
        readProject:EC.Serialization.readProject,validate:EC.Model.validate,
        pickExisting:() => root.showOpenFilePicker({types:fileTypes,multiple:false}).then(handles => handles[0]),
        pickNew:suggestedName => root.showSaveFilePicker({types:fileTypes,suggestedName}),
        confirmImport:() => root.confirm('当前有未保存的修改。导入会替换当前内容，是否继续？'),
        replaceProject(next) {
          if (dialogs?.isEditingModule() || dialogs?.isEditingProject()) throw new Error('编辑窗口已打开，请先确定或取消，再导入。');
          if (canvas?.hasDraftChanges()) throw new Error('请先完成或取消箭头备注，再导入。');
          const previous = project;
          project = next;
          try {mount();}
          catch (error) {project = previous; mount(); throw error;}
        },
        onState(state) {
          if (state.status === 'error') showError(state.message);
          refreshWarnings();
          document.title = `${state.dirty ? '● ' : ''}${EC.Model.projectTitle(project)}`;
        }
      });
      let canvas, nodes, dialogs;
      function refreshHeader() {
        const name = get('ec-project-name'), description = get('ec-project-description');
        name.textContent = EC.Model.projectTitle(project); name.title = name.textContent;
        description.textContent = project.description || '点击标题区填写描述'; description.title = description.textContent;
        get('ec-empty').hidden = project.modules.length > 0 || project.groups.length > 0;
        document.title = `${storage.isDirty() ? '● ' : ''}${EC.Model.projectTitle(project)}`;
      }
      function onChange(change = {}) {
        storage.markDirty();
        if (change.render) nodes.render();
        canvas?.refresh(); refreshHeader();
      }
      function mount() {
        canvas?.destroy(); nodes?.destroy();
        if (get('ec-dialog').open) get('ec-dialog').close();
        dialogs = EC.Dialogs.create({project,onChange,onOpen:() => {canvas?.cancelConnection(); return canvas?.finishAnnotation();}});
        nodes = EC.Nodes.create({project,layer:get('ec-nodes'),template:get('ec-module-template'),onEdit:dialogs.editModule});
        nodes.render();
        canvas = EC.Canvas.create({project,viewport:get('ec-viewport'),world:get('ec-world'),groupLayer:get('ec-groups'),edgeLayer:get('ec-edges'),nodes,onChange,onGroupEdit:dialogs.editGroup});
        refreshHeader();
        EC.app = {project,storage,nodes,canvas,dialogs};
      }
      mount();
      // Preserve a saved view. New projects with the default view start with all modules visible.
      if (project.view.x === 0 && project.view.y === 0 && project.view.scale === 1 && project.modules.length) canvas.fit({notify:false});
      function save(asNew) {
        if (dialogs.isEditingModule() || dialogs.isEditingProject()) {dialogs.showMessage('请先点击“确定”或“取消”，再保存 HTML。'); return;}
        if (!canvas.finishAnnotation()) return;
        if (!supported) {showError('此浏览器不能直接写入本地文件。请使用新版桌面 Chrome 或 Edge 打开此 HTML。'); return;}
        notice.hidden = true;
        // Do not await anything before calling Storage: native pickers require this click stack.
        try {
          const operation = asNew ? storage.saveAs() : storage.save();
          operation.catch(error => {if (error?.name !== 'AbortError') showError(error);});
        } catch (error) {if (error?.name !== 'AbortError') showError(error);}
      }
      function importFile() {
        if (dialogs.isEditingModule() || dialogs.isEditingProject()) {dialogs.showMessage('请先点击“确定”或“取消”，再导入 HTML。'); return;}
        if (!canvas.finishAnnotation()) return;
        if (typeof root.showOpenFilePicker !== 'function') {showError('此浏览器不能导入本地文件。请使用新版桌面 Chrome 或 Edge。'); return;}
        notice.hidden = true;
        storage.importFile().catch(error => {if (error?.name !== 'AbortError') showError(error);});
      }
      const actions = {
        'add-module'() {
          const center = canvas.centerPoint(), position = EC.Canvas.snapPoint({x:center.x - 180,y:center.y - 100});
          dialogs.editModule(undefined,position);
        },
        'add-group':() => dialogs.editGroup(),
        'edit-project':() => dialogs.editProject(), 'zoom-in':() => canvas.zoomBy(1.2), 'zoom-out':() => canvas.zoomBy(1 / 1.2),
        fit:() => canvas.fit(), save:() => save(false), import:importFile, export:() => save(true)
      };
      for (const control of document.querySelectorAll('[data-action]')) control.addEventListener('click',() => {
        try {
          if (!['zoom-in','zoom-out','fit'].includes(control.dataset.action)) canvas.cancelConnection();
          actions[control.dataset.action]?.();
        } catch (error) {showError(error);}
      });
      root.addEventListener('keydown',event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {event.preventDefault(); save(event.shiftKey);}
      });
      root.addEventListener('beforeunload',event => {if (storage.isDirty() || dialogs.hasDraftChanges() || canvas.hasDraftChanges()) {event.preventDefault(); event.returnValue = '';}});
      if (!supported) showError('此浏览器不能直接写入本地文件。请使用新版桌面 Chrome 或 Edge 打开此 HTML。');
    } catch (error) {
      showError(error);
      for (const control of document.querySelectorAll('[data-action]')) control.disabled = true;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})(globalThis);
