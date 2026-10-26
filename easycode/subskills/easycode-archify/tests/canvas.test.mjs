import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';
import '../assets/serialization.js';
import '../assets/canvas.js';

const {Model,Serialization,Canvas} = globalThis.EasyCode;
const near = (a,b) => assert.ok(Math.abs(a - b) < 1e-8,`${a} != ${b}`);
const bounds = modules => modules.map(module => ({x:module.x,y:module.y,width:360,height:190}));
function groupFixture(offGrid = false) {
  const project = Model.createProject('吸附检查'); project.description = '检查移动时保留项目内容';
  const group = {id:'group-main',name:'业务层',color:'#ffffff',backgroundColor:'#81b3e9',x:60,y:100};
  const a = Model.createModule({name:'入口',purpose:'处理请求',groupId:group.id,x:offGrid ? 93.3 : 90,y:offGrid ? 160.2 : 160});
  const b = Model.createModule({name:'服务',purpose:'处理业务',groupId:group.id,x:offGrid ? 580.8 : 580,y:offGrid ? 523.8 : 520});
  a.status = 'verified'; a.sources = [{path:'entry.js',line:1}];
  project.groups = [group]; project.modules = [a,b];
  Model.addRelation(project,{from:a.id,to:b.id,label:'处理请求'});
  const selection = {group,groupX:group.x,groupY:group.y,anchor:Canvas.groupBounds(group,bounds(project.modules)),positions:project.modules.map(module => ({module,x:module.x,y:module.y}))};
  return {project,group,a,b,selection};
}

test('新建位置吸附到最近的 10 像素，支持小数和负坐标',() => {
  for (const [point,expected] of [
    [{x:0,y:10},{x:0,y:10}],
    [{x:94.9,y:95},{x:90,y:100}],
    [{x:-94.9,y:-95.1},{x:-90,y:-100}],
    [{x:-0.1,y:-5},{x:0,y:0}],
    [{x:37.4,y:128.8},{x:40,y:130}]
  ]) {
    const before = structuredClone(point), result = Canvas.snapPoint(point);
    assert.deepEqual(result,expected); assert.deepEqual(point,before);
    assert.ok(result.x % 10 === 0 && result.y % 10 === 0);
  }
});

test('缩放和平移后，背景点仍与世界坐标的 20 倍数重合',() => {
  for (const scale of [0.25,0.6,1,1.8]) {
    const view = {x:-17.4,y:91.2,scale}, style = Canvas.gridStyle(view);
    const size = style.backgroundSize.split(' ').map(parseFloat);
    const offset = style.backgroundPosition.split(' ').map(parseFloat);
    near(size[0],20 * scale); near(size[1],20 * scale);
    for (const index of [-3,0,5]) {
      near(offset[0] + size[0] / 2 + index * size[0],view.x + index * 20 * scale);
      near(offset[1] + size[1] / 2 + index * size[1],view.y + index * 20 * scale);
    }
  }
});

test('模块拖动在各缩放比例下落到同一网格，连续事件不会累计偏移',() => {
  for (const scale of [0.25,0.6,1,1.8]) {
    const project = Model.createProject('单模块'), module = Model.createModule({name:'入口',x:94.25,y:-17.8});
    project.modules = [module]; module.status = 'verified'; module.sources = [{path:'entry.js'}];
    const selection = {anchor:{x:module.x,y:module.y},positions:[{module,x:module.x,y:module.y}]};
    Canvas.moveSelection(project,selection,16 * scale,-24 * scale,scale);
    assert.deepEqual({x:module.x,y:module.y},{x:110,y:-40});
    Canvas.moveSelection(project,selection,26 * scale,44 * scale,scale);
    assert.deepEqual({x:module.x,y:module.y},{x:120,y:30});
    assert.equal(module.status,'verified');
    assert.deepEqual(module.sources,[{path:'entry.js'}]);
  }
});

