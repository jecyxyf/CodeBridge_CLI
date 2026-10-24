import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';
import '../assets/module-editor.js';
import {assemble,loadBundle} from '../scripts/build.mjs';
const {Model:M,ModuleEditor:E,Serialization:S} = globalThis.EasyCode;

function fixture() {
  const project = M.createProject('模块编辑'); project.description = '草稿确认测试';
  const module = M.createModule({name:'任务模块',purpose:'管理任务',x:120,y:-30});
  const api = M.createInterface(), parameter = M.createParameter();
  Object.assign(parameter,{name:'title',type:'string',description:'任务标题',required:true});
  Object.assign(api,{name:'createTask()',purpose:'创建任务',inputs:[parameter],inputsConfirmed:true,outputsConfirmed:true,status:'verified',sources:[{path:'src/task.js',line:12,endLine:20,symbol:'createTask'}],unknowns:['需要重试吗？']});
  Object.assign(module,{interfaces:[api],status:'verified',sources:[{path:'src/task.js'}],unknowns:['存储方案待定']});
  const other = M.createModule({name:'仓库',purpose:'保存任务',x:500,y:100});
  project.modules.push(module,other);
  project.groups.push({id:'group-tasks',name:'业务层',color:'#ffffff',x:100,y:0});
  M.addRelation(project,{from:module.id,to:other.id,type:'call',label:'写入'});
  project.view.expanded = [module.id]; project.view.expandedInterfaces = [api.id];
  return {project,module,api,parameter,other};
}

test('编辑嵌套字段、删除接口和切换层级只改变草稿，取消后原数据完整',() => {
  const {project,module,api} = fixture(), before = structuredClone(project), session = E.begin(project,module.id);
  M.updateModule(session.project,module.id,{name:'草稿名称',groupId:'group-tasks',sources:[{path:'draft.js'}],unknowns:[]});
  M.updateInterface(session.project,module.id,api.id,{inputs:[],sources:[],unknowns:[],inputsConfirmed:false});
  M.updateModule(session.project,module.id,{interfaces:[]});
  assert.equal(E.hasChanges(session),true);
  assert.deepEqual(project,before);
  assert.deepEqual(E.begin(project,module.id).module,before.modules[0]);
});

test('未修改和仅展开接口不产生项目修改',() => {
  const {project,module} = fixture(), before = structuredClone(project), session = E.begin(project,module.id);
  session.project.view.expandedInterfaces = [];
  assert.equal(E.hasChanges(session),false);
  assert.equal(E.commit(project,session),false);
  assert.deepEqual(project,before);
});

test('代码位置整理为相对路径，支持多文件和 Windows 分隔符',() => {
  for (const [input,expected] of [
    ['', ''],[' \n\t', ''],['testmodel.cpp','./testmodel.cpp'],[' ./testmodel.cpp\r\n./testmodel.h ','./testmodel.cpp\n./testmodel.h'],
    ['src\\testmodel.cpp\ninclude\\testmodel.h','./src/testmodel.cpp\n./include/testmodel.h'],
    ['./src/./temporary/../testmodel.cpp','./src/testmodel.cpp'],['./testmodel.cpp/h','./testmodel.cpp/h']
  ]) assert.equal(M.normalizeCodeLocation(input),expected);
  for (const value of ['D:\\code\\testmodel.cpp','D:relative.cpp','/src/testmodel.cpp','\\\\server\\share\\file.cpp','../outside.cpp','src/../../outside.cpp','src/task.js:12-30','https://example.com/a.cpp','.','./','src/..',42,null]) {
    assert.throws(() => M.normalizeCodeLocation(value),/代码位置|路径|项目目录/);
  }
});

test('语言和相对位置只在确认时保存，取消不变，语言可自定义',async () => {
  const {project,module} = fixture(), before = structuredClone(project), session = E.begin(project,module.id);
  M.updateModule(session.project,module.id,{language:'Zig',codeLocation:'src\\task.zig\n./include/task.zig'});
  assert.deepEqual(project,before); assert.equal(module.language,'');
  assert.equal(E.commit(project,session),true);
  assert.equal(module.language,'Zig'); assert.equal(module.codeLocation,'./src/task.zig\n./include/task.zig');
  assert.equal(module.status,'modified'); assert.deepEqual(module.sources,before.modules[0].sources,'evidence remains separate from code location');
  assert.deepEqual(S.readProject(assemble(project,await loadBundle())),project);
});

