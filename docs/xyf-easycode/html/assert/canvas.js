globalThis.EasyCode.register("canvas",function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const t = (key, params) => EC.I18n.t(key, params);
  const gridSize = 10;
  const minScale = .01;
  const svgNS = 'http://www.w3.org/2000/svg';
  const interactive = 'input,textarea,select,button,a,label,summary,dialog,[contenteditable=true]';
  const portNames = {top:t('canvas.portTop'),right:t('canvas.portRight'),bottom:t('canvas.portBottom'),left:t('canvas.portLeft')};
  function portAnchor(bounds,side,gap = 7) {
    const vectors = {top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]};
    const [nx,ny] = vectors[side];
    return {x:bounds.x + bounds.width / 2 + nx * (bounds.width / 2 + gap),y:bounds.y + bounds.height / 2 + ny * (bounds.height / 2 + gap),nx,ny};
  }
  function curveBetween(start,end,lane = 0) {
    const bend = Math.max(48,Math.min(240,Math.hypot(end.x - start.x,end.y - start.y) * .45)) + lane * 28;
    const c1 = {x:start.x + start.nx * bend,y:start.y + start.ny * bend};
    const c2 = {x:end.x + end.nx * bend,y:end.y + end.ny * bend};
    if (lane) {
      const distance = Math.hypot(end.x - start.x,end.y - start.y), tx = distance ? (end.x - start.x) / distance : 1, ty = distance ? (end.y - start.y) / distance : 0;
      const mid = {x:(start.x + 3 * c1.x + 3 * c2.x + end.x) / 8 - ty * lane * 28,y:(start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 + tx * lane * 28};
      const handle = Math.min(70,Math.max(24,distance / 6));
      return {start,end,c1,c2,path:`M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${mid.x - tx * handle} ${mid.y - ty * handle}, ${mid.x} ${mid.y} C ${mid.x + tx * handle} ${mid.y + ty * handle}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,label:{x:mid.x,y:mid.y - 9}};
    }
    return {start,end,c1,c2,path:`M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
      label:{x:(start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,y:(start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 - 9}};
  }
  function relationGeometry(a,b,relation,lane = 0) {
    // Older HTML has no saved ports. Keep its left/right choice without rewriting its data.
    const forward = b.x + b.width / 2 >= a.x + a.width / 2;
    return curveBetween(portAnchor(a,relation.fromPort || (forward ? 'right' : 'left')),portAnchor(b,relation.toPort || (forward ? 'left' : 'right')),lane);
  }
  function createConnection({project,onChange = () => {},onState = () => {}}) {
    let source = null, active = false, message = '';
    const getState = () => ({source:source ? {...source} : null,active,message});
    function publish(text) {message = text; onState(getState());}
    function cancel() {source = null; active = false; publish('');}
    function start() {
      source = null; active = project.modules.length >= 2;
      publish(active ? t('canvas.connectionHint') : t('canvas.connectionNeedsModules'));
    }
    function reconcile() {if (source && !project.modules.some(item => item.id === source.moduleId)) cancel();}
    function begin(moduleId,port) {
      cancel();
      const module = project.modules.find(item => item.id === moduleId);
      if (!module || !Object.hasOwn(portNames,port)) return false;
      if (project.modules.length < 2) {start(); return false;}
      source = {moduleId,port}; active = true;
      publish(t('canvas.connectionSource',{name:EC.Model.displayName(module,t('canvas.unnamedModule')),port:portNames[port]}));
      return true;
    }
    function complete(moduleId,port) {
      reconcile();
      if (!source) return false;
      const from = source; cancel();
      if (!project.modules.some(item => item.id === moduleId) || !Object.hasOwn(portNames,port) || from.moduleId === moduleId) return false;
      try {EC.Model.addRelation(project,{from:from.moduleId,fromPort:from.port,to:moduleId,toPort:port});}
      catch (error) {publish(error.message); return false;}
      onChange({semantic:true,render:false}); return true;
    }
    return {start,cancel,begin,complete,reconcile,getState};
  }

  function snapPoint({x,y}) {
    return {x:Math.round(x / gridSize) * gridSize || 0,y:Math.round(y / gridSize) * gridSize || 0};
  }
  function gridStyle(view) {
    const size = gridSize * 2 * view.scale;
    // The gradient's dot is at the tile center; offset half a tile to put it at world (0,0).
    return {backgroundSize:`${size}px ${size}px`,backgroundPosition:`${view.x - size / 2}px ${view.y - size / 2}px`};
  }
  function groupBounds(group,members) {
    if (!members.length) return {x:group.x,y:group.y,width:400,height:170};
    // Round the enclosing frame outwards, keeping the existing member layout intact.
    const left = Math.floor((Math.min(...members.map(item => item.x)) - 20) / gridSize) * gridSize;
    const top = Math.floor((Math.min(...members.map(item => item.y)) - 56) / gridSize) * gridSize;
    const right = Math.ceil((Math.max(...members.map(item => item.x + item.width)) + 20) / gridSize) * gridSize;
    const bottom = Math.ceil((Math.max(...members.map(item => item.y + item.height)) + 20) / gridSize) * gridSize;
    return {x:left,y:top,width:right - left,height:bottom - top};
  }
  function moveSelection(project,selection,dx,dy,scale) {
    const target = snapPoint({x:selection.anchor.x + dx / scale,y:selection.anchor.y + dy / scale});
    const offsetX = target.x - selection.anchor.x, offsetY = target.y - selection.anchor.y;
    // One shared offset preserves member spacing, including older layouts that are off-grid.
    for (const item of selection.positions) EC.Model.updateModule(project,item.module.id,selection.group ? {x:item.x + offsetX,y:item.y + offsetY} : target);
    if (selection.group) {
      selection.group.x = offsetX || offsetY ? target.x : selection.groupX;
      selection.group.y = offsetX || offsetY ? target.y : selection.groupY;
    }
  }
  function svg(tag, attributes = {}) {
    const node = document.createElementNS(svgNS,tag);
    for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,String(value));
    return node;
  }
  function layerAppearance(group) {
    const valid = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
    const color = valid(group?.color) ? group.color : '#ffffff';
    const fill = valid(group?.backgroundColor) ? group.backgroundColor : '#81b3e9';
    const rgb = fill.slice(1).match(/../g).map(pair => parseInt(pair,16));
    return {color,backgroundColor:`rgba(${rgb.join(',')},0.5)`};
  }
  function relationLabelAppearance(project,relation) {
    const from = project.modules.find(module => module.id === relation?.from);
    return layerAppearance(project.groups.find(group => group.id === from?.groupId));
  }
  function create({project,viewport,world,groupLayer,groupTemplate,edgeLayer,nodes,onChange = () => {},onGroupEdit = () => {},confirm = message => EC.Dialogs.confirm(message)}) {
    if (!groupTemplate?.content?.querySelector('.group-frame')) throw new Error(t('canvas.missingLayerTemplate'));
    const view = project.view, listeners = [], groupElements = new Map(), relationElements = new Map();
    let drag = null, linkDrag = null, frame = 0, destroyed = false, pointer = null, hover = null, preview = null, selectedRelation = '';
    const connection = createConnection({project,onChange,onState:syncConnection});
    const annotations = EC.Annotations.create({project,container:viewport,onChange,onActiveChange:refreshRelationActions,
      getAppearance:id => relationLabelAppearance(project,project.relations.find(relation => relation.id === id))});
    const relationActions = document.createElement('div');
    relationActions.className = 'relation-actions'; relationActions.hidden = true;
    relationActions.setAttribute('role','group'); relationActions.setAttribute('aria-label',t('canvas.arrowControls'));
    for (const [icon,label,action] of [
      ['edit',t('canvas.editArrowText'),() => editAnnotation(selectedRelation)],
      ['trash',t('canvas.deleteArrow'),() => deleteRelation(selectedRelation)]
    ]) {
      const button = document.createElement('button'); button.type = 'button';
      EC.Icons.set(button,icon,label); button.addEventListener('click',action); relationActions.append(button);
    }
    viewport.append(relationActions);
    function listen(target,type,callback,options) {target.addEventListener(type,callback,options); listeners.push(() => target.removeEventListener(type,callback,options));}
    function nodeBounds(module) {
      const node = nodes.getElement(module.id);
      return {x:module.x,y:module.y,width:node?.offsetWidth || 480,height:node?.offsetHeight || 190};
    }
    const boundsForGroup = group => groupBounds(group,project.modules.filter(module => module.groupId === group.id).map(nodeBounds));
    function syncConnection(state = connection.getState()) {
      viewport.classList.toggle('connecting',state.active);
      const hint = document.getElementById('ec-connection-hint');
      if (hint) {hint.textContent = state.message; hint.hidden = !hint.textContent;}
      for (const module of project.modules) for (const port of nodes.getElement(module.id)?.querySelectorAll('[data-port]') || []) {
        const selected = state.source?.moduleId === module.id && state.source.port === port.dataset.port;
        port.classList.toggle('port-source',selected); port.setAttribute('aria-pressed',String(selected));
        port.classList.toggle('port-target',!!state.source && state.source.moduleId !== module.id && hover?.moduleId === module.id && hover.port === port.dataset.port);
      }
      paintPreview();
    }
    function setHover(target) {
      const port = target.closest?.('[data-port]'), next = port ? {moduleId:port.closest('.module-node').dataset.moduleId,port:port.dataset.port} : null;
      if (next?.moduleId !== hover?.moduleId || next?.port !== hover?.port) {hover = next; syncConnection();}
    }
    function paintPreview() {
      if (!preview) return;
      const {source} = connection.getState(), from = source && project.modules.find(item => item.id === source.moduleId);
      preview.style.display = from ? '' : 'none'; if (!from) return;
      const start = portAnchor(nodeBounds(from),source.port);
      const target = hover && hover.moduleId !== from.id && project.modules.find(item => item.id === hover.moduleId);
      const end = target ? portAnchor(nodeBounds(target),hover.port) : pointer ?
        {x:(pointer.x - view.x) / view.scale,y:(pointer.y - view.y) / view.scale,nx:-start.nx,ny:-start.ny} :
        {x:start.x + start.nx * 80,y:start.y + start.ny * 80,nx:-start.nx,ny:-start.ny};
      if (!target && pointer && Math.hypot(end.x - start.x,end.y - start.y) < 14) {preview.style.display = 'none'; return;}
      preview.setAttribute('d',curveBetween(start,end).path);
      preview.classList.toggle('has-target',!!target);
    }
    function paintGroups() {
      const active = new Set(project.groups.map(group => group.id));
      for (const [id,node] of groupElements) if (!active.has(id)) {node.remove(); groupElements.delete(id);}
      for (const group of project.groups) {
        let node = groupElements.get(group.id);
        if (!node) {
          const fragment = groupTemplate.content.cloneNode(true);
          node = fragment.querySelector('.group-frame'); node.dataset.groupId = group.id;
          node.querySelector('.group-header').dataset.groupId = group.id;
          EC.Icons.hydrate(node);
          node.querySelector('[data-group-action="edit"]').addEventListener('click',() => onGroupEdit(group.id));
          groupLayer.append(fragment); groupElements.set(group.id,node);
        }
        const bounds = boundsForGroup(group);
        Object.assign(node.style,{left:`${bounds.x}px`,top:`${bounds.y}px`,width:`${bounds.width}px`,height:`${bounds.height}px`});
        // Only allow an actual color, never arbitrary CSS from the project.
        const {color,backgroundColor} = layerAppearance(group);
        node.style.setProperty('--group-text',color);
        node.style.borderColor = 'transparent'; node.style.backgroundColor = backgroundColor;
        const title = node.querySelector('.group-title'); title.textContent = group.name || t('canvas.unnamedGroup'); title.style.color = color;
        node.querySelector('.group-empty').hidden = project.modules.some(module => module.groupId === group.id);
      }
    }
    function selectRelation(id) {
      selectedRelation = id;
      for (const [key,{group}] of relationElements) {group.classList.toggle('selected',key === id); group.setAttribute('aria-pressed',String(key === id));}
      refreshRelationActions();
      syncConnection();
    }
    function refreshRelationActions() {
      const entry = relationElements.get(selectedRelation);
      relationActions.hidden = !entry || !!annotations.getId();
      if (relationActions.hidden) return;
      // Keep the buttons readable at every zoom level, anchored below the actual curve midpoint.
      const point = entry.line.getPointAtLength(entry.line.getTotalLength() / 2);
      const x = point.x * view.scale + view.x, y = point.y * view.scale + view.y;
      const label = entry.background.classList.contains('is-empty') ? entry.label.getBBox() : entry.background.getBBox();
      const textBottom = (label.y + label.height) * view.scale + view.y;
      relationActions.style.left = `${Math.max(8,Math.min(viewport.clientWidth - relationActions.offsetWidth - 8,x - relationActions.offsetWidth / 2))}px`;
      relationActions.style.top = `${Math.max(8,Math.min(viewport.clientHeight - relationActions.offsetHeight - 8,Math.max(y + 12,textBottom + 8)))}px`;
    }
    function editAnnotation(id) {
      if (!relationElements.has(id)) return;
      cancelConnection(); selectRelation(id);
      const point = relationElements.get(id)?.point;
      if (point) annotations.open(id,{x:point.x * view.scale + view.x,y:point.y * view.scale + view.y});
    }
    async function deleteRelation(id) {
      const relation = project.relations.find(item => item.id === id);
      if (!relation) return;
      const name = id => EC.Model.displayName(project.modules.find(item => item.id === id),t('canvas.unnamedModule'));
      if (!await confirm(t('canvas.deleteArrowConfirm',{from:name(relation.from),to:name(relation.to),label:relation.label ? t('canvas.labelSuffix',{label:relation.label}) : ''}))) return;
      if (EC.Model.removeRelation(project,relation.id)) {selectRelation(''); onChange({semantic:true,render:false}); viewport.focus({preventScroll:true});}
    }
    function paintEdges() {
      if (!preview) {
        const defs = svg('defs');
        for (const [id,fill] of [['ec-arrow','#87a8ce'],['ec-arrow-selected','#ff9f43']]) {
          const marker = svg('marker',{id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
          marker.append(svg('path',{d:'M 0 0 L 10 5 L 0 10 z',fill})); defs.append(marker);
        }
        edgeLayer.append(defs);
        preview = svg('path',{class:'relation-preview','marker-end':'url(#ec-arrow)'}); edgeLayer.append(preview);
      }
      const ids = new Set(project.relations.map(item => item.id));
      for (const [id,entry] of relationElements) if (!ids.has(id)) {entry.group.remove(); relationElements.delete(id);}
      if (!ids.has(selectedRelation)) selectedRelation = '';
      if (annotations.getId() && !ids.has(annotations.getId())) annotations.cancel();
      const parallel = new Map();
      for (const relation of project.relations) {
        const from = project.modules.find(module => module.id === relation.from), to = project.modules.find(module => module.id === relation.to);
        if (!from || !to) continue;
        const key = [`${from.id}:${relation.fromPort || 'auto'}`,`${to.id}:${relation.toPort || 'auto'}`].sort().join('|'), lane = parallel.get(key) || 0; parallel.set(key,lane + 1);
        const {path,label:point} = relationGeometry(nodeBounds(from),nodeBounds(to),relation,lane);
        let entry = relationElements.get(relation.id);
        if (!entry) {
          const group = svg('g',{class:'relation-group',tabindex:0,role:'button','data-relation-id':relation.id});
          const line = svg('path',{class:'relation-line','marker-end':'url(#ec-arrow)'}), hit = svg('path',{class:'relation-hit'});
          const background = svg('rect',{class:'relation-label-background',rx:6,ry:6,'aria-hidden':'true'});
          const label = svg('text',{class:'relation-label','text-anchor':'middle'}), title = svg('title');
          title.textContent = t('canvas.arrowHelp'); group.append(title,line,hit,background,label);
          group.addEventListener('click',event => {
            if (event.button !== 0 || !annotations.finish()) return;
            cancelConnection(); selectRelation(relation.id); group.focus({preventScroll:true});
          });
          group.addEventListener('keydown',event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); selectRelation(relation.id); relationActions.querySelector('button').focus({preventScroll:true});
            }
          });
          entry = {group,line,hit,label,background}; relationElements.set(relation.id,entry); edgeLayer.insertBefore(group,preview);
        }
        const {group,line,hit,label,background} = entry; entry.point = point;
        const colors = relationLabelAppearance(project,relation);
        group.style.setProperty('--label-color',colors.color); group.style.setProperty('--label-background',colors.backgroundColor);
        group.setAttribute('aria-label',t('canvas.arrowSummary',{from:EC.Model.displayName(from,t('canvas.unnamedModule')),to:EC.Model.displayName(to,t('canvas.unnamedModule')),label:relation.label || t('canvas.noLabel')}));
        group.classList.toggle('selected',selectedRelation === relation.id); group.setAttribute('aria-pressed',String(selectedRelation === relation.id));
        line.setAttribute('d',path); hit.setAttribute('d',path);
        const text = relation.label || '';
        label.setAttribute('y',point.y); label.classList.toggle('is-empty',!text.trim()); background.classList.toggle('is-empty',!text.trim());
        if (entry.text !== text) {
          label.replaceChildren();
          text.split(/\r?\n/).forEach((value,index) => {const span = svg('tspan',{dy:index ? 16 : 0}); span.textContent = value; label.append(span);});
          entry.text = text;
        }
        for (const span of label.children) span.setAttribute('x',point.x);
        if (text.trim()) {
          const bounds = label.getBBox();
          for (const [key,value] of Object.entries({x:bounds.x - 7,y:bounds.y - 4,width:bounds.width + 14,height:bounds.height + 8})) background.setAttribute(key,value);
        } else {background.setAttribute('width',0); background.setAttribute('height',0);}
        if (annotations.getId() === relation.id) annotations.position({x:point.x * view.scale + view.x,y:point.y * view.scale + view.y});
      }
      refreshRelationActions();
      paintPreview();
    }
    function refresh() {
      if (destroyed) return;
      nodes.hidePreview?.();
      world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
      Object.assign(viewport.style,gridStyle(view));
      viewport.style.setProperty('--grid-dot-radius',`${Math.min(1,view.scale)}px`);
      for (const module of project.modules) {
        const node = nodes.getElement(module.id); if (node) {node.style.left = `${module.x}px`; node.style.top = `${module.y}px`;}
      }
      connection.reconcile(); paintGroups(); paintEdges(); syncConnection();
      const zoom = document.getElementById('ec-zoom'); if (zoom) zoom.textContent = `${Math.round(view.scale * 100)}%`;
    }
    function scheduleRefresh() {if (!frame) frame = requestAnimationFrame(() => {frame = 0; refresh();});}
    function changed() {onChange({semantic:false,render:false});}
    function centerPoint() {return {x:(viewport.clientWidth / 2 - view.x) / view.scale,y:(viewport.clientHeight / 2 - view.y) / view.scale};}
    function zoomAt(factor,x,y) {
      const next = Math.max(minScale,Math.min(1.8,view.scale * factor)); if (next === view.scale) return;
      const wx = (x - view.x) / view.scale, wy = (y - view.y) / view.scale;
      view.scale = next; view.x = x - wx * next; view.y = y - wy * next; refresh(); changed();
    }
    function zoomBy(factor) {zoomAt(factor,viewport.clientWidth / 2,viewport.clientHeight / 2);}
    function fit({notify = true} = {}) {
      const bounds = [...project.modules.map(nodeBounds),...project.groups.map(boundsForGroup)];
      if (!bounds.length) {view.x = 0; view.y = 0; view.scale = 1;}
      else {
        const left = Math.min(...bounds.map(item => item.x)), top = Math.min(...bounds.map(item => item.y));
        const width = Math.max(...bounds.map(item => item.x + item.width)) - left, height = Math.max(...bounds.map(item => item.y + item.height)) - top;
        view.scale = Math.max(minScale,Math.min(1.2,(viewport.clientWidth - 100) / width,(viewport.clientHeight - 100) / height));
        view.x = (viewport.clientWidth - width * view.scale) / 2 - left * view.scale;
        view.y = (viewport.clientHeight - height * view.scale) / 2 - top * view.scale;
      }
      refresh(); if (notify) changed();
    }
    function restoreView() {
      const defaultView = view.x === 0 && view.y === 0 && view.scale === 1;
      const previousScale = view.scale;
      view.scale = Math.max(minScale,view.scale);
      const bounds = [
        ...project.modules.map(nodeBounds),
        ...project.groups.map(group => ({...boundsForGroup(group),height:44}))
      ];
      const visible = bounds.some(item => {
        const left = item.x * view.scale + view.x, top = item.y * view.scale + view.y;
        return left < viewport.clientWidth && top < viewport.clientHeight &&
          left + item.width * view.scale > 0 && top + item.height * view.scale > 0;
      });
      // Recover an off-screen saved view only when opening or importing a project.
      if (bounds.length && (defaultView || !visible)) fit({notify:false});
      else if (view.scale !== previousScale) refresh();
    }
    listen(viewport,'wheel',event => {
      // Text boxes and selects retain normal scrolling and selection behavior.
      if (event.target.closest(interactive)) return;
      event.preventDefault(); const rect = viewport.getBoundingClientRect(); zoomAt(Math.exp(-event.deltaY * .0015),event.clientX - rect.left,event.clientY - rect.top);
    },{passive:false});
    function cancelConnection() {
      const previous = linkDrag; linkDrag = null;
      connection.cancel(); hover = null;
      if (previous && viewport.hasPointerCapture(previous.pointerId)) viewport.releasePointerCapture(previous.pointerId);
    }
    function portAt(event) {return document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-port]');}
    listen(viewport,'pointerdown',event => {
      if (event.button !== 0 && event.button !== 1) return;
      const port = event.target.closest('[data-port]');
      if (port && event.button === 0) {
        event.preventDefault();
        if (!annotations.finish()) return;
        cancelConnection(); selectRelation('');
        const rect = viewport.getBoundingClientRect(); pointer = {x:event.clientX - rect.left,y:event.clientY - rect.top};
        if (connection.begin(port.closest('.module-node').dataset.moduleId,port.dataset.port)) {
          linkDrag = {pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false}; viewport.setPointerCapture(event.pointerId);
        }
        return;
      }
      if (event.target.closest(interactive)) return;
      if (event.target.closest('.relation-actions')) return;
      if (!annotations.finish()) {event.preventDefault(); return;}
      const header = event.target.closest('.module-header'), groupHeader = event.target.closest('.group-header');
      const blank = !event.target.closest('.module-node,.group-frame,.relation-group');
      if (blank && event.button === 0) {cancelConnection(); selectRelation('');}
      if (!header && !groupHeader && !blank && event.button !== 1) return;
      const start = {pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
      if (event.button === 1 || !header && !groupHeader) drag = {...start,type:'pan',viewX:view.x,viewY:view.y};
      else if (header) {
        const module = project.modules.find(item => item.id === header.closest('.module-node').dataset.moduleId);
        drag = {...start,type:'nodes',anchor:{x:module.x,y:module.y},positions:[{module,x:module.x,y:module.y}]};
      } else {
        const group = project.groups.find(item => item.id === groupHeader.dataset.groupId);
        drag = {...start,type:'nodes',anchor:boundsForGroup(group),group,groupX:group.x,groupY:group.y,positions:project.modules.filter(module => module.groupId === group.id).map(module => ({module,x:module.x,y:module.y}))};
      }
      event.preventDefault(); viewport.setPointerCapture(event.pointerId); viewport.style.cursor = 'grabbing';
    });
    listen(viewport,'pointermove',event => {
      const rect = viewport.getBoundingClientRect(); pointer = {x:event.clientX - rect.left,y:event.clientY - rect.top}; setHover(linkDrag ? document.elementFromPoint(event.clientX,event.clientY) || viewport : event.target);
      if (linkDrag && event.pointerId === linkDrag.pointerId && Math.hypot(event.clientX - linkDrag.x,event.clientY - linkDrag.y) >= 3) linkDrag.moved = true;
      if (connection.getState().source) paintPreview();
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      drag.moved = true;
      if (drag.type === 'pan') {view.x = drag.viewX + dx; view.y = drag.viewY + dy;}
      else moveSelection(project,drag,dx,dy,view.scale);
      scheduleRefresh();
    });
    function endDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = drag.type === 'pan' ? view.x !== drag.viewX || view.y !== drag.viewY :
        drag.positions.some(item => item.module.x !== item.x || item.module.y !== item.y) ||
        Boolean(drag.group && (drag.group.x !== drag.groupX || drag.group.y !== drag.groupY));
      drag = null; viewport.style.cursor = '';
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (moved) {refresh(); changed();}
    }
    function endConnection(event) {
      if (!linkDrag || linkDrag.pointerId !== event.pointerId) return;
      const previous = linkDrag; linkDrag = null;
      const port = event.type === 'pointerup' && previous.moved ? portAt(event) : null;
      if (port) connection.complete(port.closest('.module-node').dataset.moduleId,port.dataset.port); else connection.cancel();
      hover = null; syncConnection();
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    }
    listen(viewport,'pointerup',event => {endConnection(event); endDrag(event);});
    listen(viewport,'pointercancel',event => {endConnection(event); endDrag(event);});
    listen(viewport,'lostpointercapture',event => {endConnection(event); endDrag(event);});
    listen(viewport,'pointerleave',() => {if (!linkDrag) {hover = null; pointer = null; syncConnection();}});
    listen(document,'keydown',event => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape' && connection.getState().active) {event.preventDefault(); cancelConnection(); return;}
      if (event.key === 'Escape' && !event.target.closest?.('input,textarea,select,[contenteditable=true]')) {
        event.preventDefault(); cancelConnection(); selectRelation('');
        if (event.target.closest?.('.relation-actions')) viewport.focus({preventScroll:true});
        return;
      }
      if (event.target.closest?.(`${interactive},[data-node-preview],.module-preview`)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRelation) {
        event.preventDefault();
        deleteRelation(selectedRelation);
      }
    });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleRefresh) : null;
    if (observer) {observer.observe(viewport); for (const module of project.modules) {const node = nodes.getElement(module.id); if (node) observer.observe(node);}}
    // Observe new nodes after structural edits, without watching every input mutation.
    const mutation = new MutationObserver(() => {if (observer) {observer.disconnect(); observer.observe(viewport); for (const module of project.modules) {const node = nodes.getElement(module.id); if (node) observer.observe(node);}} scheduleRefresh();});
    mutation.observe(document.getElementById('ec-nodes') || world,{childList:true});
    refresh();
    return {refresh,fit,restoreView,zoomBy,centerPoint,cancelConnection,
      finishAnnotation:annotations.finish,hasDraftChanges:annotations.hasDraftChanges,
      destroy() {annotations.cancel(); cancelConnection(); relationActions.remove(); destroyed = true; listeners.forEach(remove => remove()); observer?.disconnect(); mutation.disconnect(); if (frame) cancelAnimationFrame(frame); groupLayer.replaceChildren(); edgeLayer.replaceChildren(); relationElements.clear();}};
  }
  EC.Canvas = {create,snapPoint,gridStyle,groupBounds,moveSelection,portAnchor,relationGeometry,createConnection,layerAppearance,relationLabelAppearance};
});
