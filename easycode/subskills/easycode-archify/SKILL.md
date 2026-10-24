---
name: easycode-archify
description: "Create and update a standalone editable HTML module canvas for software design, change planning, or source-backed repository analysis. Show module responsibilities, interfaces, parameters, groups, and directed relationships."
---

# EasyCode Archify

Deliver one HTML with embedded styles, scripts, templates, and project data. Opening, editing and saving it needs no Node, Python, server, or network. Only the optional English-name translation button needs a network connection. Node is only needed by the agent's build/check tools. Use this package's editor, not the separate `../archify/` engine.

## Choose the working mode

- `design`: describe a proposed system; keep unimplemented content `planned`.
- `change`: read the existing project and relevant code, then plan changes. Keep proposals separate from checked facts through status and unknowns.
- `analysis`: inspect the requested repository scope. The agent reads code and records evidence; the webpage does not scan or analyze source files.

Read [project-data.md](references/project-data.md) before constructing or changing data. For source analysis or rechecking edited facts, also read [repository-analysis.md](references/repository-analysis.md). Ask only for missing choices that materially affect the result.

## Create a canvas

Use `Model.createProject`, `createModule`, `createInterface` (a public method), `createParameter`, `createEvent`, and `createTest` from `assets/model.js`; they generate complete defaults and unique IDs. Fill the requested scope, keeping unknown inputs/outputs unconfirmed. Groups are one level; each module has zero or one group. Relationships connect modules, not individual interface ports.

Run these commands from this skill's directory, replacing the example paths with the intended files:

```powershell
node scripts/build.mjs examples/task-board.json examples/task-board.html
node scripts/check.mjs examples/task-board.html
```

The JSON is an agent-side build input, not a second file the user must maintain. Deliver the HTML. `examples/task-board.*` is a design example, not evidence about real code. Webpage and module templates are maintained separately in `templates/canvas.html` and `templates/module-node.html`.

The top title and description share a clickable area that fills the space to the left of the actions. Long text truncates with an ellipsis and exposes its full value on hover. Click either line (or activate the area by keyboard) to open project settings; Confirm applies edits, Cancel/Escape discards them, and unchanged confirmation does not dirty the project. There is no separate title-edit icon. A vertical separator divides Add module / Add layer from Save / Import / Export. The footer contains only zoom controls and Fit; it has no file name, save-state text or static gesture instructions. Keep actual file saving, dirty tracking, close-page protection and error reporting working. Finish or cancel an open project-settings draft before saving/importing.

Canvas module cards only show name, responsibility summary, member counts and status. The edit button opens a dialog with five collapsible sections: module information (initially open), parameters, methods, message events, and test items (initially closed). Module information includes bilingual name, responsibility, code location and layer. Module, parameter, method and event names use one row with two columns: Chinese on the left and English on the right. Each member and a method's implementation flow can also collapse; adding opens and focuses the new member. Collapsing retains edits and never dirties project data. Confirm applies the draft; Cancel/Escape discards it. A new module is not added until confirmed. Confirm/Cancel/Delete remain visible at the bottom. After confirming, use the top Save action to write the HTML. Keep drag, grid snapping and relationship controls available on the canvas.

Project, layer, module, parameter/attribute, method, event and test names all expose Chinese (`name`) and English (`englishName`) in settings. Each English input contains a translate icon, not a random-name button. Clicking it sends only that Chinese name to MyMemory's anonymous `get` endpoint, explicitly `langpair=zh-CN|en`, with no account, key, cookies, extra dependencies or Agent. MyMemory currently allows 5,000 characters/day anonymously and at most 500 UTF-8 bytes/request. Translation can be literal or inaccurate; users can edit the result before confirming. Project names use kebab-case, module/layer names PascalCase, and other member names camelCase. Formatting does not infer tense, boolean prefixes or synonyms. Never silently translate existing data on open or save.

