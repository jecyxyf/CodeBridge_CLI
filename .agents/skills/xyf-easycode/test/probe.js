(function () {
  'use strict';
  const probe=window.__stabilityProbe={started:performance.now(),errors:[],ready:false,loadMs:null};
  window.addEventListener('error',event=>probe.errors.push(event.error?.stack || event.message));
  window.addEventListener('unhandledrejection',event=>probe.errors.push(event.reason?.stack || String(event.reason)));
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  window.addEventListener('DOMContentLoaded',()=>{
    setTimeout(async()=>{await frame();await frame();probe.loadMs=performance.now()-probe.started;probe.ready=true;},0);
  });
  probe.check=async function ({save=true,details=true}={}) {
    const started=performance.now(), EC=window.EasyCode, app=EC?.app;
    assert(app,'编辑器没有完成初始化');
    assert(!probe.errors.length,probe.errors.join('\n'));
    assert(!window.__fixtureInjection,'特殊字符被错误地执行为脚本');
    const project=app.project, validation=EC.Model.validate(project);
    assert(!validation.errors.length,JSON.stringify(validation.errors));
    assert(!validation.warnings.length,JSON.stringify(validation.warnings));
    assert(document.querySelectorAll('#ec-nodes > .module-node').length===project.modules.length,'模块显示数量错误');
    assert(document.querySelectorAll('#ec-groups > .group-frame').length===project.groups.length,'层级显示数量错误');
    assert(document.querySelectorAll('#ec-edges > .relation-group').length===project.relations.length,'箭头显示数量错误');
    assert(document.getElementById('ec-notice').hidden,'页面显示错误：'+document.getElementById('ec-notice').textContent);
    assert(!document.querySelector('[data-fixture-injection]'),'特殊字符被错误地当成 HTML');
    const viewport=document.getElementById('ec-viewport').getBoundingClientRect();
    const visible=node=>{
      const rect=node.getBoundingClientRect();
      return rect.width>0 && rect.height>0 && rect.right>viewport.left && rect.left<viewport.right && rect.bottom>viewport.top && rect.top<viewport.bottom;
    };
    const visibleModules=[...document.querySelectorAll('#ec-nodes > .module-node')].filter(visible).length;
    const visibleGroups=[...document.querySelectorAll('#ec-groups .group-header')].filter(visible).length;
    assert(!project.modules.length && !project.groups.length || visibleModules+visibleGroups>0,'项目有内容，但模块和层级标题全部在可视区外');
    assert(project.view.scale>=.01,'缩放低于 1% 下限');
    for(const module of project.modules) {
      const node=app.nodes.getElement(module.id);
      assert(node.querySelector('.module-name').textContent===module.name,'模块中文名显示不一致');
      assert(Number.isFinite(parseFloat(node.style.left)) && Number.isFinite(parseFloat(node.style.top)),'节点坐标无效');
    }
    for(const group of project.groups) {
      const node=[...document.querySelectorAll('#ec-groups > .group-frame')].find(n=>n.dataset.groupId===group.id);
      assert(node.querySelector('.group-title').textContent===group.name,'层级名称显示不一致');
      assert(node.querySelector('.group-empty').hidden===project.modules.some(m=>m.groupId===group.id),'空层级提示状态错误');
    }
    if(details) {
      for(const [selector,expected] of [['[data-method-id]',['输入','输出']],['[data-event-id]',['消息参数']]]) {
        const row=document.querySelector(selector);
        if(row) {
          row.click();
          const panel=document.getElementById('ec-module-preview');
          assert(panel && !panel.hidden,'详情未打开');
          for(const title of expected) assert(panel.textContent.includes(title),'详情缺少'+title);
          app.nodes.hidePreview();
        }
      }
      const edit=document.querySelector('[data-group-action="edit"]');
      if(edit) {edit.click();assert(document.getElementById('ec-dialog').open,'层级编辑未打开');document.querySelector('#ec-dialog button[aria-label="取消"]').click();}
    }
    let savedHTML='',saveMs=0;
    if(save) {
      let disk='',working=structuredClone(project);
      const handle={name:'test.html',getFile:async()=>new Blob([disk]),createWritable:async()=>({write:async text=>{disk=text;},close:async()=>{},abort:async()=>{}})};
      const controller=EC.Storage.createController({getProject:()=>working,buildDocument:snapshot=>EC.Serialization.buildDocument(JSON.parse(document.getElementById('ec-bundle').textContent),snapshot),readProject:EC.Serialization.readProject,validate:EC.Model.validate,pickExisting:()=>handle,pickNew:()=>handle,prepareSave:EC.Model.fillProjectDefaults});
      controller.markDirty();const before=performance.now(),pending=controller.saveAs();
      assert(pending===controller.saveAs(),'连续点击保存产生了重复任务');
      await pending;saveMs=performance.now()-before;
      assert(!controller.isDirty(),'保存后仍被标记为未保存');
      const expected=structuredClone(working);EC.Model.fillProjectDefaults(expected);
      assert(same(EC.Serialization.readProject(disk),expected),'保存后数据不一致');
      savedHTML=disk;
    }
    assert(!probe.errors.length,probe.errors.join('\n'));
    return {project:structuredClone(project),savedHTML,loadMs:probe.loadMs,saveMs,checkMs:performance.now()-started,heapBytes:performance.memory?.usedJSHeapSize ?? null,modules:project.modules.length,groups:project.groups.length,relations:project.relations.length,visibleModules,visibleGroups,errors:[...probe.errors]};
  };
})();
