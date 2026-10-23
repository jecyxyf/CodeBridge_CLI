(function (root) {
  'use strict';
  const namespace = root.EasyCode ||= {};
  const statuses = ['planned', 'verified', 'modified'];
  const relationTypes = ['call', 'dependency'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  let sequence = 0;
  function id(prefix) {
    const suffix = root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    return `${prefix}-${suffix}`;
  }
  function createProject(name = '') {
    return {
      formatVersion: 1, id: id('project'), name, description: '', mode: 'design',
      repository: {path: '', revision: '', dirty: false}, groups: [], modules: [], relations: [],
      view: {x: 0, y: 0, scale: 1, expanded: [], expandedInterfaces: []}
    };
  }
  function createModule(options = {}) {
    return {
      id: id('module'), name: options.name ?? '', purpose: options.purpose ?? '', groupId: options.groupId ?? '',
      x: options.x ?? 0, y: options.y ?? 0, status: 'planned', sources: [], unknowns: [], interfaces: []
    };
  }
  function createInterface() {
    return {
      id: id('interface'), name: '', purpose: '', status: 'planned', sources: [], unknowns: [],
      inputsConfirmed: false, outputsConfirmed: false, inputs: [], outputs: []
    };
  }
  function createParameter() {
    return {id: id('param'), name: '', type: '未知', required: false, description: ''};
  }
  function markEdited(item) {
    if (item?.status === 'verified') item.status = 'modified';
    return item;
  }
  function applyPatch(item, patch, fields, layout = []) {
    if (!object(patch)) return false;
    let semanticChange = false;
    for (const field of fields) {
      if (!Object.hasOwn(patch, field) || JSON.stringify(item[field]) === JSON.stringify(patch[field])) continue;
      item[field] = patch[field];
      if (field !== 'status' && !layout.includes(field)) semanticChange = true;
    }
    if (semanticChange) markEdited(item);
    return semanticChange;
  }
  function updateModule(project, moduleId, patch) {
    const module = project.modules.find(item => item.id === moduleId);
    if (!module) return null;
    applyPatch(module, patch, ['name','purpose','groupId','x','y','status','sources','unknowns','interfaces'], ['groupId','x','y']);
    if (Array.isArray(patch?.interfaces)) {
      const interfaceIds = new Set(project.modules.flatMap(item => item.interfaces.map(entry => entry.id)));
      project.view.expandedInterfaces = project.view.expandedInterfaces.filter(value => interfaceIds.has(value));
    }
    return module;
  }
  function updateInterface(project, moduleId, interfaceId, patch) {
    const module = project.modules.find(item => item.id === moduleId);
    const item = module?.interfaces.find(entry => entry.id === interfaceId);
    if (!item) return null;
    if (applyPatch(item, patch, ['name','purpose','status','sources','unknowns','inputsConfirmed','outputsConfirmed','inputs','outputs'])) markEdited(module);
    return item;
  }
  function removeModule(project, moduleId) {
    const module = project.modules.find(item => item.id === moduleId);
    if (!module) return false;
    const interfaces = new Set(module.interfaces.map(item => item.id));
    project.modules = project.modules.filter(item => item.id !== moduleId);
    project.relations = project.relations.filter(item => item.from !== moduleId && item.to !== moduleId);
    project.view.expanded = project.view.expanded.filter(value => value !== moduleId);
    project.view.expandedInterfaces = project.view.expandedInterfaces.filter(value => !interfaces.has(value));
    return true;
  }
  function removeGroup(project, groupId) {
    if (!project.groups.some(item => item.id === groupId)) return false;
    project.groups = project.groups.filter(item => item.id !== groupId);
    for (const module of project.modules) if (module.groupId === groupId) module.groupId = '';
    return true;
  }
  function relationKey(relation) {
    const values = [relation.from, relation.to, relation.type, relation.label];
    return values.every(value => typeof value === 'string') ? JSON.stringify(values) : null;
  }
  function addRelation(project, options = {}) {
    const relation = {
      id: id('relation'), from: options.from, to: options.to, type: options.type ?? 'call',
      label: options.label ?? '', status: options.status ?? 'planned', sources: options.sources ?? [], unknowns: options.unknowns ?? []
    };
    if (!project.modules.some(item => item.id === relation.from) || !project.modules.some(item => item.id === relation.to) ||
        relation.from === relation.to || !relationTypes.includes(relation.type) || relationKey(relation) === null ||
        project.relations.some(item => relationKey(item) === relationKey(relation))) {
      throw new Error('关系需要有效的不同模块，且不能完全重复');
    }
    project.relations.push(relation);
    return relation;
  }

  // Validation collects independent problems, so malformed drafts never stop the remaining checks.
  function validate(project) {
    const errors = [], warnings = [], ids = new Set();
    const error = (path, message) => errors.push({path, message});
    const warn = (path, message) => warnings.push({path, message});
    const at = (base, key) => base ? `${base}.${key}` : key;
    function record(value, path) {
      if (object(value)) return true;
      error(path, '应为对象'); return false;
    }
    function array(value, path) {
      if (Array.isArray(value)) return Array.from(value);
      error(path, '应为数组'); return [];
    }
    function string(value, path, draft = false) {
      if (draft && (value === undefined || value === '')) { warn(path, '内容尚未填写'); return; }
      if (typeof value !== 'string') error(path, '应为文字');
      else if (draft && !value.trim()) warn(path, '内容尚未填写');
    }
    function number(value, path, positive = false) {
      if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) error(path, positive ? '应为大于零的有限数值' : '应为有限数值');
    }
    function boolean(value, path) { if (typeof value !== 'boolean') error(path, '应为 true 或 false'); }
    function enumeration(value, choices, path) { if (!choices.includes(value)) error(path, `应为 ${choices.join(' / ')}`); }
    function identity(value, path) {
      if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {error(path, '标识须以字母开头，只能含字母、数字、下划线和短横线'); return;}
      if (ids.has(value)) error(path, '标识重复');
      ids.add(value);
    }
    function source(value, path) {
      if (!record(value, path)) return;
      string(value.path, at(path,'path'));
      if (typeof value.path === 'string' && !value.path.trim()) error(at(path,'path'), '代码路径不能为空');
      for (const field of ['line','endLine']) {
        if (value[field] !== undefined && (!Number.isSafeInteger(value[field]) || value[field] < 1)) error(at(path,field), '行号应为安全范围内的正整数');
      }
      if (value.endLine !== undefined && (!Number.isSafeInteger(value.line) || (typeof value.endLine === 'number' && value.endLine < value.line))) error(at(path,'endLine'), '结束行不能早于起始行，且须提供起始行');
      if (value.symbol !== undefined) string(value.symbol, at(path,'symbol'));
    }
    function evidence(item, path) {
      enumeration(item.status, statuses, at(path,'status'));
      let validSources = 0;
      for (const [index, value] of array(item.sources, at(path,'sources')).entries()) {
        const count = errors.length; source(value, `${path}.sources[${index}]`);
        if (errors.length === count) validSources++;
      }
      if (item.status === 'verified' && !validSources) error(at(path,'sources'), '已核对内容须有至少一处有效代码出处');
      for (const [index, value] of array(item.unknowns, at(path,'unknowns')).entries()) string(value, `${path}.unknowns[${index}]`);
    }
    function parameter(value, path, input) {
      if (!record(value, path)) return;
      identity(value.id, at(path,'id')); string(value.name, at(path,'name'), true);
      string(value.type, at(path,'type'), true); string(value.description, at(path,'description'), true);
      if (input || value.required !== undefined) boolean(value.required, at(path,'required'));
    }
    function interfaceItem(value, path) {
      if (!record(value, path)) return;
      identity(value.id, at(path,'id')); string(value.name, at(path,'name'), true); string(value.purpose, at(path,'purpose'), true);
      evidence(value, path); boolean(value.inputsConfirmed, at(path,'inputsConfirmed')); boolean(value.outputsConfirmed, at(path,'outputsConfirmed'));
      for (const field of ['inputs','outputs']) {
        array(value[field], at(path,field)).forEach((entry, index) => parameter(entry, `${path}.${field}[${index}]`, field === 'inputs'));
      }
    }
    if (!record(project, '$')) return {errors, warnings};
    if (project.formatVersion !== 1) error('formatVersion', '仅支持格式版本 1');
    identity(project.id,'id'); string(project.name,'name',true); string(project.description,'description',true);
    enumeration(project.mode, ['design','change','analysis'], 'mode');
    if (record(project.repository,'repository')) {
      string(project.repository.path,'repository.path'); string(project.repository.revision,'repository.revision'); boolean(project.repository.dirty,'repository.dirty');
    }
    const groups = array(project.groups,'groups'), modules = array(project.modules,'modules');
    const groupIds = new Set(groups.filter(object).map(item => item.id));
    const moduleIds = new Set(modules.filter(object).map(item => item.id)), interfaceIds = new Set();
    groups.forEach((group,index) => {
      const path = `groups[${index}]`; if (!record(group,path)) return;
      identity(group.id,at(path,'id')); string(group.name,at(path,'name'),true); string(group.color,at(path,'color'));
      number(group.x,at(path,'x')); number(group.y,at(path,'y'));
    });
    modules.forEach((module,index) => {
      const path = `modules[${index}]`; if (!record(module,path)) return;
      identity(module.id,at(path,'id')); string(module.name,at(path,'name'),true); string(module.purpose,at(path,'purpose'),true);
      string(module.groupId,at(path,'groupId'));
      if (module.groupId !== '' && !groupIds.has(module.groupId)) error(at(path,'groupId'), '分组不存在');
      number(module.x,at(path,'x')); number(module.y,at(path,'y')); evidence(module,path);
      array(module.interfaces,at(path,'interfaces')).forEach((item,index) => {
        interfaceItem(item,`${path}.interfaces[${index}]`); if (object(item)) interfaceIds.add(item.id);
      });
    });
    const relationKeys = new Set();
    array(project.relations,'relations').forEach((relation,index) => {
      const path = `relations[${index}]`; if (!record(relation,path)) return;
      identity(relation.id,at(path,'id')); evidence(relation,path);
      for (const endpoint of ['from','to']) if (!moduleIds.has(relation[endpoint])) error(at(path,endpoint), '模块不存在');
      if (relation.from === relation.to) error(at(path,'to'), '源模块和目标模块不能相同');
      enumeration(relation.type,relationTypes,at(path,'type')); string(relation.label,at(path,'label'),true);
      const key = relationKey(relation);
      if (key !== null) {if (relationKeys.has(key)) error(path,'关系完全重复'); relationKeys.add(key);}
    });
    if (record(project.view,'view')) {
      number(project.view.x,'view.x'); number(project.view.y,'view.y'); number(project.view.scale,'view.scale',true);
      for (const [field, validIds] of [['expanded',moduleIds],['expandedInterfaces',interfaceIds]]) {
        const expanded = new Set();
        array(project.view[field],`view.${field}`).forEach((value,index) => {
          const path = `view.${field}[${index}]`;
          if (!validIds.has(value)) error(path,'展开项不存在');
          if (expanded.has(value)) error(path,'展开项重复'); expanded.add(value);
        });
      }
    }
    return {errors, warnings};
  }
  namespace.Model = {createProject,createModule,createInterface,createParameter,validate,markEdited,updateModule,updateInterface,removeModule,removeGroup,addRelation};
})(globalThis);
