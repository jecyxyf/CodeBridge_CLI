import {cp,mkdir} from 'node:fs/promises';
import {resolve,join,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {buildRuntime} from './build.mjs';
import {fileVersion,readProjectFile,writeProjectFile} from './files.mjs';
import {check} from './check.mjs';

const sourceRoot = fileURLToPath(new URL('../../',import.meta.url));
export async function deploy(projectRoot,{sourceFile,outputDir = 'docs/archfiy',mode = 'local'} = {}) {
  if (!['local','service'].includes(mode)) throw new Error('部署模式应为 local 或 service。');
  projectRoot = resolve(projectRoot);
  const inside = (parent,child) => {const path = relative(parent,child); return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);};
  if (typeof outputDir !== 'string' || !outputDir.trim() || isAbsolute(outputDir)) throw new Error('部署目录须为项目内的相对目录。');
  const targetRoot = resolve(projectRoot,outputDir), targetFile = join(targetRoot,'archify.js');
  if (targetRoot === projectRoot || !inside(projectRoot,targetRoot)) throw new Error('部署目录须位于目标项目内，且不能是项目根目录。');
  if (inside(sourceRoot,targetRoot) || inside(targetRoot,sourceRoot)) throw new Error('部署目录不能与工具源目录重叠。');
  const previousVersion = await fileVersion(targetFile);
  let project;
  if (previousVersion !== null) {
    project = (await readProjectFile(targetFile)).project;
    if (sourceFile && !isDeepStrictEqual(project,(await readProjectFile(resolve(sourceFile))).project)) throw new Error('目标项目已有不同的 archify.js，已保留。请确认数据基准后单独更新配置。');
  } else if (sourceFile) project = (await readProjectFile(resolve(sourceFile))).project;
  else {
    // Use the shipped empty framework, but give every new project its own identity.
    project = (await readProjectFile(join(sourceRoot,'archify.js'))).project;
    project.id = globalThis.EasyCode.Model.createProject().id;
  }
  await mkdir(targetRoot,{recursive:true});
  if (mode === 'service') await cp(join(sourceRoot,'html'),join(targetRoot,'html'),{recursive:true,filter:path => !path.endsWith('.tmp')});
  if (mode === 'local') await cp(join(sourceRoot,'index.html'),join(targetRoot,'index.html'));
  else await buildRuntime(join(targetRoot,'index.html'),undefined,{mode});
  if (previousVersion === null) await writeProjectFile(targetFile,project,{expectedVersion:null});
  const result = await check(join(targetRoot,'index.html'));
  return {projectRoot,targetRoot,projectFile:targetFile,dataPreserved:previousVersion !== null,...result};
}
async function runningService(targetRoot,port) {
  const ports = port === undefined ? Array.from({length:21},(_,i) => 4175 + i) : [port];
  for (const candidate of ports) {
    const url = `http://127.0.0.1:${candidate}`;
    try {
      const response = await fetch(url + '/health',{signal:AbortSignal.timeout(300)}), health = await response.json();
      if (response.ok && health.service === 'easycode-archify' && resolve(health.root) === resolve(targetRoot)) return url;
    } catch { /* This port is free or belongs to another program. */ }
  }
  return null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [projectRoot,...args] = process.argv.slice(2), options = {}; let start = false, port;
    if (!projectRoot) throw new Error('用法：node html/scripts/deploy.mjs <目标项目根目录> [--output-dir <项目内相对目录>] [--source-file <配置路径>] [--mode local|service] [--start] [--port <端口>]');
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--start') start = true;
      else if (args[i] === '--mode' && args[i + 1] && !args[i + 1].startsWith('--')) options.mode = args[++i];
      else if (args[i] === '--output-dir' && args[i + 1] && !args[i + 1].startsWith('--')) options.outputDir = args[++i];
      else if (args[i] === '--source-file' && args[i + 1]) options.sourceFile = args[++i];
      else if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
      else throw new Error(`不支持的参数：${args[i]}`);
    }
    // A local deployment does not start or require a server.
    if (start && options.mode === undefined) options.mode = 'service';
    if (start && options.mode !== 'service') throw new Error('--start 只能用于 service 模式；local 模式直接打开 index.html。');
    if (port !== undefined && !start) throw new Error('--port 需与 --start 一起使用。');
    if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error('端口应为 0～65535 的整数。');
    const result = await deploy(projectRoot,options);
    console.log(JSON.stringify(result,null,2));
    if (result.mode === 'local') console.log(`直接用 Chrome 或 Edge 打开：${join(result.targetRoot,'index.html')}\n自动加载配置：${result.projectFile}`);
    if (start) {
      const running = await runningService(result.targetRoot,port);
      if (running) console.log(`网页服务已运行：${running}/`);
      else {
        const {startServer,keepRunning} = await import(pathToFileURL(join(result.targetRoot,'html','server.mjs')).href);
        keepRunning(await startServer({port}));
      }
    }
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