Successful translations are cached only in page memory (up to 200 phrases); cache data is not included in saved HTML. Requests time out after 12 seconds. Empty/oversized input, service limits, unavailable service, or non-English responses show a field-level message and retain the old English value. Typing in either field, removing the item, or closing the dialog invalidates pending results. Generated names stay in the form draft until Confirm; Cancel/Escape discards them. Canvas module labels and their hover text show only `name`, with a Chinese unnamed placeholder when blank.

Existing `interfaces` are displayed as methods; keep their IDs, original names, parameters, evidence and legacy expansion fields. New bilingual/section fields are optional for format-1 compatibility, including English names on projects, groups and tests. Do not guess translations or add empty fields when only refreshing an existing HTML. Code evidence and unresolved facts remain available inside collapsed details.

Connect modules by holding an edge point, dragging to another module's point, and releasing. Each module has one point at the middle of each of its four sides; the drag starts at the output and ends at the input. There is no toolbar button for adding arrows. Single clicks do not connect. Escape or releasing on blank canvas/the same module cancels the preview. All arrows are plain visual relationship markers, with no call/dependency distinction or configuration dialog. Left-click an arrow or its text to select it: the line and arrowhead turn bright orange without a selection rectangle. Edit and Delete icons appear below the curve midpoint, follow movement/zoom, and avoid the text. Click Edit to change the optional text inline; double-clicking does not edit. Enter or blur applies it, Shift+Enter adds a line, and Escape discards it. The icons hide while editing and return afterwards. Click Delete (or press Delete/Backspace on the selected arrow) to remove it with confirmation. Click blank canvas or press Escape outside text editing to deselect and hide the icons. Selection alone never dirties project data. New arrows persist their selected sides in optional `fromPort` / `toPort` fields; preserve old arrows without those fields and any legacy metadata. These are module attachment points, not API-specific ports.

For ordinary canvas authoring, build, check, and read back the project data. Run `node --test tests/*.test.mjs` when changing this package's code, templates, or tooling; it is not a step for every generated canvas.

## Update an existing HTML

Read the user's current HTML first with `EasyCode.Serialization.readProject(html)` after importing `assets/model.js` and `assets/serialization.js` in Node. Do not execute the document to extract data. Validate it before edits. Work from that returned object, not a regenerated example or an older JSON: preserve IDs, positions, groups, relationships, view/expanded state, descriptions, and user changes outside the requested scope.

Use `Model.updateModule` / `updateInterface` for semantic edits so checked facts become `modified`; use the remove helpers to clean references. Recheck sources before restoring `verified`. Build with `Serialization.buildDocument(await loadBundle(), project)` using `loadBundle` from `scripts/build.mjs`, then check and read back the result. This refreshes the editor bundle from the maintained package while retaining project content. If the supplied HTML has custom template/runtime changes, preserve and reconcile those explicitly before rebuilding; `readProject` extracts project data only.

Overwrite the intended HTML by default; create another file only for Save As or an explicitly requested copy. Do not create automatic version copies. Inside the page, first Save asks the user to select the original HTML; later Save reuses its confirmed handle. Save As selects a new destination. External file changes are detected and reported rather than silently overwritten. Use a recent desktop Chrome/Edge for native file writing.

## Verify and hand off

Check for model errors and address meaningful warnings. Read back the generated project and compare it with the intended data. When browser execution is permitted, check real edits, drag/zoom, groups, relationships, saved HTML reopen, and the visible layout. Never count skipped or simulated checks as native browser/file-picker verification.

`tests/browser.test.mjs` is opt-in and default tests skip it. For an independently authorized local run with Node 22+ and an installed Chromium browser:

```powershell
$env:EASYCODE_BROWSER_TEST = '1'
$env:EASYCODE_BROWSER_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test tests/browser.test.mjs
```

The runner launches a hidden, isolated browser, blocks page HTTP(S), writes screenshots and reopened HTML to its reported temporary directory, and uses simulated file handles. It does not test native file dialogs. Separately open the delivered HTML visibly and verify original-file selection, permission, overwrite, Save As, cancel, and reopen. Honor any execution restriction in the current session; setting this flag is not permission to bypass one.

Module-document templates and a one-click document update button are deferred; do not imply that the current canvas generates module documentation.
