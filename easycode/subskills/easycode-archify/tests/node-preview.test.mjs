import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/nodes.js';
const {previewPosition,methodSignature} = globalThis.EasyCode.Nodes;
const viewport = {left:0,top:56,right:1280,bottom:864};

test('方法签名显示返回类型和英文名称，保留参数顺序且不修改数据',() => {
  const method = {name:'保存任务',englishName:'saveTask',inputs:[{name:'任务名称',englishName:'taskName',type:'string'},{name:'优先级',englishName:'priority',type:'number'}],outputs:[{name:'保存结果',englishName:'result',type:'boolean'}]};
  const before = structuredClone(method);
  assert.equal(methodSignature(method),'boolean saveTask(taskName, priority)');
  assert.deepEqual(method,before);
});

test('方法签名区分无参数、无返回值和多个返回值',() => {
  assert.equal(methodSignature({englishName:'refresh',inputs:[],outputs:[]}),'void refresh()');
  assert.equal(methodSignature({englishName:'notify',inputs:[{englishName:'task'}],outputs:[]}),'void notify(task)');
  assert.equal(methodSignature({englishName:'loadTasks',inputs:[],outputs:[{type:'Task[]'},{type:'number'}]}),'(Task[], number) loadTasks()');
  assert.equal(methodSignature({englishName:'load',outputs:[{type:' Map<string, Task> '}]}),'Map<string, Task> load()');
});

test('缺少英文名称时使用已有英文标识或占位名，不猜测返回类型',() => {
  assert.equal(methodSignature({name:'saveTask(oldArg)',inputs:[{name:'taskName'},{name:'优先级'}],outputs:[{type:''}]}),'unknown saveTask(taskName, param2)');
  assert.equal(methodSignature({name:'保存任务',englishName:' ',inputs:[{name:'任务名称'}]}),'void method(param1)');
  assert.equal(methodSignature(), 'void method()');
});

test('详情浮层优先放右侧，右侧不足时放左侧',() => {
  const size = {width:360,height:260};
  assert.deepEqual(previewPosition({left:100,right:500,top:200,bottom:226},size,viewport),{left:512,top:200});
  assert.deepEqual(previewPosition({left:800,right:1200,top:200,bottom:226},size,viewport),{left:428,top:200});
});

test('小屏两侧不足时显示在下方或上方，保留窗口边距',() => {
  const small = {left:0,top:96,right:390,bottom:864}, size = {width:360,height:240};
  assert.deepEqual(previewPosition({left:20,right:370,top:160,bottom:190},size,small),{left:18,top:202});
  assert.deepEqual(previewPosition({left:20,right:370,top:700,bottom:730},size,small),{left:18,top:448});
});

test('画布缩放、边缘节点和长内容的浮层位置始终留在可视画布内',() => {
  const before = structuredClone(viewport);
  for (const scale of [.25,.6,1,1.8]) for (const x of [-300,20,700,1200]) for (const y of [-200,100,800,1200]) {
    const anchor = {left:x,right:x + 480 * scale,top:y,bottom:y + 26 * scale};
    for (const height of [90,500,1200]) {
      const size = {width:360,height}, result = previewPosition(anchor,size,viewport);
      assert.ok(result.left >= viewport.left + 12);
      assert.ok(result.left + size.width <= viewport.right - 12);
      assert.ok(result.top >= viewport.top + 12);
      assert.ok(result.top + Math.min(height,viewport.bottom - viewport.top - 24) <= viewport.bottom - 12);
    }
  }
  assert.deepEqual(viewport,before);
});
