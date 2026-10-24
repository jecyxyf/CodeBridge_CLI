import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser,createPage} from './helpers/cdp.mjs';

test('变量默认值与页面确认：无缺项提示、居中、Esc、焦点和草稿保留',{
  skip:process.env.EASYCODE_BROWSER_TEST !== '1',timeout:120000
},async t => {
  const {assemble,loadBundle} = await import('../scripts/build.mjs');
  const {Model:M,Serialization:S} = globalThis.EasyCode;
  const project = M.createProject('默认属性测试'); project.description = '验证新增变量和删除确认';
  const module = M.createModule({name:'任务模块',purpose:'管理任务'});
  module.interfaces.push({...M.createInterface(),name:'保存任务',purpose:'保存任务内容'});
  module.structures.push({...M.createStructure(),name:'任务信息'});
  module.events.push({...M.createEvent(),name:'任务完成',description:'发送完成通知'});
  module.tests.push({...M.createTest(),name:'保存检查',steps:'保存任务',expected:'保存成功'});
  project.modules.push(module);
  const output = await mkdtemp(join(tmpdir(),'easycode-dialogs-'));
  t.diagnostic(`Dialog and default-value artifacts: ${output}`);
  const file = join(output,'canvas.html'); await writeFile(file,assemble(project,await loadBundle()));
  const browser = await launchBrowser(); t.after(() => browser.close()); const page = await createPage(browser);
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.confirm = globalThis.alert = globalThis.prompt = () => {throw new Error("Native dialog must not be used");};'});
  await page.navigate(pathToFileURL(file).href);
  const data = 'EasyCode.app.project', moduleDialog = '#ec-dialog';
  const click = label => page.click(`${moduleDialog} button[aria-label="${label}"]`);
  async function expand(selector) {
    const button = `${selector} > .fold-heading .fold-toggle`;
    if (await page.evaluate(`document.querySelector(${JSON.stringify(button)}).getAttribute('aria-expanded') === 'false'`)) await page.click(button);
  }
  async function key(key,code) {
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:code});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:code});
  }
  async function shot(name) {
    const result = await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(output,name),Buffer.from(result.data,'base64'));
  }
  await page.click('.module-node [data-node-action="edit"]');
  for (let i = 0; i < 3; i++) await click('添加参数');
  await expand('#ec-dialog [data-editor-group="methods"]'); await expand('#ec-dialog .interface-editor');
  for (const label of ['添加输入参数','添加返回结果']) for (let i = 0; i < 3; i++) await click(label);
  await expand('#ec-dialog [data-editor-group="events"]'); await expand('#ec-dialog [data-editor-group="events"] .member-editor');
  for (let i = 0; i < 3; i++) await click('添加携带的数据');
  await expand('#ec-dialog [data-editor-group="structures"]'); await expand('#ec-dialog [data-editor-group="structures"] .member-editor');
  for (let i = 0; i < 3; i++) await click('新增字段');
  assert.equal(await page.evaluate('Array.from(document.querySelectorAll(".structure-field-row input")).every(input => input.value.trim())'),true);
  await shot('variable-defaults.png'); await click('确定');
  const saved = await page.evaluate(data), result = M.validate(saved);
  assert.deepEqual(result,{errors:[],warnings:[]});
  assert.equal(await page.evaluate('document.querySelector("#ec-warnings").hidden'),true);
  const m = saved.modules[0];
  for (const items of [m.parameters,m.interfaces[0].inputs,m.interfaces[0].outputs,m.events[0].parameters,m.structures[0].fields]) {
    assert.equal(items.length,3); assert.equal(new Set(items.map(item => item.englishName)).size,3);
    for (const item of items) for (const field of ['name','englishName','type','description']) assert.ok(item[field].trim());
  }
  const html = await page.evaluate('EasyCode.Serialization.buildDocument(JSON.parse(document.getElementById("ec-bundle").textContent),EasyCode.app.project)');
  assert.deepEqual(S.readProject(html),saved);

  await page.click('.module-node [data-node-action="edit"]');
  await expand('#ec-dialog [data-editor-group="basics"]');
  await page.fill('#ec-dialog [aria-label="模块中文名"]','尚未确定的草稿');
  for (const width of [1440,390]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await click('删除模块');
    assert.equal(await page.evaluate('document.querySelector("#ec-confirm").getAttribute("role")'),'alertdialog');
    assert.equal(await page.evaluate('document.activeElement.dataset.confirmAction'),'cancel','cancel is initially focused');
    assert.equal(await page.evaluate(`(() => {const r=document.querySelector('#ec-confirm').getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2)<1 && Math.abs(r.top+r.height/2-innerHeight/2)<1 && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight;})()`),true);
    await key('Tab',9); assert.equal(await page.evaluate('document.querySelector("#ec-confirm").contains(document.activeElement)'),true);
    await shot(`delete-confirm-${width}.png`);
    if (width === 1440) {await key('Escape',27); await page.waitFor('!document.querySelector("#ec-confirm")');}
    else await page.click('#ec-confirm [data-confirm-action="cancel"]');
    assert.equal(await page.evaluate('document.querySelector("#ec-dialog").open'),true);
    assert.equal(await page.evaluate('document.activeElement.getAttribute("aria-label")'),'删除模块');
    assert.equal(await page.evaluate('document.querySelector("[aria-label=模块中文名]").value'),'尚未确定的草稿');
    assert.deepEqual(await page.evaluate(data),saved);
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await click('取消');
  for (const [group,label] of [['events','事件'],['tests','测试项']]) {
    await page.click('.module-node [data-node-action="edit"]'); await expand(`#ec-dialog [data-editor-group="${group}"]`);
    await click(`删除${label}`); await page.click('#ec-confirm [data-confirm-action="accept"]');
    assert.equal(await page.evaluate(`document.querySelectorAll('#ec-dialog [data-editor-group="${group}"] .member-editor').length`),0);
    await click('取消'); assert.deepEqual(await page.evaluate(data),saved);
  }
  await page.click('[data-action="add-group"]');
  assert.equal(await page.evaluate('document.querySelector("#ec-dialog form").noValidate'),true);
  await click('确定'); assert.match(await page.evaluate('document.querySelector(".dialog-error").textContent'),/分组名称/);
  assert.equal(await page.evaluate('document.querySelector("#ec-dialog").open'),true);
  await page.fill('#ec-dialog [aria-label="层级中文名"]','测试层级'); await click('确定');
  await page.click('[data-action="fit"]');
  await page.click('.group-header [aria-label="编辑分组"]'); await click('删除层级'); await page.click('#ec-confirm [data-confirm-action="cancel"]');
  assert.equal(await page.evaluate(`${data}.groups.length`),1);
  await click('删除层级'); await page.click('#ec-confirm [data-confirm-action="accept"]');
  assert.equal(await page.evaluate(`${data}.groups.length`),0); assert.equal(await page.evaluate(`${data}.modules.length`),1);
  assert.deepEqual(page.pageErrors,[]); assert.deepEqual(page.consoleErrors,[]); assert.deepEqual(page.protocolErrors,[]);
  assert.equal(page.networkRequests.length,0);
});
