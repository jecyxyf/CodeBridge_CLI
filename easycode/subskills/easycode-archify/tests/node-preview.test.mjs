import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/nodes.js';
const {previewPosition,methodDetails,eventDetails} = globalThis.EasyCode.Nodes;
const viewport = {left:0,top:56,right:1280,bottom:864};

test('方法详情显示中英文标题，按输入输出保留中文名、完整类型和用途且不修改数据',() => {
  const method = {name:'保存任务',englishName:'saveTask',purpose:'检查内容并保存任务',inputs:[
    {name:'任务名称',englishName:'taskName',type:'string',description:'要保存的任务名称'},
    {name:'优先级',englishName:'priority',type:'number',description:'决定任务的执行顺序\n同级任务按创建时间排序'}
  ],outputs:[{name:'保存结果',englishName:'result',type:'boolean',description:'是否保存成功'}]};
  const before = structuredClone(method);
  assert.deepEqual(methodDetails(method),{
    title:'保存任务 / saveTask',description:'检查内容并保存任务',
    inputs:[{name:'任务名称',type:'string',description:'要保存的任务名称'},{name:'优先级',type:'number',description:'决定任务的执行顺序\n同级任务按创建时间排序'}],
    outputs:[{name:'保存结果',type:'boolean',description:'是否保存成功'}]
  });
  assert.deepEqual(method,before);
});

test('方法详情保留空输入输出与多个返回参数，不再拼接整行签名',() => {
  assert.deepEqual(methodDetails({name:'刷新',englishName:'refresh',inputs:[],outputs:[]}),{title:'刷新 / refresh',description:'',inputs:[],outputs:[]});
  const details = methodDetails({name:'加载任务',englishName:'loadTasks',outputs:[
    {name:'任务列表',type:'Task[]',description:'读取到的任务'},
    {name:'任务索引',type:' Map<string, Task> ',description:'按编号查找任务'}
  ]});
  assert.deepEqual(details.inputs,[]);
  assert.deepEqual(details.outputs,[{name:'任务列表',type:'Task[]',description:'读取到的任务'},{name:'任务索引',type:'Map<string, Task>',description:'按编号查找任务'}]);
  assert.equal(Object.hasOwn(details,'signature'),false);
});

test('缺少名称或类型时给出显示占位，不生成英文名或修改原始字段',() => {
  const method = {name:' 保存任务 ',englishName:' ',inputs:[{name:'任务名称',type:'',description:' '},{name:'',englishName:'priority',type:'number'}]};
  const before = structuredClone(method);
  assert.deepEqual(methodDetails(method),{title:'保存任务',description:'',inputs:[
    {name:'任务名称',type:'—',description:'暂无说明'},{name:'未命名参数',type:'number',description:'暂无说明'}
  ],outputs:[]});
  assert.deepEqual(method,before);
  assert.deepEqual(methodDetails(),{title:'未命名方法',description:'',inputs:[],outputs:[]});
});

test('事件详情使用中英文标题和发出方向，保留消息参数顺序、类型和多行用途',() => {
  const event = {name:'任务已保存',englishName:'taskSaved',description:'通知其他模块刷新列表',direction:'emit',trigger:'存储写入成功',parameters:[
    {name:'任务编号',englishName:'taskId',type:'string',description:'已保存任务的唯一编号'},
    {name:'保存时间',englishName:'savedAt',type:' Date ',description:'记录保存完成的时间\n用于显示最近更新时间'}
  ]};
  const before = structuredClone(event);
  assert.deepEqual(eventDetails(event),{
    title:'任务已保存 / taskSaved',description:'通知其他模块刷新列表',direction:'emit',parameters:[
      {name:'任务编号',type:'string',description:'已保存任务的唯一编号'},
      {name:'保存时间',type:'Date',description:'记录保存完成的时间\n用于显示最近更新时间'}
    ]
  });
  assert.deepEqual(event,before);
});

test('接收事件与空消息保留方向，缺少英文名时只显示中文名且不补写数据',() => {
  const event = {name:' 请求清理 ',englishName:' ',description:'收到后清理缓存',direction:'receive',parameters:[]};
  const before = structuredClone(event);
  assert.deepEqual(eventDetails(event),{title:'请求清理',description:'收到后清理缓存',direction:'receive',parameters:[]});
  assert.deepEqual(event,before);
  assert.deepEqual(eventDetails(),{title:'未命名事件',description:'',direction:'emit',parameters:[]});
  assert.deepEqual(eventDetails({parameters:[{name:'',type:' ',description:''}]}).parameters,[{name:'未命名参数',type:'—',description:'暂无说明'}]);
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
