import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import '../assets/model.js';
import '../assets/serialization.js';

export function assemble(project, bundle) {
  return globalThis.EasyCode.Serialization.buildDocument(bundle,project);
}

export async function loadBundle(base = new URL('../',import.meta.url)) {
  const scripts = ['model','serialization','storage','nodes','canvas','dialogs','app'];
  const [canvas,node,css,...runtime] = await Promise.all([
    readFile(new URL('templates/canvas.html',base),'utf8'),
    readFile(new URL('templates/module-node.html',base),'utf8'),
    readFile(new URL('assets/editor.css',base),'utf8'),
    ...scripts.map(name => readFile(new URL(`assets/${name}.js`,base),'utf8'))
  ]);
  return {canvas,node,css,runtime:runtime.join('\n;\n')};
}

export async function build(projectPath, outputPath, bundle) {
  const project = JSON.parse(await readFile(projectPath,'utf8'));
  const html = assemble(project,bundle ?? await loadBundle());
  await writeFile(outputPath,html,'utf8');
  return {outputPath, ...globalThis.EasyCode.Model.validate(project)};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [projectPath,outputPath] = process.argv.slice(2);
  if (!projectPath || !outputPath) {
    console.error('用法: node scripts/build.mjs <project.json> <output.html>'); process.exitCode = 1;
  } else {
    try {console.log(JSON.stringify(await build(projectPath,outputPath),null,2));}
    catch (error) {console.error(error.message); process.exitCode = 1;}
  }
}
