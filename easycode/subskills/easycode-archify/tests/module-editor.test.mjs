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