test('错误路径和语言类型不能部分提交',() => {
  for (const patch of [{codeLocation:'C:\\code\\file.cpp'},{codeLocation:'../file.cpp'},{codeLocation:'./file.cpp:12'},{language:[]}]) {
    const {project,module} = fixture(), before = structuredClone(project), session = E.begin(project,module.id);
    M.updateModule(session.project,module.id,patch);
    assert.ok(M.validate(session.project).errors.length); assert.throws(() => E.commit(project,session)); assert.deepEqual(project,before);
  }
});

test('功能需求按顺序增删改，只确认草稿后保存，读回保留全部文字',async () => {
  const {project,module,other} = fixture(), before = structuredClone(project), session = E.begin(project,module.id);
  assert.deepEqual(module.requirements,[]);
  M.updateModule(session.project,module.id,{requirements:['保存任务','临时需求','再次打开时恢复任务']});
  M.updateModule(session.project,module.id,{requirements:session.module.requirements.filter((_,index) => index !== 1)});
  const requirements = ['校验任务标题后保存\n保存失败时显示原因','再次打开时恢复任务 </script><script>alert(1)</script>'];
  M.updateModule(session.project,module.id,{requirements});
  assert.equal(E.hasChanges(session),true);
  assert.deepEqual(project,before,'取消草稿不改变原模块');
  assert.equal(E.commit(project,session),true);
  assert.deepEqual(module.requirements,requirements);
  assert.equal(module.status,'modified'); assert.deepEqual(module.sources,before.modules[0].sources);
  assert.deepEqual(other,before.modules[1]);
  const html = assemble(project,await loadBundle());
  assert.deepEqual(S.readProject(html),project);
  assert.equal(html.includes('</script><script>alert(1)</script>'),false);
  const originalRequirement = requirements[0];
  session.module.requirements[0] = '草稿之后的更改';
  assert.equal(module.requirements[0],originalRequirement);
  const cleared = E.begin(project,module.id);
  M.updateModule(cleared.project,module.id,{requirements:[]});
  assert.equal(E.commit(project,cleared),true); assert.deepEqual(module.requirements,[]);
});

test('功能需求拒绝错误列表和非文字条目，失败不改动项目',() => {
  for (const requirements of [null,'需求',{},[null],[42],[{}],['有效需求',false]]) {
    const {project,module} = fixture(), before = structuredClone(project), session = E.begin(project,module.id);
    M.updateModule(session.project,module.id,{requirements});
    assert.ok(M.validate(session.project).errors.some(issue => issue.path.startsWith('modules[0].requirements')));
    assert.throws(() => E.commit(project,session)); assert.deepEqual(project,before);
  }
});

test('确认保留标识和位置，更新全部嵌套字段并正确标记待核对',async() => {
  const {project,module,api,parameter,other} = fixture(), session = E.begin(project,module.id);
  M.updateModule(session.project,module.id,{name:'编辑后模块',purpose:'新的职责',groupId:'group-tasks',unknowns:['新问题']});
  M.updateInterface(session.project,module.id,api.id,{name:'create(title)',purpose:'新用途',inputs:[{...parameter,required:false,description:'</script><script>alert(1)</script>'}],outputs:[{...M.createParameter(),name:'result',description:'结果',type:'Task'}],outputsConfirmed:false,sources:[{path:'src/new.js',line:2}],unknowns:[]});
  const expected = structuredClone(session.module), view = structuredClone(project.view);
  // Unrelated changes made after opening must survive confirmation.
  other.name = '仓库新名称'; project.view.scale = 0.75;
  assert.equal(E.commit(project,session),true);
  assert.strictEqual(project.modules[0],module);
  assert.deepEqual(module,expected);
  assert.equal(module.id,session.id); assert.equal(module.x,120); assert.equal(module.y,-30);
  assert.equal(module.interfaces[0].id,api.id); assert.equal(module.interfaces[0].inputs[0].id,parameter.id);
  assert.equal(module.status,'modified'); assert.equal(module.interfaces[0].status,'modified');
  assert.equal(project.modules[1].name,'仓库新名称');
  assert.deepEqual(project.view,{...view,scale:0.75});
  assert.equal(project.relations.length,1);
  assert.deepEqual(M.validate(project).errors,[]);
  const html = assemble(project,await loadBundle());
  assert.deepEqual(S.readProject(html),project);
  session.module.interfaces[0].inputs[0].name = '不应泄漏';
  assert.equal(module.interfaces[0].inputs[0].name,'title');
});

