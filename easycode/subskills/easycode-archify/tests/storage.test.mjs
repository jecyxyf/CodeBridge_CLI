import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';
import '../assets/serialization.js';
import '../assets/storage.js';
const {Model,Serialization}=globalThis.EasyCode;
const bundle={canvas:'<!doctype html><title><!--EC:TITLE--></title><!--EC:STYLE--><!--EC:NODE--><!--EC:DATA--><!--EC:BUNDLE--><!--EC:RUNTIME-->',node:'<template id="ec-module-template"></template>',css:'',runtime:''};
const documentFor=project=>Serialization.buildDocument(bundle,project);
const copy=value=>structuredClone(value);
function deferred() { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; }
function memoryHandle(name,initial,hooks={}) {
  let content=initial, reads=0;
  return {name,get content(){return content;},externalWrite(value){content=value;},
    async getFile(){const number=++reads; await hooks.read?.(number); const value=content; return {text:async()=>value};},
    async createWritable(){await hooks.open?.(); let draft=content; return {
      async write(value){await hooks.write?.(value); draft=value;},
      async close(){await hooks.close?.(); content=draft;},
      async abort(){await hooks.abort?.();}
    };}
  };
}
function setup(options={}) {
  let project=options.project||Model.createProject('原始项目');
  const original=documentFor(project), file=options.file||memoryHandle('original.html',original);
  const states=[];
  assert.equal(typeof globalThis.EasyCode.Storage?.createController,'function','Storage.createController must exist');
  const controller=globalThis.EasyCode.Storage.createController({getProject:()=>project,buildDocument:documentFor,
    readProject:Serialization.readProject,validate:Model.validate,pickExisting:()=>file,
    replaceProject:next=>{project=next;},
    pickNew:()=>{throw new Error('不应调用另存为');},onState:state=>states.push(state),...options});
  return {get project(){return project;},file,original,states,controller};
}
function edit(fixture,name) {fixture.project.name=name; fixture.controller.markDirty();}

test('原文件覆盖，另存成功后保存只更新新文件，完整项目往返',async()=>{
  const newFile=memoryHandle('copy.html',''); let suggestion;
  const project=Model.createProject('原始项目');
  project.groups=[{id:'group-one',name:'界面',color:'#81b3e9',x:10,y:20}];
  const first=Model.createModule({name:'界面',groupId:'group-one',x:25,y:40});
  const second=Model.createModule({name:'服务'}), api=Model.createInterface();
  Object.assign(api,{name:'createTask',purpose:'创建任务',inputsConfirmed:true,outputsConfirmed:true});
  api.inputs=[{...Model.createParameter(),name:'title',type:'string',required:true,description:'任务名称'}];
  api.outputs=[{...Model.createParameter(),name:'result',type:'Task',description:'任务'}];
  first.interfaces=[api]; first.sources=[{path:'ui.js',line:3,endLine:9,symbol:'Board'}]; first.unknowns=['待确认缓存'];
  project.modules=[first,second]; Model.addRelation(project,{from:first.id,to:second.id,type:'call',label:'创建任务'});
  project.view.expanded=[first.id]; project.view.expandedInterfaces=[api.id];
  const f=setup({project,pickNew:name=>{suggestion=name; return newFile;}});
  assert.equal(f.controller.isDirty(),false); assert.equal(f.controller.getFileName(),'');
  edit(f,'第一次'); assert.equal(await f.controller.save(),true);
  assert.equal(f.file.content,documentFor(f.project)); assert.deepEqual(Serialization.readProject(f.file.content),f.project);
  assert.equal(f.controller.isDirty(),false); assert.equal(f.controller.getFileName(),'original.html');
  const oldContent=f.file.content;
  await f.controller.saveAs(); assert.equal(suggestion,'original.html');
  assert.equal(newFile.content,oldContent); assert.equal(f.controller.getFileName(),'copy.html');
  edit(f,'第二次'); await f.controller.save();
  assert.equal(f.file.content,oldContent); assert.equal(newFile.content,documentFor(f.project));
  assert.deepEqual(Serialization.readProject(newFile.content),f.project);
  assert.deepEqual(f.states.at(-1),{status:'saved',message:'已保存',fileName:'copy.html',dirty:false});
});

