import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';
import '../assets/feedback.js';
const {Model,Feedback} = globalThis.EasyCode;

test('草稿提示说明模块、接口和参数位置，修正后消失',() => {
  const project = Model.createProject('任务板'); project.description = '管理任务';
  const module = Model.createModule({name:'任务模块'}), entry = Model.createInterface();
  entry.name = 'createTask'; entry.inputs = [{...Model.createParameter(),name:'title',type:'string'}];
  module.interfaces = [entry]; project.modules = [module];
  const result = Model.validate(project);
  assert.deepEqual(result.errors,[]);
  assert.equal(Feedback.formatWarnings(project,result.warnings),
    '草稿还有 3 处待补充（可以保存）：\n模块 1“任务模块” / 模块职责：内容尚未填写\n模块 1“任务模块” / 接口 1“createTask” / 接口用途：内容尚未填写\n模块 1“任务模块” / 接口 1“createTask” / 输入参数 1“title” / 参数说明：内容尚未填写');
  module.purpose = '管理任务'; entry.purpose = '创建任务'; entry.inputs[0].description = '任务名称';
  assert.equal(Feedback.formatWarnings(project,Model.validate(project).warnings),'');
});

test('提示区分重名、未命名项，保留不认识的检查位置',() => {
  const project = Model.createProject('');
  project.groups = [{id:'group-one',name:'',color:'#ffffff',x:0,y:0}];
  project.modules = [Model.createModule({name:'任务'}),Model.createModule({name:'任务'})];
  Model.addRelation(project,{from:project.modules[0].id,to:project.modules[1].id});
  const text = Feedback.formatWarnings(project,Model.validate(project).warnings);
  for (const location of ['项目 / 项目名称','项目 / 项目用途','分组 1“未命名” / 分组名称','模块 1“任务” / 模块职责','模块 2“任务” / 模块职责','关系 1“任务 → 任务” / 关系说明']) assert.ok(text.includes(location),location);
  assert.match(Feedback.formatWarnings(project,[{path:'future.field',message:'请补充'}]),/future\.field：请补充/);
});
