import assert from 'node:assert/strict';
import {readCase} from './fixtures.mjs';

export async function checkViewport(evaluate) {
  const checks=[];
  const snapshot=()=>evaluate(`(() => {
    const win=document.querySelector('iframe').contentWindow,doc=win.document,app=win.EasyCode.app;
    const viewport=doc.getElementById('ec-viewport').getBoundingClientRect();
    const visible=node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>viewport.left&&r.left<viewport.right&&r.bottom>viewport.top&&r.top<viewport.bottom;};
    return {view:structuredClone(app.project.view),visibleModules:[...doc.querySelectorAll('#ec-nodes > .module-node')].filter(visible).length,visibleGroups:[...doc.querySelectorAll('#ec-groups .group-header')].filter(visible).length,dirty:app.storage.isDirty(),zoom:doc.getElementById('ec-zoom').textContent};
  })()`);
  await evaluate('window.stability.preview("case-100")');
  const large=await snapshot();
  assert.equal(large.view.scale,.01,'大场景适应视野应能达到 1%');
  assert.ok(large.visibleModules>0,'1% 下大场景不能空白');
  checks.push({name:'适应视野可达到 1%',scale:large.view.scale,visibleModules:large.visibleModules});

  await evaluate('window.stability.preview("case-008")');
  const recovered=await snapshot();
  assert.equal(recovered.visibleModules,1,'008 的模块应在视野内');
  assert.equal(recovered.visibleGroups,1,'008 的层级标题应在视野内');
  assert.equal(recovered.dirty,false,'打开时找回内容不应标记为用户修改');
  checks.push({name:'008 打开时找回模块和层级',view:recovered.view});

  const zoom=await evaluate(`(() => {
    const win=document.querySelector('iframe').contentWindow,doc=win.document;
    for(let n=0;n<40;n++)doc.querySelector('[data-action="zoom-out"]').click();
    const buttonScale=win.EasyCode.app.project.view.scale;
    doc.querySelector('[data-action="zoom-out"]').click();
    const repeatedScale=win.EasyCode.app.project.view.scale;
    doc.querySelector('[data-action="zoom-in"]').click();
    const zoomedInScale=win.EasyCode.app.project.view.scale;
    doc.getElementById('ec-viewport').dispatchEvent(new win.WheelEvent('wheel',{deltaY:100000,clientX:200,clientY:200,bubbles:true,cancelable:true}));
    return {buttonScale,repeatedScale,zoomedInScale,wheelScale:win.EasyCode.app.project.view.scale,label:doc.getElementById('ec-zoom').textContent};
  })()`);
  assert.equal(zoom.buttonScale,.01);assert.equal(zoom.repeatedScale,.01);
  assert.ok(zoom.zoomedInScale>.01);assert.equal(zoom.wheelScale,.01);assert.equal(zoom.label,'1%');
  checks.push({name:'缩放按钮和滚轮均停在 1%，仍可放大',...zoom});

  await evaluate('window.stability.preview("case-009")');
  const preserved=await snapshot();
  assert.deepEqual(preserved.view,(await readCase('case-009')).view,'原来可见的保存视角应保持不变');
  checks.push({name:'保留正常保存的视角',view:preserved.view});

  await evaluate('window.stability.preview("case-008")');
  const imported=await evaluate(`(async () => {
    const win=document.querySelector('iframe').contentWindow,doc=win.document,EC=win.EasyCode;
    const bundle=JSON.parse(doc.getElementById('ec-bundle').textContent),originalPicker=win.showOpenFilePicker;
    const source=structuredClone(EC.app.project),data=structuredClone(source),states=[];
    let html='';
    const handle={name:'viewport-import.html',getFile:async()=>new win.Blob([html])};
    const visible=selector=>{const bounds=doc.getElementById('ec-viewport').getBoundingClientRect();return [...doc.querySelectorAll(selector)].some(node=>{const r=node.getBoundingClientRect();return r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom;});};
    win.showOpenFilePicker=async()=>[handle];
    try {
      data.view={...data.view,x:-10000,y:-10000,scale:.25};
      html=EC.Serialization.buildDocument(bundle,data);await EC.app.storage.importFile();
      const after=structuredClone(EC.app.project),before=structuredClone(data);delete after.view;delete before.view;
      states.push({kind:'含模块的导入',visible:visible('#ec-nodes > .module-node'),contentUnchanged:JSON.stringify(after)===JSON.stringify(before),dirty:EC.app.storage.isDirty()});
      data.modules=[];data.relations=[];data.view={...data.view,expanded:[],expandedInterfaces:[]};
      html=EC.Serialization.buildDocument(bundle,data);await EC.app.storage.importFile();
      states.push({kind:'仅有空层级的导入',visible:visible('#ec-groups .group-header'),modules:EC.app.project.modules.length,dirty:EC.app.storage.isDirty()});
      data.view={...data.view,x:120,y:80,scale:.001};
      html=EC.Serialization.buildDocument(bundle,data);await EC.app.storage.importFile();
      states.push({kind:'小于下限的保存比例',scale:EC.app.project.view.scale,label:doc.getElementById('ec-zoom').textContent});
      return states;
    } finally {win.showOpenFilePicker=originalPicker;}
  })()`);
  assert.ok(imported[0].visible);assert.ok(imported[0].contentUnchanged);assert.equal(imported[0].dirty,false);
  assert.ok(imported[1].visible);assert.equal(imported[1].modules,0);assert.equal(imported[1].dirty,false);
  assert.equal(imported[2].scale,.01);assert.equal(imported[2].label,'1%');
  checks.push(...imported.map(state=>({name:state.kind,...state})));
  console.log('VIEWPORT: '+JSON.stringify(checks));
  return checks;
}