test('首次绑定比较创建时的完整基线，之后画布适配不改变基线',async()=>{
  const f=setup(); f.project.view={...f.project.view,x:100,y:200,scale:0.5};
  assert.equal(f.controller.isDirty(),false,'仅启动时适配视野，保存控制器仍然干净');
  await f.controller.save(); assert.equal(f.file.content,documentFor(f.project));
  edit(f,'页面新名称');
  await f.controller.save(); assert.equal(f.file.content,documentFor(f.project));
});

test('缺少模块职责和接口用途的草稿可保存，修正后没有警告',async()=>{
  const project=Model.createProject('任务板'); project.description='管理任务';
  const module=Model.createModule({name:'任务模块'}), entry=Model.createInterface(); entry.name='createTask';
  module.interfaces=[entry]; project.modules=[module]; const f=setup({project});
  await f.controller.save();
  assert.equal(f.states.at(-1).status,'saved'); assert.equal(f.controller.isDirty(),false);
  assert.deepEqual(Model.validate(Serialization.readProject(f.file.content)).warnings.map(item=>item.path),['modules[0].purpose','modules[0].interfaces[0].purpose']);
  module.purpose='管理任务'; entry.purpose='创建任务'; f.controller.markDirty(); await f.controller.save();
  assert.deepEqual(Model.validate(Serialization.readProject(f.file.content)).warnings,[]);
});

test('首次绑定拒绝同 ID 但已被外部改动的项目，并保留全部数据',async()=>{
  const f=setup(); const external=copy(f.project); external.description='Agent 已改';
  const externalHTML=documentFor(external); f.file.externalWrite(externalHTML); edit(f,'页面编辑');
  const live=copy(f.project);
  await assert.rejects(f.controller.save(),/外部|打开后|基线/);
  assert.equal(f.file.content,externalHTML); assert.deepEqual(f.project,live);
  assert.equal(f.controller.isDirty(),true); assert.equal(f.controller.getFileName(),'');
});

test('首次绑定拒绝不同项目、坏 HTML、结构坏数据',async()=>{
  for(const content of [documentFor(Model.createProject('别的项目')),'broken',`<script id="ec-project" type="application/json">${JSON.stringify({...Model.createProject('坏数据'),modules:null})}</script>`]) {
    const f=setup({file:memoryHandle('other.html',content)}); edit(f,'本页修改');
    await assert.rejects(f.controller.save()); assert.equal(f.file.content,content);
    assert.equal(f.controller.isDirty(),true); assert.equal(f.controller.getFileName(),'');
  }
});

test('首次绑定要求磁盘项目与保存快照的当前 ID 相同',async()=>{
  const f=setup(); f.project.id='project-replaced'; edit(f,'替换后的项目');
  await assert.rejects(f.controller.save(),/另一个项目/);
  assert.equal(f.file.content,f.original); assert.equal(f.project.id,'project-replaced');
  assert.equal(f.controller.isDirty(),true); assert.equal(f.controller.getFileName(),'');
});

test('已绑定文件任意字节被外部修改时拒绝覆盖',async()=>{
  const f=setup(); await f.controller.save();
  const externalHTML=f.file.content+'<!-- 外部改动 -->'; f.file.externalWrite(externalHTML); edit(f,'第二次编辑');
  await assert.rejects(f.controller.save(),/外部|改变/); assert.equal(f.file.content,externalHTML);
  assert.equal(f.controller.getFileName(),'original.html'); assert.equal(f.controller.isDirty(),true);
});

