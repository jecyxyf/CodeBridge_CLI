import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readProjectFile,writeProjectFile,validateProject} from './scripts/files.mjs';
import './assets/serialization.js';

export const toolsRoot = fileURLToPath(new URL('../',import.meta.url));
export async function startServer({root = toolsRoot,port,firstPort = 4175} = {}) {
  root = resolve(root);
  const projectFile = join(root,'archify.js');
  await readProjectFile(projectFile);
  const entry = await readFile(join(root,'index.html'),'utf8');
  let serviceEntry = false;
  try {globalThis.EasyCode.Serialization.readProject(entry);} catch (error) {serviceEntry = error.code === 'SERVICE_ENTRY';}
  if (!serviceEntry) throw new Error('index.html 不是服务入口。直接双击可使用本地编辑器；需要服务时先运行 html/scripts/build.mjs --service。');
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error('端口应为 0～65535 的整数。');
  let writes = Promise.resolve();
  const server = createServer(async (req,res) => {
    const send = (status,type,body,headers = {}) => {
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
      res.end(body);
    };
    const json = (status,data,headers) => send(status,'application/json; charset=utf-8',JSON.stringify(data),headers);
    try {
      const localPort = server.address().port;
      const hosts = new Set([`127.0.0.1:${localPort}`,`localhost:${localPort}`]);
      if (!hosts.has(req.headers.host)) return json(403,{error:'请使用本机服务地址访问。'});
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403,{error:'请求来源不匹配。'});
      const path = new URL(req.url,`http://${req.headers.host}`).pathname;
      if (req.method === 'GET' && path === '/health') {
        await readProjectFile(projectFile);
        return json(200,{ok:true,service:'easycode-archify',root,projectFile,pid:process.pid});
      }
      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        return send(200,'text/html; charset=utf-8',await readFile(join(root,'index.html'),'utf8'));
      }
      if (req.method === 'GET' && path === '/archify.js') {
        const current = await readProjectFile(projectFile);
        return send(200,'text/javascript; charset=utf-8',current.content,{ETag:current.version});
      }
      if (req.method === 'GET' && path === '/api/project') {
        const current = await readProjectFile(projectFile);
        if (req.headers['if-none-match'] === current.version) return send(304,'application/json','',{ETag:current.version});
        return json(200,current.project,{ETag:current.version});
      }
      if (req.method === 'PUT' && path === '/api/project') {
        if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return json(415,{error:'请发送 JSON。'});
        const expectedVersion = req.headers['if-match'];
        if (!expectedVersion) return json(428,{error:'保存前需要读取当前文件版本。'});
        const chunks = []; let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 32 * 1024 * 1024) return json(413,{error:'项目文件超过 32 MB。'});
          chunks.push(chunk);
        }
        let project;
        try {project = JSON.parse(Buffer.concat(chunks).toString('utf8'));}
        catch {return json(422,{error:'请求内容不是有效的 JSON。'});}
        validateProject(project);
        // Serialize browser saves; the expected file hash also detects edits made by skills.
        const operation = writes.then(() => writeProjectFile(projectFile,project,{expectedVersion}));
        writes = operation.catch(() => {});
        const saved = await operation;
        return json(200,{saved:true},{ETag:saved.version});
      }
      if (req.method !== 'GET') return json(405,{error:'请求方式不支持。'});
      if (path === '/favicon.ico') return send(204,'image/x-icon','');
      if (path === '/README.md') return send(200,'text/plain; charset=utf-8',await readFile(join(root,'README.md'),'utf8'));
      // Only package assets are public; no arbitrary local file paths or commands.
      if (/^\/html\/(assets|templates)\/[a-zA-Z0-9_.-]+\.(js|css|html|json|jsonc)$/.test(path)) {
        const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : 'application/json';
        return send(200,`${type}; charset=utf-8`,await readFile(join(root,path.slice(1)),'utf8'));
      }
      json(404,{error:'页面不存在。'});
    } catch (error) {
      json(error.status || (error.code === 'ENOENT' ? 404 : 500),{error:error.message});
    }
  });
  server.requestTimeout = 30000;
  const listen = candidate => new Promise((done,fail) => {
    const onError = error => {server.off('listening',onListen); fail(error);};
    const onListen = () => {server.off('error',onError); done();};
    server.once('error',onError); server.once('listening',onListen); server.listen(candidate,'127.0.0.1');
  });
  for (let attempt = 0; ; attempt++) {
    try {await listen(port ?? firstPort + attempt); break;}
    catch (error) {if (port !== undefined || error.code !== 'EADDRINUSE' || attempt >= 20) throw error;}
  }
  const url = `http://127.0.0.1:${server.address().port}`;
  return {server,url,root,projectFile};
}

export function keepRunning({server,url,projectFile}) {
  console.log(`网页地址：${url}/\n项目数据：${projectFile}\n按 Ctrl+C 停止服务。`);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,() => {
    server.close(); server.closeIdleConnections();
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('用法：node html/server.mjs [--port 4175]');
    keepRunning(await startServer({port:args.length ? Number(args[1]) : undefined}));
  } catch (error) {console.error(error.message); process.exitCode = 1;}
}
