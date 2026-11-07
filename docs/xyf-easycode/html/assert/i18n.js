globalThis.EasyCode.register("i18n",function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const fallback = structuredClone(root.EasyCodeLanguage || {locale:'zh-CN',messages:{}});
  const language = () => root.EasyCodeLanguage || fallback;
  const own = (value,key) => value && Object.hasOwn(value,key);
  const missing = new Set();
  function t(key,params = {}) {
    const current = language();
    let value = own(current.messages,key) ? current.messages[key] : fallback.messages[key];
    if (typeof value !== 'string') {missing.add(key); value = key;}
    return value.replace(/\{([\w.-]+)\}/g,(token,name) => own(params,name) ? String(params[name]) : token);
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g,character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  }
  function template(source) {return source.replace(/\{\{([\w.-]+)\}\}/g,(_,key) => escapeHTML(t(key)));}
  function config() {const current = language(); return structuredClone({...fallback,...current,messages:{...fallback.messages,...current.messages}});}
  EC.I18n = {t,template,config,escapeHTML,missing};
});