test('另存为选回同一磁盘文件的新句柄也不能绕过外部修改保护',async()=>{
  const p=Model.createProject('项目'), file=memoryHandle('same.html',documentFor(p));
  const alias={name:file.name,getFile:()=>file.getFile(),createWritable:()=>file.createWritable()};
  file.isSameEntry=async candidate=>candidate===alias;
  const f=setup({project:p,file,pickNew:()=>alias}); await f.controller.save();
  const external=file.content+'<!-- 外部修改 -->'; file.externalWrite(external); edit(f,'本页编辑');
  await assert.rejects(f.controller.saveAs(),/外部|改变/);
  assert.equal(file.content,external); assert.equal(f.controller.isDirty(),true);
  assert.equal(f.controller.getFileName(),'same.html');
});

test('文件选择器在调用栈内立即执行，数据快照在选择器等待之前取得',async()=>{
  const selection=deferred(); let picked=false;
  const project=Model.createProject('原始'); project.modules=[Model.createModule({name:'模块'})];
  const f=setup({project,pickExisting:()=>{picked=true; return selection.promise;}}); edit(f,'点击时快照');
  const expected=copy(f.project), pending=f.controller.save(); assert.equal(picked,true);
  edit(f,'选择文件时继续编辑'); f.project.modules[0].unknowns.push('保存中新增疑问'); f.project.view.scale=2;
  selection.resolve(f.file); await pending;
  assert.equal(f.file.content,documentFor(expected)); assert.deepEqual(Serialization.readProject(f.file.content),expected);
  assert.equal(f.project.name,'选择文件时继续编辑'); assert.equal(f.controller.isDirty(),true);
  assert.equal(f.states.at(-1).status,'unsaved');
  await f.controller.save(); assert.equal(f.file.content,documentFor(f.project)); assert.equal(f.controller.isDirty(),false);
});

test('另存为也立即打开选择器并使用点击时快照',async()=>{
  const selection=deferred(), newFile=memoryHandle('new.html',''); let picked=false, suggestion;
  const f=setup({pickNew:name=>{picked=true; suggestion=name; return selection.promise;}}); edit(f,'点击时');
  const expected=copy(f.project), pending=f.controller.saveAs(); assert.equal(picked,true); assert.match(suggestion,/\.html$/);
  edit(f,'稍后'); selection.resolve(newFile); await pending;
  assert.equal(newFile.content,documentFor(expected)); assert.equal(f.file.content,f.original);
  assert.equal(f.controller.getFileName(),'new.html'); assert.equal(f.controller.isDirty(),true);
});

test('保存中反复点击返回相同 Promise，期间编辑不会被旧保存清除',async()=>{
  const gate=deferred(), started=deferred();
  const p=Model.createProject('原始');
  const file=memoryHandle('busy.html',documentFor(p),{write:async()=>{started.resolve(); await gate.promise;}});
  let newPicks=0; const f=setup({project:p,file,pickNew:()=>{newPicks++; return file;}}); edit(f,'快照');
  const expected=copy(p), first=f.controller.save(); await started.promise;
  edit(f,'较新编辑'); assert.equal(f.controller.save(),first); assert.equal(f.controller.saveAs(),first); assert.equal(newPicks,0);
  assert.equal(file.content,f.original); gate.resolve(); await first;
  assert.equal(file.content,documentFor(expected)); assert.equal(f.controller.isDirty(),true);
  await f.controller.save(); assert.equal(file.content,documentFor(p)); assert.equal(f.controller.isDirty(),false);
});

