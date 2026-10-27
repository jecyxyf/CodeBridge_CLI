(function (root) {
  'use strict';
  const EC = root.EasyCode;
  async function boot() {
    const get = id => document.getElementById(id), notice = get('ec-notice');
    function showError(error) {notice.textContent = error?.message || String(error); notice.hidden = false;}
    root.addEventListener('error',event => showError(event.error || event.message));
    root.addEventListener('unhandledrejection',event => {event.preventDefault(); showError(event.reason);});
    try {
      EC.Icons.hydrate(document);
      const serviceEntry = !!document.querySelector('meta[name="easycode-service"]');
      // A service package can also be opened directly: bind a local JSON instead of requiring HTTP.
      const localMode = !!document.querySelector('meta[name="easycode-local"]') || serviceEntry && !/^https?:$/.test(root.location.protocol);
      const serviceMode = serviceEntry && !localMode;
      const syncMode = serviceMode || localMode;
      let projectOpened = !localMode;
      const initial = serviceMode ? await EC.ServiceStorage.load() : null;
      let project = initial ? initial.project : localMode ? EC.Model.createProject() : JSON.parse(get('ec-project').textContent);
      const bundle = JSON.parse(get('ec-bundle').textContent);
      const validation = EC.Model.validate(project);
      if (validation.errors.length) throw new Error(`项目数据有问题：${validation.errors[0].message}`);
      const warningNotice = EC.Feedback.createWarningNotice({
        show(message) {get('ec-warning-text').textContent = message; get('ec-warnings').hidden = false;},
        hide() {get('ec-warnings').hidden = true;}
      });
      get('ec-warning-close').addEventListener('click',warningNotice.dismiss);
      function refreshWarnings() {
        if (!projectOpened) {warningNotice.update('',project.id); return;}
        warningNotice.update(EC.Feedback.formatWarnings(project,EC.Model.validate(project).warnings),project.id);
      }
      const fileTypes = localMode ? [{description:'软件框架 JSON',accept:{'application/json':['.json']}}] : [{description:'软件框架图 HTML',accept:{'text/html':['.html']}}];
      const supported = serviceMode || typeof root.showOpenFilePicker === 'function' && typeof root.showSaveFilePicker === 'function';
      let canvas, nodes, dialogs;
      let syncNotice, syncText, reloadButton;
      if (syncMode) {
        syncNotice = document.createElement('div'); syncNotice.id = 'ec-sync-notice'; syncNotice.hidden = true; syncNotice.setAttribute('role','status');
        syncText = document.createElement('span'); reloadButton = document.createElement('button');
        reloadButton.type = 'button'; reloadButton.textContent = '载入最新内容';
        syncNotice.append(syncText,reloadButton); get('ec-feedback').prepend(syncNotice);
        for (const control of document.querySelectorAll('[data-action="import"]')) {
          control.title = localMode ? '打开 JSON' : '导入 JSON 或 HTML';
          control.setAttribute('aria-label',control.title);
        }
        const saveButton = document.querySelector('[data-action="save"]');
        saveButton.title = '保存到 JSON（Ctrl / ⌘ + S）'; saveButton.setAttribute('aria-label','保存 JSON');
      }
      if (localMode) {
        const saveAsButton = document.querySelector('[data-action="export"]');
        saveAsButton.title = '另存为 JSON（Ctrl / ⌘ + Shift + S）'; saveAsButton.setAttribute('aria-label','另存为 JSON');
        get('ec-export-html').hidden = false;
      }
      // Capture the original embedded project before any layout, fit or UI edits.
      const storage = (serviceMode ? EC.ServiceStorage : localMode ? EC.JsonStorage : EC.Storage).createController({
        version:initial?.version,
        isBusy:() => get('ec-dialog').open || EC.Dialogs.isConfirming() || !!canvas?.hasDraftChanges(),
        confirmReload:() => EC.Dialogs.confirm(`载入后会放弃网页中尚未保存的修改。需要保留时，请先取消并${localMode ? '另存为 JSON 备份' : '导出备份'}。`,{title:'载入最新内容',confirmLabel:'放弃修改并载入',danger:true}),
        onExternal(message,canReload) {syncText.textContent = message; syncNotice.hidden = !message; reloadButton.hidden = !canReload;},
        getProject:() => project,
        buildDocument:snapshot => EC.Serialization.buildDocument(bundle,snapshot),
        readProject:EC.Serialization.readProject,validate:EC.Model.validate,
        prepareSave:EC.Model.fillProjectDefaults,
        onSaved() {if (EC.Model.fillProjectDefaults(project)) {nodes.render(); canvas.refresh(); refreshHeader();}},
        pickExisting:() => root.showOpenFilePicker({types:fileTypes,multiple:false}).then(handles => handles[0]),
        pickNew:suggestedName => root.showSaveFilePicker({types:fileTypes,suggestedName}),
        confirmImport:() => EC.Dialogs.confirm('当前有未保存的修改。打开文件会替换当前内容，是否继续？',{title:'打开文件',confirmLabel:'继续打开',danger:false}),
        replaceProject(next) {
          if (get('ec-dialog').open) throw new Error('编辑窗口已打开，请先确定或取消，再载入。');
          if (canvas?.hasDraftChanges()) throw new Error('请先完成或取消箭头备注，再导入。');
          const previous = project, wasOpened = projectOpened;
          project = next; projectOpened = true;
          try {mount();}
          catch (error) {project = previous; projectOpened = wasOpened; mount(); throw error;}
        },
        onState(state) {
          if (state.status === 'error') showError(state.message);
          if (syncMode && ['saved','loaded'].includes(state.status)) notice.hidden = true;
          const status = get('ec-file-status');
          if (status) {status.textContent = [state.fileName,state.message].filter(Boolean).join(' · '); status.title = status.textContent;}
          refreshWarnings();
          document.title = projectOpened ? `${state.dirty ? '● ' : ''}${EC.Model.projectTitle(project)}` : '打开软件框架 JSON';
        }
      });
      function refreshHeader() {
        const name = get('ec-project-name'), description = get('ec-project-description');
        name.textContent = projectOpened ? EC.Model.projectTitle(project) : '软件框架编辑器'; name.title = name.textContent;
        description.textContent = projectOpened ? project.description || '点击标题区填写描述' : '打开 JSON，查看和编辑软件框架'; description.title = description.textContent;
        get('ec-empty').hidden = !projectOpened || project.modules.length > 0 || project.groups.length > 0;
        if (get('ec-open-project')) get('ec-open-project').hidden = projectOpened;
        get('ec-world').inert = !projectOpened;
        for (const control of document.querySelectorAll('[data-action]')) control.disabled = !projectOpened && (control.dataset.action !== 'import' || !supported);
        document.title = projectOpened ? `${storage.isDirty() ? '● ' : ''}${EC.Model.projectTitle(project)}` : '打开软件框架 JSON';
      }
      function onChange(change = {}) {
        storage.markDirty();
        if (change.render) nodes.render();
        canvas?.refresh(); refreshHeader();
      }
      function mount() {
        canvas?.destroy(); nodes?.destroy();
        if (get('ec-dialog').open) get('ec-dialog').close();
        dialogs = EC.Dialogs.create({project,onChange,onOpen:() => {nodes?.hidePreview(); canvas?.cancelConnection(); return canvas?.finishAnnotation();}});
        nodes = EC.Nodes.create({project,layer:get('ec-nodes'),template:get('ec-module-template'),onEdit:dialogs.editModule});
        nodes.render();
        canvas = EC.Canvas.create({project,viewport:get('ec-viewport'),world:get('ec-world'),groupLayer:get('ec-groups'),groupTemplate:get('ec-group-template'),edgeLayer:get('ec-edges'),nodes,onChange,onGroupEdit:dialogs.editGroup});
        canvas.restoreView();
        refreshHeader();
        EC.app = {project,storage,nodes,canvas,dialogs};
      }
      mount();
      if (syncMode) {
        reloadButton.addEventListener('click',() => storage.reload().catch(showError));
        storage.startSync();
        root.addEventListener('pagehide',storage.destroy);
        root.addEventListener('pageshow',event => {if (event.persisted) storage.startSync();});
        if (localMode) root.addEventListener('focus',() => storage.refresh());
      }
      function canOperate() {
        if (!projectOpened) {showError('请先打开 archify.json。'); return false;}
        return true;
      }
      function save(asNew) {
        if (!canOperate()) return;
        if (EC.Dialogs.isConfirming()) return;
        if (get('ec-dialog').open) {dialogs.showMessage('请先点击“确定”或“取消”，再保存。'); return;}
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
        if (EC.Dialogs.isConfirming()) return;
        if (get('ec-dialog').open) {dialogs.showMessage('请先点击“确定”或“取消”，再导入。'); return;}
        if (!canvas.finishAnnotation()) return;
        if (!serviceMode && typeof root.showOpenFilePicker !== 'function') {showError('此浏览器不能导入本地文件。请使用新版桌面 Chrome 或 Edge。'); return;}
        notice.hidden = true;
        storage.importFile().catch(error => {if (error?.name !== 'AbortError') showError(error);});
      }
      function exportHTML() {
        if (!canOperate() || EC.Dialogs.isConfirming()) return;
        if (get('ec-dialog').open) {dialogs.showMessage('请先点击“确定”或“取消”，再导出。'); return;}
        if (!canvas.finishAnnotation()) return;
        const snapshot = structuredClone(project); EC.Model.fillProjectDefaults(snapshot);
        const html = EC.Serialization.buildDocument(bundle,snapshot);
        const url = URL.createObjectURL(new Blob([html],{type:'text/html'})), link = document.createElement('a');
        link.href = url; link.download = 'archify-export.html'; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url),30000);
      }
      const actions = {
        'add-module'() {
          const center = canvas.centerPoint(), position = EC.Canvas.snapPoint({x:center.x - 180,y:center.y - 100});
          dialogs.editModule(undefined,position);
        },
        'add-group':() => dialogs.editGroup(),
        'edit-project':() => dialogs.editProject(), 'zoom-in':() => canvas.zoomBy(1.2), 'zoom-out':() => canvas.zoomBy(1 / 1.2),
        fit:() => canvas.fit(), save:() => save(false), import:importFile, export:() => save(true), 'export-html':exportHTML
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
