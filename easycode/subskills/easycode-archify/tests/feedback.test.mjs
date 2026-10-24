import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';
import '../assets/feedback.js';
const {Model,Feedback} = globalThis.EasyCode;

test('草稿提示说明模块、接口和参数位置，修正后消失',() => {
  const project = Model.createProject('任务板'); project.description = '管理任务';
  const module = Model.createModule({name:'任务模块',purpose:''}), entry = Model.createInterface();
  entry.name = 'createTask'; entry.purpose = ''; entry.inputs = [{...Model.createParameter(),name:'title',type:'string',description:''}];
  module.interfaces = [entry]; project.modules = [module];
  const result = Model.validate(project);
  assert.deepEqual(result.errors,[]);
  assert.equal(Feedback.formatWarnings(project,result.warnings),
    '草稿还有 3 处待补充（可以保存）：\n模块 1“任务模块” / 模块功能：内容尚未填写\n模块 1“任务模块” / 方法 1“createTask” / 方法用途：内容尚未填写\n模块 1“任务模块” / 方法 1“createTask” / 输入参数 1“title” / 参数说明：内容尚未填写');
  module.purpose = '管理任务'; entry.purpose = '创建任务'; entry.inputs[0].description = '任务名称';
  assert.equal(Feedback.formatWarnings(project,Model.validate(project).warnings),'');
});

test('提示区分重名、未命名项，保留不认识的检查位置',() => {
  const project = Model.createProject('');
  project.englishName = ''; project.description = '';
  project.groups = [{id:'group-one',name:'',color:'#ffffff',x:0,y:0}];
  project.modules = [Model.createModule({name:'任务',purpose:''}),Model.createModule({name:'任务',purpose:''})];
  Model.addRelation(project,{from:project.modules[0].id,to:project.modules[1].id});
  const text = Feedback.formatWarnings(project,Model.validate(project).warnings);
  for (const location of ['项目 / 项目名称','项目 / 项目用途','分组 1“未命名” / 分组名称','模块 1“任务” / 模块功能','模块 2“任务” / 模块功能']) assert.ok(text.includes(location),location);
  assert.ok(!text.includes('关系说明'));
  assert.match(Feedback.formatWarnings(project,[{path:'future.field',message:'请补充'}]),/future\.field：请补充/);
});

test('新分组中的待补充提示指向参数、事件数据和测试项',() => {
  const project = Model.createProject('提示'); project.description = '新增分组';
  const module = Model.createModule({name:'任务模块',purpose:'任务处理'});
  const parameter = {...Model.createParameter(),name:'',englishName:'limit',type:'number',description:''};
  module.structures = [{...Model.createStructure(),name:'任务信息',englishName:'TaskInfo',fields:[{...Model.createStructureField(),name:'任务名称',englishName:'taskName',type:'',description:''}]}];
  const event = {...Model.createEvent(),name:'',englishName:'done',description:'完成事件',parameters:[{...Model.createParameter(),name:'',englishName:'result',type:'string',description:''}]};
  module.parameters = [parameter]; module.events = [event]; module.tests = [{...Model.createTest(),name:'正常完成',steps:'',expected:''}]; project.modules = [module];
  const text = Feedback.formatWarnings(project,Model.validate(project).warnings);
  for (const expected of ['参数 1“limit” / 参数说明','数据结构 1“任务信息” / 字段 1“任务名称” / 变量类型','数据结构 1“任务信息” / 字段 1“任务名称” / 作用','事件 1“done” / 参数 1“result” / 参数说明','测试项 1“正常完成” / 测试步骤','测试项 1“正常完成” / 预期结果']) assert.ok(text.includes(expected),expected);
});

test('缺项提示到时隐藏，重复刷新不续时，关闭后不因拖动再次出现',() => {
  let current = '', sequence = 0; const timers = new Map(), shown = [];
  const notice = Feedback.createWarningNotice({show:message => {current = message; shown.push(message);},hide:() => {current = '';},schedule:callback => {timers.set(++sequence,callback); return sequence;},cancel:id => timers.delete(id)});
  notice.update('缺少方法用途','project-one');
  notice.update('缺少方法用途','project-one'); assert.equal(sequence,1,'same message never restarts the timer');
  timers.get(1)(); assert.equal(current,''); assert.equal(timers.size,0);
  notice.update('缺少方法用途','project-one'); assert.equal(current,'');
  notice.update('缺少字段名称','project-one'); assert.equal(current,'缺少字段名称');
  notice.dismiss(); assert.equal(timers.size,0); notice.update('缺少字段名称','project-one'); assert.equal(current,'');
  notice.update('','project-one'); notice.update('缺少字段名称','project-one'); assert.equal(current,'缺少字段名称','a resolved then new issue can be shown');
  notice.update('缺少字段名称','project-two'); assert.equal(timers.size,1,'switching projects clears the old timer');
  notice.update('','project-two'); assert.equal(current,''); assert.equal(timers.size,0);
  assert.equal(shown.length,4);
});
