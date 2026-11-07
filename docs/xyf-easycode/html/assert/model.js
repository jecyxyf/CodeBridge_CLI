globalThis.EasyCode.register("model",function (root) {
  'use strict';
  const namespace = root.EasyCode ||= {};
  const EC = namespace;
  const t = (key, params) => EC.I18n.t(key, params);
  const statuses = ['planned', 'verified', 'modified'];
  const relationTypes = ['call', 'dependency'];
  const portSides = ['top', 'right', 'bottom', 'left'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  const appearanceDefaults = Object.freeze({textColor:'#17254d',backgroundColor:'#fcfdff',headerColor:'#f4f7ff'});
  function moduleAppearance(module) {
    return Object.fromEntries(Object.entries(appearanceDefaults).map(([key,fallback]) => [key,isColor(module?.appearance?.[key]) ? module.appearance[key] : fallback]));
  }
  let sequence = 0;
  function id(prefix) {
    const suffix = root.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    return `${prefix}-${suffix}`;
  }
  function contentDefaults(kind,items = []) {
    if (kind === 'project') return {name:t('model.default.project'),englishName:'new-project',description:t('model.default.projectPurpose')};
    const [prefix,englishPrefix,fields] = {
      module:[t('model.default.module'),'Module',{purpose:t('model.default.modulePurpose')}], method:[t('model.default.method'),'method',{purpose:t('model.default.methodPurpose')}],
      parameter:[t('model.default.parameter'),'parameter',{type:'string'}], field:[t('model.default.field'),'field',{type:'string'}],
      structure:[t('model.default.structure'),'Structure',{}], event:[t('model.default.event'),'event',{description:t('model.default.eventDescription')}],
      test:[t('model.default.test'),'test',{steps:t('model.default.testSteps'),expected:t('model.default.testExpected')}], group:[t('model.default.group'),'Layer',{}]
    }[kind];
    let index = 1;
    while (items.some(item => item?.name === t('model.default.numberedName',{kind:prefix,index}) || item?.englishName === `${englishPrefix}${index}`)) index++;
    const defaults = {name:t('model.default.numberedName',{kind:prefix,index}),englishName:`${englishPrefix}${index}`,...fields};
    if (kind === 'parameter' || kind === 'field') defaults.description = t('model.default.parameterDescription',{kind:prefix.toLowerCase(),index});
    return defaults;
  }
  function createProject(name = t('model.default.project')) {
    return {
      formatVersion: 1, id: id('project'), ...contentDefaults('project'), name,
      repository: {path: '', revision: '', dirty: false}, groups: [], modules: [], relations: [],
      view: {x: 0, y: 0, scale: 1, expanded: [], expandedInterfaces: []}
    };
  }
  function createModule(options = {}) {
    return {
      id: id('module'), ...contentDefaults('module',options.items), ...(options.name !== undefined ? {name:options.name} : {}), ...(options.purpose !== undefined ? {purpose:options.purpose} : {}), language: '', codeLocation: '', groupId: options.groupId ?? '',
      x: options.x ?? 0, y: options.y ?? 0, appearance:moduleAppearance(), status: 'planned', sources: [], unknowns: [], requirements: [], dependencies: [], interfaces: [], parameters: [], structures: [], events: [], tests: []
    };
  }
  function createInterface(items = []) {
    return {
      id: id('interface'), ...contentDefaults('method',items), flow: '', errors: '', status: 'planned', sources: [], unknowns: [],
      inputsConfirmed: false, outputsConfirmed: false, inputs: [], outputs: []
    };
  }
  function createParameter(items = []) {
    return {id: id('param'), ...contentDefaults('parameter',items), required: false, defaultValue: ''};
  }
  function createStructure(items = []) {return {id:id('structure'),...contentDefaults('structure',items),fields:[]};}
  function createStructureField(items = []) {return {id:id('field'),...contentDefaults('field',items)};}
  function createEvent(items = []) {return {id:id('event'),...contentDefaults('event',items),direction:'emit',flow:'',trigger:'',parameters:[]};}
  function createTest(items = []) {return {id:id('test'),...contentDefaults('test',items)};}
  function fillContentDefaults(item,kind,siblings = []) {
    if (!object(item)) return false;
    let changed = false;
    const named = (typeof item.name === 'string' && item.name.trim()) || (typeof item.englishName === 'string' && item.englishName.trim());
    const defaults = contentDefaults(kind,siblings.filter(other => other?.id !== item.id));
    for (const [key,value] of Object.entries(defaults)) {
      if ((key === 'name' || key === 'englishName') && named) continue;
      if (item[key] === undefined || typeof item[key] === 'string' && !item[key].trim()) {item[key] = value; changed = true;}
    }
    return changed;
  }
  function fillListDefaults(items,kind,nested = () => false) {
    let changed = false;
    if (Array.isArray(items)) for (const item of items) {
      if (!object(item)) continue;
      const ownChanged = fillContentDefaults(item,kind,items), nestedChanged = nested(item);
      if (ownChanged || nestedChanged) {markEdited(item); changed = true;}
    }
    return changed;
  }
  function fillModuleDefaults(module,siblings = []) {
    if (!object(module)) return false;
    const changes = [
      fillContentDefaults(module,'module',siblings), fillListDefaults(module.parameters,'parameter'),
      fillListDefaults(module.interfaces,'method',entry => {
        const inputs = fillListDefaults(entry.inputs,'parameter'), outputs = fillListDefaults(entry.outputs,'parameter');
        return inputs || outputs;
      }),
      fillListDefaults(module.structures,'structure',entry => fillListDefaults(entry.fields,'field')),
      fillListDefaults(module.events,'event',entry => fillListDefaults(entry.parameters,'parameter')), fillListDefaults(module.tests,'test')
    ];
    if (changes.some(Boolean)) {markEdited(module); return true;}
    return false;
  }
  function fillProjectDefaults(project) {
    if (!object(project)) return false;
    let changed = fillContentDefaults(project,'project');
    if (fillListDefaults(project.groups,'group')) changed = true;
    if (Array.isArray(project.modules)) for (const module of project.modules) if (fillModuleDefaults(module,project.modules)) changed = true;
    return changed;
  }
  function displayName(item,fallback = '') {return (typeof item?.name === 'string' && item.name.trim()) || (typeof item?.englishName === 'string' && item.englishName.trim()) || fallback;}
  function normalizeCodeLocation(value) {
    if (typeof value !== 'string') throw new Error(t('model.error.relativeLocation'));
    return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const path = line.replace(/\\/g,'/');
      if (path.startsWith('/') || /[:<>|?*\u0000-\u001f]/.test(path)) throw new Error(t('model.error.relativePathExample'));
      const parts = [];
      for (const part of path.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
          if (!parts.length) throw new Error(t('model.error.locationOutsideProject'));
          parts.pop();
        } else parts.push(part);
      }
      if (!parts.length) throw new Error(t('model.error.locationRequired'));
      return './' + parts.join('/');
    }).join('\n');
  }
  function projectTitle(project) {
    const name = project.name?.trim() || t('model.default.project'), revision = project.repository.revision.trim();
    if (!revision) return name;
    const version = /^\d+(?:\.\d+)*(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(revision) ? `v${revision}` : revision.replace(/^V(?=\d)/,'v');
    return `${name} ${version}`;
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
    applyPatch(module, patch, ['name','englishName','language','purpose','codeLocation','groupId','x','y','appearance','status','sources','unknowns','requirements','dependencies','interfaces','parameters','structures','events','tests'], ['groupId','x','y','appearance']);
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
    if (applyPatch(item, patch, ['name','englishName','purpose','flow','errors','status','sources','unknowns','inputsConfirmed','outputsConfirmed','inputs','outputs'])) markEdited(module);
    return item;
  }
  function updateMember(project,moduleId,collection,itemId,patch) {
    const fields = {
      parameters:['name','englishName','type','description','defaultValue','required'],
      structures:['name','englishName','fields'],
      events:['name','englishName','description','direction','flow','trigger','parameters'],
      tests:['name','englishName','steps','expected']
    };
    if (!Object.hasOwn(fields,collection)) throw new Error(t('model.error.unsupportedMember'));
    const module = project.modules.find(item => item.id === moduleId), item = module?.[collection]?.find(item => item.id === itemId);
    if (!item) return null;
    if (applyPatch(item,patch,fields[collection])) markEdited(module);
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
    const values = [relation.from, relation.to, relation.type === undefined ? '' : relation.type, relation.label === undefined ? '' : relation.label];
    return values.every(value => typeof value === 'string') ? JSON.stringify(values) : null;
  }
  function addRelation(project, options = {}) {
    const relation = {
      id: id('relation'), from: options.from, to: options.to,
      label: options.label ?? '', status: options.status ?? 'planned', sources: options.sources ?? [], unknowns: options.unknowns ?? []
    };
    // Legacy type metadata is retained only when explicitly supplied; new arrows have no category.
    for (const field of ['fromPort','toPort','type']) if (options[field] !== undefined) relation[field] = options[field];
    checkRelation(project,relation);
    project.relations.push(relation);
    return relation;
  }
  function checkRelation(project,relation,exceptId) {
    if (!project.modules.some(item => item.id === relation.from) || !project.modules.some(item => item.id === relation.to) ||
        relation.from === relation.to || (relation.type !== undefined && !relationTypes.includes(relation.type)) || relationKey(relation) === null ||
        project.relations.some(item => item.id !== exceptId && relationKey(item) === relationKey(relation))) {
      throw new Error(t('model.error.invalidRelation'));
    }
    for (const field of ['fromPort','toPort']) if (relation[field] !== undefined && !portSides.includes(relation[field])) throw new Error(t('model.error.invalidPorts'));
  }
  function updateRelation(project,id,patch) {
    const relation = project.relations.find(item => item.id === id);
    if (!relation) throw new Error(t('model.error.missingRelation'));
    const fields = ['from','to','type','label','fromPort','toPort'], next = {...relation};
    for (const field of fields) if (Object.hasOwn(patch,field)) {
      if (field.endsWith('Port') && patch[field] === undefined) delete next[field];
      else next[field] = patch[field];
    }
    checkRelation(project,next,id);
    if (fields.every(field => next[field] === relation[field])) return false;
    const semantic = ['from','to','type','label'].some(field => next[field] !== relation[field]);
    Object.assign(relation,next);
    for (const field of ['fromPort','toPort']) if (!Object.hasOwn(next,field)) delete relation[field];
    if (semantic) markEdited(relation);
    return true;
  }
  function removeRelation(project,id) {
    const index = project.relations.findIndex(item => item.id === id);
    if (index < 0) return false;
    project.relations.splice(index,1); return true;
  }

  // Validation collects independent problems, so malformed drafts never stop the remaining checks.
  function validate(project) {
    const errors = [], warnings = [], ids = new Set();
    const error = (path, message) => errors.push({path, message});
    const warn = (path, message) => warnings.push({path, message});
    const at = (base, key) => base ? `${base}.${key}` : key;
    function record(value, path) {
      if (object(value)) return true;
      error(path, t('model.error.objectExpected')); return false;
    }
    function array(value, path) {
      if (Array.isArray(value)) return Array.from(value);
      error(path, t('model.error.arrayExpected')); return [];
    }
    function string(value, path, draft = false) {
      if (draft && (value === undefined || value === '')) { warn(path, t('model.error.missingContent')); return; }
      if (typeof value !== 'string') error(path, t('model.error.textExpected'));
      else if (draft && !value.trim()) warn(path, t('model.error.missingContent'));
    }
    function number(value, path, positive = false) {
      if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) error(path, positive ? t('model.error.positiveNumberExpected') : t('model.error.finiteNumberExpected'));
    }
    function boolean(value, path) { if (typeof value !== 'boolean') error(path, t('model.error.booleanExpected')); }
    function optionalText(item,fields,path) {
      for (const field of fields) if (item[field] !== undefined) string(item[field],at(path,field));
    }
    function bilingualName(item,path) {
      // Existing files keep their name field unchanged; either language may be filled first.
      string(item.name,at(path,'name'),!(typeof item.englishName === 'string' && item.englishName.trim()));
      optionalText(item,['englishName'],path);
    }
    function enumeration(value, choices, path) { if (!choices.includes(value)) error(path, t('model.error.allowedValues',{values:choices.join(' / ')})); }
    function identity(value, path) {
      if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value)) {error(path, t('model.error.invalidId')); return;}
      if (ids.has(value)) error(path, t('model.error.duplicateId'));
      ids.add(value);
    }
    function source(value, path) {
      if (!record(value, path)) return;
      string(value.path, at(path,'path'));
      if (typeof value.path === 'string' && !value.path.trim()) error(at(path,'path'), t('model.error.sourcePathRequired'));
      for (const field of ['line','endLine']) {
        if (value[field] !== undefined && (!Number.isSafeInteger(value[field]) || value[field] < 1)) error(at(path,field), t('model.error.positiveLineNumber'));
      }
      if (value.endLine !== undefined && (!Number.isSafeInteger(value.line) || (typeof value.endLine === 'number' && value.endLine < value.line))) error(at(path,'endLine'), t('model.error.invalidEndLine'));
      if (value.symbol !== undefined) string(value.symbol, at(path,'symbol'));
    }
    function evidence(item, path) {
      enumeration(item.status, statuses, at(path,'status'));
      let validSources = 0;
      for (const [index, value] of array(item.sources, at(path,'sources')).entries()) {
        const count = errors.length; source(value, `${path}.sources[${index}]`);
        if (errors.length === count) validSources++;
      }
      if (item.status === 'verified' && !validSources) error(at(path,'sources'), t('model.error.verifiedSourceRequired'));
      for (const [index, value] of array(item.unknowns, at(path,'unknowns')).entries()) string(value, `${path}.unknowns[${index}]`);
    }
    function parameter(value, path, input) {
      if (!record(value, path)) return;
      identity(value.id, at(path,'id')); bilingualName(value,path);
      string(value.type, at(path,'type'), true); string(value.description, at(path,'description'), true);
      optionalText(value,['defaultValue'],path);
      if (input || value.required !== undefined) boolean(value.required, at(path,'required'));
    }
    function interfaceItem(value, path) {
      if (!record(value, path)) return;
      identity(value.id, at(path,'id')); bilingualName(value,path); string(value.purpose, at(path,'purpose'), true);
      optionalText(value,['flow','errors'],path);
      evidence(value, path); boolean(value.inputsConfirmed, at(path,'inputsConfirmed')); boolean(value.outputsConfirmed, at(path,'outputsConfirmed'));
      for (const field of ['inputs','outputs']) {
        array(value[field], at(path,field)).forEach((entry, index) => parameter(entry, `${path}.${field}[${index}]`, field === 'inputs'));
      }
    }
    function eventItem(value,path) {
      if (!record(value,path)) return;
      identity(value.id,at(path,'id')); bilingualName(value,path); string(value.description,at(path,'description'),true);
      enumeration(value.direction,['emit','receive'],at(path,'direction')); string(value.trigger,at(path,'trigger'));
      optionalText(value,['flow'],path);
      array(value.parameters,at(path,'parameters')).forEach((entry,index) => parameter(entry,`${path}.parameters[${index}]`,false));
    }
    function structureItem(value,path) {
      if (!record(value,path)) return;
      identity(value.id,at(path,'id')); bilingualName(value,path);
      array(value.fields,at(path,'fields')).forEach((entry,index) => {
        const fieldPath = `${path}.fields[${index}]`;
        if (!record(entry,fieldPath)) return;
        identity(entry.id,at(fieldPath,'id')); bilingualName(entry,fieldPath);
        string(entry.type,at(fieldPath,'type'),true); string(entry.description,at(fieldPath,'description'),true);
      });
    }
    function testItem(value,path) {
      if (!record(value,path)) return;
      identity(value.id,at(path,'id')); bilingualName(value,path);
      string(value.steps,at(path,'steps'),true); string(value.expected,at(path,'expected'),true);
    }
    if (!record(project, '$')) return {errors, warnings};
    if (project.formatVersion !== 1) error('formatVersion', t('model.error.formatVersion'));
    identity(project.id,'id'); bilingualName(project,''); string(project.description,'description',true);
    if (record(project.repository,'repository')) {
      string(project.repository.path,'repository.path'); string(project.repository.revision,'repository.revision'); boolean(project.repository.dirty,'repository.dirty');
    }
    const groups = array(project.groups,'groups'), modules = array(project.modules,'modules');
    const groupIds = new Set(groups.filter(object).map(item => item.id));
    const moduleIds = new Set(modules.filter(object).map(item => item.id)), interfaceIds = new Set();
    groups.forEach((group,index) => {
      const path = `groups[${index}]`; if (!record(group,path)) return;
      identity(group.id,at(path,'id')); bilingualName(group,path); string(group.color,at(path,'color'));
      if (group.backgroundColor !== undefined && (typeof group.backgroundColor !== 'string' || !/^#[\da-f]{6}$/i.test(group.backgroundColor))) error(at(path,'backgroundColor'), t('model.error.backgroundColorFormat'));
      number(group.x,at(path,'x')); number(group.y,at(path,'y'));
    });
    modules.forEach((module,index) => {
      const path = `modules[${index}]`; if (!record(module,path)) return;
      identity(module.id,at(path,'id')); bilingualName(module,path); string(module.purpose,at(path,'purpose'),true);
      optionalText(module,['codeLocation','language'],path);
      if (module.appearance !== undefined && record(module.appearance,at(path,'appearance'))) {
        for (const key of Object.keys(appearanceDefaults)) if (!isColor(module.appearance[key])) error(`${path}.appearance.${key}`,t('model.error.colorFormat'));
      }
      if (typeof module.codeLocation === 'string') {
        try {normalizeCodeLocation(module.codeLocation);} catch (issue) {error(at(path,'codeLocation'),issue.message);}
      }
      string(module.groupId,at(path,'groupId'));
      if (module.groupId !== '' && !groupIds.has(module.groupId)) error(at(path,'groupId'), t('model.error.missingGroup'));
      number(module.x,at(path,'x')); number(module.y,at(path,'y')); evidence(module,path);
      if (module.requirements !== undefined) array(module.requirements,at(path,'requirements')).forEach((value,index) => string(value,`${path}.requirements[${index}]`));
      array(module.dependencies,at(path,'dependencies')).forEach((value,index) => {
        const dependencyPath = `${path}.dependencies[${index}]`;
        string(value,dependencyPath,true);
        if (typeof value === 'string' && /[\r\n]/.test(value)) error(dependencyPath,t('model.error.singleLineDependency'));
      });
      array(module.interfaces,at(path,'interfaces')).forEach((item,index) => {
        interfaceItem(item,`${path}.interfaces[${index}]`); if (object(item)) interfaceIds.add(item.id);
      });
      for (const [field,check] of [['parameters',(item,path) => parameter(item,path,false)],['structures',structureItem],['events',eventItem],['tests',testItem]]) {
        if (module[field] !== undefined) array(module[field],at(path,field)).forEach((item,index) => check(item,`${path}.${field}[${index}]`));
      }
    });
    const relationKeys = new Set();
    array(project.relations,'relations').forEach((relation,index) => {
      const path = `relations[${index}]`; if (!record(relation,path)) return;
      identity(relation.id,at(path,'id')); evidence(relation,path);
      for (const endpoint of ['from','to']) if (!moduleIds.has(relation[endpoint])) error(at(path,endpoint), t('model.error.missingModule'));
      if (relation.from === relation.to) error(at(path,'to'), t('model.error.differentModules'));
      if (relation.type !== undefined) enumeration(relation.type,relationTypes,at(path,'type'));
      if (relation.label !== undefined) string(relation.label,at(path,'label'));
      for (const field of ['fromPort','toPort']) if (relation[field] !== undefined) enumeration(relation[field],portSides,at(path,field));
      const key = relationKey(relation);
      if (key !== null) {if (relationKeys.has(key)) error(path,t('model.error.duplicateRelation')); relationKeys.add(key);}
    });
    if (record(project.view,'view')) {
      number(project.view.x,'view.x'); number(project.view.y,'view.y'); number(project.view.scale,'view.scale',true);
      for (const [field, validIds] of [['expanded',moduleIds],['expandedInterfaces',interfaceIds]]) {
        const expanded = new Set();
        array(project.view[field],`view.${field}`).forEach((value,index) => {
          const path = `view.${field}[${index}]`;
          if (!validIds.has(value)) error(path,t('model.error.missingExpandedItem'));
          if (expanded.has(value)) error(path,t('model.error.duplicateExpandedItem')); expanded.add(value);
        });
      }
    }
    return {errors, warnings};
  }
  namespace.Model = {createProject,createModule,moduleAppearance,createInterface,createParameter,createStructure,createStructureField,createEvent,createTest,fillModuleDefaults,fillProjectDefaults,displayName,normalizeCodeLocation,projectTitle,validate,markEdited,updateModule,updateInterface,updateMember,removeModule,removeGroup,addRelation,updateRelation,removeRelation};
});
