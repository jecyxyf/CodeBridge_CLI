(function (root) {
  'use strict';
  const namespace = root.EasyCode ||= {};

  function createController({getProject,buildDocument,readProject,validate,pickExisting,pickNew,replaceProject,confirmImport = () => false,onState = () => {}}) {
    // Capture before Canvas.fit() or edits can change the live project.
    const initialProject = structuredClone(getProject());
    let initialData = JSON.stringify(initialProject);
    let handle = null, lastContent = null, inFlight = null, importing = false;
    let editVersion = 0, savedVersion = 0, unconfirmed = false;
    const isDirty = () => unconfirmed || editVersion !== savedVersion;
    const getFileName = () => handle?.name || '';
    function state(status,message) {
      onState({status,message,fileName:getFileName(),dirty:isDirty()});
    }
    function check(project) {
      const result = validate(project);
      if (result.errors.length) throw new Error(result.errors.map(item => `${item.path}: ${item.message}`).join('\n'));
    }
    const read = async target => (await target.getFile()).text();

    async function persist(target,html,snapshot,snapshotVersion,saveAs) {
      let writable, closed = false;
      try {
        const before = await read(target);
        const sameTarget = target === handle || (handle?.isSameEntry && await handle.isSameEntry(target));
        if (sameTarget) {
          if (before !== lastContent) throw new Error('文件已被外部改变，请重新打开文件或另存为');
        } else if (!saveAs) {
          const diskProject = readProject(before);
          check(diskProject);
          if (diskProject.id !== snapshot.id) throw new Error('所选文件属于另一个项目');
          if (JSON.stringify(diskProject) !== initialData) throw new Error('文件在页面打开后已被外部修改，请重新打开文件或另存为');
        }
        writable = await target.createWritable();
        await writable.write(html);
        await writable.close();
        closed = true;
        const readBack = await read(target);
        if (JSON.stringify(readProject(readBack)) !== JSON.stringify(snapshot)) throw new Error('保存后核对失败');
        // The target becomes current only after the disk contents have been verified.
        handle = target;
        lastContent = readBack;
        savedVersion = snapshotVersion;
        unconfirmed = false;
        state(isDirty() ? 'unsaved' : 'saved',isDirty() ? '有较新的修改尚未保存' : '已保存');
        return true;
      } catch (error) {
        if (writable && !closed) {
          try {await writable.abort();} catch { /* Preserve the original write failure. */ }
        }
        if (closed) {
          unconfirmed = true;
          throw new Error(`文件可能已写入，但保存后核对失败：${error.message}`,{cause:error});
        }
        throw error;
      }
    }

    // Deliberately not async: the picker runs in the click's call stack, and
    // every repeated click receives exactly the same Promise while busy.
    function start(saveAs) {
      if (importing) return Promise.reject(new Error('正在导入，请稍后再保存或导出'));
      if (inFlight) return inFlight;
      let resolve, reject;
      const pending = new Promise((done,fail) => {resolve = done; reject = fail;});
      inFlight = pending;
      function finish(error,result) {
        inFlight = null;
        if (error) {
          state(error.name === 'AbortError' ? 'unsaved' : 'error',error.name === 'AbortError' ? '已取消保存' : error.message);
          reject(error);
        } else resolve(result);
      }
      try {
        const snapshotVersion = editVersion;
        const snapshot = structuredClone(getProject());
        check(snapshot);
        const html = buildDocument(snapshot);
        // Do not move this into a .then(), await, or a queued operation.
        const selection = saveAs ? pickNew(getFileName() || 'project.html') : (handle || pickExisting());
        state('saving','正在保存');
        Promise.resolve(selection).then(target => persist(target,html,snapshot,snapshotVersion,saveAs))
          .then(result => finish(null,result),error => finish(error));
      } catch (error) {finish(error);}
      return pending;
    }

    function importFile() {
      if (inFlight) return Promise.reject(new Error('文件操作尚未完成，请稍后再导入'));
      if (typeof replaceProject !== 'function') return Promise.reject(new Error('未设置导入处理'));
      let resolve, reject;
      const pending = new Promise((done,fail) => {resolve = done; reject = fail;});
      inFlight = pending; importing = true;
      function finish(error) {
        inFlight = null; importing = false;
        if (error) {
          state(error.name === 'AbortError' ? (isDirty() || !handle ? 'unsaved' : 'saved') : 'error',error.name === 'AbortError' ? '已取消导入' : error.message);
          reject(error);
        } else resolve(true);
      }
      try {
        // Open on the button's click stack; validate data without executing the HTML.
        const selection = pickExisting();
        state('loading','正在导入');
        Promise.resolve(selection).then(async target => {
          const content = await read(target), project = readProject(content);
          check(project);
          const baseline = JSON.stringify(project);
          // Check at replacement time, including edits made while the file was loading.
          if (isDirty() && !confirmImport()) throw Object.assign(new Error('已取消导入'),{name:'AbortError'});
          replaceProject(project);
          initialData = baseline; handle = target; lastContent = content;
          editVersion = 0; savedVersion = 0; unconfirmed = false;
          state('saved','已导入');
        }).then(() => finish(),finish);
      } catch (error) {finish(error);}
      return pending;
    }

    state('unsaved','尚未绑定保存文件');
    return {
      save: () => start(false),
      saveAs: () => start(true),
      importFile,
      markDirty() {editVersion++; state(importing ? 'loading' : inFlight ? 'saving' : 'unsaved',importing ? '正在导入，当前页面有修改' : inFlight ? '正在保存，有较新的修改' : '有修改尚未保存');},
      isDirty,
      getFileName
    };
  }
  namespace.Storage = {createController};
})(globalThis);
