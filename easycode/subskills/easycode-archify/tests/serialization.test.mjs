import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import '../assets/model.js';
import '../assets/serialization.js';
import {assemble,build,loadBundle} from '../scripts/build.mjs';
const {Model,Serialization}=globalThis.EasyCode;
const bundle={canvas:'<!doctype html><html><head><title><!--EC:TITLE--></title><!--EC:STYLE--></head><body><!--EC:NODE--><!--EC:DATA--><!--EC:BUNDLE--><!--EC:RUNTIME--></body></html>',node:'<template id="ec-module-template"></template>',css:'body {color: red}',runtime:'globalThis.started = true;'};
test('恶意 HTML 是文本且多次保存不增长',()=>{
  const p=Model.createProject('</script><script>alert(1)</script>'); p.description='<>&\u2028\u2029';
  const a=Serialization.buildDocument(bundle,p);
  assert.deepEqual(Serialization.readProject(a),p);
  assert.equal(Serialization.buildDocument(bundle,Serialization.readProject(a)),a);
  assert.ok(!a.includes('<script>alert(1)</script>'));
  assert.match(a,/&lt;\/script&gt;/); assert.match(a,/\\u003c/); assert.match(a,/\\u2028/);
  const embedded=JSON.parse(a.match(/<script id="ec-bundle" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(embedded,bundle);
});
test('模板只替换原有槽位，不处理用户文本或递归套入的模板',()=>{
  const p=Model.createProject('<!--EC:RUNTIME-->'); p.description='<!--EC:DATA-->';
  const html=Serialization.buildDocument({...bundle,node:'<template id="ec-module-template"><!--EC:TITLE--></template>'},p);
  assert.deepEqual(Serialization.readProject(html),p); assert.match(html,/<template id="ec-module-template"><!--EC:TITLE--><\/template>/);
  assert.equal((html.match(/globalThis.started = true;/g)||[]).length,2);
});
test('拒绝缺失、重复、错误类型、坏 JSON 与不支持版本的数据块',()=>{
  const p=Model.createProject('x'), tag=`<script id="ec-project" type="application/json">${JSON.stringify(p)}</script>`;
  for(const html of ['',tag+tag,tag.replace('application/json','text/javascript'),'<script id="ec-project" type="application/json">{</script>',tag.replace('"formatVersion":1','"formatVersion":2')]) assert.throws(()=>Serialization.readProject(html));
  assert.throws(()=>Serialization.readProject(tag+'<script id="ec-project"></script>'));
  assert.deepEqual(Serialization.readProject('<!--'+tag+'-->'+tag),p);
  assert.deepEqual(Serialization.readProject(tag.replace('id="ec-project"','ID=ec-project').replace('type="application/json"',"TYPE='application/json'")),p);
});
test('损坏项目和不完整模板在组装时被拒绝，草稿可以组装',()=>{
  const p=Model.createProject(''); assert.ok(assemble(p,bundle).includes('ec-project'));
  assert.throws(()=>assemble({...p,modules:null},bundle),/modules/);
  assert.throws(()=>assemble(p,{...bundle,canvas:'<!--EC:DATA-->'}),/TITLE|槽位|slot/);
  assert.throws(()=>assemble(p,{...bundle,runtime:null}));
});
test('检查命令读 HTML 并给出结构问题，坏输入非零退出',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ec-check-'));
  try {
    const file=path.join(dir,'project.html'); await writeFile(file,assemble(Model.createProject('示例'),bundle));
    const script=new URL('../scripts/check.mjs',import.meta.url);
    const valid=spawnSync(process.execPath,[script.pathname.replace(/^\/(\w:)/,'$1'),file],{encoding:'utf8'});
    assert.equal(valid.status,0,valid.stderr); assert.match(valid.stdout,/warnings/);
    const bad={...Model.createProject('bad'),modules:null};
    await writeFile(file,`<script id="ec-project" type="application/json">${JSON.stringify(bad)}</script>`);
    const invalid=spawnSync(process.execPath,[script.pathname.replace(/^\/(\w:)/,'$1'),file],{encoding:'utf8'});
    assert.notEqual(invalid.status,0); assert.match(invalid.stdout,/modules/);
    await writeFile(file,'broken');
    const malformed=spawnSync(process.execPath,[script.pathname.replace(/^\/(\w:)/,'$1'),file],{encoding:'utf8'});
    assert.notEqual(malformed.status,0); assert.ok(malformed.stderr.trim());
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('设计示例有六个模块和三个组，结构有效',async()=>{
  const p=JSON.parse(await readFile(new URL('../examples/task-board.json',import.meta.url),'utf8'));
  assert.equal(p.mode,'design'); assert.match(p.description,/设计示例/);
  assert.equal(p.modules.length,6); assert.equal(p.groups.length,3);
  assert.deepEqual(Model.validate(p).errors,[]); assert.ok(p.modules.every(m=>m.status==='planned'));
});
test('组装覆盖指定文件，失败保留旧文件，临时完整模板按约定顺序加载',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ec-build-'));
  try {
    await mkdir(path.join(dir,'templates')); await mkdir(path.join(dir,'assets'));
    await writeFile(path.join(dir,'templates/canvas.html'),bundle.canvas);
    await writeFile(path.join(dir,'templates/module-node.html'),bundle.node);
    await writeFile(path.join(dir,'assets/editor.css'),bundle.css);
    const scripts=['model','serialization','storage','feedback','icons','nodes','canvas','module-editor','dialogs','app'];
    for(const name of scripts) await writeFile(path.join(dir,`assets/${name}.js`),`/* ${name} */`);
    const loaded=await loadBundle(pathToFileURL(dir+path.sep));
    assert.deepEqual(loaded,{...bundle,runtime:scripts.map(name=>`/* ${name} */`).join('\n;\n')});
    const projectPath=path.join(dir,'input.json'), output=path.join(dir,'result.html'), p=Model.createProject('第一次');
    await writeFile(projectPath,JSON.stringify(p)); await build(projectPath,output,loaded);
    p.name='第二次'; await writeFile(projectPath,JSON.stringify(p)); await build(projectPath,output,loaded);
    const saved=await readFile(output,'utf8'); assert.deepEqual(Serialization.readProject(saved),p);
    await writeFile(projectPath,JSON.stringify({...p,modules:null}));
    await assert.rejects(build(projectPath,output,loaded),/modules/);
    assert.equal(await readFile(output,'utf8'),saved);
    const buildScript=fileURLToPath(new URL('../scripts/build.mjs',import.meta.url));
    const usage=spawnSync(process.execPath,[buildScript],{encoding:'utf8'});
    assert.notEqual(usage.status,0); assert.match(usage.stderr,/build.mjs/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
