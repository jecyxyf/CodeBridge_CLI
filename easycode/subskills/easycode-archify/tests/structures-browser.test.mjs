import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchBrowser,createPage} from './helpers/cdp.mjs';

test('数据结构：增删草稿、保存重开、默认收起和小屏显示',{
  skip:process.env.EASYCODE_BROWSER_TEST !== '1',timeout:120000
},async t => {
  const {assemble,loadBundle} = await import('../scripts/build.mjs');
  const {Model:M,Serialization:S} = globalThis.EasyCode;
  const project = M.createProject('模块设计'), module = M.createModule({name:'任务模块',purpose:'保存任务'});
  module.englishName = 'TaskModule'; project.modules.push(module);
  const output = await mkdtemp(join(tmpdir(),'easycode-structures-'));
  t.diagnostic(`Structure UI artifacts: ${output}`);
  const file = join(output,'canvas.html'); await writeFile(file,assemble(project,await loadBundle()));
  const browser = await launchBrowser(); t.after(() => browser.close()); const page = await createPage(browser);
  await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.confirm = globalThis.alert = globalThis.prompt = () => {throw new Error("Native dialog must not be used");};'});
  await page.navigate(pathToFileURL(file).href);
  const data = 'EasyCode.app.project', group = '#ec-dialog [data-editor-group="structures"]';
  const click = label => page.click(`#ec-dialog button[aria-label="${label}"]`);
  const fill = (label,value) => page.fill(`#ec-dialog [aria-label="${label}"]`,value);
  const row = index => `${group} .structure-field-row:nth-child(${index})`;
  const readFields = () => page.evaluate(`Array.from(document.querySelectorAll('${group} .structure-field-row'),row => Array.from(row.querySelectorAll('input'),input => input.value))`);
  async function open() {
    await page.click('.module-node [data-node-action="edit"]');
    assert.equal(await page.evaluate('Array.from(document.querySelectorAll("#ec-dialog .fold-toggle")).every(button => button.getAttribute("aria-expanded") === "false")'),true);
  }
  async function expandStructure() {
    await page.click(`${group} > .fold-heading .fold-toggle`);
    await page.click(`${group} .member-editor > .fold-heading .fold-toggle`);
  }
  await open();
  assert.deepEqual(await page.evaluate('Array.from(document.querySelectorAll(".module-editor > [data-editor-group]"),node => node.dataset.editorGroup)'),['appearance','basics','requirements','parameters','structures','methods','events','tests']);
  assert.equal(await page.evaluate('document.querySelector(".module-dialog-language").hidden'),true);
  const before = await page.evaluate(data);
  await click('添加数据结构');
  assert.equal(await page.evaluate('document.activeElement.getAttribute("aria-label")'),'数据结构中文名');
  await fill('数据结构中文名','任务信息'); await fill('数据结构英文名','TaskInfo');
  assert.equal(await page.evaluate(`document.querySelectorAll('${group} textarea').length`),0,'structure definition uses field rows');
  const values = [['任务名称','taskName','std::string','显示的任务名称 </script><script>globalThis.__injected = true</script>'],['临时字段','temporary','int','稍后删除'],['完成状态','completed','bool','是否已完成']];
  for (const [index,valuesForRow] of values.entries()) {
    await click('新增字段');
    assert.equal(await page.evaluate('document.activeElement.getAttribute("aria-label")'),'中文名');
    for (const [column,label] of ['中文名','英文名','变量类型','作用'].entries()) await page.fill(`${row(index + 1)} [aria-label="${label}"]`,valuesForRow[column]);
  }
  const lastId = await page.evaluate(`document.querySelector('${row(3)}').dataset.fieldId`);
  await click('删除字段 2');
  assert.equal(await page.evaluate('document.activeElement.closest(".structure-field-row").dataset.fieldId'),lastId);
  const expectedValues = [values[0],values[2]];
  assert.deepEqual(await readFields(),expectedValues,'deleting the middle field preserves sibling input');
  assert.deepEqual(await page.evaluate(data),before,'editing remains a draft');
  await click('确定');
  const saved = await page.evaluate(`${data}.modules[0].structures`);
  assert.equal(saved.length,1); assert.equal(saved[0].name,'任务信息'); assert.equal(saved[0].englishName,'TaskInfo');
  assert.deepEqual(saved[0].fields.map(item => [item.name,item.englishName,item.type,item.description]),expectedValues);
  assert.equal(saved[0].fields[1].id,lastId);
  assert.deepEqual(await page.evaluate('Array.from(document.querySelectorAll(".module-node [data-module-group]"),node => node.dataset.moduleGroup)'),['basics'],'structure data stays in configuration and is not a canvas group');
  await open(); await expandStructure();
  await page.fill(`${row(1)} [aria-label="中文名"]`,'取消的修改');
  await click('删除字段 2'); await click('删除字段 1');
  assert.equal(await page.evaluate(`document.querySelector('${group} .structure-fields .empty-note').hidden`),false);
  assert.equal(await page.evaluate('document.activeElement.getAttribute("aria-label")'),'新增字段');
  await click('新增字段'); await fill('中文名','取消的字段');
  await click('取消');
  assert.deepEqual(await page.evaluate(`${data}.modules[0].structures`),saved,'cancel discards field edits, deletion and insertion');
  await open(); await expandStructure();
  await click('删除数据结构'); await page.click('#ec-confirm [data-confirm-action="cancel"]');
  assert.equal(await page.evaluate(`document.querySelectorAll('${group} .member-editor').length`),1,'canceling deletion keeps the entry');
  await click('删除数据结构'); await page.click('#ec-confirm [data-confirm-action="accept"]');
  assert.equal(await page.evaluate(`document.querySelector('${group} .empty-note').hidden`),false);
  await click('取消');
  assert.deepEqual(await page.evaluate(`${data}.modules[0].structures`),saved,'canceling the dialog restores deleted entries');
  await open(); await click('添加数据结构');
  await page.fill(`${group} .member-editor:last-child [aria-label="数据结构中文名"]`,'临时结构');
  await page.fill(`${group} .member-editor:last-child [aria-label="数据结构英文名"]`,'Temporary');
  await click('确定');
  assert.equal(await page.evaluate(`${data}.modules[0].structures.length`),2,'multiple structures are saved');
  await open(); await page.click(`${group} > .fold-heading .fold-toggle`);
  await page.click(`${group} .member-editor:last-child button[aria-label="删除数据结构"]`);
  await page.click('#ec-confirm [data-confirm-action="accept"]');
  await click('确定');
  assert.deepEqual(await page.evaluate(`${data}.modules[0].structures`),saved,'deleting one entry retains its sibling');

  // Exercise the same serialization used by Save without opening native file dialogs.
  const html = await page.evaluate('EasyCode.Serialization.buildDocument(JSON.parse(document.getElementById("ec-bundle").textContent),EasyCode.app.project)');
  assert.deepEqual(S.readProject(html),await page.evaluate(data));
  const reopened = join(output,'reopened.html'); await writeFile(reopened,html);
  await page.navigate(pathToFileURL(reopened).href);
  assert.equal(await page.evaluate('globalThis.__injected === undefined'),true);
  for (const width of [1440,390]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await page.click('[data-action="fit"]'); await open(); await expandStructure();
    assert.deepEqual(await readFields(),expectedValues);
    assert.equal(await page.evaluate('document.querySelector("[aria-label=数据结构英文名]").value'),'TaskInfo');
    const fits = await page.evaluate(`(() => {
      const dialog = document.querySelector('#ec-dialog').getBoundingClientRect();
      const fields = [...document.querySelectorAll('${group} input,${group} textarea')].map(node => node.getBoundingClientRect());
      const buttons = [...document.querySelectorAll('.dialog-actions button')].map(node => node.getBoundingClientRect());
      return dialog.left >= 0 && dialog.right <= innerWidth && fields.every(r => r.left >= dialog.left && r.right <= dialog.right) && buttons.every(r => r.top >= 0 && r.bottom <= innerHeight);
    })()`);
    assert.ok(fits,'structure fields and dialog controls fit the screen');
    assert.equal(await page.evaluate(`(() => {
      const fields = [...document.querySelectorAll('${row(1)} input')].map(node => node.getBoundingClientRect());
      return fields.every(rect => Math.abs(rect.top - fields[0].top) < 1);
    })()`),width > 700,'wide screens show one row; narrow screens wrap fields');
    const shot = await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(output,`structures-${width}.png`),Buffer.from(shot.data,'base64'));
    await click('取消');
  }
  assert.deepEqual(page.pageErrors,[]); assert.deepEqual(page.consoleErrors,[]); assert.deepEqual(page.protocolErrors,[]);
  assert.equal(page.networkRequests.length,0);
});
