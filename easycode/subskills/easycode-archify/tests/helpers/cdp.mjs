// Opt-in local test support. Importing this module never launches a browser.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

export async function launchBrowser() {
  if (process.env.EASYCODE_BROWSER_TEST !== '1') throw new Error('Browser execution requires EASYCODE_BROWSER_TEST=1 and independent local authorization');
  const executable = process.env.EASYCODE_BROWSER_EXECUTABLE;
  if (!executable) throw new Error('Set EASYCODE_BROWSER_EXECUTABLE to an installed Chromium executable');
  if (typeof WebSocket !== 'function') throw new Error('This opt-in runner requires Node 22+ WebSocket support');
  const profile = await mkdtemp(join(tmpdir(),'easycode-browser-'));
  const child = spawn(executable,[
    '--headless=new','--no-first-run','--no-default-browser-check','--disable-extensions',
    '--disable-background-networking','--disable-component-update','--disable-sync',
    '--metrics-recording-only','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
    `--user-data-dir=${profile}`,'about:blank'
  ],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let launchError, exited = false, stderr = '', connection;
  child.on('error',error => {launchError = error;});
  child.on('exit',() => {exited = true;});
  child.stderr.on('data',chunk => {stderr = (stderr + chunk.toString()).slice(-3000);});
  async function close() {
    if (connection) {
      await connection.send('Browser.close').catch(() => {});
      connection.close();
    }
    if (!exited && child.pid) child.kill();
    for (let attempt = 0; !exited && child.pid && attempt < 50; attempt++) await delay(100);
    await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
  try {
    let address;
    const deadline = Date.now() + 15000;
    while (!address && Date.now() < deadline) {
      if (launchError) throw launchError;
      if (exited) throw new Error(`Chromium exited before debugging was ready: ${stderr}`);
      try {
        const [port,path] = (await readFile(join(profile,'DevToolsActivePort'),'utf8')).trim().split(/\r?\n/);
        if (/^\d+$/.test(port) && path?.startsWith('/devtools/browser/')) address = `ws://127.0.0.1:${port}${path}`;
      } catch (error) {if (!['ENOENT','EBUSY'].includes(error.code)) throw error;}
      if (!address) await delay(50);
    }
    if (!address) throw new Error('Timed out waiting for Chromium debugging endpoint');
    connection = await connect(address);
    return {...connection,close};
  } catch (error) {await close(); throw error;}
}

async function connect(address) {
  const socket = new WebSocket(address), pending = new Map(), listeners = new Set();
  let sequence = 0;
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => {socket.close(); reject(new Error('CDP WebSocket open timed out'));},10000);
    socket.addEventListener('open',() => {clearTimeout(timer); resolve();},{once:true});
    socket.addEventListener('error',() => {clearTimeout(timer); reject(new Error('CDP WebSocket failed'));},{once:true});
  });
  socket.addEventListener('message',event => {
    const packet = JSON.parse(String(event.data));
    if (packet.id) {
      const entry = pending.get(packet.id);
      if (!entry) return;
      pending.delete(packet.id); clearTimeout(entry.timer);
      if (packet.error) entry.reject(new Error(`${entry.method}: ${packet.error.message}`));
      else entry.resolve(packet.result);
    } else for (const listener of listeners) listener(packet);
  });
  socket.addEventListener('close',() => {
    for (const entry of pending.values()) {clearTimeout(entry.timer); entry.reject(new Error('CDP connection closed'));}
    pending.clear();
  });
  return {
    send(method,params = {},sessionId) {
      const id = ++sequence;
      return new Promise((resolve,reject) => {
        const timer = setTimeout(() => {pending.delete(id); reject(new Error(`CDP timeout: ${method}`));},15000);
        pending.set(id,{resolve,reject,timer,method});
        try {socket.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}));}
        catch (error) {clearTimeout(timer); pending.delete(id); reject(error);}
      });
    },
    onEvent(listener) {listeners.add(listener); return () => listeners.delete(listener);},
    close() {socket.close();}
  };
}

export async function createPage(browser) {
  const {targetId} = await browser.send('Target.createTarget',{url:'about:blank'});
  const {sessionId} = await browser.send('Target.attachToTarget',{targetId,flatten:true});
  const send = (method,params) => browser.send(method,params,sessionId);
  const pageErrors = [], consoleErrors = [], blockedRequests = [], networkRequests = [], protocolErrors = [];
  browser.onEvent(event => {
    if (event.sessionId !== sessionId) return;
    const {method,params} = event;
    if (method === 'Runtime.exceptionThrown') pageErrors.push(params.exceptionDetails.text + ': ' + (params.exceptionDetails.exception?.description || ''));
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') consoleErrors.push(params.args.map(arg => arg.value ?? arg.description).join(' '));
    if (method === 'Log.entryAdded' && params.entry.level === 'error') consoleErrors.push(params.entry.text);
    if (method === 'Network.requestWillBeSent' && /^https?:/i.test(params.request.url)) networkRequests.push(params.request.url);
    if (method === 'Fetch.requestPaused') {
      blockedRequests.push(params.request.url);
      void send('Fetch.failRequest',{requestId:params.requestId,errorReason:'BlockedByClient'}).catch(error => protocolErrors.push(error.message));
    }
    if (method === 'Page.javascriptDialogOpening') {
      // Native confirm/leave-page dialogs only; file pickers remain separately untested.
      void send('Page.handleJavaScriptDialog',{accept:true}).catch(error => protocolErrors.push(error.message));
    }
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'http://*',requestStage:'Request'},{urlPattern:'https://*',requestStage:'Request'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  async function waitFor(expression) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {if (await evaluate(expression)) return; await delay(30);}
    throw new Error(`Timed out: ${expression}`);
  }
  async function navigate(url) {
    if (!url.startsWith('file://')) throw new Error('This test accepts only a local file URL; it never serves the page');
    const result = await send('Page.navigate',{url});
    if (result.errorText) throw new Error(result.errorText);
    await waitFor('document.readyState === "complete" && Boolean(globalThis.EasyCode?.app)');
  }
  async function point(selector,text) {
    return evaluate(`(() => {
      const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const node = elements.find(el => (${JSON.stringify(text)} === undefined || el.textContent.trim() === ${JSON.stringify(text)}) && el.getClientRects().length && !el.closest('[hidden]'));
      if (!node) throw new Error('No visible control: ' + ${JSON.stringify(selector)});
      node.scrollIntoView({block:'center',inline:'center'});
      const r = node.getBoundingClientRect(); return {x:r.left + r.width / 2,y:r.top + Math.min(r.height / 2,12)};
    })()`);
  }
  async function click(selector,text) {
    const p = await point(selector,text);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});
  }
  async function fill(selector,value) {
    await evaluate(`(() => {const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.closest('[hidden]')) throw new Error('Missing visible input'); el.focus(); el.select();})()`);
    await send('Input.insertText',{text:value});
  }
  async function select(selector,value) {
    await evaluate(`(() => {const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing select'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  async function drag(selector,dx,dy) {
    const p = await point(selector);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:p.x + dx / 2,y:p.y + dy / 2});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:p.x + dx,y:p.y + dy});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:p.x + dx,y:p.y + dy});
  }
  return {send,evaluate,waitFor,navigate,click,fill,select,drag,pageErrors,consoleErrors,blockedRequests,networkRequests,protocolErrors};
}
