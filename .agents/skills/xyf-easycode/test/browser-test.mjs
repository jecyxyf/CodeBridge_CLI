import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,readdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cases,makeProject,readCase,root} from './fixtures.mjs';
import {assemble,loadBundle} from '../subskills/xyf-archify/tools/html/scripts/build.mjs';
import {checkViewport} from './viewport-checks.mjs';

const base=process.argv[2] || 'http://127.0.0.1:4174';
const M=globalThis.EasyCode.Model,S=globalThis.EasyCode.Serialization,bundle=await loadBundle();
const files=(await readdir(new URL('json/',root))).filter(name=>name.endsWith('.json'));
assert.equal(files.length,100,'测试目录中应恰有 100 份 JSON');
const hashes=[];
for(const spec of cases) {
  const project=await readCase(spec.id);
  assert.deepEqual(M.validate(project),{errors:[],warnings:[]},spec.id);
  assert.deepEqual(project,makeProject(spec),`${spec.id} 固定种子不可复现`);
  assert.deepEqual(S.readProject(assemble(project,bundle)),project,`${spec.id} 生成和提取不一致`);
  hashes.push({id:spec.id,sha256:createHash('sha256').update(JSON.stringify(project)).digest('hex')});
}
for(const kind of ['重复标识','失效分层','无效连接点']) {
  const project=makeProject(cases[15]);
  if(kind==='重复标识')project.modules[1].id=project.modules[0].id;
  if(kind==='失效分层')project.modules[0].groupId='group-missing';
  if(kind==='无效连接点')project.relations[0].fromPort='diagonal';
  assert.ok(M.validate(project).errors.length,kind+' 未被拒绝');
  assert.throws(()=>assemble(project,bundle),undefined,kind+' 生成未被阻止');
}
console.log('DATA: 100/100 校验、固定种子复现、HTML 往返通过；3 类坏数据被拒绝。');
assert.equal((await (await fetch(base+'/health')).json()).cases,100,'请先启动 server.mjs');
const candidates=[process.env.EASYCODE_TEST_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;
for(const candidate of candidates){try{await access(candidate);executable=candidate;break;}catch{}}
if(!executable)throw new Error('没有找到 Chrome 或 Edge，可通过 EASYCODE_TEST_BROWSER 指定浏览器路径。');
const profile=await mkdtemp(join(tmpdir(),'easycode-stability-browser-'));
const browser=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--window-size=1600,1100','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
let socket,sequence=0,sessionId;
const pending=new Map(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),browserErrors=[];
function command(method,params={},session) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('浏览器响应超时：'+method));},120000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    socket.send(JSON.stringify({id,method,params,...session ? {sessionId:session} : {}}));
  });
}
async function evaluate(expression) {
  const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
try {
  let port;
  for(let n=0;n<200;n++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(50);}}
  assert.ok(port,'浏览器没有完成启动');
  const version=await (await fetch('http://127.0.0.1:'+port+'/json/version')).json();
  socket=new WebSocket(version.webSocketDebuggerUrl);
  socket.onmessage=event=>{
    const data=JSON.parse(event.data),item=pending.get(data.id);
    if(item){pending.delete(data.id);data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result);}
    if(data.method==='Runtime.exceptionThrown')browserErrors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    if(data.method==='Page.javascriptDialogOpening')command('Page.handleJavaScriptDialog',{accept:true},data.sessionId).catch(()=>{});
  };
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  const {targetId}=await command('Target.createTarget',{url:base});
  ({sessionId}=await command('Target.attachToTarget',{targetId,flatten:true}));
  await command('Runtime.enable',{},sessionId);await command('Page.enable',{},sessionId);
  let initialized=false;
  for(let n=0;n<300;n++){if(await evaluate('Boolean(window.stability?.getState().ready)')){initialized=true;break;}await pause(100);}
  assert.ok(initialized,'测试网页没有初始化：'+await evaluate('document.getElementById("status")?.textContent'));
  await evaluate('void window.stability.runAll().then(value=>window.__automationReport=value,error=>window.__automationFailure=error.stack || String(error))');
  const deadline=Date.now()+20*60*1000;let previous=-1,report;
  while(Date.now()<deadline) {
    const state=await evaluate('({state:window.stability.getState(),finished:!!window.__automationReport,failure:window.__automationFailure})');
    if(state.failure)throw new Error(state.failure);
    if(state.state.completed!==previous){previous=state.state.completed;console.log(`BROWSER: ${previous}/100，通过 ${state.state.passed}，失败 ${state.state.failed}，当前 ${state.state.current}`);}
    if(state.finished){report=await evaluate('window.__automationReport');break;}
    await pause(1000);
  }
  assert.ok(report,'浏览器批量测试超过 20 分钟');
  const viewportChecks=await checkViewport(evaluate);
  report.verification={dataCases:100,reproducible:true,invalidCasesRejected:3,fixtureHashes:hashes,browserErrors,viewportChecks};
  await writeFile(new URL('report.json',root),JSON.stringify(report,null,2)+'\n','utf8');
  await evaluate('window.stability.preview("case-016")');
  const screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
  const screenshotPath=join(profile,'dashboard.png');await writeFile(screenshotPath,Buffer.from(screenshot.data,'base64'));
  console.log('SCREENSHOT: '+screenshotPath);
  console.log('SUMMARY: '+JSON.stringify(report.summary));
  console.log('PRESSURE: '+JSON.stringify(report.results.filter(row=>row.category==='规模压力').map(({modules,relations,loadMs,saveMs,reopenMs,ok,error})=>({modules,relations,loadMs,saveMs,reopenMs,ok,error}))));
  assert.equal(report.summary.completed,100);assert.equal(report.summary.failed,0);assert.deepEqual(browserErrors,[]);
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await command('Browser.close');}catch{}socket.close();}
  browser.kill();
}
