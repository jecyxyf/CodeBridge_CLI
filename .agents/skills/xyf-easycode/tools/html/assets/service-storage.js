(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const endpoint = () => new URL('/api/project',root.location.href).href;
  async function responseError(response) {
    const body = await response.json().catch(() => ({}));
    return Object.assign(new Error(body.error || `服务请求失败（${response.status}）`),{status:response.status});
  }
  async function load(version) {
    const response = await fetch(endpoint(),{cache:'no-store',headers:version ? {'If-None-Match':version} : {},signal:AbortSignal.timeout(10000)});
    if (response.status === 304) return null;
    if (!response.ok) throw await responseError(response);
    const project = await response.json(), revision = response.headers.get('ETag');
    const validation = EC.Model.validate(project);
    if (validation.errors.length) throw new Error(validation.errors[0].message);
    if (!revision) throw new Error('服务没有返回文件版本，无法安全保存。');
    return {project,version:revision};
  }
  function download(content,name,type) {
    const url = URL.createObjectURL(new Blob([content],{type})), link = document.createElement('a');
    link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url),30000);
  }
  function chooseFile() {
    return new Promise((resolve,reject) => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.hidden = true;
      const cancel = () => {input.remove(); reject(Object.assign(new Error('已取消导入'),{name:'AbortError'}));};
      input.addEventListener('cancel',cancel,{once:true});
      input.addEventListener('change',() => {const file = input.files[0]; input.remove(); file ? resolve(file) : cancel();},{once:true});
      document.body.append(input); input.click();
    });
  }
  function createController({version:initialVersion,getProject,replaceProject,validate,prepareSave = () => {},onSaved = () => {},
    buildDocument,readProject,isBusy = () => false,confirmImport = () => false,confirmReload = () => false,
    onState = () => {},onExternal = () => {}}) {
    let version = initialVersion, editVersion = 0, savedVersion = 0, inFlight = null, checking = false, timer, stopped = false;
    const isDirty = () => editVersion !== savedVersion;
    const state = (status,message) => onState({status,message,dirty:isDirty(),fileName:'archify.json'});
    const check = project => {
      const result = validate(project);
      if (result.errors.length) throw new Error(result.errors.map(item => `${item.path}: ${item.message}`).join('\n'));
    };
    function operation(action) {
      if (inFlight) return inFlight;
      inFlight = Promise.resolve().then(action).catch(error => {
        if (error.name !== 'AbortError') state('error',error.message);
        throw error;
      }).finally(() => {inFlight = null;});
      return inFlight;
    }
    function save() {
      return operation(async () => {
        if (isBusy()) throw new Error('请先完成或取消当前编辑，再保存。');
        const snapshotVersion = editVersion, snapshot = structuredClone(getProject());
        check(snapshot); prepareSave(snapshot); check(snapshot); state('saving','正在保存');
        const response = await fetch(endpoint(),{method:'PUT',headers:{'Content-Type':'application/json','If-Match':version},body:JSON.stringify(snapshot),signal:AbortSignal.timeout(30000)});
        if (!response.ok) {
          if (response.status === 409) onExternal('配置已被其他操作修改。当前编辑已保留，请先导出备份，再载入最新内容。',true);
          throw await responseError(response);
        }
        const revision = response.headers.get('ETag');
        if (!revision) throw new Error('保存结果缺少文件版本，请重新载入核对。');
        version = revision; savedVersion = snapshotVersion;
        if (editVersion === snapshotVersion) onSaved(snapshot);
        onExternal('',false); state(isDirty() ? 'unsaved' : 'saved','已保存到 archify.json');
        return true;
      });
    }
    async function refresh(force = false) {
      if (checking || inFlight || stopped) return false;
      checking = true;
      try {
        const requestedVersion = version, requestedEdit = editVersion;
        const latest = await load(force ? undefined : version);
        if (requestedVersion !== version || requestedEdit !== editVersion) return false;
        if (!latest) {onExternal('',false); return false;}
        // A save/import can begin while the GET request is in flight.
        if (inFlight) return false;
        if (isBusy()) {onExternal('配置已更新。结束当前编辑后可载入最新内容。',true); return false;}
        if (isDirty() && (!force || !await confirmReload())) {
          onExternal('配置已更新。当前编辑已保留，可先导出备份，再载入最新内容。',true); return false;
        }
        // The disk and the page may change while the confirmation is open.
        if (inFlight || isBusy() || requestedVersion !== version || requestedEdit !== editVersion) return false;
        const current = force ? await load() : latest;
        if (inFlight || isBusy() || requestedVersion !== version || requestedEdit !== editVersion || stopped) return false;
        replaceProject(current.project); version = current.version; savedVersion = editVersion;
        onExternal('',false); state('loaded','已载入最新内容'); return true;
      } catch (error) {
        onExternal(`暂时无法同步：${error.message}。正在自动重试，当前编辑仍保留。`,false);
        if (force) throw error;
        return false;
      } finally {checking = false;}
    }
    async function poll() {
      if (stopped) return;
      await refresh();
      if (!stopped) timer = setTimeout(poll,2000);
    }
    return {
      save,
      saveAs() {
        const snapshot = structuredClone(getProject()); check(snapshot); prepareSave(snapshot); check(snapshot);
        download(EC.ProjectFile.stringify(snapshot),'archify.json','application/json');
        return Promise.resolve(true);
      },
      importFile() {
        if (inFlight) return Promise.reject(new Error('正在保存或导入，请稍后再试。'));
        const selection = chooseFile();
        return operation(async () => {
          const file = await selection;
          if (!/\.json$/i.test(file.name)) throw new Error('请选择 .json 格式的架构配置文件。');
          const content = await file.text();
          const next = EC.ProjectFile.parse(content);
          check(next);
          if (isBusy()) throw new Error('请先完成或取消当前编辑，再导入。');
          if (isDirty() && !await confirmImport()) return false;
          replaceProject(next); editVersion++; state('unsaved','已导入；点击保存后写入 archify.json');
          return true;
        });
      },
      reload:() => refresh(true),
      startSync() {stopped = false; clearTimeout(timer); timer = setTimeout(poll,2000);},
      destroy() {stopped = true; clearTimeout(timer);},
      markDirty() {editVersion++; state('unsaved','有修改尚未保存');},
      isDirty,
      getFileName:() => 'archify.json'
    };
  }
  EC.ServiceStorage = {load,createController};
})(globalThis);
