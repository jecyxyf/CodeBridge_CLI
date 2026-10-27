import {cp,mkdir,readFile} from 'node:fs/promises';
import {resolve,join,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {buildRuntime} from './build.mjs';
import {fileVersion,readProjectFile,writeProjectFile} from './files.mjs';
import {check,checkService} from './check.mjs';
import {validPort,writeReadme} from '../server.mjs';

const sourceRoot = fileURLToPath(new URL('../../',import.meta.url));
export async function deploy(projectRoot,{sourceFile,outputDir = 'docs/archfiy',mode = 'service'} = {}) {
  if (!['local','service'].includes(mode)) throw new Error('部署模式应为 local 或 service。');
  projectRoot = resolve(projectRoot);
  const inside = (parent,child) => {const path = relative(parent,child); return path === '' || path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);};
  if (typeof outputDir !== 'string' || !outputDir.trim() || isAbsolute(outputDir)) throw new Error('部署目录须为项目内的相对目录。');
  const targetRoot = resolve(projectRoot,outputDir), targetFile = join(targetRoot,'archify.json');
  if (targetRoot === projectRoot || !inside(projectRoot,targetRoot)) throw new Error('部署目录须位于目标项目内，且不能是项目根目录。');
  if (inside(sourceRoot,targetRoot) || inside(targetRoot,sourceRoot)) throw new Error('部署目录不能与工具源目录重叠。');
  const previousVersion = await fileVersion(targetFile);
  let project;
  if (previousVersion !== null) {
    project = (await readProjectFile(targetFile)).project;
    if (sourceFile && !isDeepStrictEqual(project,(await readProjectFile(resolve(sourceFile))).project)) throw new Error('目标项目已有不同的 archify.json，已保留。请确认数据基准后单独更新配置。');
  } else if (sourceFile) project = (await readProjectFile(resolve(sourceFile))).project;
  else {
    if (await fileVersion(join(targetRoot,'archify.js')) !== null) throw new Error('目标目录已有旧 archify.js，请先确认 JSON 数据来源，避免用空框架替换已有设计。');
    // Use the shipped empty framework, but give every new project its own identity.
    project = (await readProjectFile(join(sourceRoot,'archify.json'))).project;
    project.id = globalThis.EasyCode.Model.createProject().id;
  }
  await mkdir(targetRoot,{recursive:true});
  if (mode === 'service') await cp(join(sourceRoot,'html'),join(targetRoot,'html'),{recursive:true,filter:path => !path.endsWith('.tmp')});
  await buildRuntime(join(targetRoot,'index.html'),undefined,{mode});
  if (previousVersion === null) await writeProjectFile(targetFile,project,{expectedVersion:null});
  const result = await check(join(targetRoot,'index.html'));
  return {projectRoot,targetRoot,projectFile:targetFile,dataPreserved:previousVersion !== null,...result};
}
async function runningService(targetRoot,port) {
  const candidates = new Set(port === undefined ? [] : [port]);
  try {
    const readme = await readFile(join(targetRoot,'ReadMe.md'),'utf8');
    const saved = Number(/http:\/\/127\.0\.0\.1:(\d{5})\//.exec(readme)?.[1]);
    if (validPort(saved)) candidates.add(saved);
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  for (const candidate of candidates) {
    const url = `http://127.0.0.1:${candidate}`;
    try {
      const response = await fetch(url + '/health',{signal:AbortSignal.timeout(1000)}), health = await response.json();
      if (response.ok && health.service === 'easycode-archify' && resolve(health.root) === resolve(targetRoot)) {
        if (port !== undefined && candidate !== port) throw Object.assign(new Error(`该目录的服务已在 ${url}/ 运行，请停止后再更换端口。`),{code:'PORT_CONFLICT'});
        return url;
      }
    } catch (error) {if (error.code === 'PORT_CONFLICT') throw error;}
  }
  return null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [projectRoot,...args] = process.argv.slice(2), options = {}; let start, port;
    if (!projectRoot) throw new Error('用法：node html/scripts/deploy.mjs <目标项目根目录> [--output-dir <项目内相对目录>] [--source-file <archify.json路径>] [--no-start] [--port <五位数端口>] [--mode service|local]');
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--start') start = true;
      else if (args[i] === '--no-start') start = false;
      else if (args[i] === '--mode' && args[i + 1] && !args[i + 1].startsWith('--')) options.mode = args[++i];
      else if (args[i] === '--output-dir' && args[i + 1] && !args[i + 1].startsWith('--')) options.outputDir = args[++i];
      else if (args[i] === '--source-file' && args[i + 1] && !args[i + 1].startsWith('--')) options.sourceFile = args[++i];
      else if (args[i] === '--port' && args[i + 1]) port = Number(args[++i]);
      else throw new Error(`不支持的参数：${args[i]}`);
    }
    start ??= options.mode !== 'local';
    if (start && options.mode === 'local') throw new Error('local 模式只支持手动加载 JSON，不启动服务。');
    if (port !== undefined && !start) throw new Error('--port 需启动服务时使用。');
    if (port !== undefined && !validPort(port)) throw new Error('端口应为 10000～65535 的五位数整数。');
    const result = await deploy(projectRoot,options);
    console.log(JSON.stringify(result,null,2));
    if (start) {
      const running = await runningService(result.targetRoot,port);
      if (running) {
        await writeReadme({root:result.targetRoot,url:running});
        await checkService(running);
        console.log(`网页服务已运行：${running}/\n访问说明：${join(result.targetRoot,'ReadMe.md')}`);
      } else {
        const {startServer,keepRunning} = await import(pathToFileURL(join(result.targetRoot,'html','server.mjs')).href);
        const service = await startServer({port});
        try {await checkService(service.url);}
        catch (error) {await new Promise(done => service.server.close(done)); throw error;}
        keepRunning(service);
      }
    } else if (result.mode === 'local') console.log('此入口需手动加载 archify.json；默认部署使用 Node 网页服务。');
    else console.log(`网页已生成，尚未启动。启动命令：node "${join(result.targetRoot,'html','server.mjs')}"`);
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
