globalThis.EasyCode.register("bootstrap",function (root) {
  'use strict';
  const EC = root.EasyCode;
  function start() {
    document.documentElement.lang = EC.I18n.config().locale || 'zh-CN';
    const style = document.createElement('style'); style.id = 'easycode-style'; style.textContent = EC.styles; document.head.append(style);
    const markup = [EC.Templates.canvas,EC.Templates.module,EC.Templates.layer].map(EC.I18n.template).join('\n');
    document.body.insertAdjacentHTML('afterbegin',markup);
    EC.start();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
});
