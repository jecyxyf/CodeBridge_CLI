globalThis.EasyCode.register("project-storage",function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const t = (key,params) => EC.I18n.t(key,params);
  const defaultName = 'software_architecture.js';
  const cancelled = () => Object.assign(new Error(t('projectStorage.cancelled')),{name:'AbortError'});
  function chooseImportFile() {
    return new Promise((resolve,reject) => {
      const input = root.document.createElement('input');
      input.type = 'file'; input.accept = '.js,text/javascript,application/javascript'; input.hidden = true;
      const cleanup = () => input.remove();
      input.addEventListener('change',() => {const file = input.files?.[0]; cleanup(); file ? resolve(file) : reject(cancelled());},{once:true});
      input.addEventListener('cancel',() => {cleanup(); reject(cancelled());},{once:true});
      root.document.body.append(input); input.click();
    });
  }
  function downloadFile(content,fileName) {
    const url = root.URL.createObjectURL(new Blob([content],{type:'text/javascript;charset=utf-8'}));
    const link = root.document.createElement('a');
    link.href = url; link.download = fileName;
    root.document.body.append(link);
    try {link.click();} finally {link.remove(); root.setTimeout(() => root.URL.revokeObjectURL(url),30000);}
  }
  function createController({initialProject = null,initialHandle = null,initialBaseline = null,getProject,replaceProject,validate,pickExisting,pickNew,
    canWrite = Boolean(initialHandle) || (typeof pickExisting === 'function' && typeof pickNew === 'function'),
    pickImport = chooseImportFile,download = downloadFile,confirmOverwrite = () => false,
    prepareSave = () => {},onSaved = () => {},isBusy = () => false,confirmImport = () => false,
    confirmReload = () => false,onState = () => {},onExternal = () => {}}) {
    let handle = initialHandle, baseline = initialHandle ? initialBaseline : null, sourceName = initialHandle?.name || (initialProject === null ? '' : defaultName);
    let loaded = initialProject !== null, editVersion = 0, savedVersion = 0, unconfirmed = false;
    let initialData = initialProject === null ? null : JSON.stringify(initialProject);
    let inFlight = null, checking = false, timer, stopped = false;
    const isDirty = () => unconfirmed || editVersion !== savedVersion;
    const getFileName = () => handle?.name || sourceName || (loaded ? defaultName : '');
    const state = (status,message) => onState({status,message,dirty:isDirty(),fileName:getFileName()});
    const read = async target => (typeof target.getFile === 'function' ? await target.getFile() : target).text();
    const checkFile = target => {if (!/\.js$/i.test(target?.name || '')) throw new Error(t('projectStorage.chooseJs'));};
    function check(project) {
      EC.ProjectFile.validate(project);
      const result = validate(project);
      if (result.errors.length) throw new Error(result.errors.map(item => t('projectStorage.validationDetail',{path:item.path,message:item.message})).join('\n'));
      return project;
    }
    const parse = content => check(EC.ProjectFile.parse(content));
    function conflict() {
      onExternal(t('projectStorage.externalConflict'),Boolean(handle));
      return new Error(t('projectStorage.originalPreserved'));
    }
    function ready() {
      if (!loaded) throw new Error(t('projectStorage.loadFirst'));
      if (isBusy()) throw new Error(t('projectStorage.finishBeforeFileOperation'));
    }
    // Invoke the action now: file pickers and permission prompts need this click.
    function operation(action) {
      if (inFlight) return inFlight;
      let resolve, reject;
      const pending = new Promise((done,fail) => {resolve = done; reject = fail;});
      inFlight = pending;
      function finish(error,result) {
        inFlight = null;
        if (error) {
          state(error.name === 'AbortError' ? (isDirty() ? 'unsaved' : loaded ? 'loaded' : 'idle') : 'error',error.name === 'AbortError' ? t('projectStorage.cancelledPreserved') : error.message);
          reject(error);
        } else resolve(result);
      }
      try {Promise.resolve(action()).then(result => finish(null,result),error => finish(error));}
      catch (error) {finish(error);}
      return pending;
    }
    function makeSnapshot() {
      ready();
      const snapshot = structuredClone(getProject());
      check(snapshot); prepareSave(snapshot); check(snapshot);
      return {snapshot,content:EC.ProjectFile.stringify(snapshot),version:editVersion};
    }
    function exportCopy() {
      return operation(async () => {
        const {content} = makeSnapshot();
        // Download is deliberately called before the first await.
        await download(content,defaultName);
        state('exported',t('projectStorage.exportedCopy'));
        return true;
      });
    }
    function open() {
      return operation(async () => {
        if (isBusy()) throw new Error(t('projectStorage.finishBeforeOpen'));
        const selection = canWrite && typeof pickExisting === 'function' ? pickExisting(handle) : pickImport();
        state('loading',t('projectStorage.loading'));
        const target = await selection; checkFile(target);
        const content = await read(target), next = parse(content);
        if (isBusy()) throw new Error(t('projectStorage.finishBeforeOpen'));
        if (isDirty()) {
          const previousEdit = editVersion;
          if (!await confirmImport()) throw cancelled();
          if (previousEdit !== editVersion) throw new Error(t('projectStorage.changedDuringConfirmation'));
        }
        if (isBusy()) throw new Error(t('projectStorage.editNotFinished'));
        replaceProject(next);
        handle = typeof target.getFile === 'function' && typeof target.createWritable === 'function' ? target : null;
        baseline = handle ? content : null; sourceName = target.name;
        initialData = JSON.stringify(next); loaded = true; editVersion = savedVersion = 0; unconfirmed = false;
        onExternal('',false); state('loaded',handle ? t('projectStorage.opened') : t('projectStorage.importedReadOnly'));
        return true;
      });
    }
    function save(asNew = false) {
      if (!canWrite || (asNew && typeof pickNew !== 'function') || (!asNew && !handle && typeof pickExisting !== 'function')) return exportCopy();
      return operation(async () => {
        const {snapshot,content,version:snapshotVersion} = makeSnapshot();
        const selection = asNew ? pickNew(defaultName,handle) : handle || pickExisting();
        const permission = !asNew && handle?.requestPermission ? handle.requestPermission({mode:'readwrite'}) : 'granted';
        state('saving',handle || asNew ? t('projectStorage.saving') : t('projectStorage.chooseOriginal'));
        if (await permission !== 'granted') throw new Error(t('projectStorage.writePermissionRetry'));
        const target = await selection; checkFile(target);
        if (typeof target.createWritable !== 'function') throw new Error(t('projectStorage.cannotWrite'));
        if (target !== handle && target.requestPermission && await target.requestPermission({mode:'readwrite'}) !== 'granted') throw new Error(t('projectStorage.writePermissionDenied'));
        const same = target === handle || Boolean(handle?.isSameEntry && await handle.isSameEntry(target));
        const before = await read(target);
        if (same && before !== baseline) throw conflict();
        if (!asNew && !handle && JSON.stringify(parse(before)) !== initialData) throw conflict();
        if (asNew && !same && before.length && !await confirmOverwrite({fileName:target.name})) throw cancelled();
        if (await read(target) !== before) throw conflict();
        let writable, closed = false, closeAttempted = false;
        try {
          writable = await target.createWritable();
          if (await read(target) !== before) throw conflict();
          await writable.write(content);
          closeAttempted = true; await writable.close(); closed = true;
          const readBack = await read(target);
          if (readBack !== content) throw new Error(t('projectStorage.readbackMismatch'));
          parse(readBack);
          handle = target; baseline = readBack; sourceName = target.name;
          initialData = JSON.stringify(snapshot); savedVersion = snapshotVersion; unconfirmed = false;
          if (editVersion === snapshotVersion) onSaved(snapshot);
          onExternal('',false);
          state(isDirty() ? 'unsaved' : 'saved',isDirty() ? t('projectStorage.newerChanges') : t('projectStorage.saved'));
          return true;
        } catch (error) {
          if (writable && !closed) {try {await writable.abort();} catch { /* Keep the original failure. */ }}
          if (closeAttempted) {
            unconfirmed = true;
            throw new Error(t('projectStorage.verificationFailed',{message:error.message}),{cause:error});
          }
          throw error;
        }
      });
    }
    async function refresh(force = false) {
      if (!handle || inFlight || checking || stopped) return false;
      checking = true;
      const target = handle, previous = baseline, requestedEdit = editVersion;
      const outdated = () => stopped || inFlight || target !== handle || previous !== baseline || requestedEdit !== editVersion;
      try {
        let content = await read(target);
        if (outdated()) return false;
        if (content === baseline) {onExternal('',false); return false;}
        let next = parse(content);
        if (isBusy()) {onExternal(t('projectStorage.updatedWhileEditing'),true); return false;}
        if (isDirty()) {
          onExternal(t('projectStorage.updatedWithUnsaved'),true);
          if (!force || !await confirmReload()) return false;
          if (outdated() || isBusy()) return false;
          content = await read(target); next = parse(content);
        }
        if (outdated() || isBusy()) return false;
        replaceProject(next); baseline = content; initialData = JSON.stringify(next); savedVersion = editVersion; unconfirmed = false;
        onExternal('',false); state('loaded',t('projectStorage.latestLoaded'));
        return true;
      } catch (error) {
        if (!outdated()) onExternal(t('projectStorage.readFailed',{message:error.message}),false);
        if (force) throw error;
        return false;
      } finally {checking = false;}
    }
    async function poll() {
      if (stopped) return;
      await refresh();
      if (!stopped) timer = root.setTimeout(poll,2000);
    }
    state(loaded ? 'loaded' : 'idle',loaded ? (handle ? t('projectStorage.opened') : t('projectStorage.automaticallyLoaded')) : t('projectStorage.loadPrompt'));
    return {
      importFile:open,save:() => save(),saveAs:() => save(true),download:exportCopy,reload:() => refresh(true),refresh,
      startSync() {stopped = false; root.clearTimeout(timer); timer = root.setTimeout(poll,2000);},
      destroy() {stopped = true; root.clearTimeout(timer);},
      markDirty() {editVersion++; state('unsaved',t('projectStorage.unsaved'));},
      isDirty,getFileName
    };
  }
  EC.ProjectStorage = {createController};
});
