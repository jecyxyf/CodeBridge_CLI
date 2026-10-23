(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const svgNS = 'http://www.w3.org/2000/svg';
  const interactive = 'input,textarea,select,button,a,label,summary,dialog,[contenteditable=true]';
  function svg(tag, attributes = {}) {
    const node = document.createElementNS(svgNS,tag);
    for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
    return node;
  }
  function create({project,viewport,world,groupLayer,edgeLayer,nodes,onChange = () => {},onGroupEdit = () => {},onRelationEdit = () => {}}) {
    const view = project.view, listeners = [], groupElements = new Map();
    let drag = null, frame = 0, destroyed = false;
    function listen(target,type,callback,options) {target.addEventListener(type,callback,options); listeners.push(() => target.removeEventListener(type,callback,options));}
    function nodeBounds(module) {
      const node = nodes.getElement(module.id);
      return {x:module.x,y:module.y,width:node?.offsetWidth || 360,height:node?.offsetHeight || 190};
    }
    function groupBounds(group) {
      const members = project.modules.filter(module => module.groupId === group.id).map(nodeBounds);
      if (!members.length) return {x:group.x,y:group.y,width:400,height:170};
      const left = Math.min(...members.map(item => item.x)) - 20, top = Math.min(...members.map(item => item.y)) - 48;
      return {x:left,y:top,width:Math.max(...members.map(item => item.x + item.width)) - left + 20,height:Math.max(...members.map(item => item.y + item.height)) - top + 20};
    }
    function paintGroups() {
      const active = new Set(project.groups.map(group => group.id));
      for (const [id,node] of groupElements) if (!active.has(id)) {node.remove(); groupElements.delete(id);}
      for (const group of project.groups) {
        let node = groupElements.get(group.id);
        if (!node) {
          node = document.createElement('section'); node.className = 'group-frame'; node.dataset.groupId = group.id;
          const header = document.createElement('header'); header.className = 'group-header'; header.dataset.groupId = group.id;
          const title = document.createElement('span'); title.className = 'group-title';
          const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '编辑'; edit.addEventListener('click',() => onGroupEdit(group.id));
          const empty = document.createElement('span'); empty.className = 'group-empty'; empty.textContent = '展开模块，在“所属分组”中加入此组';
          header.append(title,edit); node.append(header,empty); groupLayer.append(node); groupElements.set(group.id,node);
        }
        const bounds = groupBounds(group);
        Object.assign(node.style,{left:`${bounds.x}px`,top:`${bounds.y}px`,width:`${bounds.width}px`,height:`${bounds.height}px`});
        // Only allow an actual color, never arbitrary CSS from the project.
        const color = /^#[\da-f]{6}$/i.test(group.color) ? group.color : '#6da89a';
        node.style.borderColor = `${color}70`; node.style.backgroundColor = `${color}06`;
        node.querySelector('.group-title').textContent = group.name || '未命名分组'; node.querySelector('.group-header').style.color = color;
        node.querySelector('.group-empty').hidden = project.modules.some(module => module.groupId === group.id);
      }
    }
    function paintEdges() {
      edgeLayer.replaceChildren();
      const defs = svg('defs'), marker = svg('marker',{id:'ec-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
      marker.append(svg('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#87a8ce'})); defs.append(marker); edgeLayer.append(defs);
      const parallel = new Map();
      for (const relation of project.relations) {
        const from = project.modules.find(module => module.id === relation.from), to = project.modules.find(module => module.id === relation.to);
        if (!from || !to) continue;
        const a = nodeBounds(from), b = nodeBounds(to), forward = b.x + b.width / 2 >= a.x + a.width / 2;
        const key = [from.id,to.id].sort().join('|'), lane = parallel.get(key) || 0; parallel.set(key,lane + 1);
        const startX = forward ? a.x + a.width : a.x, endX = forward ? b.x : b.x + b.width;
        const offset = Math.min(60,lane * 20), startY = a.y + Math.min(a.height - 18,72 + offset), endY = b.y + Math.min(b.height - 18,72 + offset);
        const bend = Math.max(55,Math.abs(endX - startX) * .48), direction = forward ? 1 : -1;
        const path = `M ${startX} ${startY} C ${startX + bend * direction} ${startY}, ${endX - bend * direction} ${endY}, ${endX} ${endY}`;
        const group = svg('g',{'class':'relation-group','tabindex':0,'role':'button','aria-label':`${from.name} → ${to.name}，${relation.type === 'call' ? '调用' : '依赖'}：${relation.label || '无说明'}`,'data-relation-id':relation.id});
        group.append(svg('path',{d:path,class:`relation-line ${relation.type}`,'marker-end':'url(#ec-arrow)'}),svg('path',{d:path,class:'relation-hit'}));
        const label = svg('text',{x:(startX + endX) / 2,y:(startY + endY) / 2 - 9 - lane * 3,class:'relation-label','text-anchor':'middle'});
        label.textContent = relation.label || (relation.type === 'call' ? '调用' : '依赖'); group.append(label);
        group.addEventListener('click',() => onRelationEdit(relation.id));
        group.addEventListener('keydown',event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); onRelationEdit(relation.id);}});
        edgeLayer.append(group);
      }
    }
    function refresh() {
      if (destroyed) return;
      world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
      viewport.style.backgroundSize = `${24 * view.scale}px ${24 * view.scale}px`;
      viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
      for (const module of project.modules) {
        const node = nodes.getElement(module.id); if (node) {node.style.left = `${module.x}px`; node.style.top = `${module.y}px`;}
      }
      paintGroups(); paintEdges();
      const zoom = document.getElementById('ec-zoom'); if (zoom) zoom.textContent = `${Math.round(view.scale * 100)}%`;
    }
    function scheduleRefresh() {if (!frame) frame = requestAnimationFrame(() => {frame = 0; refresh();});}
    function changed() {onChange({semantic:false,render:false});}
    function centerPoint() {return {x:(viewport.clientWidth / 2 - view.x) / view.scale,y:(viewport.clientHeight / 2 - view.y) / view.scale};}
    function zoomAt(factor,x,y) {
      const next = Math.max(.25,Math.min(1.8,view.scale * factor)); if (next === view.scale) return;
      const wx = (x - view.x) / view.scale, wy = (y - view.y) / view.scale;
      view.scale = next; view.x = x - wx * next; view.y = y - wy * next; refresh(); changed();
    }
    function zoomBy(factor) {zoomAt(factor,viewport.clientWidth / 2,viewport.clientHeight / 2);}
    function fit({notify = true} = {}) {
      const bounds = [...project.modules.map(nodeBounds),...project.groups.map(groupBounds)];
      if (!bounds.length) {view.x = 0; view.y = 0; view.scale = 1;}
      else {
        const left = Math.min(...bounds.map(item => item.x)), top = Math.min(...bounds.map(item => item.y));
        const width = Math.max(...bounds.map(item => item.x + item.width)) - left, height = Math.max(...bounds.map(item => item.y + item.height)) - top;
        view.scale = Math.max(.25,Math.min(1.2,(viewport.clientWidth - 100) / width,(viewport.clientHeight - 100) / height));
        view.x = (viewport.clientWidth - width * view.scale) / 2 - left * view.scale;
        view.y = (viewport.clientHeight - height * view.scale) / 2 - top * view.scale;
      }
      refresh(); if (notify) changed();
    }
    listen(viewport,'wheel',event => {
      // Text boxes and selects retain normal scrolling and selection behavior.
      if (event.target.closest(interactive)) return;
      event.preventDefault(); const rect = viewport.getBoundingClientRect(); zoomAt(Math.exp(-event.deltaY * .0015),event.clientX - rect.left,event.clientY - rect.top);
    },{passive:false});
    listen(viewport,'pointerdown',event => {
      if (event.button !== 0 && event.button !== 1 || event.target.closest(interactive)) return;
      const header = event.target.closest('.module-header'), groupHeader = event.target.closest('.group-header');
      const blank = !event.target.closest('.module-node,.group-frame,.relation-group');
      if (!header && !groupHeader && !blank && event.button !== 1) return;
      const start = {pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
      if (event.button === 1 || !header && !groupHeader) drag = {...start,type:'pan',viewX:view.x,viewY:view.y};
      else if (header) {
        const module = project.modules.find(item => item.id === header.closest('.module-node').dataset.moduleId);
        drag = {...start,type:'nodes',positions:[{module,x:module.x,y:module.y}]};
      } else {
        const group = project.groups.find(item => item.id === groupHeader.dataset.groupId);
        drag = {...start,type:'nodes',group,groupX:group.x,groupY:group.y,positions:project.modules.filter(module => module.groupId === group.id).map(module => ({module,x:module.x,y:module.y}))};
      }
      event.preventDefault(); viewport.setPointerCapture(event.pointerId); viewport.style.cursor = 'grabbing';
    });
    listen(viewport,'pointermove',event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      drag.moved = true;
      if (drag.type === 'pan') {view.x = drag.viewX + dx; view.y = drag.viewY + dy;}
      else {
        for (const item of drag.positions) EC.Model.updateModule(project,item.module.id,{x:item.x + dx / view.scale,y:item.y + dy / view.scale});
        if (drag.group) {drag.group.x = drag.groupX + dx / view.scale; drag.group.y = drag.groupY + dy / view.scale;}
      }
      scheduleRefresh();
    });
    function endDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = drag.moved; drag = null; viewport.style.cursor = '';
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (moved) {refresh(); changed();}
    }
    listen(viewport,'pointerup',endDrag); listen(viewport,'pointercancel',endDrag); listen(viewport,'lostpointercapture',endDrag);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRefresh) : null;
    if (observer) {observer.observe(viewport); for (const module of project.modules) {const node = nodes.getElement(module.id); if (node) observer.observe(node);}}
    // Observe new nodes after structural edits, without watching every input mutation.
    const mutation = new MutationObserver(() => {if (observer) {observer.disconnect(); observer.observe(viewport); for (const module of project.modules) {const node = nodes.getElement(module.id); if (node) observer.observe(node);}} scheduleRefresh();});
    mutation.observe(document.getElementById('ec-nodes') || world,{childList:true});
    refresh();
    return {refresh,fit,zoomBy,centerPoint,destroy() {destroyed = true; listeners.forEach(remove => remove()); observer?.disconnect(); mutation.disconnect(); if (frame) cancelAnimationFrame(frame); groupLayer.replaceChildren(); edgeLayer.replaceChildren();}};
  }
  EC.Canvas = {create};
})(globalThis);
