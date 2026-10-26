import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';
import '../assets/module-editor.js';
import {assemble,loadBundle} from '../scripts/build.mjs';
const {Model:M,ModuleEditor:E,Serialization:S} = globalThis.EasyCode;

function fixture() {
  const project = M.createProject('外观设置'), module = M.createModule({name:'任务模块'}), other = M.createModule({name:'日志模块'});
  module.status = 'verified'; module.sources = [{path:'src/tasks.ts'}];
  project.modules.push(module,other); M.addRelation(project,{from:module.id,to:other.id});
  return {project,module,other};
}

test('模块颜色有完整独立默认值，读取外观不修改项目',() => {
  const a = M.createModule(), b = M.createModule();
  assert.deepEqual(a.appearance,{textColor:'#17254d',backgroundColor:'#fcfdff',headerColor:'#f4f7ff'});
  a.appearance.textColor = '#123456';
  assert.equal(b.appearance.textColor,'#17254d');
  const before = structuredClone(a), colors = M.moduleAppearance(a); colors.headerColor = '#ffffff';
  assert.deepEqual(a,before);
  const missing = {name:'外观未设置'};
  assert.deepEqual(M.moduleAppearance(missing),b.appearance);
  assert.deepEqual(missing,{name:'外观未设置'});
});

test('模块颜色拒绝空值、坏结构和任意 CSS，渲染只接收安全颜色',() => {
  const {project,module} = fixture();
  for (const value of [null,[],false,'#ffffff',{}]) {
    module.appearance = value;
    assert.ok(M.validate(project).errors.some(error => error.path.startsWith('modules[0].appearance')));
  }
  for (const key of ['textColor','backgroundColor','headerColor']) {
    for (const value of ['',42,{},'#fff','#12345g','red','url(https://invalid.test/image)','#ffffff;display:none']) {
      module.appearance = {...M.moduleAppearance(),[key]:value};
      assert.ok(M.validate(project).errors.some(error => error.path === `modules[0].appearance.${key}`));
      assert.equal(M.moduleAppearance(module)[key],M.moduleAppearance()[key]);
    }
  }
  module.appearance = {textColor:'#ABCDEF',backgroundColor:'#123456',headerColor:'#000000'};
  assert.deepEqual(M.validate(project),{errors:[],warnings:[]});
});

test('外观编辑只改草稿，确认只更新当前模块，保存重开保留颜色',async () => {
  const {project,module,other} = fixture(), before = structuredClone(project);
  const draft = E.begin(project,module.id);
  const colors = {textColor:'#223344',backgroundColor:'#f4f5f6',headerColor:'#d7e2ed'};
  M.updateModule(draft.project,module.id,{appearance:colors});
  assert.equal(E.hasChanges(draft),true);
  assert.deepEqual(project,before,'unconfirmed or abandoned draft cannot change the canvas');
  assert.equal(E.hasChanges(E.begin(project,module.id)),false);
  assert.equal(E.commit(project,draft),true);
  assert.deepEqual(module.appearance,colors);
  assert.equal(module.status,'verified','colors do not change code verification status');
  assert.deepEqual(other,before.modules[1]);
  assert.deepEqual(project.relations,before.relations); assert.deepEqual(project.view,before.view);
  const restored = structuredClone(module); restored.appearance = before.modules[0].appearance;
  assert.deepEqual(restored,before.modules[0],'content and position stay intact');
  assert.equal(E.commit(project,E.begin(project,module.id)),false,'unchanged confirmation is a no-op');
  const reopened = S.readProject(assemble(project,await loadBundle()));
  assert.deepEqual(reopened,project);
});

test('无效颜色或过期外观草稿不能部分写入项目',() => {
  const {project,module} = fixture(), before = structuredClone(project);
  const invalid = E.begin(project,module.id);
  invalid.module.appearance.textColor = 'red'; invalid.module.purpose = '不应写入';
  assert.throws(() => E.commit(project,invalid),/颜色/); assert.deepEqual(project,before);
  const stale = E.begin(project,module.id);
  stale.module.appearance.headerColor = '#123456';
  M.updateModule(project,module.id,{appearance:{...module.appearance,backgroundColor:'#111111'}});
  const current = structuredClone(project);
  assert.throws(() => E.commit(project,stale),/已发生变化/); assert.deepEqual(project,current);
});

test('未保存过外观的模块，读取默认值和无改动确认都不改写数据',() => {
  const {project,module} = fixture(); delete module.appearance;
  const before = structuredClone(project), session = E.begin(project,module.id);
  assert.deepEqual(M.moduleAppearance(session.module),M.moduleAppearance());
  assert.equal(E.hasChanges(session),false);
  assert.equal(E.commit(project,session),false);
  assert.deepEqual(project,before);
});
