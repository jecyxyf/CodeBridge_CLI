globalThis.EasyCode.register("template-layer",function (root) {
  const EC = root.EasyCode;
  EC.Templates ||= {};
  EC.Templates.layer = "<template id=\"ec-group-template\">\n  <section class=\"group-frame\">\n    <header class=\"group-header\">\n      <span class=\"group-title\"></span>\n      <button type=\"button\" data-group-action=\"edit\" data-icon=\"more\" aria-label=\"{{template.layer.edit.group}}\" title=\"{{template.layer.edit.group}}\"></button>\n    </header>\n    <span class=\"group-empty\">{{template.layer.edit.a.module.and.assign.it.to}}</span>\n  </section>\n</template>\n";
});
