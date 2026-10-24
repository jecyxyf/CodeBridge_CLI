import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';

const {Model} = globalThis.EasyCode;
function fixture() {
  const p = Model.createProject('测试'), a = Model.createModule({name:'A'}), b = Model.createModule({name:'B'});
  a.interfaces.push(Model.createInterface()); p.modules.push(a,b); return {p,a,b,i:a.interfaces[0]};
}

test('标题显示版本，空版本不加后缀，已有 v 不重复且不改变数据',() => {
  const project = Model.createProject('软件框架图');
  for (const [revision,title] of [
    ['','软件框架图'],['  ','软件框架图'],['0.0.1','软件框架图v0.0.1'],['v0.0.1','软件框架图v0.0.1'],
    [' V1.2.3 ','软件框架图v1.2.3'],['1.0.0-beta.1+build.2','软件框架图v1.0.0-beta.1+build.2'],
    ['main','软件框架图 main'],['0abc123','软件框架图 0abc123']
  ]) {
    project.repository.revision = revision;
    const before = structuredClone(project);
    assert.equal(Model.projectTitle(project),title); assert.deepEqual(project,before);
  }
  project.name = ''; project.repository.revision = '0.0.1';
  assert.equal(Model.projectTitle(project),'软件框架图v0.0.1');
});
test('创建函数提供独立的完整默认值和稳定标识', () => {
  const {p,a,b,i} = fixture(), parameter = Model.createParameter();
  assert.deepEqual(Model.validate(p).errors, []);
  assert.equal(p.formatVersion,1); assert.equal(Object.hasOwn(p,'mode'),false);
  assert.deepEqual(p.repository,{path:'',revision:'',dirty:false});
  assert.deepEqual(p.view,{x:0,y:0,scale:1,expanded:[],expandedInterfaces:[]});
  assert.notEqual(a.id,b.id); assert.notEqual(a.sources,b.sources);
  assert.equal(a.groupId,''); assert.equal(a.status,'planned');
  assert.deepEqual(a.unknowns,[]); assert.deepEqual(i.sources,[]); assert.deepEqual(i.unknowns,[]);
  assert.equal(i.inputsConfirmed,false); assert.equal(i.outputsConfirmed,false);
  assert.deepEqual(i.inputs,[]); assert.deepEqual(i.outputs,[]);
  assert.equal(parameter.name,''); assert.equal(parameter.type,'未知');
  assert.equal(parameter.required,false); assert.equal(parameter.description,''); assert.ok(parameter.id);
});
test('删除模块清除关系与展开状态但保留其他模块', () => {
  const {p,a,b,i}=fixture();
  Model.addRelation(p,{from:a.id,to:b.id,type:'call',label:'调用'});
  p.view.expanded.push(a.id,b.id); p.view.expandedInterfaces.push(i.id);
  assert.equal(Model.removeModule(p,a.id),true);
  assert.deepEqual(p.modules,[b]); assert.deepEqual(p.relations,[]);
  assert.deepEqual(p.view.expanded,[b.id]); assert.deepEqual(p.view.expandedInterfaces,[]);
  assert.equal(Model.removeModule(p,'missing'),false);
});
test('改接口内容使接口和模块待核对，位置变化不改变核对状态', () => {
  const {p,a,i}=fixture(); a.status=i.status='verified';
  Model.updateModule(p,a.id,{x:80,y:90}); assert.equal(a.status,'verified');
  Model.updateInterface(p,a.id,i.id,{purpose:'新行为'});
  assert.equal(a.status,'modified'); assert.equal(i.status,'modified');
});
test('替换接口列表清除已删除接口的展开记录，保留其他有效展开项', () => {
  const {p,a,b,i}=fixture(), retained=Model.createInterface(), other=Model.createInterface();
  a.interfaces.push(retained); b.interfaces.push(other);
  p.view.expandedInterfaces=[i.id,retained.id,other.id];
  assert.deepEqual(Model.validate(p).errors,[]);
  Model.updateModule(p,a.id,{interfaces:[retained]});
  assert.deepEqual(Model.validate(p).errors,[]);
  assert.deepEqual(p.view.expandedInterfaces,[retained.id,other.id]);
  Model.updateModule(p,a.id,{interfaces:[]});
  assert.deepEqual(Model.validate(p).errors,[]);
  assert.deepEqual(p.view.expandedInterfaces,[other.id]);
});
test('重命名保留标识及连线，布局分组和无变化不影响核对状态', () => {
  const {p,a,b,i}=fixture(), id=a.id;
  p.groups.push({id:'group-a',name:'组',color:'#123456',x:0,y:0});
  const relation=Model.addRelation(p,{from:a.id,to:b.id,type:'call'});
  a.status=i.status='verified';
  Model.updateModule(p,id,{groupId:'group-a'}); Model.updateModule(p,id,{name:'A'});
  Model.updateInterface(p,id,i.id,{purpose:i.purpose}); assert.equal(a.status,'verified');
  Model.updateModule(p,id,{name:'重命名',id:'forbidden'});
  assert.equal(a.id,id); assert.equal(a.status,'modified'); assert.equal(relation.from,id);
  Model.updateInterface(p,id,i.id,{status:'verified'}); assert.equal(i.status,'verified');
  const draft=Model.createModule(); Model.markEdited(draft); assert.equal(draft.status,'planned');
  Model.markEdited(null); Model.markEdited(i); assert.equal(i.status,'modified');
  assert.equal(Model.updateModule(p,'missing',{}),null);
  assert.equal(Model.updateInterface(p,id,'missing',{}),null);
});
test('解散组仅清空成员归属，不改变核对状态或关系', () => {
  const {p,a,b}=fixture(); p.groups.push({id:'g',name:'组',color:'#123456',x:0,y:0});
  a.groupId='g'; a.status='verified'; const relation=Model.addRelation(p,{from:a.id,to:b.id});
  assert.equal(Model.removeGroup(p,'g'),true); assert.equal(a.groupId,'');
  assert.equal(a.status,'verified'); assert.deepEqual(p.relations,[relation]);
  assert.equal(Model.removeGroup(p,'missing'),false);
});
test('关系限制有效端点、不同模块、重复项，并兼容旧类型数据', () => {
  const {p,a,b}=fixture(); const r=Model.addRelation(p,{from:a.id,to:b.id,label:'调用'});
  assert.equal(Object.hasOwn(r,'type'),false); assert.equal(r.status,'planned'); assert.deepEqual(r.sources,[]); assert.deepEqual(r.unknowns,[]);
  assert.throws(()=>Model.addRelation(p,{from:a.id,to:a.id}),/relation|关系/i);
  assert.throws(()=>Model.addRelation(p,{from:a.id,to:'missing'}),/relation|关系/i);
  assert.throws(()=>Model.addRelation(p,{from:a.id,to:b.id,label:'调用'}),/relation|关系/i);
  assert.throws(()=>Model.addRelation(p,{from:a.id,to:b.id,type:'bad'}),/relation|关系/i);
  Model.addRelation(p,{from:b.id,to:a.id});
  Model.addRelation(p,{from:a.id,to:b.id,type:'dependency'});
  assert.deepEqual(Model.validate(p).errors,[]);
});
test('确认无参数和参数待确认可以分别保存，空描述只给提醒', () => {
  const {p,i}=fixture(); const before=Model.validate(p);
  assert.ok(before.warnings.some(w=>w.path==='modules[0].interfaces[0].purpose'));
  i.inputsConfirmed=true; i.outputsConfirmed=true;
  assert.deepEqual(Model.validate(p).errors,[]);
  i.status='verified'; assert.ok(Model.validate(p).errors.some(w=>w.path==='modules[0].interfaces[0].sources'));
});
test('验证坏结构不崩溃，错误带有准确位置', () => {
  for (const value of [null,undefined,1,'x',[],{}, {modules:[null],groups:[false],relations:[7],view:null}]) {
    assert.doesNotThrow(()=>Model.validate(value)); assert.ok(Model.validate(value).errors.length);
  }
  const {p,a,i}=fixture(); a.x=NaN; a.sources=[null,{path:'x',line:0,endLine:1,symbol:4},{path:'x',line:5,endLine:2}];
  i.inputs=[{id:'param-x',name:'a',type:'str',required:'yes',description:''}];
  i.outputs=[null]; i.outputsConfirmed='yes'; a.unknowns=[3]; p.repository.dirty='yes'; p.view.scale=0;
  const paths=Model.validate(p).errors.map(e=>e.path);
  for(const path of ['modules[0].x','modules[0].sources[0]','modules[0].sources[1].line','modules[0].sources[1].symbol','modules[0].sources[2].endLine','modules[0].interfaces[0].inputs[0].required','modules[0].interfaces[0].outputs[0]','modules[0].interfaces[0].outputsConfirmed','modules[0].unknowns[0]','repository.dirty','view.scale']) assert.ok(paths.includes(path),path);
});
test('验证所有标识、引用、枚举和嵌套数组', () => {
  const {p,a,b,i}=fixture(); b.id=a.id; a.groupId='missing'; a.status='bad';
  i.inputs=null; i.outputs={}; i.sources='bad'; p.groups=[{id:i.id,name:'',color:4,x:Infinity,y:0}];
  p.relations=[{id:'r',from:'missing',to:a.id,type:'bad',label:'',status:'bad',sources:[],unknowns:[]}];
  p.view.expanded=['missing']; p.view.expandedInterfaces=['missing'];
  const paths=Model.validate(p).errors.map(e=>e.path);
  for(const path of ['modules[1].id','modules[0].groupId','modules[0].status','modules[0].interfaces[0].id','modules[0].interfaces[0].inputs','modules[0].interfaces[0].outputs','modules[0].interfaces[0].sources','groups[0].color','groups[0].x','relations[0].from','relations[0].type','relations[0].status','view.expanded[0]','view.expandedInterfaces[0]']) assert.ok(paths.includes(path),path);
});
test('来源路径和行号合法，输出可以省略 required，重复关系和展开项报错', () => {
  const {p,a,b,i}=fixture(); a.sources=[{path:'src/a.js',line:1,endLine:3,symbol:'A'}];
  const output=Model.createParameter(); delete output.required; i.outputs.push(output);
  assert.deepEqual(Model.validate(p).errors,[]);
  const r=Model.addRelation(p,{from:a.id,to:b.id}); p.relations.push({...r,id:'other'});
  p.view.expanded=[a.id,a.id];
  const paths=Model.validate(p).errors.map(e=>e.path);
  assert.ok(paths.includes('relations[1]')); assert.ok(paths.includes('view.expanded[1]'));
});
test('坏关系中的任意值和不安全行号不让验证崩溃',()=>{
  const {p}=fixture(); const cycle={}; cycle.self=cycle;
  p.relations=[{id:'r',from:cycle,to:2n,type:'call',label:Symbol('bad'),sources:[],unknowns:[],status:'planned'}];
  assert.doesNotThrow(()=>Model.validate(p)); assert.ok(Model.validate(p).errors.length);
  p.relations=[]; p.modules[0].sources=[{path:'a',line:9007199254740992}];
  assert.ok(Model.validate(p).errors.some(e=>e.path==='modules[0].sources[0].line'));
});
test('数组里的空洞不能被误认为有效结构',()=>{
  const {p,a,i}=fixture();
  p.groups=new Array(1); p.modules.push(...new Array(1)); a.interfaces.push(...new Array(1));
  i.inputs=new Array(1); i.outputs=new Array(1); p.relations=new Array(1); p.view.expanded=new Array(1);
  const paths=Model.validate(p).errors.map(e=>e.path);
  for(const path of ['groups[0]','modules[2]','modules[0].interfaces[1]','modules[0].interfaces[0].inputs[0]','modules[0].interfaces[0].outputs[0]','relations[0]','view.expanded[0]']) assert.ok(paths.includes(path),path);
});
