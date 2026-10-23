import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/model.js';
import '../assets/annotations.js';
import {assemble,loadBundle} from '../scripts/build.mjs';
const {Model:M,Annotations:A,Serialization:S} = globalThis.EasyCode;
function fixture(legacy = false) {
  const project = M.createProject('备注'); project.description = '普通模块关系';
  const a = M.createModule({name:'A',purpose:'入口'}), b = M.createModule({name:'B',purpose:'服务'});
  project.modules.push(a,b);
  const relation = M.addRelation(project,{from:a.id,to:b.id,fromPort:'bottom',toPort:'top',...(legacy ? {type:'dependency'} : {})});
  return {project,relation,a,b};
}

test('新箭头没有调用或依赖类别，备注留空也没有缺项提示',() => {
  const {project,relation} = fixture();
  assert.equal(Object.hasOwn(relation,'type'),false);
  assert.deepEqual(M.validate(project),{errors:[],warnings:[]});
  relation.label = '   ';
  assert.deepEqual(M.validate(project),{errors:[],warnings:[]});
  delete relation.label;
  assert.deepEqual(M.validate(project),{errors:[],warnings:[]});
});

test('备注先留在草稿，取消或尚未完成编辑时不改变原箭头',() => {
  const {project,relation} = fixture(), before = structuredClone(project);
  const draft = A.begin(project,relation.id); draft.text = '正在编辑';
  assert.equal(A.hasChanges(draft),true); assert.deepEqual(project,before);
  assert.equal(A.begin(project,relation.id).text,'');
});

test('完成编辑只修改备注，旧类型、端点、位置和其他模块都保留',() => {
  const {project,relation} = fixture(true), before = structuredClone(project), draft = A.begin(project,relation.id);
  draft.text = '用户记录的关系';
  assert.equal(A.commit(project,draft),true);
  before.relations[0].label = draft.text;
  assert.deepEqual(project,before); assert.equal(relation.type,'dependency');
  assert.equal(A.commit(project,A.begin(project,relation.id)),false,'no-op edit does not dirty the project');
});

test('清空备注可以完成编辑，未填写的旧备注不被无故改写',() => {
  const {project,relation} = fixture(); relation.label = '旧备注';
  const draft = A.begin(project,relation.id); draft.text = '';
  assert.equal(A.commit(project,draft),true); assert.equal(relation.label,'');
  assert.deepEqual(M.validate(project),{errors:[],warnings:[]});
  delete relation.label;
  assert.equal(A.commit(project,A.begin(project,relation.id)),false);
  assert.equal(Object.hasOwn(relation,'label'),false);
});

test('多行和 HTML 字样作为普通备注保存读回，不执行内容',async() => {
  const {project,relation} = fixture(), draft = A.begin(project,relation.id);
  draft.text = '第一行\n</script><script>alert(1)</script>\n第三行';
  A.commit(project,draft);
  const html = assemble(project,await loadBundle());
  assert.deepEqual(S.readProject(html),project);
  assert.equal(html.includes('<script>alert(1)</script>'),false);
  assert.equal(S.readProject(html).relations[0].label,draft.text);
});

test('旧备注被外部修改或箭头已删除时，不让过期草稿覆盖',() => {
  for (const action of ['change','delete']) {
    const {project,relation} = fixture(), draft = A.begin(project,relation.id); draft.text = '过期草稿';
    if (action === 'change') relation.label = '较新的备注'; else M.removeRelation(project,relation.id);
    const before = structuredClone(project);
    assert.throws(() => A.commit(project,draft)); assert.deepEqual(project,before);
  }
});

test('删除箭头保留模块、层级和其他箭头，重复删除不产生修改',() => {
  const {project,relation,a,b} = fixture();
  const retained = M.addRelation(project,{from:b.id,to:a.id,label:'另一条'}), modules = structuredClone(project.modules);
  assert.equal(M.removeRelation(project,relation.id),true);
  assert.deepEqual(project.relations,[retained]); assert.deepEqual(project.modules,modules);
  assert.equal(M.removeRelation(project,relation.id),false);
  assert.throws(() => A.begin(project,relation.id),/不存在/);
});
