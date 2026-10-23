# Project data, format 1

`assets/model.js` is the schema authority. `Model.validate(project)` returns `{errors:[{path,message}],warnings:[{path,message}]}` without throwing on malformed data. Fix errors before building/saving; empty draft names, purposes and parameter descriptions produce warnings.

| Object | Fields |
| --- | --- |
| project | `formatVersion:1`, `id`, `name`, `description`, `mode:design/change/analysis`, `repository`, `groups:[]`, `modules:[]`, `relations:[]`, `view` |
| repository | `path:string`, `revision:string`, `dirty:boolean`; version identifies the code inspected, not the HTML version |
| group | `id`, `name`, `color` (title text, use `#rrggbb`), optional `backgroundColor` (`#rrggbb`), `x:number`, `y:number` |
| module | `id`, `name`, `purpose`, `groupId` (existing group ID or `''`), `x`, `y`, `status`, `sources:[]`, `unknowns:string[]`, `interfaces:[]`; optional `englishName:string`, `codeLocation:string`, `parameters:[]`, `events:[]`, `tests:[]` |
| interface (method) | `id`, `name` (legacy signature allowed), `purpose`, `status`, `sources:[]`, `unknowns:string[]`, `inputsConfirmed:boolean`, `outputsConfirmed:boolean`, `inputs:[]`, `outputs:[]`; optional `englishName:string`, `flow:string`, `errors:string` |
| parameter | `id`, `name`, `type:string`, `description`; optional `englishName:string`, `defaultValue:string`; inputs require `required:boolean`; other parameters may omit `required` (if supplied, boolean) |
| event | `id`, `name`, `englishName?:string`, `description`, `direction:emit/receive`, `trigger:string`, `parameters:[]` (payload) |
| test item | `id`, `name`, `steps:string`, `expected:string` |
| relation | `id`, `from:moduleId`, `to:moduleId`, optional `fromPort` / `toPort` (`top/right/bottom/left`), optional `label:string`, `status`, `sources:[]`, `unknowns:string[]`; legacy optional `type:call/dependency` is preserved but not shown |
| source | `{path:string, line?:positiveInteger, endLine?:positiveInteger, symbol?:string}`; nonempty path; endLine requires line and cannot be smaller |
| view | finite `x`, `y`, positive `scale`, `expanded:moduleId[]`, `expandedInterfaces:interfaceId[]` |

All IDs are globally unique strings, starting with a letter and containing only letters, digits, `_` and `-`. Creation helpers generate them; retain existing IDs on updates. Coordinates must be finite. The UI constrains zoom to 25%–180%. A relation needs two different existing modules; identical `(from,to,type,label)` entries are rejected. Expanded IDs must exist and cannot repeat.

Canvas cards are read-only summaries: name, a short responsibility preview, member counts and evidence status. The edit icon opens a scrollable module dialog with all fields. Dialog edits use a separate draft; Confirm validates and applies it, Cancel/Escape discards it. New modules are added only on Confirm. Delete is available in the existing module's dialog, with confirmation that also names the number of affected relationships. Confirm/Cancel/Delete share the same neutral icon-button style and remain visible at the bottom. HTML Save happens after dialog confirmation; Ctrl+S in the module dialog asks the user to confirm or cancel first.

The dialog has five collapsible groups. Module information starts open, showing bilingual name, responsibility, code location and layer. Under the external-interface heading, Parameters, Methods, Message events and Test items start closed with counts. Each member can collapse independently; method inputs, results, implementation flow and event payloads also have their own fold controls. Adding a member opens its group and the new row, then focuses its first field; deleting one retains siblings' fields and expansion. Fold controls use real buttons with `aria-expanded` and `aria-controls`; collapse changes only the DOM, keeping the draft intact.

Names use one row and two columns, Chinese on the left (`name`) and English on the right (`englishName`), for modules, parameters, methods and events. Either language may be supplied first; warn only when neither name is filled. Keep existing single names unchanged rather than guessing a translation. `Model.displayName` prefers Chinese/legacy name, then English, for compact labels. Tests use a single name. Parameters describe public configuration/attributes, with type, description and optional default; method-specific parameters belong under that method. Methods also have purpose, optional implementation flow and errors. Events specify emitted/received direction, trigger and payload. Tests record steps and expected result.

`interfaces` remains the stored method list. All added fields on existing modules/methods/parameters are optional, so refreshing or opening an old HTML requires no migration. New constructors include empty defaults; do not backfill old data on open. `codeLocation` is a free-text location shown in module information; if absent, the editor displays existing source paths/starting lines without writing a new field. Clearing it explicitly stores an empty string. Legacy source evidence stays separate and preserved inside collapsed details; a free-text code location alone does not establish verified evidence.

