(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  function createController({initialProject = null,getProject,replaceProject,validate,pickExisting,pickNew,prepareSave = () => {},onSaved = () => {},
    isBusy = () => false,confirmImport = () => false,confirmReload = () => false,onState = () => {},onExternal = () => {}}) {
    let handle = null, baseline = null, loaded = initialProject !== null, editVersion = 0, savedVersion = 0, unconfirmed = false;
    let initialData = initialProject === null ? null : JSON.stringify(initialProject);
    let inFlight = null, checking = false, timer, stopped = false;
    const isDirty = () => unconfirmed || editVersion !== savedVersion;
    const getFileName = () => handle?.name || (loaded ? 'archify.json' : '');
    const state = (status,message) => onState({status,message,dirty:isDirty(),fileName:getFileName()});
    const read = async target => (await target.getFile()).text();
    const checkFile = target => {if (!/\.json$/i.test(target.name || '')) throw new Error('请选择 .json 格式的架构配置文件。');};
    function check(project) {
      const result = validate(project);
      if (result.errors.length) throw new Error(result.errors.map(item => `${item.path}: ${item.message}`).join('\n'));
      return project;
    }
    const parse = content => check(EC.ProjectFile.parse(content));
    const cancelled = () => Object.assign(new Error('已取消操作'),{name:'AbortError'});
    const conflict = () => {
      onExternal('配置已被其他操作修改。当前编辑已保留，可先另存为，再重新加载原文件。',Boolean(handle));
      return new Error('配置文件不匹配或已被其他操作修改，未覆盖原文件。');
    };
    function ready() {
      if (!loaded) throw new Error('请先加载 archify.json。');
      if (isBusy()) throw new Error('请先完成或取消当前编辑，再操作文件。');
    }
    // Invoke action synchronously: native pickers and permission requests need the user's click.
    function operation(action) {
      if (inFlight) return inFlight;
      let resolve, reject;
      const pending = new Promise((done,fail) => {resolve = done; reject = fail;});
      inFlight = pending;
      const finish = (error,result) => {
        inFlight = null;
        if (error) {
          state(error.name === 'AbortError' ? (isDirty() ? 'unsaved' : loaded ? 'loaded' : 'idle') : 'error',error.name === 'AbortError' ? '已取消操作，当前内容已保留' : error.message);
          reject(error);
        } else resolve(result);
      };
      try {Promise.resolve(action()).then(result => finish(null,result),error => finish(error));}
      catch (error) {finish(error);}
      return pending;
    }
    function open() {
      return operation(async () => {
        if (isBusy()) throw new Error('请先完成或取消当前编辑，再打开文件。');
        const selection = pickExisting(handle);
        state('loading','正在加载配置');
        const target = await selection; checkFile(target);
        const content = await read(target), next = parse(content);
        if (isBusy()) throw new Error('请先完成或取消当前编辑，再打开文件。');
        if (isDirty() && !await confirmImport()) throw cancelled();
        if (isBusy()) throw new Error('当前编辑尚未结束。');
        replaceProject(next);
        handle = target; baseline = content; initialData = JSON.stringify(next); loaded = true; editVersion = savedVersion = 0; unconfirmed = false;
        onExternal('',false); state('loaded','已打开');
        return true;
      });
    }
    function save(asNew = false) {
      return operation(async () => {
        ready();
        const snapshotVersion = editVersion, snapshot = structuredClone(getProject());
        check(snapshot); prepareSave(snapshot); check(snapshot);
        const content = EC.ProjectFile.stringify(snapshot);
        // Request permission before reading the disk or waiting on anything else.
        const selection = asNew ? pickNew(getFileName() || 'archify.json',handle) : handle || pickExisting();
        const permission = !asNew && handle?.requestPermission ? handle.requestPermission({mode:'readwrite'}) : 'granted';
        state('saving',handle || asNew ? '正在保存配置' : '请选择当前页面对应的 archify.json');
        if (await permission !== 'granted') throw new Error('没有获得写入权限，当前编辑仍保留。请再次点击保存并允许写入。');
        const target = await selection;
        checkFile(target);
        if (target !== handle && target.requestPermission && await target.requestPermission({mode:'readwrite'}) !== 'granted') throw new Error('没有获得写入权限，当前编辑仍保留。');
        const same = target === handle || (handle?.isSameEntry && await handle.isSameEntry(target));
        const before = await read(target);
        if (same && before !== baseline) throw conflict();
        if (!asNew && !handle && JSON.stringify(parse(before)) !== initialData) throw conflict();
        let writable, closed = false;
        try {
          writable = await target.createWritable();
          // Catch changes made while the browser was opening the write stream.
          if (await read(target) !== before) throw conflict();
          await writable.write(content);
          await writable.close(); closed = true;
          const readBack = await read(target);
          if (readBack !== content) throw new Error('保存后文件内容与本次修改不一致');
          parse(readBack);
          handle = target; baseline = readBack; initialData = JSON.stringify(snapshot); savedVersion = snapshotVersion; unconfirmed = false;
          if (editVersion === snapshotVersion) onSaved(snapshot);
          onExternal('',false);
          state(isDirty() ? 'unsaved' : 'saved',isDirty() ? '有较新的修改尚未保存' : '已保存到配置文件');
          return true;
        } catch (error) {
          if (writable && !closed) {try {await writable.abort();} catch { /* Keep the write error. */ }}
          if (closed) {
            unconfirmed = true;
            throw new Error(`文件可能已写入，但读回核对失败：${error.message}。当前编辑仍保留。`,{cause:error});
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
        if (isBusy()) {onExternal('配置已更新，结束当前编辑后可载入最新内容。',true); return false;}
        if (isDirty()) {
          onExternal('配置已更新。当前编辑已保留，可先另存为，再重新加载原文件。',true);
          if (!force || !await confirmReload()) return false;
          if (outdated() || isBusy()) return false;
          // The disk may change again while the confirmation is open.
          content = await read(target); next = parse(content);
        }
        if (outdated() || isBusy()) return false;
        replaceProject(next); baseline = content; initialData = JSON.stringify(next); savedVersion = editVersion; unconfirmed = false;
        onExternal('',false); state('loaded','已载入最新配置');
        return true;
      } catch (error) {
        if (!outdated()) onExternal(`暂时无法读取配置：${error.message}。当前内容已保留，可重新加载文件。`,false);
        if (force) throw error;
        return false;
      } finally {checking = false;}
    }
    async function poll() {
      if (stopped) return;
      await refresh();
      if (!stopped) timer = setTimeout(poll,2000);
    }
    state(loaded ? 'loaded' : 'idle',loaded ? '已加载；首次保存时选择原文件' : '请加载 archify.json');
    return {
      importFile:open,save:() => save(),saveAs:() => save(true),reload:() => refresh(true),refresh,
      startSync() {stopped = false; clearTimeout(timer); timer = setTimeout(poll,2000);},
      destroy() {stopped = true; clearTimeout(timer);},
      markDirty() {editVersion++; state('unsaved','有修改尚未保存');},
      isDirty,getFileName
    };
  }
  EC.ProjectStorage = {createController};
})(globalThis);
