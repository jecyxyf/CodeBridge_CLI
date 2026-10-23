# Project data, format 1

`assets/model.js` is the schema authority. `Model.validate(project)` returns `{errors:[{path,message}],warnings:[{path,message}]}` without throwing on malformed data. Fix errors before building/saving; empty draft names, purposes and parameter descriptions produce warnings.

| Object | Fields |
| --- | --- |
| project | `formatVersion:1`, `id`, `name`, `description`, `mode:design/change/analysis`, `repository`, `groups:[]`, `modules:[]`, `relations:[]`, `view` |
| repository | `path:string`, `revision:string`, `dirty:boolean`; version identifies the code inspected, not the HTML version |
| group | `id`, `name`, `color` (title text, use `#rrggbb`), optional `backgroundColor` (`#rrggbb`), `x:number`, `y:number` |
| module | `id`, `name`, `purpose`, `groupId` (existing group ID or `''`), `x`, `y`, `status`, `sources:[]`, `unknowns:string[]`, `interfaces:[]` |
| interface | `id`, `name` (signature allowed), `purpose`, `status`, `sources:[]`, `unknowns:string[]`, `inputsConfirmed:boolean`, `outputsConfirmed:boolean`, `inputs:[]`, `outputs:[]` |
| parameter | `id`, `name`, `type:string`, `description`; inputs require `required:boolean`; output `required` may be omitted (if supplied, boolean) and has no UI meaning |
| relation | `id`, `from:moduleId`, `to:moduleId`, optional `fromPort` / `toPort` (`top/right/bottom/left`), optional `label:string`, `status`, `sources:[]`, `unknowns:string[]`; legacy optional `type:call/dependency` is preserved but not shown |
| source | `{path:string, line?:positiveInteger, endLine?:positiveInteger, symbol?:string}`; nonempty path; endLine requires line and cannot be smaller |
| view | finite `x`, `y`, positive `scale`, `expanded:moduleId[]`, `expandedInterfaces:interfaceId[]` |

All IDs are globally unique strings, starting with a letter and containing only letters, digits, `_` and `-`. Creation helpers generate them; retain existing IDs on updates. Coordinates must be finite. The UI constrains zoom to 25%–180%. A relation needs two different existing modules; identical `(from,to,type,label)` entries are rejected. Expanded IDs must exist and cannot repeat.

Canvas cards are read-only summaries: name, a short responsibility preview, interface count and evidence status. The edit icon opens a scrollable module dialog with all fields. Dialog edits use a separate draft; Confirm validates and applies it, Cancel/Escape discards it. New modules are added only on Confirm. Delete is available in the existing module's dialog, with confirmation that also names the number of affected relationships. Confirm/Cancel/Delete share the same neutral icon-button style. HTML Save happens after dialog confirmation; Ctrl+S in the module dialog asks the user to confirm or cancel first.

Each module has one connection point at the middle of each edge. Hold a point, drag to a point on another module, and release to create a relation. The drag starts at the output and ends at the input; points have no fixed role and may serve multiple relations. Single clicks do not connect. Dragging shows a highlighted preview following the pointer. Escape, pointer cancellation, or releasing on blank canvas/the same module cancels without modifying data. The toolbar arrow action guides this same interaction; there is no footer connection button. New arrows have no `type`, and all arrows share one style. They only help readers understand module relationships. Duplicate detection still uses `(from,to,type,label)` regardless of side, treating absent type/label as empty strings.

There is no arrow configuration dialog. Double-click a saved arrow or its annotation to edit text inline in an isolated draft. Enter or blur applies it, Shift+Enter adds a line, and Escape discards it; IME composition does not submit. Text may be empty without a warning. Click an arrow to select it, then press Delete or Backspace to remove it with confirmation; those keys inside a text field only edit text. Save finishes the active annotation before taking its snapshot, and unsaved annotation drafts participate in the close-page warning.

New arrows save `fromPort` and `toPort`. Format-1 files without these optional fields remain valid and choose left/right sides from relative module positions; do not migrate or overwrite their project data just to refresh the editor. Preserve legacy type/evidence fields even though the arrow UI does not expose them. Explicitly chosen sides remain fixed when a module moves. Preview state is not stored. `Canvas.createConnection` owns drag state through `begin` / `complete` / `cancel` and calls `onChange` only after a valid completed relation; `Canvas.relationGeometry` computes curves from current module bounds and saved sides.

Keep the format-1 `view.expanded` and `view.expandedInterfaces` fields for compatibility. Cards no longer expand. Interface sections in the dialog start from the legacy interface expansion list, but subsequent toggles are local to that dialog and do not dirty the project. Deleting modules/interfaces still removes obsolete expansion references.