test('选择取消和同步选择失败保留旧目标、dirty 和完整模型',async()=>{
  const cancel=Object.assign(new Error('用户取消'),{name:'AbortError'}); let failure=cancel;
  const f=setup({pickNew:()=>{throw failure;}}); await f.controller.save();
  await assert.rejects(f.controller.saveAs(),error=>error===cancel); assert.equal(f.controller.isDirty(),false);
  edit(f,'未保存编辑');
  const expected=copy(f.project), old=f.file.content;
  await assert.rejects(f.controller.saveAs(),error=>error===cancel);
  assert.equal(f.states.at(-1).status,'unsaved');
  failure=new Error('权限失败'); await assert.rejects(f.controller.saveAs(),/权限失败/);
  assert.equal(f.states.at(-1).status,'error'); assert.equal(f.file.content,old); assert.deepEqual(f.project,expected);
  assert.equal(f.controller.getFileName(),'original.html'); assert.equal(f.controller.isDirty(),true);
  await f.controller.save(); assert.equal(f.file.content,documentFor(expected));
});

test('首次选择异步取消不会绑定目标，下一次可重试',async()=>{
  let count=0; const cancel=Object.assign(new Error('取消'),{name:'AbortError'});
  const p=Model.createProject('项目'), file=memoryHandle('retry.html',documentFor(p));
  const f=setup({project:p,pickExisting:()=>++count===1?Promise.reject(cancel):Promise.resolve(file)}); edit(f,'新内容');
  await assert.rejects(f.controller.save(),error=>error===cancel); assert.equal(file.content,f.original);
  assert.equal(f.controller.getFileName(),''); assert.equal(f.controller.isDirty(),true);
  await f.controller.save(); assert.equal(file.content,documentFor(p));
});

for(const phase of ['open','write','close']) test(`${phase} 失败保留原文件与 dirty，另存失败不切换目标`,async()=>{
  const replacement=memoryHandle('failed.html','旧目标内容',{[phase]:()=>{throw new Error(phase+' failed');}});
  const f=setup({pickNew:()=>replacement}); await f.controller.save(); edit(f,'修改'); const expected=copy(f.project), old=f.file.content;
  await assert.rejects(f.controller.saveAs(),new RegExp(phase));
  assert.equal(replacement.content,'旧目标内容'); assert.equal(f.file.content,old); assert.deepEqual(f.project,expected);
  assert.equal(f.controller.getFileName(),'original.html'); assert.equal(f.controller.isDirty(),true);
  await f.controller.save(); assert.equal(f.file.content,documentFor(expected));
});

test('close 成功但读回失败明确提示可能已写入，保持未确认与旧目标',async()=>{
  const replacement=memoryHandle('uncertain.html','',{read:number=>{if(number===2) throw new Error('readback failed');}});
  const f=setup({pickNew:()=>replacement}); await f.controller.save(); edit(f,'修改'); const old=f.file.content;
  await assert.rejects(f.controller.saveAs(),/可能.*写入|写入.*核对/);
  assert.equal(replacement.content,documentFor(f.project)); assert.equal(f.file.content,old);
  assert.equal(f.controller.getFileName(),'original.html'); assert.equal(f.controller.isDirty(),true);
  assert.match(f.states.at(-1).message,/可能.*写入|写入.*核对/);
});

test('读回数据与快照不同不能假报保存成功',async()=>{
  const p=Model.createProject('项目'), wrong={...p,name:'磁盘不同'};
  let file; file=memoryHandle('wrong.html',documentFor(p),{read:number=>{if(number===2) file.externalWrite(documentFor(wrong));}});
  const f=setup({project:p,file}); edit(f,'期望保存');
  await assert.rejects(f.controller.save(),/核对/); assert.equal(file.content,documentFor(wrong));
  assert.equal(f.controller.isDirty(),true); assert.equal(f.controller.getFileName(),''); assert.equal(p.name,'期望保存');
});

test('非法当前数据不会写文件，修复后可保存',async()=>{
  const f=setup(); f.project.modules=null; f.controller.markDirty();
  await assert.rejects(f.controller.save(),/modules/); assert.equal(f.file.content,f.original); assert.equal(f.controller.isDirty(),true);
  f.project.modules=[]; await f.controller.save(); assert.equal(f.file.content,documentFor(f.project));
});

