import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';
import '../assets/canvas.js';
import {assemble,loadBundle} from '../scripts/build.mjs';
const {Model:M,Canvas:C,Serialization:S} = globalThis.EasyCode;
const sides = ['top','right','bottom','left'];
const bounds = module => ({...module,width:360,height:180});
function fixture() {
  const project = M.createProject('连接点'); project.description = '拖拽连线检查';
  const modules = ['入口','业务','存储'].map((name,i) => M.createModule({name,purpose:name,x:i * 500,y:i * 120}));
  project.modules.push(...modules);
  const changes = [], states = [];
  const connection = C.createConnection({project,onChange:change => changes.push(change),onState:state => states.push(state)});
  return {project,modules,connection,changes,states};
}

test('按下开始拖拽，松开在有效终点后才写入一条箭头',() => {
  const {project,modules:[a,b],connection,changes} = fixture(), before = structuredClone(project);
  connection.start();
  assert.equal(connection.getState().active,true);
  assert.equal(connection.begin(a.id,'bottom'),true);
  assert.deepEqual(connection.getState().source,{moduleId:a.id,port:'bottom'});
  assert.deepEqual(project,before); assert.equal(changes.length,0);
  assert.equal(connection.complete(b.id,'top'),true);
  assert.equal(changes.length,1); assert.deepEqual(changes[0],{semantic:true,render:false});
  assert.deepEqual(project.relations.map(({from,to,fromPort,toPort,type,status}) => ({from,to,fromPort,toPort,type,status})),[{from:a.id,to:b.id,fromPort:'bottom',toPort:'top',type:undefined,status:'planned'}]);
  assert.deepEqual(connection.getState(),{active:false,source:null,message:''});
  assert.deepEqual(M.validate(project).errors,[]);
});

test('圆点没有固定方向，同一点可以连接多个模块并反向使用',() => {
  const {project,modules:[a,b,c],connection,changes} = fixture();
  connection.begin(a.id,'left'); connection.complete(b.id,'right');
  connection.begin(a.id,'left'); connection.complete(c.id,'top');
  connection.begin(b.id,'right'); connection.complete(a.id,'left');
  assert.deepEqual(project.relations.map(r => [r.from,r.fromPort,r.to,r.toPort]),[
    [a.id,'left',b.id,'right'],[a.id,'left',c.id,'top'],[b.id,'right',a.id,'left']
  ]);
  assert.equal(changes.length,3);
});

test('取消、重新拖拽和无效点不改项目；导出的数据不含未完成的箭头',async() => {
  const {project,modules:[a],connection,changes} = fixture(), before = structuredClone(project);
  connection.begin(a.id,'top'); connection.cancel();
  connection.begin(a.id,'right'); connection.start();
  assert.equal(connection.getState().source,null);
  connection.begin('missing','left'); connection.begin(a.id,'unknown');
  assert.deepEqual(project,before); assert.equal(changes.length,0);
  connection.begin(a.id,'bottom');
  assert.deepEqual(S.readProject(assemble(project,await loadBundle())),before);
  connection.getState().source.port = 'left';
  assert.equal(connection.getState().source.port,'bottom','state snapshots cannot modify the live selection');
});

test('松开在空白或自身时取消，重复箭头也不会留下待连接状态',() => {
  const {project,modules:[a,b,c],connection,changes} = fixture();
  connection.begin(a.id,'right'); connection.complete();
  assert.equal(project.relations.length,0); assert.equal(connection.getState().source,null);
  connection.begin(a.id,'right'); connection.complete(a.id,'left');
  assert.equal(project.relations.length,0); assert.equal(connection.getState().source,null);
  connection.begin(a.id,'right'); connection.complete(b.id,'left');
  connection.begin(a.id,'top'); connection.complete(b.id,'bottom');
  assert.match(connection.getState().message,/重复/); assert.equal(project.relations.length,1); assert.equal(changes.length,1);
  assert.equal(connection.getState().source,null); assert.equal(connection.getState().active,false);
  connection.complete(c.id,'left');
  assert.equal(project.relations.length,1,'a release after cancellation cannot start or finish a connection');
  connection.begin(a.id,'top'); connection.complete(c.id,'left');
  assert.equal(project.relations.length,2); assert.equal(changes.length,2);
});

test('删除起点模块会清掉未完成拖拽；模块不足两个时提示但不创建箭头',() => {
  const {project,modules:[a,b,c],connection,changes} = fixture();
  connection.begin(a.id,'right'); M.removeModule(project,a.id); connection.reconcile();
  assert.equal(connection.getState().source,null); assert.equal(connection.getState().active,false);
  M.removeModule(project,c.id); connection.begin(b.id,'top');
  assert.equal(connection.getState().active,false); assert.match(connection.getState().message,/至少需要两个模块/);
  assert.equal(project.relations.length,0); assert.equal(changes.length,0);
});

test('四边共 16 种组合均连接到指定边，箭头沿所选边进入目标',() => {
  const a = {x:-80,y:20,width:360,height:180}, b = {x:550,y:400,width:280,height:230};
  const expected = (box,side) => ({
    top:{x:box.x + box.width / 2,y:box.y - 7,nx:0,ny:-1},
    right:{x:box.x + box.width + 7,y:box.y + box.height / 2,nx:1,ny:0},
    bottom:{x:box.x + box.width / 2,y:box.y + box.height + 7,nx:0,ny:1},
    left:{x:box.x - 7,y:box.y + box.height / 2,nx:-1,ny:0}
  })[side];
  for (const fromPort of sides) for (const toPort of sides) {
    const result = C.relationGeometry(a,b,{fromPort,toPort});
    assert.deepEqual(result.start,expected(a,fromPort)); assert.deepEqual(result.end,expected(b,toPort));
    for (const [anchor,control] of [[result.start,result.c1],[result.end,result.c2]]) {
      assert.ok((control.x - anchor.x) * anchor.nx + (control.y - anchor.y) * anchor.ny > 0,'control extends outwards from the module');
      assert.equal((control.x - anchor.x) * anchor.ny - (control.y - anchor.y) * anchor.nx,0,'the curve meets the port perpendicular to the edge');
    }
    assert.ok(Object.values(result.label).every(Number.isFinite));
    assert.doesNotMatch(result.path,/NaN|Infinity|undefined/);
  }
});

