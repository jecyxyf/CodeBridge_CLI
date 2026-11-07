globalThis.EasyCode.register("serialization",function (root) {
  'use strict';
  const namespace = root.EasyCode ||= {};
  const EC = namespace;
  const t = (key,params) => EC.I18n.t(key,params);
  function safeJSON(value) {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
      character => '\\u' + character.charCodeAt(0).toString(16).padStart(4,'0'));
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  }
  function buildDocument(project) {
    namespace.ProjectFile.validate(project);
    const language = namespace.I18n.config();
    const locale = escapeHTML(language.locale || 'zh-CN');
    const title = escapeHTML(namespace.Model.projectTitle(project));
    const runtime = ('globalThis.EasyCodeLanguage = ' + safeJSON(language) + ';\n' + namespace.runtimeSource()).replace(/<\/script/gi,'<\\/script');
    return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body><script id="ec-project" type="application/json">${safeJSON(project)}</script><script>${runtime}</script></body></html>`;
  }
  function decodeAttribute(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (whole, entity) => {
      if (entity[0] === '#') {
        const point = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
      }
      return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[entity.toLowerCase()];
    });
  }
  function attributes(text) {
    const result = Object.create(null);
    const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const match of text.matchAll(pattern)) {
      const key = match[1].toLowerCase();
      if (!Object.hasOwn(result,key)) result[key] = decodeAttribute(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return result;
  }
  function readProject(html) {
    if (typeof html !== 'string') throw new Error(t('serialization.textRequired'));
    // Scan actual tags, skipping comments and raw-text bodies. No DOM or code execution is needed in Node.
    const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z0-9:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
    let match, templateDepth = 0;
    const blocks = [];
    while ((match = tags.exec(html))) {
      if (!match[1]) continue;
      const name = match[1].toLowerCase(), closing = match[0][1] === '/';
      if (name === 'template') {templateDepth += closing ? -Math.min(templateDepth,1) : 1; continue;}
      if (closing) continue;
      if (name === 'meta' && templateDepth === 0 && attributes(match[2]).name === 'easycode-service') throw Object.assign(new Error(t('serialization.serviceEntry')),{code:'SERVICE_ENTRY'});
      if (name === 'meta' && templateDepth === 0 && attributes(match[2]).name === 'easycode-local') throw Object.assign(new Error(t('serialization.localEntry')),{code:'LOCAL_ENTRY'});
      if (!['script','style','textarea','title','xmp','iframe','noembed','noframes'].includes(name)) continue;
      const endTag = new RegExp(`<\\/${name}\\s*>`,'gi'); endTag.lastIndex = tags.lastIndex;
      const end = endTag.exec(html), content = html.slice(tags.lastIndex, end ? end.index : html.length);
      if (name === 'script' && templateDepth === 0) {
        const attrs = attributes(match[2]);
        if (attrs.id === 'ec-project') blocks.push({type:attrs.type,content,closed:Boolean(end)});
      }
      tags.lastIndex = end ? endTag.lastIndex : html.length;
    }
    if (blocks.length !== 1) throw new Error(t('serialization.singleDataBlock'));
    const block = blocks[0];
    if (block.type?.trim().toLowerCase() !== 'application/json' || !block.closed) throw new Error(t('serialization.completeDataBlock'));
    let project;
    try {project = JSON.parse(block.content);} catch {throw new Error(t('serialization.invalidJson'));}
    if (!project || typeof project !== 'object' || Array.isArray(project) || project.formatVersion !== 1) throw new Error(t('serialization.formatVersion',{version:1}));
    return project;
  }
  function entryResources(html) {
    const resources = [], tags = /<!--[\s\S]*?(?:-->|$)|<([a-z][a-z0-9:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
    let match;
    while ((match = tags.exec(html))) {
      if (!match[1]) continue;
      const name = match[1].toLowerCase(), attrs = attributes(match[2]);
      if (name === 'script' && Object.hasOwn(attrs,'src') || name === 'link' && attrs.rel?.toLowerCase() === 'stylesheet') resources.push({tag:name,...attrs});
      if (['script','style','textarea','title','xmp','iframe','noembed','noframes'].includes(name)) {
        const endTag = new RegExp(`<\\/${name}\\s*>`,'gi'); endTag.lastIndex = tags.lastIndex;
        const end = endTag.exec(html); tags.lastIndex = end ? endTag.lastIndex : html.length;
      }
    }
    return resources;
  }
  namespace.Serialization = {buildDocument,readProject,entryResources};
});
