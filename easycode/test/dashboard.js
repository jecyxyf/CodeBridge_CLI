(function () {
  'use strict';
  const get=id=>document.getElementById(id), delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let manifest=[],selected=null,frame=null,running=false,stopping=false,task=null,ready=false,results=[];
  const ms=value=>Number.isFinite(value) ? `${Math.round(value)} ms` : '—';
  const instrument=html=>html.replace('<head>','<head><script src="/probe.js"></script>');
  function status(text,error=false) {get('status').textContent=text;get('status').classList.toggle('status-error',error);}
  function select(spec) {
    selected=spec;get('case-title').textContent=spec.name;get('json-link').href=spec.json;get('page-link').href=spec.page;
    for(const button of get('case-list').querySelectorAll('button'))button.classList.toggle('active',button.dataset.caseId===spec.id);
  }
  function paintCases() {
    const search=get('search').value.trim().toLowerCase(),category=get('category').value;
    get('case-list').replaceChildren();
    for(const spec of manifest.filter(item=>(!category || item.category===category) && `${item.id} ${item.name}`.toLowerCase().includes(search))) {
      const button=document.createElement('button');button.className='case-button';button.dataset.caseId=spec.id;button.disabled=running;button.textContent=spec.name;
      const result=results.find(row=>row.id===spec.id);if(result)button.dataset.result=result.ok ? 'passed' : 'failed';
      const small=document.createElement('small');small.textContent=`${spec.modules} 模块　${spec.groups} 层级　${spec.relations} 连线`;button.append(small);
      button.classList.toggle('active',selected?.id===spec.id);button.addEventListener('click',()=>preview(spec).catch(error=>status(error.message,true)));get('case-list').append(button);
    }
  }
  async function loadFrame({url,html}) {
    const next=document.createElement('iframe');next.title='架构编辑器测试预览';
    if(html) next.srcdoc=instrument(html);else next.src=url;
    frame=next;get('viewer').replaceChildren(next);
    const deadline=performance.now()+60000;
    while(performance.now()<deadline) {
      if(next!==frame)throw new Error('当前测试已被新的预览替换');
      if(next.contentWindow?.__stabilityProbe?.ready)return next.contentWindow;
      await delay(40);
    }
    throw new Error('页面 60 秒内没有完成加载');
  }
  async function preview(spec) {
    if(running)return;select(spec);status(`正在加载 ${spec.id}…`);
    const win=await loadFrame({url:spec.page});
    const check=await win.__stabilityProbe.check({save:false,details:false});
    status(`已加载 ${spec.id}`);get('metrics').textContent=`${spec.modules} 模块，加载 ${ms(check.loadMs)}`;
  }
  function paintResults() {
    get('results').replaceChildren();
    for(const result of results) {
      const row=document.createElement('tr');
      for(const value of [result.id,result.modules,result.relations,ms(result.loadMs),ms(result.saveMs),ms(result.reopenMs),result.ok ? '通过' : result.error]) {
        const cell=document.createElement('td');cell.textContent=String(value);row.append(cell);
      }
      row.lastElementChild.className=result.ok ? 'pass' : 'fail';row.lastElementChild.title=result.error || '通过';get('results').append(row);
    }
  }
  async function testOne(spec) {
    select(spec);let initial;
    try {
      const win=await loadFrame({url:spec.page});initial=await win.__stabilityProbe.check();
      const savedData=win.EasyCode.Serialization.readProject(initial.savedHTML);
      const reopened=await loadFrame({html:initial.savedHTML});
      const second=await reopened.__stabilityProbe.check({save:false});
      if(JSON.stringify(reopened.EasyCode.Serialization.readProject(reopened.document.documentElement.outerHTML))!==JSON.stringify(savedData))throw new Error('保存后重新加载的数据不一致');
      return {id:spec.id,category:spec.category,modules:spec.modules,relations:spec.relations,bytes:spec.bytes,ok:true,loadMs:initial.loadMs,saveMs:initial.saveMs,reopenMs:second.loadMs,checkMs:initial.checkMs,heapBytes:second.heapBytes,visibleModules:initial.visibleModules,visibleGroups:initial.visibleGroups};
    } catch(error) {return {id:spec.id,category:spec.category,modules:spec.modules,relations:spec.relations,bytes:spec.bytes,ok:false,error:error.message,loadMs:initial?.loadMs ?? null};}
  }
  function run(specs) {
    if(task)return task;
    task=(async()=>{
      running=true;stopping=false;results=[];document.body.classList.add('busy');
      get('run-all').disabled=get('run-current').disabled=true;get('stop').disabled=false;get('progress').max=specs.length;get('progress').value=0;paintCases();
      const startedAt=new Date().toISOString(),before=performance.now();
      try {
        for(const [index,spec] of specs.entries()) {
          if(stopping)break;
          status(`正在测试 ${index+1}/${specs.length}：${spec.name}`);
          results.push(await testOne(spec));get('progress').value=results.length;paintResults();paintCases();
          get('metrics').textContent=`通过 ${results.filter(row=>row.ok).length}，失败 ${results.filter(row=>!row.ok).length}`;
          await delay(0);
        }
        const loads=results.filter(row=>row.ok).map(row=>row.loadMs).sort((a,b)=>a-b),passed=results.filter(row=>row.ok).length;
        const report={startedAt,finishedAt:new Date().toISOString(),status:stopping ? '已停止' : '已完成',durationMs:performance.now()-before,requested:specs.length,browser:navigator.userAgent,logicalProcessors:navigator.hardwareConcurrency,saveMethod:'内存文件句柄，未操作原生文件选择窗口',summary:{completed:results.length,passed,failed:results.length-passed,p95LoadMs:loads[Math.max(0,Math.ceil(loads.length*.95)-1)] ?? null,maxLoadMs:loads.at(-1) ?? null},results};
        const response=await fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
        if(!response.ok)throw new Error('测试已结束，但报告保存失败');
        get('report-time').textContent=`${passed}/${results.length} 通过；报告已保存：${new Date(report.finishedAt).toLocaleString()}`;
        status(`${report.status}：${passed} 份通过，${results.length-passed} 份失败`,passed!==results.length);
        get('metrics').textContent=`加载 P95 ${ms(report.summary.p95LoadMs)}，最慢 ${ms(report.summary.maxLoadMs)}`;
        return report;
      } finally {running=false;task=null;document.body.classList.remove('busy');get('run-all').disabled=get('run-current').disabled=false;get('stop').disabled=true;paintCases();}
    })();
    return task;
  }
  get('search').addEventListener('input',paintCases);get('category').addEventListener('change',paintCases);
  get('run-all').addEventListener('click',()=>run(manifest).catch(error=>status(error.message,true)));
  get('run-current').addEventListener('click',()=>selected && run([selected]).catch(error=>status(error.message,true)));
  get('stop').addEventListener('click',()=>{stopping=true;status('正在结束当前测试…');});
  window.stability={getState:()=>({ready,running,stopping,completed:results.length,passed:results.filter(row=>row.ok).length,failed:results.filter(row=>!row.ok).length,current:selected?.id,results}),runAll:()=>run(manifest),runCurrent:()=>run([selected]),preview:id=>preview(manifest.find(spec=>spec.id===id)),stop:()=>{stopping=true;}};
  (async()=>{
    const response=await fetch('/api/cases');if(!response.ok)throw new Error('无法读取测试数据清单');manifest=await response.json();
    for(const category of new Set(manifest.map(spec=>spec.category))) {const option=document.createElement('option');option.value=option.textContent=category;get('category').append(option);}
    paintCases();await preview(manifest[0]);
    const previous=await (await fetch('/api/report')).json();
    if(previous.results?.length){
      results=previous.results;paintResults();paintCases();
      const passed=results.filter(row=>row.ok).length;
      get('report-time').textContent=`${passed}/${results.length} 通过；上次报告：${new Date(previous.finishedAt).toLocaleString()}`;
      get('progress').max=previous.requested || 100;get('progress').value=results.length;
      status(`上次测试：${passed} 份通过，${results.length-passed} 份失败`,passed!==results.length);
      get('metrics').textContent=`加载 P95 ${ms(previous.summary?.p95LoadMs)}，最慢 ${ms(previous.summary?.maxLoadMs)}`;
    }
    ready=true;
  })().catch(error=>status(error.message,true));
})();
