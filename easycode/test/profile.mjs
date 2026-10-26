import {readFile,writeFile} from 'node:fs/promises';
import {readCase,root} from './fixtures.mjs';
import {assemble,loadBundle} from '../subskills/easycode-archify/tools/html/scripts/build.mjs';

const M=globalThis.EasyCode.Model,S=globalThis.EasyCode.Serialization;
const project=await readCase('case-100'),bundle=await loadBundle(),timings={};
function measure(name,operation) {
  const start=performance.now(),result=operation();timings[name]=Number((performance.now()-start).toFixed(2));return result;
}
measure('validateMs',()=>M.validate(project));
const snapshot=measure('cloneMs',()=>structuredClone(project));
measure('fillDefaultsMs',()=>M.fillProjectDefaults(snapshot));
const html=measure('assembleMs',()=>assemble(snapshot,bundle));
measure('readBackMs',()=>S.readProject(html));
const profile={case:'case-100',modules:project.modules.length,runtime:process.version,environment:'Node，独立定位纯数据处理的耗时，不替代浏览器时长',timings};
const reportPath=new URL('report.json',root),report=JSON.parse(await readFile(reportPath,'utf8'));
report.diagnostic=profile;
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(profile,null,2));
