globalThis.EasyCode.register("icons",function (root) {
  'use strict';
  const EC = root.EasyCode ||= {};
  const svgNS = 'http://www.w3.org/2000/svg';
  // Local line icons: no fonts, downloads, or user-supplied SVG markup.
  const paths = {
    node:'M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6Z',
    more:'M12 5h.01M12 12h.01M12 19h.01',
    info:'M5 3h10l4 4v14H5ZM14 3v5h5M8 12h8M8 16h6',
    list:'m4 6 2 2 3-4M12 6h8m-16 8 2 2 3-4M12 14h8M4 21h16',
    parameters:'m10 3-.6 2-2 .9-1.9-.5-2 3.4 1.4 1.5v2.4l-1.4 1.5 2 3.4 1.9-.5 2 .9.6 2h4l.6-2 2-.9 1.9.5 2-3.4-1.4-1.5v-2.4l1.4-1.5-2-3.4-1.9.5-2-.9-.6-2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    code:'m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
    function:'M17 4h-2a3 3 0 0 0-3 2.5l-2 11A3 3 0 0 1 7 20H5M7 10h9',
    event:'m13 2-9 12h7l-1 8 10-13h-8l1-7Z',
    folder:'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z',
    translate:'M3 5h12M9 3v2M6 5c0 5 3 8 7 10M12 5c0 5-3 8-8 11M13 21l4-11 4 11M15 17h4',
    add:'M12 5v14M5 12h14',
    'module-add':'M9 4H4v16h16v-5M16 3v8M12 7h8',
    'group-add':'M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4M12 8v8M8 12h8',
    'arrow-add':'M4 19h6V7h10M16 3l4 4-4 4M5 3v8M1 7h8',
    ungroup:'M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4M8 12h8',
    link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
    edit:'M4 16 16 4l4 4L8 20l-5 1 1-5ZM13 7l4 4',
    trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    save:'M4 3h13l4 4v14H3V3h1M7 3v6h10V3M7 21v-7h10v7',
    'save-as':'M4 3h12l4 4v5M4 3v18h7M7 3v6h9V3M7 21v-7h5M14 18h8M18 14l4 4-4 4',
    import:'M12 3v12M7 10l5 5 5-5M4 15v6h16v-6',
    export:'M12 15V3M7 8l5-5 5 5M4 15v6h16v-6',
    'zoom-in':'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6M7 10h6M10 7v6',
    'zoom-out':'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM15 15l6 6M7 10h6',
    fit:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 8h8v8H8Z',
    check:'M5 12l4 4L19 6',
    close:'m6 6 12 12M6 18 18 6',
    'chevron-down':'m6 9 6 6 6-6',
    'chevron-up':'m6 15 6-6 6 6',
    'chevron-right':'m9 6 6 6-6 6'
  };
  function create(name) {
    if (!Object.hasOwn(paths,name)) throw new Error(EC.I18n.t('icons.unknown',{name}));
    const svg = document.createElementNS(svgNS,'svg');
    for (const [key,value] of Object.entries({viewBox:'0 0 24 24',class:'icon',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'})) svg.setAttribute(key,value);
    const path = document.createElementNS(svgNS,'path'); path.setAttribute('d',paths[name]); svg.append(path); return svg;
  }
  function set(button,name,label,title = label) {
    button.classList.add('icon-button'); button.dataset.icon = name;
    button.setAttribute('aria-label',label); button.title = title;
    button.replaceChildren(create(name)); return button;
  }
  function hydrate(container) {
    for (const button of container.querySelectorAll('button[data-icon]')) set(button,button.dataset.icon,button.getAttribute('aria-label'),button.title || button.getAttribute('aria-label'));
  }
  EC.Icons = {create,set,hydrate};
});