test('仅调整所属层级保留已核对状态',() => {
  const {project,module} = fixture(), session = E.begin(project,module.id);
  M.updateModule(session.project,module.id,{groupId:'group-tasks'});
  E.commit(project,session);
  assert.equal(module.status,'verified'); assert.equal(module.groupId,'group-tasks');
});

test('新建取消不留下模块；确定添加一次，保留传入的网格坐标',() => {
  const {project} = fixture(), before = structuredClone(project), cancelled = E.begin(project,undefined,{x:-20,y:50});
  assert.deepEqual(project,before); assert.equal(cancelled.existing,false);
  const session = E.begin(project,undefined,{x:-20,y:50});
  assert.equal(E.hasChanges(session),false);
  assert.equal(E.commit(project,session),true);
  assert.equal(project.modules.length,3);
  assert.equal(project.modules[2].name,'新模块'); assert.equal(project.modules[2].x,-20); assert.equal(project.modules[2].y,50);
  assert.equal(project.modules.some(item => item.id === cancelled.id),false);
  assert.throws(() => E.commit(project,session),/重复/);
});

test('删除接口仅在确认时清理展开引用，其他模块和关系保留',() => {
  const {project,module,api,other} = fixture(), session = E.begin(project,module.id);
  const otherAPI = M.createInterface(); other.interfaces.push(otherAPI); project.view.expandedInterfaces.push(otherAPI.id);
  const relations = structuredClone(project.relations);
  M.updateModule(session.project,module.id,{interfaces:[]});
  assert.deepEqual(project.view.expandedInterfaces,[api.id,otherAPI.id]);
  E.commit(project,session);
  assert.deepEqual(module.interfaces,[]); assert.deepEqual(project.view.expandedInterfaces,[otherAPI.id]);
  assert.deepEqual(project.view.expanded,[module.id]); assert.deepEqual(project.relations,relations);
});

test('无效层级、出处和重复标识不能部分写入，修正后可继续确定',() => {
  for (const patch of [
    {groupId:'group-missing'}, {sources:[{path:''}]}, {sources:[{path:'a.js',line:10,endLine:2}]},
    {status:'verified',sources:[]}, {interfaces:[{...M.createInterface(),id:'group-tasks'}]}
  ]) {
    const {project,module} = fixture(), before = structuredClone(project), session = E.begin(project,module.id);
    Object.assign(session.module,patch);
    assert.throws(() => E.commit(project,session)); assert.deepEqual(project,before);
    Object.assign(session.module,structuredClone(module),{name:'修正后'});
    assert.equal(E.commit(project,session),true); assert.equal(module.name,'修正后');
  }
});

test('模块被外部修改或删除时阻止旧草稿覆盖',() => {
  for (const change of ['edit','delete']) {
    const {project,module} = fixture(), session = E.begin(project,module.id);
    session.module.name = '旧草稿';
    if (change === 'edit') module.name = '较新内容'; else M.removeModule(project,module.id);
    const before = structuredClone(project);
    assert.throws(() => E.commit(project,session),/发生变化/); assert.deepEqual(project,before);
  }
  const {project,module} = fixture(), session = E.begin(project,module.id);
  session.module.id = 'module-changed';
  assert.throws(() => E.commit(project,session),/标识不能修改/);
  assert.throws(() => E.begin(project,'module-missing'),/不存在/);
});

