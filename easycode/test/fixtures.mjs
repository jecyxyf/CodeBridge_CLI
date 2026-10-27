import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import '../subskills/easycode-archify/tools/html/assets/model.js';
import {assemble,loadBundle} from '../subskills/easycode-archify/tools/html/scripts/build.mjs';

const M = globalThis.EasyCode.Model;
export const root = new URL('./',import.meta.url);
const sizes = [50,80,100,150,200,300,400,500,750,1000];
export const cases = Array.from({length:100},(_,index) => {
  const n = index + 1, id = `case-${String(n).padStart(3,'0')}`;
  const category = n <= 10 ? '最小项目' : n <= 40 ? '常规项目' : n <= 60 ? '完整字段' : n <= 80 ? '长文字与特殊字符' : n <= 90 ? '复杂连线' : '规模压力';
  const count = n <= 10 ? (n <= 2 ? 0 : 1) : n <= 40 ? 2 + index % 11 : n <= 60 ? 5 + index % 8 : n <= 80 ? 2 + index % 4 : n <= 90 ? 20 + (n - 81) * 10 : sizes[n - 91];
  return {id,n,seed:2026102600+n,category,name:`${String(n).padStart(3,'0')} · ${category}${category === '规模压力' ? ` ${count} 模块` : ''}`,modules:count};
});
const hostile = ['保存 "任务" 与路径 C:\\测试\\任务','<img data-fixture-injection src=x onerror="globalThis.__fixtureInjection=true">','</script><script>globalThis.__fixtureInjection=true</script>','中文 English 😀 ∑ \u2028 分隔符 \u2029 换行\n第二行\t制表符','包含 < > & 单引号\' 和反引号 ` 的内容'];