Group borders are transparent. `color` controls the group title text; titles use 20px semibold type, defaulting to white (`#ffffff`). Background color defaults to `#81b3e9` (RGB 129, 179, 233), independently of the title color, with fixed 50% transparency. Existing groups without `backgroundColor` use that default blue. New groups should include both defaults. Only the background fill is translucent; titles and module content keep their normal opacity. Preserve explicitly chosen colors when updating or saving a project; do not add an adjustable opacity field.

Action buttons use the local SVG icons in `assets/icons.js`, with descriptive `aria-label` and hover `title` text. Project and interface names remain readable content beside their icon buttons. Keep icons embedded in the generated HTML; do not introduce external fonts, assets, or network requests.

## Meaning of evidence and unknowns

- `planned`: a proposal, not a checked implementation.
- `verified`: checked against the stated source version. Modules, interfaces, and relationships each require at least one valid source. Validation checks the shape, not whether that code actually supports the claim.
- `modified`: a previously checked fact was edited and needs rechecking. `markEdited(item)` changes only `verified` to `modified`.

An empty parameter list plus `inputsConfirmed:false` / `outputsConfirmed:false` means unknown, not zero parameters. Set confirmation true only when absence or the listed signature was established. Write unresolved points in `unknowns`; do not invent types, outputs, dependencies, or business rules to fill space.

## Public editing helpers

```js
import '../assets/model.js'; // adjust relative to the calling script
const M = globalThis.EasyCode.Model;
const project = M.createProject('Project');
const module = M.createModule({name:'Module',purpose:'Responsibility',x:100,y:100,groupId:''});
project.modules.push(module);
const api = M.createInterface(); // name/purpose empty, both confirmations false
const parameter = M.createParameter(); // type '未知', required false
M.updateModule(project,module.id,{purpose:'Updated responsibility'});
// Attach api/parameters using updateModule / updateInterface when editing existing facts.
```

`createModule(options)` accepts only name, purpose, groupId, x, y; status and evidence start as planned/empty. `createInterface()` and `createParameter()` accept no options. There is no createGroup helper: construct the group shape with a fresh valid ID.

`updateModule(project,id,patch)` and `updateInterface(project,moduleId,interfaceId,patch)` update supported fields. Interface semantic changes also mark the module; module position/group changes do not invalidate evidence. `removeModule` removes its relationships and expansion records; `removeGroup` ungroups its modules; `addRelation(project,options)` validates endpoints and duplication. `validate` is still required after edits.

`updateRelation(project,id,patch)` validates before applying changes to `from`, `to`, `type`, `label`, `fromPort`, and `toPort`. It returns false for an unchanged relation. Side-only edits preserve evidence status; changes to direction/type/description mark verified relations as modified. Setting a port to `undefined` removes that optional field and restores automatic side selection.

`removeRelation(project,id)` removes only that arrow and returns whether it existed. `Annotations.begin` creates an isolated text draft; `Annotations.commit` applies only changed text and rejects stale/deleted arrows. `Annotations.create` owns the inline editor, keyboard controls, positioning and draft checks.

`ModuleEditor.begin(project,moduleId?,position?)` returns an isolated session with `project` (draft), `module`, and the original snapshot. Apply the Model helpers to that draft. `ModuleEditor.commit(project,session)` validates before updating the live module, preserves unrelated current data, rejects a stale session, and returns false for an unchanged existing module. `hasChanges(session)` checks draft changes for the close-page warning. `ModuleEditor.create({session,confirm})` builds the form; `Dialogs.editModule` owns Confirm/Cancel/Delete and dirty-state notifications.

## HTML and saving

`Serialization.buildDocument(bundle,project)` validates, escapes embedded JSON, and fills six slots once. `bundle={canvas,node,css,runtime}` comes from `scripts/build.mjs`'s `loadBundle()`. HTML holds project JSON in `script#ec-project[type=application/json]`, the immutable source bundle in `script#ec-bundle[type=application/json]`, and the module template in `template#ec-module-template`. Runtime scripts register under `globalThis.EasyCode`.

`Serialization.readProject(html)` reads the single top-level project data block without executing HTML and rejects missing/duplicate, wrong-type, unclosed or invalid JSON blocks. It returns data; call `Model.validate` separately. Do not parse embedded data with an ad hoc regex or treat an arbitrary script as the project.

`Storage.createController({getProject,buildDocument,readProject,validate,pickExisting,pickNew,onState})` exposes `save()`, `saveAs()`, `markDirty()`, `isDirty()`, `getFileName()`. Save methods return Promises. Initial Save binds only after matching project data and successful write/readback; later Save checks external changes. Save As chooses another target. Cancellation/failure retains dirty state; edits made while saving remain dirty. Native handles belong to that page session; reopening asks for the file again. There are no automatic backups or runtime package dependencies.
