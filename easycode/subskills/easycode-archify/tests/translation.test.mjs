import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/translation.js';
import '../assets/model.js';
import '../assets/serialization.js';
import {assemble,loadBundle} from '../scripts/build.mjs';
const {Translation:T,Model:M,Serialization:S} = globalThis.EasyCode;
const ok = text => ({ok:true,status:200,json:async () => ({responseStatus:200,responseData:{translatedText:text}})});

test('英文命名按类型整理，不把中文或错误结果伪装成英文',() => {
  for (const [text,kind,expected] of [
    ['Task Manager','project','task-manager'],['Task Manager','module','TaskManager'],['Data layer','group','DataLayer'],
    ['Save task','method','saveTask'],['Task ID','parameter','taskId'],['Task saved','event','taskSaved'],
    ['Save success','test','saveSuccess'],['Maximum retries','constant','MAXIMUM_RETRIES'],
    ['HTTPServer ID','method','httpServerId'],['default','parameter','defaultValue'],['2 tasks','method','value2Tasks'],
    ['User&#39;s name','parameter','usersName'],['Save &amp; close','method','saveClose']
  ]) assert.equal(T.formatName(text,kind),expected);
  for (const text of ['保存任务','Save 任务','123','<script>alert(1)</script>','',null,'Сохранить']) assert.throws(() => T.formatName(text),/英文/);
});

test('明确中译英、无凭证请求；成功缓存复用并根据类型分别整理',async () => {
  const calls = [];
  const translate = T.createClient({fetch:async (url,options) => {calls.push({url,options}); return ok('Save task');}});
  assert.equal(await translate(' 保存任务 ','method'),'saveTask');
  assert.equal(await translate('保存任务','module'),'SaveTask');
  assert.equal(await translate('保存任务','project'),'save-task');
  assert.equal(calls.length,1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin,'https://api.mymemory.translated.net');
  assert.equal(url.searchParams.get('q'),'保存任务'); assert.equal(url.searchParams.get('langpair'),'zh-CN|en');
  assert.equal(calls[0].options.credentials,'omit'); assert.equal(calls[0].options.referrerPolicy,'no-referrer');
  await assert.rejects(translate(''),/先填写/);
  await assert.rejects(translate('中'.repeat(167)),/500/);
  assert.equal(calls.length,1,'invalid input never makes a request');
});

test('配额、服务、网络、中文结果分别报错；失败不进入缓存',async () => {
  let response, count = 0;
  const translate = T.createClient({fetch:async () => {count++; if (response instanceof Error) throw response; return response;}});
  for (const [value,message] of [
    [{ok:false,status:429},/受限/], [{ok:false,status:503},/不可用/],
    [{ok:true,status:200,json:async () => ({responseStatus:200,quotaFinished:true,responseData:{translatedText:'quota error'}})},/额度/],
    [{ok:true,status:200,json:async () => ({responseStatus:403})},/未完成/],
    [ok('保存任务'),/英文/], [new TypeError('Failed to fetch'),/网络/],
    [{ok:true,status:200,json:async () => {throw new SyntaxError('bad JSON');}},/网络/]
  ]) {response = value; await assert.rejects(translate('保存任务'),message);}
  response = ok('Save task'); assert.equal(await translate('保存任务'),'saveTask'); assert.equal(count,8);
});

test('超时和主动取消终止请求，已取消请求不能读取缓存',async () => {
  const wait = (_,{signal}) => new Promise((resolve,reject) => signal.addEventListener('abort',() => reject(signal.reason),{once:true}));
  await assert.rejects(T.createClient({fetch:wait,timeoutMs:10})('保存任务'),/超时/);
  const controller = new AbortController(), translate = T.createClient({fetch:wait});
  const pending = translate('保存任务','method',{signal:controller.signal}); controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  const cached = T.createClient({fetch:async () => ok('Save task')}); await cached('保存任务');
  await assert.rejects(cached('保存任务','method',{signal:controller.signal}),{name:'AbortError'});
});

test('项目、层级、测试英文名兼容旧数据并随 HTML 保存；坏类型被拒绝',async () => {
  const project = M.createProject('项目'), module = M.createModule({name:'模块'}), check = M.createTest();
  project.modules = [module]; module.tests = [check]; check.name = '测试';
  project.groups = [{id:'group-test',name:'层级',color:'#ffffff',x:0,y:0}];
  delete project.englishName; delete check.englishName;
  const original = structuredClone(project), bundle = await loadBundle();
  assert.deepEqual(S.readProject(assemble(project,bundle)),original);
  project.englishName = 'test-project'; project.groups[0].englishName = 'DataLayer';
  M.updateMember(project,module.id,'tests',check.id,{englishName:'saveSuccess'});
  assert.equal(check.englishName,'saveSuccess');
  assert.deepEqual(S.readProject(assemble(project,bundle)),project);
  for (const item of [project,project.groups[0],check]) {
    const before = item.englishName; item.englishName = 123;
    assert.ok(M.validate(project).errors.some(error => error.path.endsWith('englishName'))); item.englishName = before;
  }
});
