import {readFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {readProjectFile,writeAtomic,fileVersion} from './files.mjs';
import '../assets/model.js';
import '../assets/serialization.js';

export function assemble(project, bundle) {
  return globalThis.EasyCode.Serialization.buildDocument(bundle,project);
}

export async function loadBundle(base = new URL('../',import.meta.url)) {
  const scripts = ['model','serialization','storage','json-storage','service-storage','feedback','icons','translation','nodes','annotations','canvas','module-editor','dialogs','app'];
  const [canvas,node,group,css,...runtime] = await Promise.all([
    readFile(new URL('templates/canvas.html',base),'utf8'),
    readFile(new URL('templates/module-node.html',base),'utf8'),
    readFile(new URL('templates/group-layer.html',base),'utf8'),
    readFile(new URL('assets/editor.css',base),'utf8'),
    ...scripts.map(name => readFile(new URL(`assets/${name}.js`,base),'utf8'))
  ]);
  return {canvas,node,group,css,runtime:runtime.join('\n;\n')};
}

export async function build(projectPath, outputPath, bundle) {
  const expectedVersion = await fileVersion(outputPath);
  const {project} = await readProjectFile(projectPath);
  const html = assemble(project,bundle ?? await loadBundle());
  await writeAtomic(outputPath,html,{expectedVersion,verify:text => {
    if (!isDeepStrictEqual(globalThis.EasyCode.Serialization.readProject(text),project)) throw new Error('HTML 数据核对失败。');
  }});
  return {outputPath, ...globalThis.EasyCode.Model.validate(project)};
}

// Both entries contain the editor without a stale project snapshot.
export async function buildRuntime(outputPath = fileURLToPath(new URL('../../index.html',import.meta.url)),bundle,{mode = 'local'} = {}) {
  if (!['local','service'].includes(mode)) throw new Error('网页模式应为 local 或 service。');
  const expectedVersion = await fileVersion(outputPath);
  const empty = globalThis.EasyCode.Model.createProject();
  const html = globalThis.EasyCode.Serialization.buildDocument(bundle ?? await loadBundle(),empty,{service:mode === 'service',local:mode === 'local'});
  await writeAtomic(outputPath,html,{expectedVersion,verify:text => {
    try {globalThis.EasyCode.Serialization.readProject(text);}
    catch (error) {if (error.code === (mode === 'service' ? 'SERVICE_ENTRY' : 'LOCAL_ENTRY')) return; throw error;}
    throw new Error('网页入口不能内嵌项目数据。');
  }});
  return {outputPath,mode};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [projectPath,outputPath,...rest] = process.argv.slice(2);
  if (projectPath === '--runtime' || projectPath === '--service') {
    try {
      if (rest.length || outputPath?.startsWith('--')) throw new Error('请在模式参数后指定 HTML 输出路径。');
      console.log(JSON.stringify(await buildRuntime(outputPath,undefined,{mode:projectPath === '--service' ? 'service' : 'local'}),null,2));
    }
    catch (error) {console.error(error.message); process.exitCode = 1;}
  } else if (!projectPath || !outputPath) {
    console.error('用法: node html/scripts/build.mjs --runtime [index.html]\n或: node html/scripts/build.mjs --service [index.html]\n或: node html/scripts/build.mjs <project.json> <export.html>'); process.exitCode = 1;
  } else {
    try {console.log(JSON.stringify(await build(projectPath,outputPath),null,2));}
    catch (error) {console.error(error.message); process.exitCode = 1;}
  }
}
