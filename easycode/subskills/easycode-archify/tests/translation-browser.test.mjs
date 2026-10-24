import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser,createPage} from './helpers/cdp.mjs';

test('翻译按钮：草稿、格式、失败、过期响应、取消和保存重开',{
  skip:process.env.EASYCODE_BROWSER_TEST !== '1',timeout:120000
},async t => {
  const {assemble,loadBundle} = await import('../scripts/build.mjs');
  const {Model:M,Serialization:S} = globalThis.EasyCode;
  const project = M.createProject('名称测试'), module = M.createModule({name:'保存任务'});
  module.englishName = 'OriginalModule'; project.modules = [module];
  const output = await mkdtemp(join(tmpdir(),'easycode-translation-'));
  t.diagnostic(`Translation UI artifacts: ${output}; translation responses are mocked.`);
  const file = join(output,'canvas.html'); await writeFile(file,assemble(project,await loadBundle()));
  const browser = await launchBrowser(); t.after(() => browser.close()); const page = await createPage(browser);
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    globalThis.__translation = {mode:'success',calls:[],pending:[]};
    globalThis.fetch = async (url,options) => {
      __translation.calls.push({url,credentials:options.credentials});
      const result = text => ({ok:true,status:200,json:async () => ({responseStatus:200,responseData:{translatedText:text}})});
      if (__translation.mode === 'delayed') return new Promise(resolve => __translation.pending.push(text => resolve(result(text))));
      if (__translation.mode === 'network') throw new TypeError('Failed to fetch');
      if (__translation.mode === 'chinese') return result('保存任务');
      if (__translation.mode === 'quota') return {ok:true,status:200,json:async () => ({responseStatus:429,quotaFinished:true})};
      return result({'任务管理器':'Task Manager','数据层':'Data layer','保存成功':'Save success'}[new URL(url).searchParams.get('q')] || 'Save task');
    };`});
  await page.navigate(pathToFileURL(file).href);
  const data = 'EasyCode.app.project', openModule = () => page.click('.module-node [data-node-action="edit"]');
  const fill = (label,value) => page.fill(`#ec-dialog [aria-label="${label}"]`,value);
  const click = label => page.click(`#ec-dialog button[aria-label="${label}"]`);
  const value = label => page.evaluate(`document.querySelector('#ec-dialog [aria-label="${label}"]').value`);
  const waitValue = (label,expected) => page.waitFor(`document.querySelector('#ec-dialog [aria-label="${label}"]').value === ${JSON.stringify(expected)}`);
  const mode = async name => page.evaluate(`__translation.mode = ${JSON.stringify(name)}; EasyCode.Translation.translate = EasyCode.Translation.createClient();`);
  assert.equal(await page.evaluate('__translation.calls.length'),0,'no requests on open');
  const before = await page.evaluate(data);
  await openModule(); await click('翻译模块英文名'); await waitValue('模块英文名','SaveTask');
  assert.equal(await page.evaluate('document.querySelector(".module-dialog-name").textContent'),'保存任务 / SaveTask','translation also refreshes the dialog title');
  assert.deepEqual(await page.evaluate(data),before,'translation is a draft');
  assert.equal(await page.evaluate('EasyCode.app.dialogs.hasDraftChanges()'),true);
  await click('取消'); assert.deepEqual(await page.evaluate(data),before);
  await openModule(); await click('翻译模块英文名'); await waitValue('模块英文名','SaveTask');
  assert.equal(await page.evaluate('__translation.calls.length'),1,'session cache avoids duplicate requests');
  await click('确定');
  assert.equal(await page.evaluate(`${data}.modules[0].englishName`),'SaveTask');
  assert.equal(await page.evaluate('document.querySelector(".module-name").title'),'保存任务');
  assert.equal(await page.evaluate('document.querySelector(".module-name").textContent'),'保存任务');

  await page.click('.project-heading'); await fill('项目中文名','任务管理器');
  await click('翻译项目英文名'); await waitValue('项目英文名','task-manager'); await click('确定');
  assert.equal(await page.evaluate(`${data}.englishName`),'task-manager');
  await page.click('[data-action="add-group"]'); await fill('层级中文名','数据层');
  await click('翻译层级英文名'); await waitValue('层级英文名','DataLayer'); await click('确定');
  assert.equal(await page.evaluate(`${data}.groups[0].englishName`),'DataLayer');

  await openModule(); await click('添加测试项'); await fill('测试项中文名','保存成功');
  await click('翻译测试项英文名'); await waitValue('测试项英文名','saveSuccess');
  await click('添加方法'); await fill('方法中文名','保存任务'); await click('翻译方法英文名'); await waitValue('方法英文名','saveTask');
  await click('确定');
  assert.equal(await page.evaluate(`${data}.modules[0].tests[0].englishName`),'saveSuccess');
  assert.equal(await page.evaluate(`${data}.modules[0].interfaces[0].englishName`),'saveTask');

  for (const [name,message] of [['network','网络'],['chinese','英文'],['quota','额度']]) {
    await mode(name); await openModule(); await fill('模块英文名','keepManual'); await click('翻译模块英文名');
    await page.waitFor(`Array.from(document.querySelectorAll('.translation-message')).some(node => node.textContent.includes('${message}'))`);
    assert.equal(await value('模块英文名'),'keepManual','failure preserves the existing value'); await click('取消');
  }
  await mode('delayed'); await openModule(); await click('翻译模块英文名');
  await fill('模块英文名','manualChoice');
  await page.evaluate('__translation.pending.shift()("Old translation")');
  assert.equal(await value('模块英文名'),'manualChoice','late response cannot overwrite typing');
  await click('翻译模块英文名'); await fill('模块中文名','新名称'); await fill('模块中文名','保存任务');
  await page.evaluate('__translation.pending.shift()("Old translation")');
  assert.equal(await value('模块英文名'),'manualChoice','editing Chinese and reverting still invalidates the request');
  await click('翻译模块英文名'); await click('取消'); const beforeLate = await page.evaluate(data);
  await openModule(); await page.evaluate('__translation.pending.shift()("Old translation")');
  assert.equal(await value('模块英文名'),'SaveTask','reopened dialog ignores an old response');
  assert.equal(await page.evaluate('EasyCode.app.dialogs.hasDraftChanges()'),false);
  await click('取消'); assert.deepEqual(await page.evaluate(data),beforeLate);

  // The same serializer used by Save must retain all confirmed names on reopen.
  const saved = await page.evaluate('EasyCode.Serialization.buildDocument(JSON.parse(document.getElementById("ec-bundle").textContent),EasyCode.app.project)');
  assert.deepEqual(S.readProject(saved),await page.evaluate(data));
  const reopened = join(output,'reopened.html'); await writeFile(reopened,saved);
  await page.navigate(pathToFileURL(reopened).href);
  await openModule(); assert.equal(await value('模块英文名'),'SaveTask');
  await page.send('Emulation.setDeviceMetricsOverride',{width:520,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('.translation-control')).filter(node => node.getClientRects().length && !node.closest('[hidden]')).every(node => {const input=node.querySelector('input').getBoundingClientRect(),button=node.querySelector('button').getBoundingClientRect();return button.left>=input.left && button.right<=input.right && input.right<=innerWidth;})`),true);
  const screenshot = await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(join(output,'translation-mobile.png'),Buffer.from(screenshot.data,'base64'));
  assert.deepEqual(page.pageErrors,[]); assert.deepEqual(page.protocolErrors,[]);
  assert.equal(page.networkRequests.length,0,'mock UI tests never call the public service');
});
