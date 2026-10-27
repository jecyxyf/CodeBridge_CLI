import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {readProjectFile,validateProject} from './files.mjs';
import '../assets/serialization.js';

function summary(project,mode) {
  return {mode,...validateProject(project),modules:project.modules.length,groups:project.groups.length,relations:project.relations.length};
}
export async function check(file,expectedFile) {
  let project,mode;
  if (/\.json$/i.test(file)) {({project} = await readProjectFile(file)); mode = 'json';}
  else {
    const html = await readFile(file,'utf8');
    try {project = globalThis.EasyCode.Serialization.readProject(html); mode = 'snapshot';}
    catch (error) {
      if (!['SERVICE_ENTRY','LOCAL_ENTRY'].includes(error.code)) throw error;
      ({project} = await readProjectFile(join(dirname(file),'archify.json'))); mode = error.code === 'SERVICE_ENTRY' ? 'service' : 'local';
      if (mode === 'local' && /<(?:script\b[^>]*\bsrc\s*=|link\b[^>]*\brel\s*=\s*["']stylesheet)/i.test(html)) throw new Error('本地入口须内嵌脚本和样式。');
    }
  }
  if (expectedFile && !isDeepStrictEqual(project,(await readProjectFile(expectedFile)).project)) throw new Error('输出与指定 JSON 不一致。');
  return summary(project,mode);
}
export async function checkService(url) {
  const base = new URL(url).origin;
  const get = async path => {
    const response = await fetch(base + path,{signal:AbortSignal.timeout(10000),cache:'no-store'});
    if (!response.ok) throw new Error(`${path} 返回 ${response.status}`);
    return response;
  };
  const health = await (await get('/health')).json();
  if (!health.ok || health.service !== 'easycode-archify') throw new Error('该地址不是 Archify 服务。');
  const response = await get('/api/project'), project = await response.json();
  const disk = await readProjectFile(health.projectFile);
  if (!isDeepStrictEqual(project,disk.project) || response.headers.get('ETag') !== disk.version) throw new Error('网页接口与磁盘 JSON 不一致，请重试核对。');
  const html = await (await get('/')).text();
  if (!html.includes('<meta name="easycode-service" content="archify">')) throw new Error('没有返回服务版网页入口。');
  return {url:base + '/',projectFile:health.projectFile,...summary(project,'service')};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file,expectedFile] = process.argv.slice(2);
  if (!file) {console.error('用法: node html/scripts/check.mjs <index.html | archify.json | export.html> [expected.json]\n或: node html/scripts/check.mjs --url <http://127.0.0.1:端口>'); process.exitCode = 1;}
  else {
    try {
      const result = file === '--url' ? await checkService(expectedFile) : await check(file,expectedFile); console.log(JSON.stringify(result,null,2));
      if (result.errors.length) process.exitCode = 1;
    } catch (error) {console.error(error.message); process.exitCode = 1;}
  }
}
