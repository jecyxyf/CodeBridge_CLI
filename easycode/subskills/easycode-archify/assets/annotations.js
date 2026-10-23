(function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  function begin(project,id) {
    const relation = project.relations.find(item => item.id === id);
    if (!relation) throw new Error('箭头已不存在。');
    const original = relation.label || '';
    return {id,original,text:original};
  }
  function hasChanges(draft) {return draft.text !== draft.original;}
  function commit(project,draft) {
    const relation = project.relations.find(item => item.id === draft.id);
    if (!relation) throw new Error('箭头已不存在。');
    if ((relation.label || '') !== draft.original) throw new Error('备注已发生变化，请按 Esc 后重新编辑。');
    if (!hasChanges(draft)) return false;
    return EC.Model.updateRelation(project,draft.id,{label:draft.text});
  }
  function create({project,container,onChange = () => {}}) {
    let active = null;
    function cancel() {
      const previous = active; active = null;
      previous?.wrapper.remove();
    }
    function finish() {
      if (!active) return true;
      active.draft.text = active.input.value;
      let changed;
      try {
        changed = commit(project,active.draft);
      } catch (issue) {active.error.textContent = issue.message; return false;}
      cancel();
      if (changed) onChange({semantic:true,render:false});
      return true;
    }
    function position(point) {
      if (!active) return;
      active.point = point;
      const {wrapper,input} = active;
      input.style.height = 'auto'; input.style.height = `${Math.min(140,Math.max(42,input.scrollHeight))}px`;
      wrapper.style.left = `${Math.max(8,Math.min(container.clientWidth - wrapper.offsetWidth - 8,point.x - wrapper.offsetWidth / 2))}px`;
      wrapper.style.top = `${Math.max(8,Math.min(container.clientHeight - wrapper.offsetHeight - 8,point.y - 24))}px`;
    }
    function open(id,point) {
      if (active?.draft.id === id) {active.input.focus(); return true;}
      if (!finish()) return false;
      const draft = begin(project,id), wrapper = document.createElement('div'), input = document.createElement('textarea');
      wrapper.className = 'annotation-editor'; wrapper.setAttribute('role','group'); wrapper.setAttribute('aria-label','编辑箭头备注');
      input.setAttribute('aria-label','箭头备注'); input.placeholder = '填写备注（可留空）'; input.value = draft.text; input.rows = 1;
      const hint = document.createElement('small'); hint.textContent = 'Enter 完成 · Shift+Enter 换行 · Esc 取消';
      const error = document.createElement('p'); error.className = 'annotation-error'; error.setAttribute('role','alert');
      wrapper.append(input,hint,error); container.append(wrapper); active = {draft,wrapper,input,error,point};
      input.addEventListener('input',() => {if (active) {draft.text = input.value; error.textContent = ''; position(active.point);}});
      input.addEventListener('keydown',event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); cancel(); container.focus({preventScroll:true});}
        else if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); event.stopPropagation(); if (finish()) container.focus({preventScroll:true});}
      });
      input.addEventListener('blur',finish);
      position(point); input.focus({preventScroll:true}); input.select(); return true;
    }
    return {open,finish,cancel,position,getId:() => active?.draft.id,
      hasDraftChanges:() => !!active && active.input.value !== active.draft.original};
  }
  EC.Annotations = {begin,hasChanges,commit,create};
})(globalThis);