test('已绑定目标读失败不会破坏旧文件，读权限恢复后可重试',async()=>{
  let fail=false; const p=Model.createProject('项目'); const file=memoryHandle('read.html',documentFor(p),{read:()=>{if(fail) throw new Error('无法读取');}});
  const f=setup({project:p,file}); await f.controller.save(); edit(f,'新内容'); const old=file.content; fail=true;
  await assert.rejects(f.controller.save(),/无法读取/); assert.equal(file.content,old); assert.equal(f.controller.isDirty(),true);
  fail=false; await f.controller.save(); assert.equal(file.content,documentFor(p));
});

test('导入完整 HTML 恢复内容与布局，只读文件，之后保存写回导入目标',async()=>{
  const imported=Model.createProject('导入的软件框架图'); imported.description='独立方案';
  const module=Model.createModule({name:'入口',purpose:'处理请求',groupId:'group-imported',x:420,y:280});
  const api=Model.createInterface(); api.name='run()'; api.purpose='启动'; module.interfaces=[api];
  const service=Model.createModule({name:'服务',purpose:'处理业务'});
  imported.groups=[{id:'group-imported',name:'业务层',color:'#ffffff',backgroundColor:'#112233',x:12,y:34}];
  imported.modules=[module,service]; Model.addRelation(imported,{from:module.id,to:service.id,label:'请求'});
  imported.view={x:-80,y:24,scale:0.8,expanded:[module.id],expandedInterfaces:[api.id]};
  const html=documentFor(imported)+'<script>globalThis.__importExecuted = true</script>';
  const target=memoryHandle('imported.html',html), exported=memoryHandle('exported.html','');
  let picks=0;
  const f=setup({pickExisting:()=>++picks===1?f.file:target,pickNew:()=>exported});
  await f.controller.save(); const previous=f.file.content;
  assert.equal(await f.controller.importFile(),true);
  assert.deepEqual(f.project,imported); assert.equal(target.content,html); assert.equal(f.file.content,previous);
  assert.equal(globalThis.__importExecuted,undefined,'导入不能执行文件中的脚本');
  assert.equal(f.controller.getFileName(),'imported.html'); assert.equal(f.controller.isDirty(),false);
  assert.equal(f.states.at(-1).message,'已导入');
  edit(f,'导入后编辑'); await f.controller.save();
  assert.equal(picks,2,'保存直接使用导入时的句柄');
  assert.deepEqual(Serialization.readProject(target.content),f.project); assert.equal(f.file.content,previous);
  await f.controller.saveAs(); const importedSaved=target.content;
  edit(f,'导出后编辑'); await f.controller.save();
  assert.equal(target.content,importedSaved); assert.deepEqual(Serialization.readProject(exported.content),f.project);
  assert.equal(f.controller.getFileName(),'exported.html');
});

test('导入坏文件、读取失败、选择取消时保留当前草稿和保存目标',async()=>{
  const cancel=Object.assign(new Error('取消'),{name:'AbortError'});
  const badProject={...Model.createProject('损坏'),modules:null};
  const selections=[
    ()=>{throw cancel;},()=>Promise.reject(cancel),
    ()=>memoryHandle('bad.html','broken'),
    ()=>memoryHandle('bad-model.html',`<script id="ec-project" type="application/json">${JSON.stringify(badProject)}</script>`),
    ()=>memoryHandle('unreadable.html','',{read:()=>{throw new Error('读取失败');}})
  ];
  for (const select of selections) {
    let importing=false;
    const f=setup({pickExisting:()=>importing?select():f.file}); await f.controller.save();
    edit(f,'保留草稿'); const expected=copy(f.project), old=f.file.content; importing=true;
    await assert.rejects(f.controller.importFile());
    assert.deepEqual(f.project,expected); assert.equal(f.file.content,old);
    assert.equal(f.controller.getFileName(),'original.html'); assert.equal(f.controller.isDirty(),true);
    await f.controller.save(); assert.deepEqual(Serialization.readProject(f.file.content),expected);
  }
});

