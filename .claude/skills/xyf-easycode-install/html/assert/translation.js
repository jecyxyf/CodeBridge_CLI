globalThis.EasyCode.register("translation",function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const t = (key,params) => EC.I18n.t(key,params);
  const endpoint = 'https://api.mymemory.translated.net/get';
  const reserved = new Set('await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield'.split(' '));
  function formatName(text, kind = 'parameter') {
    if (typeof text !== 'string') throw new Error(t('translation.noEnglish'));
    const entities = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
    const decoded = text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,key) => {
      if (key[0] !== '#') return entities[key.toLowerCase()];
      const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’‘]/g,"'").replace(/[–—]/g,'-');
    if (/[^\x20-\x7e\s]/.test(decoded) || /[<>]/.test(decoded) || !/[a-z]/i.test(decoded)) throw new Error(t('translation.invalidEnglish'));
    const words = decoded.replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2').replace(/([a-z\d])([A-Z])/g,'$1 $2').replace(/['’]/g,'').match(/[a-z\d]+/gi).map(word => word.toLowerCase());
    const cap = word => word[0].toUpperCase() + word.slice(1);
    if (kind === 'project') return words.join('-');
    if (kind === 'constant') return (/^\d/.test(words[0]) ? ['value',...words] : words).join('_').toUpperCase();
    const pascal = ['module','group','class'].includes(kind);
    let result = pascal ? words.map(cap).join('') : words[0] + words.slice(1).map(cap).join('');
    if (/^\d/.test(result)) result = (pascal ? 'Value' : 'value') + result;
    if (reserved.has(result)) result += 'Value';
    return result;
  }
  function createClient({fetch:request = (...args) => root.fetch(...args),timeoutMs = 12000} = {}) {
    const cache = new Map();
    return async function translate(text,kind = 'parameter',{signal} = {}) {
      const source = String(text ?? '').trim();
      if (!source) throw new Error(t('translation.nameRequired'));
      // English labels can be formatted locally; only Chinese translation needs the network.
      if (/^[\x20-\x7e\s]+$/.test(source)) return formatName(source,kind);
      if (new TextEncoder().encode(source).length > 500) throw new Error(t('translation.nameTooLong',{limit:500}));
      signal?.throwIfAborted();
      if (cache.has(source)) return formatName(cache.get(source),kind);
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort',abort,{once:true});
      let timedOut = false;
      const timer = setTimeout(() => {timedOut = true; controller.abort();},timeoutMs);
      try {
        const url = new URL(endpoint); url.searchParams.set('q',source); url.searchParams.set('langpair','zh-CN|en');
        const response = await request(url.href,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
        if (response.status === 429) throw new Error(t('translation.rateLimited'));
        if (!response.ok) throw new Error(t('translation.unavailable'));
        const data = await response.json();
        if (data.quotaFinished || Number(data.responseStatus) === 429) throw new Error(t('translation.quotaExhausted'));
        if (Number(data.responseStatus) !== 200) throw new Error(t('translation.incomplete'));
        const translated = data.responseData?.translatedText, result = formatName(translated,kind);
        controller.signal.throwIfAborted();
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(source,translated);
        return result;
      } catch (error) {
        if (timedOut) throw new Error(t('translation.timedOut'));
        if (signal?.aborted) throw signal.reason;
        if (error instanceof TypeError || error instanceof SyntaxError) throw new Error(t('translation.connectionFailed'));
        throw error;
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort',abort);
      }
    };
  }
  const translate = createClient();
  let fieldId = 0;
  // Reuse the actual form inputs: only dispatch an edit event after a current, successful response.
  function attach({source,target,kind}) {
    const original = target.parentElement, wrapper = document.createElement('div'); wrapper.className = 'field translation-field';
    const label = document.createElement('label'); label.textContent = target.getAttribute('aria-label');
    target.id ||= `ec-english-name-${++fieldId}`; label.htmlFor = target.id;
    const control = document.createElement('div'); control.className = 'translation-control';
    const button = document.createElement('button'); button.type = 'button';
    EC.Icons.set(button,'translate',t('translation.buttonLabel',{name:label.textContent}),t('translation.buttonHint'));
    const message = document.createElement('span'); message.className = 'translation-message'; message.setAttribute('role','status');
    message.id = `${target.id}-status`; target.setAttribute('aria-describedby',message.id);
    original.replaceWith(wrapper); control.append(target,button); wrapper.append(label,control,message);
    let active = null, revision = 0;
    const cancel = () => {revision++; active?.abort(); active = null; button.disabled = false; button.removeAttribute('aria-busy'); message.textContent = '';};
    source.addEventListener('input',cancel); target.addEventListener('input',cancel);
    button.addEventListener('click',async () => {
      cancel(); const version = revision, chinese = source.value, english = target.value;
      const controller = active = new AbortController();
      button.disabled = true; button.setAttribute('aria-busy','true'); message.textContent = t('translation.inProgress');
      const current = () => version === revision && target.isConnected && target.closest('dialog')?.open && source.value === chinese && target.value === english;
      try {
        const result = await EC.Translation.translate(chinese,kind,{signal:controller.signal});
        if (!current()) return;
        target.value = result; target.dispatchEvent(new Event('input',{bubbles:true}));
        message.textContent = t('translation.filled');
      } catch (error) {if (current() && !controller.signal.aborted) message.textContent = error.message || t('translation.failed');}
      finally {if (active === controller) {active = null; button.disabled = false; button.removeAttribute('aria-busy');}}
    });
    const dialog = source.closest('dialog') || document.getElementById('ec-dialog');
    const observer = new MutationObserver(() => {if (!target.isConnected || !dialog.open) {cancel(); observer.disconnect();}});
    observer.observe(dialog,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
  }
  EC.Translation = {formatName,createClient,translate,attach};
});
