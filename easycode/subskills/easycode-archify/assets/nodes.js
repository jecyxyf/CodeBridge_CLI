(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const statusNames = {planned:'方案',verified:'已核对源码',modified:'已修改 · 待核对'};
  function create({project,layer,template,onSelect = () => {},onEdit = () => {}}) {
    const elements = new Map();
    let selected = '';
    function render() {
      layer.replaceChildren(); elements.clear();
      for (const module of project.modules) {
        const fragment = template.content.cloneNode(true), node = fragment.querySelector('.module-node');
        EC.Icons.hydrate(node);
        const moduleName = EC.Model.displayName(module,'未命名模块');
        node.dataset.moduleId = module.id; node.setAttribute('aria-label',`模块：${moduleName}`);
        node.style.left = `${module.x}px`; node.style.top = `${module.y}px`; node.classList.toggle('selected',selected === module.id);
        const name = node.querySelector('.module-name'); name.textContent = moduleName; name.title = [module.name,module.englishName].filter(Boolean).join(' / ') || moduleName;
        node.querySelector('.module-purpose').textContent = module.purpose || '尚未填写模块职责';
        node.querySelector('.module-summary').textContent = [`${module.interfaces.length} 个方法`,...['parameters','events','tests'].flatMap((key,index) => module[key]?.length ? [`${module[key].length} 个${['参数','事件','测试项'][index]}`] : [])].join(' · ');
        const state = node.querySelector('[data-module-status]'); state.textContent = statusNames[module.status]; state.dataset.status = module.status;
        node.querySelector('[data-node-action=edit]').addEventListener('click',() => onEdit(module.id));
        for (const port of node.querySelectorAll('[data-port]')) {
          port.setAttribute('aria-label',`${moduleName}：${port.getAttribute('aria-label')}`);
          port.setAttribute('aria-pressed','false');
        }
        node.addEventListener('pointerdown',() => {selected = module.id; for (const [id,item] of elements) item.classList.toggle('selected',id === selected); onSelect(module.id);});
        elements.set(module.id,node); layer.append(fragment);
      }
    }
    return {render,getElement:id => elements.get(id),destroy() {layer.replaceChildren(); elements.clear();}};
  }
  EC.Nodes = {create};
})(globalThis);