test('旧箭头自动选左右边，指定连接点后不会随模块相对位置换边',() => {
  const a = {x:0,y:0,width:360,height:180}, b = {x:500,y:200,width:360,height:180};
  const old = {from:'a',to:'b'}, before = structuredClone(old);
  assert.equal(C.relationGeometry(a,b,old).start.nx,1);
  assert.equal(C.relationGeometry(b,a,old).start.nx,-1);
  assert.deepEqual(old,before);
  for (const x of [-500,0,500]) {
    const moved = {...b,x};
    const result = C.relationGeometry(a,moved,{fromPort:'left',toPort:'bottom'});
    assert.deepEqual(result.start,C.portAnchor(a,'left'));
    assert.deepEqual(result.end,C.portAnchor(moved,'bottom'));
  }
});

test('同一对连接点的多条箭头分开绘制，仍使用同一组端点',() => {
  const a = {x:0,y:0,width:360,height:180}, b = {...a,x:600}, relation = {fromPort:'right',toPort:'left'};
  const first = C.relationGeometry(a,b,relation), second = C.relationGeometry(a,b,relation,1);
  assert.deepEqual(first.start,second.start); assert.deepEqual(first.end,second.end);
  assert.notEqual(first.path,second.path); assert.notEqual(first.label.y,second.label.y);
});

test('非法连接点在新建、编辑、导入检查时都被拒绝，失败不部分修改',() => {
  const {project,modules:[a,b]} = fixture();
  for (const side of [null,'center',5,{},['left']]) {
    const before = structuredClone(project);
    assert.throws(() => M.addRelation(project,{from:a.id,to:b.id,fromPort:side}),/连接点/);
    assert.deepEqual(project,before);
  }
  const relation = M.addRelation(project,{from:a.id,to:b.id,fromPort:'top',toPort:'bottom'}), before = structuredClone(project);
  assert.throws(() => M.updateRelation(project,relation.id,{label:'不能留下',toPort:'bad'}),/连接点/);
  assert.deepEqual(project,before);
  relation.fromPort = 'bad'; relation.toPort = null;
  const paths = M.validate(project).errors.map(item => item.path);
  assert.ok(paths.includes('relations[0].fromPort')); assert.ok(paths.includes('relations[0].toPort'));
});

test('只换连接边保留源码核对状态，改方向或内容才标记待核对；自动边可恢复',() => {
  const {project,modules:[a,b]} = fixture();
  const relation = M.addRelation(project,{from:a.id,to:b.id,fromPort:'right',toPort:'left',status:'verified',sources:[{path:'src/a.js',line:2}]});
  assert.equal(M.updateRelation(project,relation.id,{fromPort:'top',toPort:'bottom'}),true);
  assert.equal(relation.status,'verified');
  assert.equal(M.updateRelation(project,relation.id,{fromPort:'top'}),false);
  assert.equal(M.updateRelation(project,relation.id,{fromPort:undefined,toPort:undefined}),true);
  assert.equal(Object.hasOwn(relation,'fromPort'),false); assert.equal(Object.hasOwn(relation,'toPort'),false);
  assert.equal(relation.status,'verified');
  M.updateRelation(project,relation.id,{from:b.id,to:a.id,label:'反向调用'});
  assert.equal(relation.status,'modified'); assert.deepEqual(relation.sources,[{path:'src/a.js',line:2}]);
});

test('编辑箭头不允许改成自身或重复关系',() => {
  const {project,modules:[a,b]} = fixture();
  const first = M.addRelation(project,{from:a.id,to:b.id,label:'一'});
  M.addRelation(project,{from:a.id,to:b.id,label:'二'});
  const before = structuredClone(project);
  assert.throws(() => M.updateRelation(project,first.id,{label:'二'}),/重复/);
  assert.throws(() => M.updateRelation(project,first.id,{to:a.id}),/不同模块/);
  assert.deepEqual(project,before);
});

test('保存读回保留新连接点和旧数据，模块拖动后端点随之移动',async() => {
  const {project,modules:[a,b],connection} = fixture();
  const old = M.addRelation(project,{from:b.id,to:a.id,label:'旧关系'});
  connection.begin(a.id,'bottom'); connection.complete(b.id,'left');
  const saved = S.readProject(assemble(project,await loadBundle()));
  assert.deepEqual(saved,project); assert.deepEqual(saved.relations[0],old);
  const relation = saved.relations[1], before = C.relationGeometry(bounds(saved.modules[0]),bounds(saved.modules[1]),relation);
  M.updateModule(saved,b.id,{x:b.x + 130,y:b.y - 40});
  const after = C.relationGeometry(bounds(saved.modules[0]),bounds(saved.modules[1]),relation);
  assert.equal(after.end.x,before.end.x + 130); assert.equal(after.end.y,before.end.y - 40);
  assert.deepEqual(after.start,before.start); assert.equal(relation.toPort,'left');
});
