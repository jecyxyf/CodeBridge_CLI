import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser,createPage} from './helpers/cdp.mjs';

test('模块卡片：紧凑分组、点击只读详情、外观草稿与保存重开',{
  skip:process.env.EASYCODE_BROWSER_TEST !== '1',timeout:120000
},async t => {
  const {assemble,loadBundle} = await import('../scripts/build.mjs');
  const {Model:M,Serialization:S} = globalThis.EasyCode;
  const project = M.createProject('模块卡片预览');
  const full = M.createModule({name:'任务管理',purpose:'管理任务的创建、保存和完成状态。',x:20,y:20});
  const empty = M.createModule({name:'空模块',purpose:'  ',x:650,y:20});
  const blankParameter = {...M.createParameter(),name:'',englishName:'',type:'',description:'',defaultValue:''};
  full.englishName = 'HiddenModuleEnglish'; full.language = 'TypeScript'; full.codeLocation = './src/task-manager.ts';
  full.requirements = ['保存前检查任务名称','完成后通知订阅者\n通知中带上任务编号','  '];
  full.parameters = [{...M.createParameter(),name:'最大任务数',englishName:'HiddenParameterEnglish',type:'number',description:'允许保存的任务数量',defaultValue:'0'},blankParameter];
  full.interfaces.push({...M.createInterface(),name:'保存任务',englishName:'HiddenMethodEnglish',purpose:'检查任务内容并写入存储。',flow:'检查名称\n写入任务\n发出通知',errors:'写入失败时返回错误原因',
    inputs:[{...M.createParameter(),name:'任务名称',englishName:'HiddenInputEnglish',type:'string',description:'要保存的任务名称',required:true},
      {...M.createParameter(),name:'优先级',englishName:'priority',type:'number',description:'决定任务的执行顺序\n同级任务按创建时间排序',required:false}],
    outputs:[{...M.createParameter(),name:'保存结果',englishName:'HiddenOutputEnglish',type:'boolean',description:'是否保存成功',defaultValue:'false'}]});
  full.events.push({...M.createEvent(),name:'任务已保存',englishName:'HiddenEventEnglish',description:'通知任务已完成保存',trigger:'写入成功后',
    parameters:[{...M.createParameter(),name:'任务编号',englishName:'HiddenPayloadEnglish',type:'string',description:'已保存任务的唯一编号'},
      {...M.createParameter(),name:'保存时间',englishName:'savedAt',type:'string',description:'记录保存完成的时间\n用于显示最近更新时间'}]});
  full.interfaces.push({...M.createInterface(),name:'读取任务',purpose:'读取当前任务列表'});
  full.events.push({...M.createEvent(),name:'清理完毕',description:'通知清理已完成'});
  full.structures.push({...M.createStructure(),name:'不应显示的数据结构'});
  full.tests.push({...M.createTest(),name:'不应显示的测试项'});
  full.unknowns.push('不应显示的待确认事项'); full.sources.push({path:'hidden-evidence.ts'});
  empty.requirements = ['','  ']; empty.parameters = [{...blankParameter,id:'blank-parameter'}];
  empty.interfaces.push({...M.createInterface(),name:'',englishName:'',purpose:''});
  empty.events.push({...M.createEvent(),name:'',englishName:'',description:''});
  empty.structures.push({...M.createStructure(),name:'仅配置显示的结构'});
  project.groups.push({id:'group-test',name:'不应显示的层级',color:'#ffffff',backgroundColor:'#81b3e9',x:0,y:0});
  full.groupId = 'group-test'; project.modules.push(full,empty); project.view = {...project.view,x:16,y:16};
  M.addRelation(project,{from:full.id,to:empty.id,fromPort:'bottom',toPort:'bottom'});
  const output = await mkdtemp(join(tmpdir(),'easycode-cards-')), file = join(output,'canvas.html');
  t.diagnostic(`Read-only module cards: ${output}`); await writeFile(file,assemble(project,await loadBundle()));
  const browser = await launchBrowser(); t.after(() => browser.close()); const page = await createPage(browser);
  await page.send('Emulation.setDeviceMetricsOverride',{width:1300,height:1300,deviceScaleFactor:1,mobile:false});
  await page.navigate(pathToFileURL(file).href);
  const card = `.module-node[data-module-id="${full.id}"]`, blank = `.module-node[data-module-id="${empty.id}"]`;
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('${card} [data-module-group]'),node => node.dataset.moduleGroup)`),['basics','requirements','parameters','methods','events']);
  assert.equal(await page.evaluate(`document.querySelectorAll('${blank} [data-module-group]').length`),0);
  assert.equal(await page.evaluate(`document.querySelector('${blank} .module-language').hidden`),true);
  assert.equal(await page.evaluate(`document.querySelector('${card} .module-language').textContent`),'TypeScript');
  const text = await page.evaluate(`document.querySelector('${card}').textContent`);
  for (const value of ['模块信息','功能需求','参数','方法','消息事件','保存任务','任务已保存','允许保存的任务数量']) assert.ok(text.includes(value),value);
  assert.doesNotMatch(text,/Hidden\w*English|不应显示|所属层级|保存结果|携带参数|输入参数|输出参数|hidden-evidence|默认值|实现流程|触发条件/);
  assert.equal(await page.evaluate('document.querySelectorAll(".module-content input,.module-content textarea,.module-content select,.module-content button,.module-content [contenteditable],.module-content details,.module-content summary").length'),0);
  assert.equal(await page.evaluate(`document.querySelector('${card}').offsetWidth`),480);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${card}')).getPropertyValue('--node').trim()`),'#fcfdff');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${card} .module-language')).fontSize !== getComputedStyle(document.querySelector('${card} .module-name')).fontSize`),true);
  assert.equal(await page.evaluate(`document.querySelectorAll('${card} .module-requirements li').length`),2);
  assert.equal(await page.evaluate(`document.querySelectorAll('${card} [data-module-group=parameters] > .module-parameter-list > .module-member').length`),1);
  assert.equal(await page.evaluate(`(() => {const b=document.querySelector('${card} [data-node-action=edit]').getBoundingClientRect(),l=document.querySelector('${card} .module-language').getBoundingClientRect();return l.right <= b.left;})()`),true);
  await page.click('#ec-warning-close');
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('${card} [data-module-group]'),node => node.dataset.itemCount)`),['2','2','1','2','2']);
  assert.equal(await page.evaluate(`document.querySelector('${card} .module-type-label').textContent`),'num');
  assert.equal(await page.evaluate(`document.querySelector('${card} [data-module-group=parameters] .module-member').dataset.valueKind`),'number');
  assert.equal(await page.evaluate(`document.querySelector('${card} .module-shell').contains(document.querySelector('${card} [data-port]'))`),false,'connection ports stay outside the clipped shell');
  const before = await page.evaluate('EasyCode.app.project');
  const method = `${card} [data-method-id="${full.interfaces[0].id}"]`, event = `${card} [data-event-id="${full.events[0].id}"]`;
  const geometry = `({height:document.querySelector('${card}').offsetHeight,path:document.querySelector('.relation-line').getAttribute('d')})`;
  const shape = await page.evaluate(geometry);
  await page.evaluate(`document.querySelector('${method}').dispatchEvent(new PointerEvent('pointerenter'))`);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),true,'hover does not open details');
  await page.evaluate(`document.querySelector('${method}').dispatchEvent(new MouseEvent('click',{button:2}))`);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),true,'right click does not open details');
  await page.click(method);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),false);
  assert.equal(await page.evaluate('document.querySelector(".module-preview-title").textContent'),'保存任务');
  assert.equal(await page.evaluate('document.querySelector(".module-preview-description").textContent'),'检查任务内容并写入存储。');
  assert.equal(await page.evaluate('document.querySelector(".module-preview-content").children.length'),4);
  assert.equal(await page.evaluate('document.querySelector(".module-preview-signature").textContent'),'boolean HiddenMethodEnglish(HiddenInputEnglish, priority)');
  assert.deepEqual(await page.evaluate('Array.from(document.querySelectorAll(".module-preview-parameter"),row => [row.querySelector("dt code").textContent,row.querySelector("dd").textContent])'),[
    ['HiddenInputEnglish','要保存的任务名称'],['priority','决定任务的执行顺序\n同级任务按创建时间排序']
  ]);
  assert.doesNotMatch(await page.evaluate('document.querySelector(".module-preview").textContent'),/保存结果|输入参数|输出参数/);
  assert.equal(await page.evaluate(`document.querySelector('${method}').getAttribute('aria-expanded')`),'true');
  await page.evaluate(`document.querySelector('${method}').dispatchEvent(new PointerEvent('pointerleave'))`);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),false,'leaving the row keeps click details open');
  await page.click(method);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),true,'same row toggles closed');
  await page.click(`${card} [data-method-id="${full.interfaces[1].id}"]`);
  assert.equal(await page.evaluate('document.querySelector(".module-preview-parameters")'),null,'no parameter section for methods without inputs');
  await page.click(event);
  assert.equal(await page.evaluate('document.querySelector(".module-preview-title").textContent'),'任务已保存');
  assert.equal(await page.evaluate('document.querySelector(".module-preview-description").textContent'),'通知任务已完成保存');
  assert.equal(await page.evaluate('document.querySelector(".module-preview-signature")'),null,'messages have no method signature');
  assert.deepEqual(await page.evaluate('Array.from(document.querySelectorAll(".module-preview-parameter"),row => [row.querySelector("dt code").textContent,row.querySelector("dd").textContent])'),[
    ['HiddenPayloadEnglish','已保存任务的唯一编号'],['savedAt','记录保存完成的时间\n用于显示最近更新时间']
  ]);
  await page.click(`${card} [data-event-id="${full.events[1].id}"]`);
  assert.equal(await page.evaluate('document.querySelector(".module-preview-parameters")'),null,'events without payloads omit the parameter list');
  await page.click(`${card} .module-group-title`);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),true,'outside click closes details');
  await page.evaluate(`document.querySelector('${method}').focus()`);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),true,'focus alone does not open');
  async function key(key,code,windowsVirtualKeyCode) {
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});
  }
  await key('Enter','Enter',13);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),false);
  await key('Escape','Escape',27);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),true);
  assert.deepEqual(await page.evaluate(geometry),shape,'reading never resizes cards or moves edges');
  assert.deepEqual(await page.evaluate('EasyCode.app.project'),before);
  assert.equal(await page.evaluate('EasyCode.app.storage.isDirty()'),false);
  const appearance = '#ec-dialog [data-editor-group="appearance"]';
  await page.click(method); await page.click(`${card} [data-node-action="edit"]`);
  assert.equal(await page.evaluate('document.querySelector("#ec-dialog [aria-label=触发条件]")'),null,'event settings omit the trigger input');
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),true);
  assert.equal(await page.evaluate('document.querySelector(".module-editor > [data-editor-group]").dataset.editorGroup'),'appearance');
  assert.equal(await page.evaluate(`document.querySelector('${appearance} .fold-toggle').getAttribute('aria-expanded')`),'false');
  await page.click(`${appearance} > .fold-heading .fold-toggle`);
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('${appearance} input[type=color]'),node => node.getAttribute('aria-label'))`),['字体颜色','背景颜色','标题栏颜色']);
  async function colors() {
    await page.evaluate(`(() => {for (const [label,value] of [['字体颜色','#ddeeff'],['背景颜色','#253344'],['标题栏颜色','#172635']]) {const input=document.querySelector('#ec-dialog [aria-label="'+label+'"]'); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  }
  await colors(); assert.deepEqual(await page.evaluate('EasyCode.app.project'),before);
  await page.click('#ec-dialog [aria-label="取消"]'); assert.deepEqual(await page.evaluate('EasyCode.app.project'),before);
  await page.click(`${card} [data-node-action="edit"]`); await page.click(`${appearance} > .fold-heading .fold-toggle`); await colors();
  await page.click('#ec-dialog [data-editor-group="basics"] > .fold-heading .fold-toggle');
  const longText = '多行功能说明\n' + '这是一段很长的模块功能描述'.repeat(100) + '\n<script>globalThis.__cardInjected = true</script>';
  await page.fill('#ec-dialog [aria-label="模块功能"]',longText);
  await page.fill('#ec-dialog [aria-label="编程语言"]','');
  await page.click('#ec-dialog [aria-label="确定"]');
  await page.waitFor(`document.querySelector('${card} .module-language').hidden`);
  assert.equal(await page.evaluate('globalThis.__cardInjected === undefined'),true);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${card}')).getPropertyValue('--node').trim()`),'#253344');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${card} [data-node-action=edit] .icon')).color`),'rgb(221, 238, 255)');
  await page.click(`${card} .module-purpose`);
  assert.equal(await page.evaluate('document.querySelector(".module-preview-description").textContent'),longText);
  assert.equal(await page.evaluate('globalThis.__cardInjected === undefined'),true);
  const withinViewport = `(() => {const p=document.querySelector('.module-preview').getBoundingClientRect(),v=document.querySelector('#ec-viewport').getBoundingClientRect();return p.left>=v.left && p.right<=v.right && p.top>=v.top && p.bottom<=v.bottom;})()`;
  assert.equal(await page.evaluate(withinViewport),true);
  assert.deepEqual(await page.evaluate('EasyCode.app.project.modules[0].structures'),full.structures);
  assert.deepEqual(await page.evaluate('EasyCode.app.project.modules[0].tests'),full.tests);
  assert.deepEqual(await page.evaluate('EasyCode.app.project.modules[0].interfaces'),full.interfaces);
  assert.deepEqual(await page.evaluate('EasyCode.app.project.modules[0].events'),full.events);
  const html = await page.evaluate('EasyCode.Serialization.buildDocument(JSON.parse(document.getElementById("ec-bundle").textContent),EasyCode.app.project)');
  const saved = await page.evaluate('EasyCode.app.project'); assert.deepEqual(S.readProject(html),saved);
  const reopened = join(output,'reopened.html'); await writeFile(reopened,html); await page.navigate(pathToFileURL(reopened).href);
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('${card} [data-module-group]'),node => node.dataset.moduleGroup)`),['basics','requirements','parameters','methods','events']);
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),true);
  assert.equal(await page.evaluate('globalThis.__cardInjected === undefined'),true);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${card}')).getPropertyValue('--node').trim()`),'#253344');
  await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await page.click('[data-action="fit"]');
  assert.equal(await page.evaluate(`(() => {const r=document.querySelector('${card}').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;})()`),true);
  await page.click(`${card} .module-purpose`); assert.equal(await page.evaluate(withinViewport),true);
  await page.click('[data-action="zoom-in"]');
  assert.equal(await page.evaluate('document.querySelector(".module-preview").hidden'),true);
  assert.deepEqual(page.pageErrors,[]); assert.deepEqual(page.consoleErrors,[]); assert.deepEqual(page.protocolErrors,[]);
  assert.equal(page.networkRequests.length,0);
});