test('五组内容在草稿中独立编辑，确认后可完整保存读回',async() => {
  const {project,module,api} = fixture(), before = structuredClone(project), session = E.begin(project,module.id);
  const setting = {...M.createParameter(),name:'重试次数',englishName:'retryCount',type:'number',description:'失败后重试次数',defaultValue:'3'};
  const event = {...M.createEvent(),name:'任务完成',englishName:'taskCompleted',description:'任务处理完毕',trigger:'保存成功',parameters:[{...M.createParameter(),name:'任务编号',englishName:'taskId',type:'string',description:'完成的任务'}]};
  const check = {...M.createTest(),name:'保存任务',steps:'输入有效任务并保存',expected:'发出任务完成事件'};
  M.updateModule(session.project,module.id,{englishName:'TaskModule',language:'JavaScript',codeLocation:'./src/task.js',parameters:[setting],events:[event],tests:[check]});
  M.updateInterface(session.project,module.id,api.id,{name:'创建任务',englishName:'createTask',flow:'1. 检查输入\n2. 保存\n3. 发出事件',errors:'无效输入时返回错误'});
  M.updateMember(session.project,module.id,'events',event.id,{direction:'receive'});
  M.updateMember(session.project,module.id,'tests',check.id,{expected:'接收任务完成事件'});
  assert.deepEqual(project,before,'nested edits remain isolated until confirmation');
  assert.equal(E.commit(project,session),true);
  assert.equal(module.status,'modified'); assert.equal(module.interfaces[0].status,'modified');
  assert.equal(module.interfaces[0].id,api.id); assert.deepEqual(module.sources,before.modules[0].sources);
  assert.equal(module.events[0].direction,'receive'); assert.equal(module.parameters[0].defaultValue,'3');
  assert.equal(module.tests[0].expected,'接收任务完成事件');
  assert.deepEqual(M.validate(project),{errors:[],warnings:[]});
  assert.deepEqual(S.readProject(assemble(project,await loadBundle())),project);
});

test('旧模块缺少新增字段时，打开或无修改确认不会补写或丢失旧数据',async() => {
  const {project,module,api,parameter} = fixture();
  for (const field of ['englishName','codeLocation','parameters','events','tests']) delete module[field];
  for (const field of ['englishName','flow','errors']) delete api[field];
  for (const field of ['englishName','defaultValue']) delete parameter[field];
  const before = structuredClone(project), session = E.begin(project,module.id);
  assert.equal(E.hasChanges(session),false); assert.equal(E.commit(project,session),false);
  assert.deepEqual(project,before); assert.deepEqual(M.validate(project),{errors:[],warnings:[]});
  assert.deepEqual(S.readProject(assemble(project,await loadBundle())),before);
  M.updateInterface(session.project,module.id,api.id,{englishName:'createTask'});
  E.commit(project,session);
  before.modules[0].interfaces[0].englishName = 'createTask';
  before.modules[0].status = before.modules[0].interfaces[0].status = 'modified';
  assert.deepEqual(project,before,'adding one bilingual name leaves legacy data and absent groups untouched');
});

test('新分组中的坏结构、重复 ID 或非文字字段不能部分提交',() => {
  const patches = [
    {parameters:null}, {events:{}}, {tests:[null]}, {englishName:{trim:42}}, {codeLocation:42}, {language:42},
    {parameters:[{...M.createParameter(),defaultValue:3}]},
    {events:[{...M.createEvent(),direction:'invalid'}]},
    {events:[{...M.createEvent(),parameters:[null]}]},
    {tests:[{...M.createTest(),expected:[]}]}
  ];
  for (const patch of patches) {
    const {project,module} = fixture(), before = structuredClone(project), session = E.begin(project,module.id);
    Object.assign(session.module,patch);
    assert.doesNotThrow(() => M.validate(session.project));
    assert.throws(() => E.commit(project,session)); assert.deepEqual(project,before);
  }
  const {project,module,api} = fixture(), session = E.begin(project,module.id);
  session.module.events = [{...M.createEvent(),id:api.id}];
  assert.throws(() => E.commit(project,session),/标识重复/);
});

test('仅填英文名可用，新增成员修改只标记所属模块且拒绝未知分组',() => {
  const {project,module,other} = fixture();
  module.name = ''; module.englishName = 'TaskModule';
  const parameter = {...M.createParameter(),englishName:'enabled',description:'是否启用',type:'boolean'};
  module.parameters = [parameter];
  assert.deepEqual(M.validate(project),{errors:[],warnings:[]});
  assert.equal(M.displayName(module),'TaskModule'); assert.equal(M.displayName(parameter),'enabled');
  assert.equal(M.displayName({name:42,englishName:[]},'未命名'),'未命名');
  const oldOther = structuredClone(other);
  M.updateMember(project,module.id,'parameters',parameter.id,{defaultValue:'true'});
  assert.equal(module.status,'modified'); assert.deepEqual(other,oldOther);
  assert.equal(M.updateMember(project,module.id,'events','missing',{}),null);
  assert.throws(() => M.updateMember(project,module.id,'sources',parameter.id,{}),/不支持/);
  assert.deepEqual(M.validate(project).errors,[]);
});
