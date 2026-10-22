'use strict';

// Run the actual page script with a small DOM and deterministic network/timer fakes.
// No browser packages or application-only test hooks are required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../local_client/web/app.js'), 'utf8');
const settle = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

class Element {
  constructor() {
    this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false;
    this.open = false; this.dataset = {}; this.listeners = new Map(); this.attributes = {};
    const classes = new Set();
    this.classList = {
      toggle(name, active) {
        const enabled = active === undefined ? !classes.has(name) : active;
        if (enabled) classes.add(name); else classes.delete(name);
        return enabled;
      },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    };
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  async dispatch(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
  setAttribute(name, value) { this.attributes[name] = value; }
  append() {}
  replaceChildren() {}
  focus() {}
  reportValidity() { return true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.get('close')?.(); }
}

class Clock {
  constructor() { this.now = 0; this.nextId = 1; this.timers = new Map(); }
  add(callback, delay, interval = false) {
    const id = this.nextId++;
    this.timers.set(id, { callback, at: this.now + delay, delay, interval });
    return id;
  }
  async advance(milliseconds) {
    const end = this.now + milliseconds;
    while (true) {
      const pending = [...this.timers].filter(([, timer]) => timer.at <= end)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0]);
      if (!pending.length) break;
      const [id, timer] = pending[0]; this.now = timer.at;
      if (timer.interval) timer.at += timer.delay; else this.timers.delete(id);
      timer.callback();
      await settle();
    }
    this.now = end;
    await settle();
  }
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function hangingRequest(request) {
  return new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

async function page(initial = {}) {
  const clock = new Clock(), nodes = new Map(), requests = [], routes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const form = element('connection-form');
  form.elements = Object.fromEntries(['host', 'port', 'username', 'password', 'folder', 'proxy',
    'remote_os', 'remote_mount_path'].map(name => [name, new Element()]));
  Object.assign(form.elements.host, { value: 'example.test' });
  Object.assign(form.elements.port, { value: '22' });
  Object.assign(form.elements.proxy, { value: 'socks5://localhost:1080' });
  Object.assign(form.elements.remote_os, { value: 'Linux' });
  form.querySelectorAll = () => Object.values(form.elements);
  element('verify-readwrite').textContent = '验证读写';
  const document = {
    hidden: false, getElementById: element, querySelector: element,
    querySelectorAll: () => [], createElement: () => new Element(),
    createTextNode: text => text, addEventListener() {},
  };
  let status = { state: 'connected', phase: 'readable', message: '目录可读取',
    mount_path: '/remote/project', readwrite_result: null, ...initial };
  const context = vm.createContext({
    document, location: { hash: '#token=fixture-token' }, URLSearchParams, AbortController,
    setTimeout: (callback, delay) => clock.add(callback, delay),
    clearTimeout: id => clock.timers.delete(id),
    setInterval: (callback, delay) => clock.add(callback, delay, true),
    fetch: async (url, options) => {
      const request = { url, ...options }; requests.push(request);
      if (routes.has(url)) return routes.get(url)(request);
      if (url === '/api/status') return response(status);
      throw new Error('Unexpected request: ' + url);
    },
  });
  vm.runInContext(script, context, { filename: 'app.js' });
  await settle();
  return { clock, element, routes, requests,
    evaluate: expression => vm.runInContext(expression, context),
    setStatus: next => { status = { ...status, ...next }; },
  };
}

test('a hung status request aborts and the regular polling loop recovers', async () => {
  const app = await page();
  app.routes.set('/api/status', hangingRequest);
  const refresh = app.evaluate('refresh()');
  await settle();
  const stalled = app.requests.at(-1);
  await app.clock.advance(10000);
  await refresh;
  assert.equal(stalled.signal.aborted, true);
  assert.equal(app.evaluate('refreshInFlight'), false);
  assert.match(app.element('status-message').textContent, /请求超时（10 秒）/);
  app.routes.delete('/api/status');
  await app.clock.advance(2000);
  assert.equal(app.element('top-status').textContent, '目录可读取');
  assert.equal(app.evaluate('refreshInFlight'), false);
});

test('the deadline covers a stalled JSON response body even if it ignores abort', async () => {
  const app = await page();
  app.routes.set('/api/body-test', () => ({ ok: true, json: () => new Promise(() => {}) }));
  const request = app.evaluate("api('/api/body-test')");
  const rejected = assert.rejects(request, /请求超时（10 秒）/);
  await settle();
  const stalled = app.requests.at(-1);
  await app.clock.advance(10000);
  await rejected;
  assert.equal(stalled.signal.aborted, true);
});

test('accepted verification stays pending and status updates show progress and unlock on failure', async () => {
  const app = await page();
  app.routes.set('/api/verify-readwrite', () => {
    app.setStatus({ phase: 'write_verifying', message: '远端正在读取临时文件' });
    return response({ ok: true, pending: true }, 202);
  });
  await app.element('verify-readwrite').dispatch('click');
  assert.equal(app.evaluate('diagnosticBusy'), '');
  assert.equal(app.element('verify-readwrite').disabled, true);
  assert.equal(app.element('disconnect-button').disabled, false);
  assert.match(app.element('readwrite-result').textContent, /远端正在读取/);
  assert.doesNotMatch(app.element('readwrite-result').textContent, /验证通过/);
  app.setStatus({ message: '正在确认本地写回' });
  await app.clock.advance(2000);
  assert.equal(app.element('readwrite-result').textContent, '正在确认本地写回');
  app.setStatus({ phase: 'readable', message: '写回超时',
    readwrite_result: { ok: false, message: '本地写回超时，请重测。' } });
  await app.clock.advance(2000);
  assert.equal(app.element('verify-readwrite').disabled, false);
  assert.equal(app.element('verify-readwrite').textContent, '验证读写');
  assert.equal(app.element('readwrite-result').classList.contains('error'), true);
  assert.match(app.element('readwrite-result').textContent, /写回超时/);
});

test('timed out verification submissions unlock controls without retrying the action', async () => {
  const app = await page();
  app.routes.set('/api/verify-readwrite', hangingRequest);
  const action = app.element('verify-readwrite').dispatch('click');
  await settle();
  assert.equal(app.element('verify-readwrite').disabled, true);
  await app.clock.advance(10000);
  await action;
  assert.equal(app.evaluate('diagnosticBusy'), '');
  assert.equal(app.element('verify-readwrite').disabled, false);
  assert.match(app.element('readwrite-result').textContent, /请求超时/);
  assert.match(app.element('toast').textContent, /不要重复提交/);
  app.setStatus({ phase: 'write_verifying', message: '服务已恢复，正在验证读写' });
  await app.clock.advance(2000);
  assert.equal(app.element('readwrite-result').classList.contains('error'), false);
  assert.equal(app.element('verify-readwrite').disabled, true);
  app.setStatus({ phase: 'write_verified', readwrite_result: { ok: true, message: '读写验证通过' } });
  await app.clock.advance(2000);
  assert.equal(app.element('readwrite-result').textContent, '读写验证通过');
  assert.equal(app.element('verify-readwrite').disabled, false);
  assert.equal(app.requests.filter(request => request.url === '/api/verify-readwrite').length, 1);
});

test('a late status response from before submission cannot undo accepted pending state', async () => {
  const app = await page();
  let finishStale;
  app.routes.set('/api/status', () => new Promise(resolve => { finishStale = resolve; }));
  const stale = app.evaluate('refresh()');
  app.routes.set('/api/verify-readwrite', () => response({ ok: true, pending: true }, 202));
  await app.element('verify-readwrite').dispatch('click');
  finishStale(response({ state: 'connected', phase: 'write_verified',
    readwrite_result: { ok: true, message: '上一次读写验证通过' } }));
  await stale;
  assert.equal(app.evaluate('phase'), 'write_verifying');
  assert.equal(app.element('verify-readwrite').disabled, true);
  assert.doesNotMatch(app.element('readwrite-result').textContent, /验证通过/);
});

test('automatic verification progress continues while a manual submission is still responding', async () => {
  const app = await page();
  app.routes.set('/api/verify-readwrite', hangingRequest);
  const action = app.element('verify-readwrite').dispatch('click');
  app.setStatus({ phase: 'write_verifying', message: '正在确认写回，剩余 5 秒' });
  await app.clock.advance(2000);
  assert.equal(app.element('readwrite-result').textContent, '正在确认写回，剩余 5 秒');
  await app.clock.advance(8000);
  await action;
  assert.equal(app.element('disconnect-button').disabled, false);
});

test('diagnostics and directory selection use their bounded longer deadlines', async () => {
  const app = await page({ state: 'disconnected', phase: 'idle' });
  app.routes.set('/api/test-server', hangingRequest);
  const diagnostic = app.element('test-server').dispatch('click');
  await app.clock.advance(34999);
  assert.equal(app.evaluate('diagnosticBusy'), 'server');
  await app.clock.advance(1);
  await diagnostic;
  assert.match(app.element('server-test-result').textContent, /请求超时（35 秒）/);
  assert.equal(app.element('test-server').disabled, false);

  app.routes.set('/api/pick-directory', hangingRequest);
  const picker = app.element('pick-directory').dispatch('click');
  await app.clock.advance(124999);
  assert.equal(app.element('pick-directory').disabled, true);
  await app.clock.advance(1);
  await picker;
  assert.match(app.element('toast').textContent, /请求超时（125 秒）/);
  assert.equal(app.element('pick-directory').disabled, false);
  assert.equal(app.evaluate('diagnosticBusy'), '');
});

test('mount occupancy errors preserve the server PID and recovery instructions without claiming readiness', async () => {
  const app = await page({ state: 'connecting', phase: 'mounting', mount_path: '',
    message: '正在挂载目录', settings: { remote_os: 'Linux' } });
  const serverError = '远端挂载失败：挂载目录仍被旧终端占用：PID 4821（cwd）、PID 4822（目录 FD）。\n'
    + '请在对应终端执行 cd ~，关闭占用该目录的编辑器工作区后重连。';
  app.setStatus({ state: 'error', phase: 'error', message: serverError });
  await app.clock.advance(2000);
  assert.equal(app.element('status-message').textContent, serverError);
  assert.equal(app.element('status-message').classList.contains('error'), true);
  assert.equal(app.element('top-status').textContent, '连接失败');
  assert.equal(app.element('connect-button').disabled, false);
  assert.equal(app.element('verify-readwrite').disabled, true);
  assert.equal(app.element('phase-mount').classList.contains('complete'), false);
  assert.equal(app.element('phase-read').classList.contains('complete'), false);
  assert.equal(app.element('readwrite-result').hidden, true);
  assert.equal(app.requests.filter(request => request.url !== '/api/status').length, 0);
  await app.clock.advance(2000);
  assert.equal(app.element('status-message').textContent, serverError);
});
