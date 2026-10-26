(function (root) {
  'use strict';
  const namespace = root.EasyCode ||= {};
  const slots = ['TITLE','STYLE','NODE','GROUP','DATA','BUNDLE','RUNTIME'];
  function safeJSON(value) {
    return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
      character => '\\u' + character.charCodeAt(0).toString(16).padStart(4,'0'));
  }
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  }
  function buildDocument(bundle, project, {service = false} = {}) {
    for (const field of ['canvas','node','group','css','runtime']) {
      if (typeof bundle?.[field] !== 'string') throw new Error(`bundle.${field} 应为文字`);
    }
    const validation = namespace.Model.validate(project);
    if (validation.errors.length) throw new Error(validation.errors.map(item => `${item.path}: ${item.message}`).join('\n'));
    for (const slot of slots) {
      if (bundle.canvas.split(`<!--EC:${slot}-->`).length !== 2) throw new Error(`模板槽位 ${slot} 应恰好出现一次`);
    }
    const replacements = {
      TITLE: escapeHTML(namespace.Model.projectTitle(project)),
      STYLE: `<style>${bundle.css.replace(/<\/style/gi, '<\\/style')}</style>`,
      NODE: bundle.node,
      GROUP: bundle.group,
      DATA: service ? '<meta name="easycode-service" content="archify">' : `<script id="ec-project" type="application/json">${safeJSON(project)}</script>`,
      BUNDLE: `<script id="ec-bundle" type="application/json">${safeJSON(bundle)}</script>`,
      RUNTIME: `<script>${bundle.runtime.replace(/<\/script/gi, '<\\/script')}</script>`
    };
    // A callback replacement never reinterprets text inserted by another slot.
    return bundle.canvas.replace(/<!--EC:(TITLE|STYLE|NODE|GROUP|DATA|BUNDLE|RUNTIME)-->/g, (_, slot) => replacements[slot]);
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
    if (typeof html !== 'string') throw new Error('HTML 应为文字');
    // Scan actual tags, skipping comments and raw-text bodies. No DOM or code execution is needed in Node.
    const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-z][a-z0-9:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
    let match, templateDepth = 0;
    const blocks = [];
    while ((match = tags.exec(html))) {
      if (!match[1]) continue;
      const name = match[1].toLowerCase(), closing = match[0][1] === '/';
      if (name === 'template') {templateDepth += closing ? -Math.min(templateDepth,1) : 1; continue;}
      if (closing) continue;
      if (name === 'meta' && templateDepth === 0 && attributes(match[2]).name === 'easycode-service') throw Object.assign(new Error('这是服务入口，项目数据位于同目录的 archify.json。'),{code:'SERVICE_ENTRY'});
      if (!['script','style','textarea','title','xmp','iframe','noembed','noframes'].includes(name)) continue;
      const endTag = new RegExp(`<\\/${name}\\s*>`,'gi'); endTag.lastIndex = tags.lastIndex;
      const end = endTag.exec(html), content = html.slice(tags.lastIndex, end ? end.index : html.length);
      if (name === 'script' && templateDepth === 0) {
        const attrs = attributes(match[2]);
        if (attrs.id === 'ec-project') blocks.push({type:attrs.type,content,closed:Boolean(end)});
      }
      tags.lastIndex = end ? endTag.lastIndex : html.length;
    }
    if (blocks.length !== 1) throw new Error('HTML 必须有且只有一个 ec-project 数据块');
    const block = blocks[0];
    if (block.type?.trim().toLowerCase() !== 'application/json' || !block.closed) throw new Error('ec-project 必须为完整 application/json 数据块');
    let project;
    try {project = JSON.parse(block.content);} catch {throw new Error('ec-project 不是合法 JSON');}
    if (!project || typeof project !== 'object' || Array.isArray(project) || project.formatVersion !== 1) throw new Error('仅支持项目格式版本 1');
    return project;
  }
  namespace.Serialization = {buildDocument,readProject};
})(globalThis);