export function makeProject(spec) {
  let sequence = 0, state = spec.seed >>> 0;
  const next = prefix => `${prefix}-${spec.id}-${++sequence}`;
  const random = () => {state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296;};
  const own = (value,prefix) => ({...value,id:next(prefix)});
  const full = spec.category === '完整字段', text = spec.category === '长文字与特殊字符', pressure = spec.category === '规模压力';
  const project = own(M.createProject(`稳定性测试 ${spec.name}`),'project');
  project.englishName = `stability-${spec.id}`;
  project.description = `固定种子 ${spec.seed}，${spec.category}，仅包含生成的测试数据。`;
  project.repository = {path:'',revision:spec.n % 2 ? '0.0.1' : 'test-revision',dirty:full && spec.n % 2 === 0};
  const groupCount = spec.n === 2 ? 2 : spec.n <= 10 ? (spec.n > 6 ? 1 : 0) : Math.min(8,Math.max(1,Math.ceil(spec.modules / 8)));
  project.groups = Array.from({length:groupCount},(_,i) => ({id:next('group'),name:`层级${i+1}`,englishName:`Layer${i+1}`,color:i % 2 ? '#17254d' : '#ffffff',backgroundColor:['#81b3e9','#d5c5f4','#b9e2d2'][i%3],x:i*560,y:60}));
  function parameter(name) {
    const value = own(M.createParameter(),'param');
    value.name = name; value.englishName = `parameter${sequence}`;
    value.type = ['string','number','boolean','TaskData','string[]','std::vector<std::string>'][sequence % 6];
    value.description = text ? hostile[sequence % hostile.length] + '参数说明。'.repeat(12 + spec.n % 20) : `用于保存${name}的数据。`;
    value.defaultValue = sequence % 3 ? '' : '0'; value.required = sequence % 2 === 0;
    return value;
  }
  for (let i=0;i<spec.modules;i++) {
    const module = own(M.createModule({name:`模块${i+1}`,purpose:`处理第 ${i+1} 个模块的任务。`,x:(i%5)*560+80,y:Math.floor(i/5)*(full || text ? 1400 : 880)+120}),'module');
    module.englishName = `Module${i+1}`;
    module.groupId = project.groups.length && i % 5 !== 4 ? project.groups[i % project.groups.length].id : '';
    module.language = spec.n % 4 === 0 ? '' : ['TypeScript','C++','Python'][i%3];
    module.codeLocation = full ? `./src/module-${i+1}.ts\n./include/module-${i+1}.h` : '';
    if (full) {
      module.appearance = {textColor:'#17254d',backgroundColor:'#fcfdff',headerColor:['#f4f7ff','#ecf8f3','#f6f0ff'][i%3]};
      module.status = i % 3 === 0 ? 'verified' : i % 3 === 1 ? 'modified' : 'planned';
      module.sources = [{path:`synthetic/module-${i+1}.ts`,line:1,endLine:30,symbol:module.englishName}];
    }
    if (text) {module.name = `${hostile[(i+spec.n)%hostile.length]} 模块${i+1}`; module.purpose = '很长的模块功能说明。'.repeat(30 + spec.n % 50);}
    const parameterCount = spec.n <= 10 ? (spec.n % 3 === 0 ? 1 : 0) : pressure ? 1 : full ? 6 : text ? 8 : 1 + spec.n % 3;
    module.parameters = Array.from({length:parameterCount},(_,j) => parameter(`参数${j+1}`));
    const methodCount = spec.n <= 10 ? Number(spec.n === 10) : pressure ? Number(i % 4 === 0) : full ? 3 : 1 + spec.n % 2;
    module.interfaces = Array.from({length:methodCount},(_,j) => {
      const method = own(M.createInterface(),'interface'); method.name=`方法${j+1}`;method.englishName=`method${j+1}`;
      method.purpose = text ? hostile[(i+j)%hostile.length] : '处理输入并返回结果。';
      method.flow='检查输入\n执行处理\n返回结果';method.errors='输入无效时返回错误\n处理失败时保留原因';
      method.inputsConfirmed = full; method.outputsConfirmed = full;
      method.inputs = Array.from({length:text && spec.n === 80 && j === 0 ? 100 : full ? 4 : 2},(_,k) => parameter(`输入${k+1}`));
      method.outputs = Array.from({length:full ? 2 : 1},(_,k) => parameter(`输出${k+1}`));
      return method;
    });
    if (full || text || spec.n > 10 && !pressure && i % 3 === 0) {
      module.requirements = full || text ? ['输入后保存内容。','删除前确认选定对象。',text ? hostile[i % hostile.length] : '刷新后保持数据一致。'] : ['显示模块的中文名称。'];
      module.events = Array.from({length:full ? 2 : 1},(_,j) => {
        const event=own(M.createEvent(),'event');event.name=`事件${j+1}`;event.englishName=`event${j+1}`;event.direction=(i+j)%2 ? 'receive' : 'emit';
        // Keep the fixed 100-case baseline without optional flow; event-flow checks cover that field separately.
        delete event.flow;
        event.description=text ? hostile[(i+j+1)%hostile.length] : '在数据变化后通知其他模块。';event.parameters=[parameter('消息内容')];return event;
      });
    }
    if (full) {
      const structure=own(M.createStructure(),'structure');structure.name='任务结构';structure.englishName='TaskData';
      structure.fields=Array.from({length:4},(_,j)=>({...own(M.createStructureField(),'field'),name:`字段${j+1}`,englishName:`field${j+1}`}));
      module.structures=[structure];module.tests=[own(M.createTest(),'test')];
    }
    project.modules.push(module);
  }
  const pairs = new Set();
  const connect = (a,b,label) => {
    if(a===b || pairs.has(`${a}:${b}`)) return;
    pairs.add(`${a}:${b}`);
    project.relations.push({id:next('relation'),from:project.modules[a].id,to:project.modules[b].id,label,status:'planned',sources:[],unknowns:[],fromPort:a<b ? 'right' : 'bottom',toPort:a<b ? 'left' : 'top'});
  };
  for(let i=1;i<project.modules.length;i++) connect(i-1,i,text ? hostile[i%hostile.length] : '传递任务');
  if(spec.category==='复杂连线') {
    connect(project.modules.length-1,0,'循环通知');
    for(let i=0;i<project.modules.length*3;i++) connect(Math.floor(random()*project.modules.length),Math.floor(random()*project.modules.length),`依赖${i+1}`);
  }
  if(spec.n===8 || spec.n===72) project.view={...project.view,x:-180,y:90,scale:.25};
  if(spec.n===9 || spec.n===73) project.view={...project.view,x:25,y:-100,scale:1.8};
  if(full) {project.view.expanded=project.modules.slice(0,2).map(m=>m.id);project.view.expandedInterfaces=project.modules.slice(0,2).map(m=>m.interfaces[0].id);}
  return project;
}

export async function generate() {
  await mkdir(new URL('json/',root),{recursive:true});
  const bundle=await loadBundle();let totalBytes=0;
  for(const spec of cases) {
    const project=makeProject(spec), validation=M.validate(project);
    if(validation.errors.length || validation.warnings.length) throw new Error(`${spec.id}: ${JSON.stringify(validation)}`);
    const html=assemble(project,bundle);
    if(JSON.stringify(globalThis.EasyCode.Serialization.readProject(html))!==JSON.stringify(project)) throw new Error(`${spec.id}: 数据往返不一致`);
    const contents=JSON.stringify(project,null,2)+'\n';totalBytes+=Buffer.byteLength(contents);
    await writeFile(new URL(`json/${spec.id}.json`,root),contents,'utf8');
  }
  return {cases:cases.length,totalBytes};
}

export async function readCase(id) {
  if(!cases.some(spec=>spec.id===id)) throw new Error('测试数据不存在');
  return JSON.parse(await readFile(new URL(`json/${id}.json`,root),'utf8'));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await generate(),null,2));
