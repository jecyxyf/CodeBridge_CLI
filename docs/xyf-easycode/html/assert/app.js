globalThis.EasyCode.register("app",function (root) {
  'use strict';
  const EC = root.EasyCode;
  async function boot() {
    const get = id => document.getElementById(id);
    const notice = get('ec-notice');
    const t = (key,params) => EC.I18n.t(key,params);
    function showError(error) {notice.textContent = error?.message || String(error); notice.hidden = false;}
    root.addEventListener('error',event => showError(event.error || event.message));
    root.addEventListener('unhandledrejection',event => {event.preventDefault(); showError(event.reason);});
    try {
      EC.Icons.hydrate(document);
      let initial = null, loadError = '', initialHandle = null, initialBaseline = null;
      const snapshot = get('ec-project');
      if (!snapshot && /^https?:$/i.test(root.location?.protocol || '') && typeof root.fetch === 'function') {
        try {
          const response = await root.fetch('__easycode__/project',{cache:'no-store',credentials:'same-origin',headers:{'x-easycode-project':'1'}});
          if (response.ok && response.headers.get('x-easycode-project') === '1') {
            initialBaseline = await response.text();
            initial = structuredClone(EC.ProjectFile.parse(initialBaseline));
            initialHandle = {
              name:EC.ProjectFile.fileName,
              async getFile() {
                const res = await root.fetch('__easycode__/project',{cache:'no-store',credentials:'same-origin',headers:{'x-easycode-project':'1'}});
                if (!res.ok) throw new Error(t('projectStorage.cannotWrite'));
                const body = await res.text();
                return {name:EC.ProjectFile.fileName,text:async () => body};
              },
              async createWritable() {
                let buffer = '';
                return {
                  async write(chunk) {buffer += String(chunk ?? '');},
                  async close() {
                    const res = await root.fetch('__easycode__/project',{
                      method:'PUT',
                      headers:{'content-type':'text/javascript;charset=utf-8','x-easycode-project':'1'},
                      body:buffer,
                      credentials:'same-origin'
                    });
                    if (!res.ok) throw new Error((await res.text()) || t('projectStorage.cannotWrite'));
                  },
                  async abort() {buffer = '';}
                };
              }
            };
          }
        } catch (error) {
          if (initialBaseline !== null) loadError = error.message;
        }
      }
      if (initial === null && !loadError) {
        try {
          const source = snapshot ? JSON.parse(snapshot.textContent) : root.softwareArchitecture;
          if (source === undefined) throw new Error(t("app.cannot.load.software.architecture.js.keep.it"));
          initial = structuredClone(EC.ProjectFile.validate(source));
        } catch (error) {loadError = error.message;}
      }
      let projectOpened = initial !== null;
      let project = initial || EC.Model.createProject();
      let canvas, nodes, dialogs, storage;
      const nativeFiles = typeof root.showOpenFilePicker === 'function' && typeof root.showSaveFilePicker === 'function';
      const fileTypes = [{description:t("app.software.architecture.data"),accept:{'text/javascript':['.js']}}];
      let pickerHash = 2166136261;
      for (const character of root.location.href.split(/[?#]/)[0]) pickerHash = Math.imul(pickerHash ^ character.charCodeAt(0),16777619);
      const pickerId = `easycode-${(pickerHash >>> 0).toString(16)}`;
      function download(content,fileName,type = 'text/javascript;charset=utf-8') {
        const url = URL.createObjectURL(new Blob([content],{type}));
        const link = document.createElement('a');
        link.href = url; link.download = fileName; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url),30000);
      }
      function pickImport() {
        return new Promise((resolve,reject) => {
          const input = document.createElement('input'); input.type = 'file'; input.accept = '.js'; input.hidden = true;
          let settled = false;
          function finish(file) {
            if (settled) return; settled = true; input.remove();
            if (file) resolve(file); else reject(Object.assign(new Error(t("app.open.cancelled")),{name:'AbortError'}));
          }
          input.addEventListener('change',() => finish(input.files?.[0]),{once:true});
          input.addEventListener('cancel',() => finish(),{once:true});
          document.body.append(input); input.click();
        });
      }
      const warningNotice = EC.Feedback.createWarningNotice({
        show(message) {get('ec-warning-text').textContent = message; get('ec-warnings').hidden = false;},
        hide() {get('ec-warnings').hidden = true;}
      });
      get('ec-warning-close').addEventListener('click',warningNotice.dismiss);
      function refreshWarnings() {
        if (!projectOpened) {warningNotice.update('',project.id); return;}
        warningNotice.update(EC.Feedback.formatWarnings(project,EC.Model.validate(project).warnings),project.id);
      }
      const syncNotice = document.createElement('div'), syncText = document.createElement('span'), reloadButton = document.createElement('button');
      syncNotice.id = 'ec-sync-notice'; syncNotice.hidden = true; syncNotice.setAttribute('role','status');
      reloadButton.type = 'button'; reloadButton.textContent = t("app.load.latest.version");
      syncNotice.append(syncText,reloadButton); get('ec-feedback').prepend(syncNotice);
      function labelAction(action,title,label = title) {
        for (const control of document.querySelectorAll(`[data-action="${action}"]`)) {control.title = title; control.setAttribute('aria-label',label);}
      }
      labelAction('import',t("app.load.configuration"));
      labelAction('save',t("app.save.configuration.ctrl.s"),t("app.save.configuration"));
      labelAction('export',t("app.download.js.copy.ctrl.shift.s"),t("app.download.js.copy"));
      get('ec-export-html').hidden = false;
      const isNativeHandle = value => typeof root.FileSystemHandle === 'function' && value instanceof root.FileSystemHandle;
      storage = EC.ProjectStorage.createController({
        initialProject:initial,
        initialHandle,
        initialBaseline,
        getProject:() => project,
        validate:EC.Model.validate,
        isBusy:() => get('ec-dialog').open || EC.Dialogs.isConfirming() || !!canvas?.hasDraftChanges(),
        prepareSave:EC.Model.fillProjectDefaults,
        onSaved() {if (EC.Model.fillProjectDefaults(project)) {nodes?.render(); canvas?.refresh(); refreshHeader();}},
        pickExisting:nativeFiles ? startIn => root.showOpenFilePicker({id:pickerId,types:fileTypes,multiple:false,...(isNativeHandle(startIn) ? {startIn} : {})}).then(handles => handles[0]) : undefined,
        pickNew:nativeFiles ? (suggestedName,startIn) => root.showSaveFilePicker({id:pickerId,types:fileTypes,suggestedName,...(isNativeHandle(startIn) ? {startIn} : {})}) : undefined,
        pickImport,download,
        confirmOverwrite:({fileName}) => EC.Dialogs.confirm(t("app.replace.the.contents.of.filename",{fileName}),{title:t("app.replace.file"),confirmLabel:t("app.replace"),danger:true}),
        confirmImport:() => EC.Dialogs.confirm(t("app.there.are.unsaved.changes.loading.another.file"),{title:t("app.load.configuration"),confirmLabel:t("app.continue"),danger:false}),
        confirmReload:() => EC.Dialogs.confirm(t("app.loading.will.discard.unsaved.edits.download.a"),{title:t("app.load.latest.version"),confirmLabel:t("app.discard.edits.and.reload"),danger:true}),
        onExternal(message,canReload) {syncText.textContent = message; syncNotice.hidden = !message; reloadButton.hidden = !canReload;},
        replaceProject(next) {
          if (get('ec-dialog').open || canvas?.hasDraftChanges()) throw new Error(t("app.finish.or.cancel.the.current.edit.before"));
          const previous = project, wasOpened = projectOpened;
          project = next; projectOpened = true;
          try {mount();} catch (error) {project = previous; projectOpened = wasOpened; mount(); throw error;}
        },
        onState(state) {
          if (state.status === 'error') {showError(state.message); if (!projectOpened) get('ec-open-message').textContent = state.message;}
          if (['saved','loaded','exported'].includes(state.status)) notice.hidden = true;
          const status = get('ec-file-status');
          status.textContent = [state.fileName,state.message].filter(Boolean).join(' · '); status.title = status.textContent;
          refreshWarnings();
          document.title = projectOpened ? `${state.dirty ? '● ' : ''}${EC.Model.projectTitle(project)}` : t("app.load.architecture.configuration");
        }
      });
      function refreshHeader() {
        const name = get('ec-project-name'), description = get('ec-project-description');
        name.textContent = projectOpened ? EC.Model.projectTitle(project) : t("app.architecture.editor"); name.title = name.textContent;
        description.textContent = projectOpened ? project.description || t("app.click.the.heading.to.add.a.description") : t("app.load.a.configuration.to.view.and.edit"); description.title = description.textContent;
        get('ec-empty').hidden = !projectOpened || project.modules.length > 0 || project.groups.length > 0;
        get('ec-open-project').hidden = projectOpened; get('ec-world').inert = !projectOpened;
        for (const control of document.querySelectorAll('[data-action]')) control.disabled = !projectOpened && control.dataset.action !== 'import';
        document.title = projectOpened ? `${storage?.isDirty() ? '● ' : ''}${EC.Model.projectTitle(project)}` : t("app.load.architecture.configuration");
      }
      function onChange(change = {}) {storage.markDirty(); if (change.render) nodes.render(); canvas?.refresh(); refreshHeader();}
      function mount() {
        canvas?.destroy(); nodes?.destroy();
        dialogs = EC.Dialogs.create({project,onChange,onOpen:() => {nodes?.hidePreview(); canvas?.cancelConnection(); return canvas?.finishAnnotation();}});
        nodes = EC.Nodes.create({project,layer:get('ec-nodes'),template:get('ec-module-template'),onEdit:dialogs.editModule}); nodes.render();
        canvas = EC.Canvas.create({project,viewport:get('ec-viewport'),world:get('ec-world'),groupLayer:get('ec-groups'),groupTemplate:get('ec-group-template'),edgeLayer:get('ec-edges'),nodes,onChange,onGroupEdit:dialogs.editGroup});
        canvas.restoreView(); refreshHeader(); EC.app = {project,storage,nodes,canvas,dialogs};
      }
      mount();
      if (loadError) {get('ec-open-message').textContent = loadError; showError(loadError);}
      reloadButton.addEventListener('click',() => storage.reload().catch(showError));
      storage.startSync(); root.addEventListener('pagehide',storage.destroy);
      root.addEventListener('pageshow',event => {if (event.persisted) storage.startSync();});
      root.addEventListener('focus',() => storage.refresh());
      function ready() {
        if (!projectOpened) {showError(t("app.load.software.architecture.js.first")); return false;}
        if (EC.Dialogs.isConfirming()) return false;
        if (get('ec-dialog').open) {dialogs.showMessage(t("app.click.ok.or.cancel.before.file.operations")); return false;}
        return canvas.finishAnnotation();
      }
      function run(action) {
        notice.hidden = true;
        try {Promise.resolve(action()).catch(error => {if (error?.name !== 'AbortError') showError(error);});}
        catch (error) {if (error?.name !== 'AbortError') showError(error);}
      }
      function save(copy) {if (ready()) run(() => copy ? storage.download() : storage.save());}
      function importFile() {
        if (EC.Dialogs.isConfirming()) return;
        if (get('ec-dialog').open) {dialogs.showMessage(t("app.click.ok.or.cancel.before.importing")); return;}
        if (!canvas.finishAnnotation()) return;
        run(() => storage.importFile());
      }
      function exportHTML() {
        if (!ready()) return;
        const snapshot = structuredClone(project); EC.Model.fillProjectDefaults(snapshot);
        download(EC.Serialization.buildDocument(snapshot),'architecture-snapshot.html','text/html;charset=utf-8');
      }
      const actions = {
        'add-module'() {const center = canvas.centerPoint(); dialogs.editModule(undefined,EC.Canvas.snapPoint({x:center.x - 180,y:center.y - 100}));},
        'add-group':() => dialogs.editGroup(),'edit-project':() => dialogs.editProject(),
        'zoom-in':() => canvas.zoomBy(1.2),'zoom-out':() => canvas.zoomBy(1 / 1.2),fit:() => canvas.fit(),
        save:() => save(false),export:() => save(true),import:importFile,'export-html':exportHTML
      };
      for (const control of document.querySelectorAll('[data-action]')) control.addEventListener('click',() => {
        try {if (!['zoom-in','zoom-out','fit'].includes(control.dataset.action)) canvas.cancelConnection(); actions[control.dataset.action]?.();} catch (error) {showError(error);}
      });
      root.addEventListener('keydown',event => {if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {event.preventDefault(); save(event.shiftKey);}});
      root.addEventListener('beforeunload',event => {if (storage.isDirty() || dialogs.hasDraftChanges() || canvas.hasDraftChanges()) {event.preventDefault(); event.returnValue = '';}});
    } catch (error) {showError(error); for (const control of document.querySelectorAll('[data-action]')) control.disabled = true;}
  }
  EC.start = boot;
});