test('层级外框边缘对齐网格，仍完整包住原有模块',() => {
  const members = [{x:-13.2,y:46.7,width:360,height:191},{x:521.4,y:-15.1,width:360,height:302}];
  const original = structuredClone(members), frame = Canvas.groupBounds({},members);
  assert.deepEqual(frame,{x:-40,y:-80,width:950,height:390});
  for (const value of Object.values(frame)) assert.ok(value % 10 === 0);
  for (const item of members) {
    assert.ok(frame.x <= item.x - 20 && frame.y <= item.y - 56);
    assert.ok(frame.x + frame.width >= item.x + item.width + 20);
    assert.ok(frame.y + frame.height >= item.y + item.height + 20);
  }
  assert.deepEqual(members,original);
});

test('整个层级吸附时保持成员间距、代码依据、连线和视图',() => {
  for (const scale of [0.25,0.6,1,1.8]) {
    const {project,group,a,b,selection} = groupFixture();
    const view = structuredClone(project.view), relations = structuredClone(project.relations);
    Canvas.moveSelection(project,selection,17 * scale,24 * scale,scale);
    assert.deepEqual({x:group.x,y:group.y},{x:90,y:120});
    assert.deepEqual({x:a.x,y:a.y},{x:110,y:180});
    assert.deepEqual({x:b.x,y:b.y},{x:600,y:540});
    assert.equal(b.x - a.x,490); assert.equal(b.y - a.y,360);
    assert.equal(a.status,'verified'); assert.deepEqual(project.relations,relations); assert.deepEqual(project.view,view);
    const frame = Canvas.groupBounds(group,bounds(project.modules));
    assert.equal(frame.x,group.x); assert.equal(frame.y,group.y);
    for (const item of [group,a,b]) assert.ok(item.x % 10 === 0 && item.y % 10 === 0);
  }
});

test('旧画布中未对齐的成员整体移动时保留相对位置，不单独重排',() => {
  const {project,group,a,b,selection} = groupFixture(true);
  const offset = {x:b.x - a.x,y:b.y - a.y};
  Canvas.moveSelection(project,selection,17,-7,1);
  near(b.x - a.x,offset.x); near(b.y - a.y,offset.y);
  near(a.x,113.3); near(a.y,150.2); near(b.x,600.8); near(b.y,513.8);
  assert.equal(group.x,90); assert.equal(group.y,90);
});

test('不足半格或移回原位时恢复原坐标，空层级也能吸附',() => {
  const {project,group,a,b,selection} = groupFixture();
  const original = structuredClone(project);
  Canvas.moveSelection(project,selection,4,-4,1); assert.deepEqual(project,original);
  Canvas.moveSelection(project,selection,17,24,1);
  Canvas.moveSelection(project,selection,0,0,1); assert.deepEqual(project,original);
  const empty = {id:'group-empty',name:'空层级',color:'#ffffff',x:-23.2,y:51.8};
  project.groups.push(empty);
  const frame = Canvas.groupBounds(empty,[]);
  assert.deepEqual(frame,{x:-23.2,y:51.8,width:400,height:170});
  Canvas.moveSelection(project,{group:empty,groupX:empty.x,groupY:empty.y,anchor:frame,positions:[]},7,8,1);
  assert.deepEqual({x:empty.x,y:empty.y},{x:-20,y:60});
  assert.deepEqual([group,a,b],[original.groups[0],...original.modules]);
});

test('吸附后的坐标通过 HTML 保存和读回保持不变',() => {
  const {project,selection} = groupFixture();
  Canvas.moveSelection(project,selection,-137,63,0.6);
  const bundle = {canvas:'<!doctype html><title><!--EC:TITLE--></title><!--EC:STYLE--><!--EC:NODE--><!--EC:DATA--><!--EC:BUNDLE--><!--EC:RUNTIME-->',node:'<template id="ec-module-template"></template>',css:'',runtime:''};
  const reopened = Serialization.readProject(Serialization.buildDocument(bundle,project));
  assert.deepEqual(reopened,project); assert.deepEqual(Model.validate(reopened).errors,[]);
  for (const item of [...reopened.modules,...reopened.groups]) assert.ok(item.x % 10 === 0 && item.y % 10 === 0);
});
