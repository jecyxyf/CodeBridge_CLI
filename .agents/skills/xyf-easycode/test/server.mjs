import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {cases,readCase,root} from './fixtures.mjs';
import {assemble,loadBundle} from '../subskills/xyf-archify/tools/html/scripts/build.mjs';

export const instrument = html => html.replace('<head>','<head><script src="/probe.js"></script>');
export async function startServer({port=4174}={}) {
  const bundle=await loadBundle();
  const manifest=await Promise.all(cases.map(async spec=>{
    const data=await readCase(spec.id);
    return {...spec,groups:data.groups.length,relations:data.relations.length,bytes:Buffer.byteLength(JSON.stringify(data)),json:`/json/${spec.id}.json`,page:`/render/${spec.id}`};
  }));
  const server=createServer(async(req,res)=>{
    const send=(status,type,body)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);};
    const json=(status,data)=>send(status,'application/json; charset=utf-8',JSON.stringify(data));
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if(req.method==='POST' && path==='/api/report') {
        if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`) return json(403,{error:'来源不匹配'});
        let body='';for await(const chunk of req) {body+=chunk;if(body.length>2_000_000) return json(413,{error:'报告过大'});}
        const report=JSON.parse(body);
        if(!Array.isArray(report.results) || report.results.length>100 || report.results.some(row=>!cases.some(spec=>spec.id===row.id))) return json(400,{error:'报告格式有误'});
        await writeFile(new URL('report.json',root),JSON.stringify(report,null,2)+'\n','utf8');return json(200,{saved:true});
      }
      if(req.method!=='GET') return json(405,{error:'请求方式不支持'});
      if(path==='/health') return json(200,{ok:true,cases:manifest.length});
      if(path==='/api/cases') return json(200,manifest);
      if(path==='/api/report') {
        try{return send(200,'application/json; charset=utf-8',await readFile(new URL('report.json',root),'utf8'));}
        catch(error){if(error.code==='ENOENT')return json(200,{results:[],status:'尚未测试'});throw error;}
      }
      if(['/','/index.html','/dashboard.js','/probe.js'].includes(path)) {
        const file=path==='/' ? 'index.html' : path.slice(1);
        return send(200,file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',await readFile(new URL(file,root),'utf8'));
      }
      const match=/^\/(json|render)\/(case-\d{3})(?:\.json)?$/.exec(path);
      if(match && cases.some(spec=>spec.id===match[2])) {
        const project=await readCase(match[2]);
        if(match[1]==='json') return json(200,project);
        return send(200,'text/html; charset=utf-8',instrument(assemble(project,bundle)));
      }
      json(404,{error:'页面不存在'});
    } catch(error) {json(500,{error:error.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const {server,url}=await startServer({port:Number(process.argv[2] || 4174)});
  console.log(`测试网页：${url}，100 份 JSON。`);
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
}