Each module has one connection point at the middle of each edge. Hold a point, drag to a point on another module, and release to create a relation. The drag starts at the output and ends at the input; points have no fixed role and may serve multiple relations. Single clicks do not connect. Dragging shows a highlighted preview following the pointer. Escape, pointer cancellation, or releasing on blank canvas/the same module cancels without modifying data. The toolbar arrow action guides this same interaction; there is no footer connection button. New arrows have no `type`, and all arrows share one style. They only help readers understand module relationships. Duplicate detection still uses `(from,to,type,label)` regardless of side, treating absent type/label as empty strings.

There is no arrow configuration dialog. Double-click a saved arrow or its annotation to edit text inline in an isolated draft. Enter or blur applies it, Shift+Enter adds a line, and Escape discards it; IME composition does not submit. Text may be empty without a warning. Click an arrow to select it, then press Delete or Backspace to remove it with confirmation; those keys inside a text field only edit text. Save finishes the active annotation before taking its snapshot, and unsaved annotation drafts participate in the close-page warning.

New arrows save `fromPort` and `toPort`. Format-1 files without these optional fields remain valid and choose left/right sides from relative module positions; do not migrate or overwrite their project data just to refresh the editor. Preserve legacy type/evidence fields even though the arrow UI does not expose them. Explicitly chosen sides remain fixed when a module moves. Preview state is not stored. `Canvas.createConnection` owns drag state through `begin` / `complete` / `cancel` and calls `onChange` only after a valid completed relation; `Canvas.relationGeometry` computes curves from current module bounds and saved sides.

Keep the format-1 `view.expanded` and `view.expandedInterfaces` fields for compatibility. Cards no longer expand. Dialog sections use the defaults above instead of the legacy expansion list; toggles are local to that dialog and do not dirty the project. Deleting modules/methods still removes obsolete expansion references.

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

`createModule(options)` accepts only name, purpose, groupId, x, y; status and evidence start as planned/empty. `createInterface()`, `createParameter()`, `createEvent()` and `createTest()` accept no options. There is no createGroup helper: construct the group shape with a fresh valid ID.

`updateModule(project,id,patch)` and `updateInterface(project,moduleId,interfaceId,patch)` update supported fields. Interface semantic changes also mark the module; module position/group changes do not invalidate evidence. `removeModule` removes its relationships and expansion records; `removeGroup` ungroups its modules; `addRelation(project,options)` validates endpoints and duplication. `validate` is still required after edits.

`updateMember(project,moduleId,collection,itemId,patch)` edits supported fields of a module parameter, event or test (`collection` is `parameters`, `events` or `tests`) and marks the owning module when changed. Module collection arrays can be added/removed through `updateModule`. For nested method parameters use `updateInterface`; for event payloads use `updateMember` with the event's `parameters` patch. IDs across all collections, including payloads and test items, share the global uniqueness rule. New collections and their nested fields are validated before commit/save; empty drafts can warn without preventing a save.

`updateRelation(project,id,patch)` validates before applying changes to `from`, `to`, `type`, `label`, `fromPort`, and `toPort`. It returns false for an unchanged relation. Side-only edits preserve evidence status; changes to direction/type/description mark verified relations as modified. Setting a port to `undefined` removes that optional field and restores automatic side selection.

`removeRelation(project,id)` removes only that arrow and returns whether it existed. `Annotations.begin` creates an isolated text draft; `Annotations.commit` applies only changed text and rejects stale/deleted arrows. `Annotations.create` owns the inline editor, keyboard controls, positioning and draft checks.

`ModuleEditor.begin(project,moduleId?,position?)` returns an isolated session with `project` (draft), `module`, and the original snapshot. Apply the Model helpers to that draft. `ModuleEditor.commit(project,session)` validates before updating the live module, preserves unrelated current data, rejects a stale session, and returns false for an unchanged existing module. `hasChanges(session)` checks draft changes for the close-page warning. `ModuleEditor.create({session,confirm})` builds the form; `Dialogs.editModule` owns Confirm/Cancel/Delete and dirty-state notifications.

## HTML and saving

`Serialization.buildDocument(bundle,project)` validates, escapes embedded JSON, and fills six slots once. `bundle={canvas,node,css,runtime}` comes from `scripts/build.mjs`'s `loadBundle()`. HTML holds project JSON in `script#ec-project[type=application/json]`, the immutable source bundle in `script#ec-bundle[type=application/json]`, and the module template in `template#ec-module-template`. Runtime scripts register under `globalThis.EasyCode`.

`Serialization.readProject(html)` reads the single top-level project data block without executing HTML and rejects missing/duplicate, wrong-type, unclosed or invalid JSON blocks. It returns data; call `Model.validate` separately. Do not parse embedded data with an ad hoc regex or treat an arbitrary script as the project.

`Storage.createController({getProject,buildDocument,readProject,validate,pickExisting,pickNew,onState})` exposes `save()`, `saveAs()`, `markDirty()`, `isDirty()`, `getFileName()`. Save methods return Promises. Initial Save binds only after matching project data and successful write/readback; later Save checks external changes. Save As chooses another target. Cancellation/failure retains dirty state; edits made while saving remain dirty. Native handles belong to that page session; reopening asks for the file again. There are no automatic backups or runtime package dependencies.
