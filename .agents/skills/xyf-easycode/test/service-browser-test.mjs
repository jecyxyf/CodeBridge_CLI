import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,access,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {deploy} from '../subskills/xyf-archify/tools/html/scripts/deploy.mjs';
import {startServer} from '../subskills/xyf-archify/tools/html/server.mjs';
import {readProjectFile,writeProjectFile} from '../subskills/xyf-archify/tools/html/scripts/files.mjs';
import {readCase} from './fixtures.mjs';
import {checkEventFlows} from './event-flow-checks.mjs';

const temporary = await mkdtemp(join(tmpdir(),'archify-browser-'));
const deployment = await deploy(join(temporary,'project'));
let running = await startServer({root:deployment.targetRoot,port:0});
const port = running.server.address().port, url = running.url;
const candidates = [process.env.EASYCODE_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;
for (const candidate of candidates) {try {await access(candidate); executable = candidate; break;} catch {}}
assert.ok(executable,'需要 Chrome 或 Edge');
const browser = spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--window-size=1600,1100','--user-data-dir='+temporary,'about:blank'],{stdio:'ignore',windowsHide:true});
let socket,sessionId,sequence = 0;
const pending = new Map(),pause = ms => new Promise(done => setTimeout(done,ms)),errors = [],checks = [];
function command(method,params = {},session) {
  const id = ++sequence;
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => {pending.delete(id); reject(new Error('浏览器响应超时：'+method));},60000);
    pending.set(id,{resolve:value => {clearTimeout(timer); resolve(value);},reject:error => {clearTimeout(timer); reject(error);}});
    socket.send(JSON.stringify({id,method,params,...session ? {sessionId:session} : {}}));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression,message,timeout = 15000) {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline) {if (await evaluate(expression)) return; await pause(100);}
  throw new Error(message+': '+await evaluate('document.getElementById("ec-notice")?.textContent+" / "+document.getElementById("ec-sync-notice")?.textContent'));
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const edit = (selector,value) => evaluate(`(() => {const field=document.querySelector(${JSON.stringify(selector)});field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
async function save() {await click('[data-action="save"]'); await until('!EasyCode.app.storage.isDirty()','保存没有完成',60000);}
async function changeFile(change) {
  const current = await readProjectFile(deployment.projectFile); change(current.project);
  await writeProjectFile(deployment.projectFile,current.project,{expectedVersion:current.version});
}
async function closeServer() {running.server.closeAllConnections(); await new Promise(done => running.server.close(done));}
try {
  let debugPort;
  for (let n=0;n<200;n++) {try {debugPort=(await readFile(join(temporary,'DevToolsActivePort'),'utf8')).split('\n')[0]; break;} catch {await pause(50);}}
  assert.ok(debugPort,'Chrome 未启动');
  const version = await (await fetch('http://127.0.0.1:'+debugPort+'/json/version')).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  socket.onmessage = event => {
    const data=JSON.parse(event.data),item=pending.get(data.id);
    if(item) {pending.delete(data.id); data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result);}
    if(data.method==='Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    if(data.method==='Page.javascriptDialogOpening') command('Page.handleJavaScriptDialog',{accept:true},data.sessionId).catch(()=>{});
  };
  await new Promise((done,fail) => {socket.onopen=done;socket.onerror=fail;});
  const {targetId} = await command('Target.createTarget',{url:'about:blank'});
  ({sessionId} = await command('Target.attachToTarget',{targetId,flatten:true}));
  await command('Runtime.enable',{},sessionId); await command('Page.enable',{},sessionId);
  await command('Page.navigate',{url},sessionId);
  await until('Boolean(window.EasyCode?.app)','页面没有初始化');
  assert.deepEqual(await evaluate('({nodes:document.querySelectorAll(".module-node").length,empty:!document.getElementById("ec-empty").hidden,embedded:!!document.getElementById("ec-project")})'),{nodes:0,empty:true,embedded:false});
  checks.push('服务版空框架正常显示，没有内嵌项目快照');

  await click('[data-action="add-group"]');
  await edit('[aria-label="层级中文名"]','测试层级'); await edit('[aria-label="层级英文名"]','TestLayer');
  await click('#ec-dialog button[type="submit"]');
  await click('[data-action="add-module"]'); await click('#ec-dialog button[type="submit"]');
  await save();
  let disk = await readProjectFile(deployment.projectFile);
  assert.equal(disk.project.modules.length,1); assert.equal(disk.project.groups.length,1);
  assert.equal(await evaluate('document.querySelectorAll(".module-node").length'),1);
  checks.push('按钮新增模块和分层，保存直接写回 JSON');
  checks.push(await checkEventFlows({evaluate,click,edit,save,projectFile:deployment.projectFile}));

  await changeFile(project => {project.name='技能修改自动显示';project.modules[0].purpose='外部 JSON 修改的模块功能';});
  await until('document.getElementById("ec-project-name").textContent === "技能修改自动显示"','外部修改未刷新');
  assert.equal(await evaluate('EasyCode.app.storage.isDirty()'),false);
  checks.push('技能修改 JSON 后自动刷新，无需重新生成入口');

  await click('[data-action="add-group"]');
  await edit('[aria-label="层级中文名"]','未保存的新层级');
  await changeFile(project => {project.name='冲突中的外部版本';});
  await until('!document.getElementById("ec-sync-notice").hidden','编辑期间未提示外部变化');
  assert.equal(await evaluate('document.getElementById("ec-dialog").open'),true);
  await click('#ec-dialog button[type="submit"]');
  await click('[data-action="save"]');
  await until('document.getElementById("ec-notice").textContent.includes("其他操作修改")','冲突保存未拒绝');
  assert.equal((await readProjectFile(deployment.projectFile)).project.groups.length,1);
  assert.equal(await evaluate('EasyCode.app.project.groups.length'),2);
  await click('#ec-sync-notice button'); await until('!!document.getElementById("ec-confirm")','缺少居中的确认弹窗');
  await click('[data-confirm-action="cancel"]');
  assert.equal(await evaluate('EasyCode.app.storage.isDirty()'),true);
  await click('#ec-sync-notice button'); await until('!!document.getElementById("ec-confirm")','未再次确认载入');
  await click('[data-confirm-action="accept"]');
  await until('EasyCode.app.project.name === "冲突中的外部版本" && !EasyCode.app.storage.isDirty()','最新版本未载入');
  assert.equal(await evaluate('EasyCode.app.project.groups.length'),1);
  checks.push('编辑窗口不被打断；冲突保留双方内容；取消/确认载入均正确');

  const valid = await readFile(deployment.projectFile,'utf8');
  await writeFile(deployment.projectFile,'{invalid');
  await until('document.getElementById("ec-sync-notice").textContent.includes("有效的 JSON")','坏 JSON 未提示');
  assert.equal(await evaluate('EasyCode.app.project.name'),'冲突中的外部版本');
  await writeFile(deployment.projectFile,valid);
  await until('document.getElementById("ec-sync-notice").hidden','修正 JSON 后未恢复');
  await closeServer();
  await until('!document.getElementById("ec-sync-notice").hidden','服务停止未提示');
  await click('[data-action="edit-project"]'); await edit('[aria-label="项目中文名"]','断线时的编辑'); await click('#ec-dialog button[type="submit"]');
  running = await startServer({root:deployment.targetRoot,port});
  await until('document.getElementById("ec-sync-notice").hidden','服务恢复后未重连');
  assert.equal(await evaluate('EasyCode.app.project.name'),'断线时的编辑');
  await save(); assert.equal((await readProjectFile(deployment.projectFile)).project.name,'断线时的编辑');
  checks.push('无效 JSON 和断线均保留页面，恢复后可继续保存');

  const imported = await readCase('case-008'), importPath = join(temporary,'import.json');
  await writeFile(importPath,JSON.stringify(imported));
  await command('Page.setInterceptFileChooserDialog',{enabled:true},sessionId);
  await click('[data-action="import"]');
  const documentNode = await command('DOM.getDocument',{},sessionId);
  const {nodeId} = await command('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector:'input[type="file"]'},sessionId);
  await command('DOM.setFileInputFiles',{nodeId,files:[importPath]},sessionId);
  await until(`EasyCode.app.project.id === ${JSON.stringify(imported.id)}`,'JSON 导入失败');
  assert.equal(await evaluate('EasyCode.app.storage.isDirty()'),true);
  assert.equal((await readProjectFile(deployment.projectFile)).project.name,'断线时的编辑');
  await save();
  await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:temporary});
  await click('[data-action="export"]');
  const exportPath = join(temporary,'archify-export.html');
  for (let n=0;n<150;n++) {try {await access(exportPath);break;} catch {await pause(100);}}
  const exported = globalThis.EasyCode.Serialization.readProject(await readFile(exportPath,'utf8'));
  assert.deepEqual(exported,(await readProjectFile(deployment.projectFile)).project);
  checks.push('导入先保留在页面，保存才写文件；导出 HTML 包含完整设计');

  const large = await readCase('case-100'), baseline = await readProjectFile(deployment.projectFile);
  await writeProjectFile(deployment.projectFile,large,{expectedVersion:baseline.version});
  await until('document.querySelectorAll(".module-node").length === 1000','1000 个模块未完整显示',60000);
  assert.equal(await evaluate('EasyCode.app.project.view.scale'),.01);
  checks.push('1000 个模块能从外部 JSON 加载，缩放下限仍为 1%');
  assert.deepEqual(errors,[]);
  const report = {passed:checks.length,checks,browserErrors:errors,temporary};
  await writeFile(new URL('service-browser-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {
  if (socket?.readyState===WebSocket.OPEN) {try {await command('Browser.close');} catch {} socket.close();}
  browser.kill();
  await closeServer();
}
