import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deploy} from '../subskills/xyf-archify/tools/html/scripts/deploy.mjs';
import {readProjectFile,writeProjectFile} from '../subskills/xyf-archify/tools/html/scripts/files.mjs';
import {checkService,check} from '../subskills/xyf-archify/tools/html/scripts/check.mjs';
import {build} from '../subskills/xyf-archify/tools/html/scripts/build.mjs';
import {readCase} from './fixtures.mjs';

const temporary = await mkdtemp(join(tmpdir(),'archify-service-'));
const deployment = await deploy(join(temporary,'带 空格的项目'));
const {startServer} = await import(pathToFileURL(join(deployment.targetRoot,'html/server.mjs')).href);
const running = await startServer({port:0});
const {server,url} = running, projectFile = deployment.projectFile;
const read = async () => {const response = await fetch(url + '/api/project'); return {response,project:await response.json(),version:response.headers.get('etag')};};
const put = (project,version,extra={}) => fetch(url + '/api/project',{method:'PUT',headers:{'Content-Type':'application/json',...(version ? {'If-Match':version} : {}),...extra},body:JSON.stringify(project)});
const passed = [];
try {
  const initial = await read();
  assert.equal(initial.response.status,200); assert.equal(initial.project.modules.length,0); assert.equal(initial.project.groups.length,0);
  assert.notEqual(initial.project.id,'project-template');
  assert.equal((await readdir(join(deployment.targetRoot,'html'))).includes('index.html'),false);
  assert.equal((await checkService(url)).mode,'service');
  const entry = await (await fetch(url + '/')).text();
  assert.throws(() => globalThis.EasyCode.Serialization.readProject(entry),error => error.code === 'SERVICE_ENTRY');
  passed.push('复制后可启动；根目录入口；空项目有独立 ID');

  const full = await readCase('case-061'); full.extension = {retained:'保留额外字段'};
  assert.equal((await put(full,initial.version)).status,200);
  assert.deepEqual((await readProjectFile(projectFile)).project,full);
  let current = await read();
  assert.deepEqual(current.project,full);
  assert.equal((await fetch(url + '/api/project',{headers:{'If-None-Match':current.version}})).status,304);
  assert.equal((await put(initial.project,initial.version)).status,409);
  passed.push('完整字段和特殊文字往返一致；旧版本不能覆盖；未变化返回 304');

  const one = structuredClone(full), two = structuredClone(full); one.name = '并发一'; two.name = '并发二';
  const concurrent = await Promise.all([put(one,current.version),put(two,current.version)]);
  assert.deepEqual(concurrent.map(result => result.status).sort(),[200,409]);
  const accepted = concurrent[0].status === 200 ? one : two;
  assert.deepEqual((await readProjectFile(projectFile)).project,accepted);
  current = await read();
  passed.push('两个网页同时保存，仅一个成功');

  const before = await readFile(projectFile,'utf8'), invalid = structuredClone(current.project);
  invalid.modules[1].id = invalid.modules[0].id;
  assert.equal((await put(invalid,current.version)).status,422);
  assert.equal((await put(current.project,null)).status,428);
  assert.equal((await put(current.project,current.version,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await put(current.project,current.version,{Origin:'https://example.com'})).status,403);
  assert.equal(await readFile(projectFile,'utf8'),before);
  assert.equal((await fetch(url + '/html/server.mjs')).status,404);
  assert.equal((await fetch(url + '/html/assets/../../server.mjs')).status,404);
  passed.push('无效数据和跨站写入被拒绝，原文件保持不变');

  const external = structuredClone(current.project); external.name = '技能修改后的名称';
  await writeProjectFile(projectFile,external,{expectedVersion:current.version});
  assert.equal((await put(current.project,current.version)).status,409);
  assert.deepEqual((await read()).project,external);
  const validContent = await readFile(projectFile,'utf8');
  await writeFile(projectFile,'{"broken":');
  assert.equal((await fetch(url + '/api/project')).status,422);
  await writeFile(projectFile,validContent);
  assert.deepEqual((await read()).project,external);
  passed.push('识别技能改动；无效 JSON 有明确错误，修复后恢复读取');

  const snapshot = join(temporary,'独立快照.html');
  await build(projectFile,snapshot); assert.equal((await check(snapshot,projectFile)).mode,'snapshot');
  const snapshotContent = await readFile(snapshot,'utf8'), invalidFile = join(temporary,'invalid.json');
  await writeFile(invalidFile,JSON.stringify(invalid));
  await assert.rejects(() => build(invalidFile,snapshot));
  assert.equal(await readFile(snapshot,'utf8'),snapshotContent);
  passed.push('独立 HTML 往返一致；无效输入不会覆盖旧输出');

  const redeployed = await deploy(deployment.projectRoot);
  assert.equal(redeployed.dataPreserved,true); assert.equal(await readFile(projectFile,'utf8'),validContent);
  const otherJSON = join(temporary,'other.json'); await writeFile(otherJSON,JSON.stringify(initial.project));
  await assert.rejects(() => deploy(deployment.projectRoot,{sourceJSON:otherJSON}),/已有不同/);
  assert.equal(await readFile(projectFile,'utf8'),validContent);
  const second = await deploy(join(temporary,'第二个项目'));
  assert.notEqual((await readProjectFile(second.projectFile)).project.id,initial.project.id);
  const seeded = await deploy(join(temporary,'带输入的项目'),{sourceJSON:projectFile});
  assert.deepEqual((await readProjectFile(seeded.projectFile)).project,external);
  await assert.rejects(() => startServer({port:server.address().port}),error => error.code === 'EADDRINUSE');
  assert.equal((await readdir(deployment.targetRoot)).some(name => name.endsWith('.tmp')),false);
  passed.push('重复部署保留原 JSON；不同输入拒绝覆盖；指定输入部署保真；端口占用报错');
  console.log(JSON.stringify({passed:passed.length,checks:passed,temporary},null,2));
} finally {
  server.closeAllConnections(); await new Promise(done => server.close(done));
}
