import {readFile,open,rename,unlink,mkdir} from 'node:fs/promises';
import {dirname,basename,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import '../assets/model.js';

export const versionOf = content => '"' + createHash('sha256').update(content).digest('hex') + '"';
export function validateProject(project) {
  const result = globalThis.EasyCode.Model.validate(project);
  if (result.errors.length) throw Object.assign(new Error(result.errors.map(item => `${item.path}: ${item.message}`).join('\n')),{status:422});
  return result;
}
export function parseProject(content) {
  let project;
  try {project = JSON.parse(content.replace(/^\uFEFF/,''));}
  catch {throw Object.assign(new Error('archify.json 不是有效的 JSON，请修正后重试。'),{status:422});}
  validateProject(project);
  return project;
}
export async function readProjectFile(file) {
  const content = await readFile(file,'utf8');
  return {project:parseProject(content),version:versionOf(content),content};
}
export async function fileVersion(file) {
  try {return versionOf(await readFile(file));}
  catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}

// Verify a sibling temporary file before replacing the destination. Never truncate live data.
export async function writeAtomic(file,content,{expectedVersion,verify = () => {}} = {}) {
  await mkdir(dirname(file),{recursive:true});
  const temporary = join(dirname(file),`.${basename(file)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary,'wx');
    try {await handle.writeFile(content,'utf8'); await handle.sync();} finally {await handle.close();}
    await verify(await readFile(temporary,'utf8'));
    if (expectedVersion !== undefined && await fileVersion(file) !== expectedVersion) {
      throw Object.assign(new Error('文件已被其他操作修改，请载入最新内容后再保存。'),{status:409});
    }
    await rename(temporary,file);
  } finally {
    await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error;});
  }
}
export async function writeProjectFile(file,project,{expectedVersion} = {}) {
  validateProject(project);
  const content = JSON.stringify(project,null,2) + '\n';
  const verify = text => {
    if (!isDeepStrictEqual(parseProject(text),project)) throw new Error('JSON 写入核对失败。');
  };
  await writeAtomic(file,content,{expectedVersion,verify});
  const saved = await readProjectFile(file);
  if (!isDeepStrictEqual(saved.project,project)) throw Object.assign(new Error('保存后文件又被修改，请载入最新内容。'),{status:409});
  return saved;
}
