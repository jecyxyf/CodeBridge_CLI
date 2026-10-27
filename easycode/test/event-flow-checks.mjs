import assert from 'node:assert/strict';
import {readProjectFile} from '../subskills/easycode-archify/tools/html/scripts/files.mjs';

export async function checkEventFlows({evaluate,click,edit,save,projectFile}) {
  const events = '[data-editor-group="events"]', methods = '[data-editor-group="methods"]';
  const member = events + ' [data-member-id]';
  const flow = member + ' [data-editor-group="flow"]';
  const addEvent = events + ' > .fold-heading > .group-add';
  const addStep = flow + ' > .fold-heading > .group-add';
  const toggle = selector => selector + ' > .fold-heading > .fold-toggle';
  const position = selector => evaluate(`(() => {const b=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {top:b.top,left:b.left,scroll:document.querySelector('#ec-dialog .dialog-body').scrollTop};})()`);
  const expanded = selector => evaluate(`document.querySelector(${JSON.stringify(toggle(selector))}).getAttribute('aria-expanded')`);
  const contents = selector => evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),input=>input.value)`);
  const stable = (before,after) => {
    for (const key of ['top','left','scroll']) assert.ok(Math.abs(before[key]-after[key]) < 1,`新增后 ${key} 发生跳动`);
  };
  await click('.module-node .module-more');
  const eventPosition = await position(addEvent);
  await click(addEvent);
  stable(eventPosition,await position(addEvent));
  assert.equal(await expanded(events),'false');
  assert.equal(await expanded(member),'false');
  await click(toggle(events)); await click(toggle(member));
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(\'[aria-label="事件类型"] option\'),option=>({value:option.value,text:option.textContent}))'),[
    {value:'emit',text:'发送消息'},{value:'receive',text:'接受消息'}
  ]);
  assert.equal(await evaluate('document.querySelector(\'[aria-label="事件类型"]\').value'),'emit');
  assert.equal(await expanded(flow),'false');
  const stepPosition = await position(addStep);
  await click(addStep); await click(addStep);
  stable(stepPosition,await position(addStep));
  assert.equal(await expanded(flow),'false');
  await click(toggle(flow));
  await edit(flow+' [aria-label="实现步骤 1"]','校验消息内容');
  await edit(flow+' [aria-label="实现步骤 2"]','分发消息');
  await click(addStep);
  await edit(flow+' [aria-label="实现步骤 3"]','记录处理结果');
  await click(flow+' [aria-label="删除步骤 2"]');
  assert.deepEqual(await contents(flow+' .flow-step-row input'),['校验消息内容','记录处理结果']);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(flow+' .flow-step-row input')}),input=>input.getAttribute('aria-label'))`),['实现步骤 1','实现步骤 2']);
  await evaluate('(() => {const field=document.querySelector(\'[aria-label="事件类型"]\');field.value="receive";field.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await click(member+' [data-editor-group="payload"] > .fold-heading > .group-add');
  await click(addEvent);
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(member+' > .fold-heading > .fold-toggle')})[1].getAttribute('aria-expanded')`),'false');
  await click(toggle(events));

  // Both members use the same step editor, but must save through their own update path.
  await click(methods+' > .fold-heading > .group-add'); await click(toggle(methods));
  await click(toggle(methods+' [data-member-id]'));
  for (const [key,value] of [['flow','校验方法输入'],['errors','失败时返回原因']]) {
    const group = methods+` [data-editor-group="${key}"]`;
    await click(group+' > .fold-heading > .group-add'); await click(toggle(group));
    await edit(group+' .flow-step-row input',value);
  }
  await click('#ec-dialog button[type="submit"]'); await save();
  const disk = (await readProjectFile(projectFile)).project, module = disk.modules[0];
  assert.equal(module.events[0].direction,'receive');
  assert.equal(module.events[0].flow,'校验消息内容\n记录处理结果');
  assert.equal(module.events[0].parameters.length,1);
  assert.equal(module.events[1].flow,'');
  assert.equal(module.interfaces[0].flow,'校验方法输入');
  assert.equal(module.interfaces[0].errors,'失败时返回原因');
  const firstEvent = `.module-member[data-event-id="${module.events[0].id}"]`;
  await click(firstEvent);
  assert.equal(await evaluate('document.querySelector(".module-preview-direction").textContent'),'接受消息');
  await click('.module-node .module-more');
  await click(toggle(events)); await click(toggle(member));
  assert.equal(await expanded(flow),'false');
  await click(toggle(flow));
  assert.deepEqual(await contents(flow+' .flow-step-row input'),['校验消息内容','记录处理结果']);
  await click(flow+' [aria-label="删除步骤 2"]'); await click(flow+' [aria-label="删除步骤 1"]');
  await click('#ec-dialog button[type="submit"]'); await save();
  const cleared = (await readProjectFile(projectFile)).project.modules[0];
  assert.equal(cleared.events[0].flow,'');
  assert.equal(cleared.interfaces[0].flow,'校验方法输入');
  assert.equal(cleared.events[0].parameters.length,1);
  return '事件类型、步骤增删及编号、默认折叠和位置保持、JSON 保存重开、清空流程、方法与参数互不影响';
}
