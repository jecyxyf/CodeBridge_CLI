import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import '../assets/model.js';
import '../assets/serialization.js';

export async function check(file) {
  const html = await readFile(file,'utf8');
  return globalThis.EasyCode.Model.validate(globalThis.EasyCode.Serialization.readProject(html));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file] = process.argv.slice(2);
  if (!file) {console.error('用法: node scripts/check.mjs <project.html>'); process.exitCode = 1;}
  else {
    try {
      const result = await check(file); console.log(JSON.stringify(result,null,2));
      if (result.errors.length) process.exitCode = 1;
    } catch (error) {console.error(error.message); process.exitCode = 1;}
  }
}