test('导入替换前确认未保存内容，取消不丢草稿，确认后切换项目',async()=>{
  let accepted=false, confirmations=0;
  const imported=Model.createProject('新项目'), target=memoryHandle('new.html',documentFor(imported));
  const f=setup({pickExisting:()=>target,confirmImport:()=>{confirmations++; return accepted;}});
  edit(f,'未保存草稿'); const expected=copy(f.project);
  await assert.rejects(f.controller.importFile(),error=>error.name==='AbortError');
  assert.deepEqual(f.project,expected); assert.equal(f.controller.isDirty(),true);
  assert.equal(f.controller.getFileName(),''); assert.equal(f.states.at(-1).message,'已取消导入');
  accepted=true; await f.controller.importFile();
  assert.deepEqual(f.project,imported); assert.equal(confirmations,2); assert.equal(f.controller.isDirty(),false);
});

test('导入选择器立即打开，读取期间的新编辑也须确认',async()=>{
  const selected=deferred(); let picked=false, confirmations=0;
  const imported=Model.createProject('待导入'), target=memoryHandle('new.html',documentFor(imported));
  const f=setup({pickExisting:()=>{picked=true; return selected.promise;},confirmImport:()=>{confirmations++; return false;}});
  const pending=f.controller.importFile(); assert.equal(picked,true);
  edit(f,'等待读取时的新编辑'); selected.resolve(target);
  await assert.rejects(pending,error=>error.name==='AbortError');
  assert.equal(confirmations,1); assert.equal(f.project.name,'等待读取时的新编辑'); assert.equal(f.controller.isDirty(),true);
});

test('导入和保存互斥，重复导入不会打开第二个选择器',async()=>{
  const selected=deferred(); let picks=0;
  const target=memoryHandle('new.html',documentFor(Model.createProject('新项目')));
  const f=setup({pickExisting:()=>{picks++; return selected.promise;}});
  const pending=f.controller.importFile();
  await assert.rejects(f.controller.importFile(),/尚未完成/);
  await assert.rejects(f.controller.save(),/正在导入/); await assert.rejects(f.controller.saveAs(),/正在导入/);
  assert.equal(picks,1); selected.resolve(target); await pending;
  edit(f,'修改'); await f.controller.save(); assert.equal(f.controller.isDirty(),false);
  const gate=deferred(), started=deferred(), project=Model.createProject('旧项目');
  const file=memoryHandle('busy.html',documentFor(project),{write:async()=>{started.resolve(); await gate.promise;}});
  const saving=setup({project,file}); const write=saving.controller.save(); await started.promise;
  await assert.rejects(saving.controller.importFile(),/尚未完成/);
  gate.resolve(); await write; assert.equal(saving.controller.getFileName(),'busy.html');
});

test('导入后检测外部文件修改，不覆盖磁盘的新内容',async()=>{
  const target=memoryHandle('new.html',documentFor(Model.createProject('新项目')));
  const f=setup({pickExisting:()=>target}); await f.controller.importFile();
  const external=target.content+'<!-- 外部修改 -->'; target.externalWrite(external); edit(f,'页面草稿');
  await assert.rejects(f.controller.save(),/外部改变/);
  assert.equal(target.content,external); assert.equal(f.project.name,'页面草稿'); assert.equal(f.controller.isDirty(),true);
});

test('导入页面替换失败时不切换文件绑定，也不清除未保存状态',async()=>{
  const target=memoryHandle('new.html',documentFor(Model.createProject('新项目')));
  const f=setup({pickExisting:()=>target,confirmImport:()=>true,replaceProject:()=>{throw new Error('无法显示');}});
  edit(f,'保留草稿'); const expected=copy(f.project);
  await assert.rejects(f.controller.importFile(),/无法显示/);
  assert.deepEqual(f.project,expected); assert.equal(f.controller.getFileName(),''); assert.equal(f.controller.isDirty(),true);
});
