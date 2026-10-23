---
name: easycode-archify
description: "Create and update a standalone editable HTML module canvas for software design, change planning, or source-backed repository analysis. Show module responsibilities, interfaces, parameters, groups, and directed relationships."
---

# EasyCode Archify

Deliver one HTML with embedded styles, scripts, templates, and project data. Opening it needs no Node, Python, server, or network. Node is only needed by the agent's build/check tools. Use this package's editor, not the separate `../archify/` engine.

## Choose the working mode

- `design`: describe a proposed system; keep unimplemented content `planned`.
- `change`: read the existing project and relevant code, then plan changes. Keep proposals separate from checked facts through status and unknowns.
- `analysis`: inspect the requested repository scope. The agent reads code and records evidence; the webpage does not scan or analyze source files.

Read [project-data.md](references/project-data.md) before constructing or changing data. For source analysis or rechecking edited facts, also read [repository-analysis.md](references/repository-analysis.md). Ask only for missing choices that materially affect the result.

## Create a canvas

Use `Model.createProject`, `createModule`, `createInterface`, and `createParameter` from `assets/model.js`; they generate complete defaults and unique IDs. Fill the requested scope, keeping unknown inputs/outputs unconfirmed. Groups are one level; each module has zero or one group. Relationships connect modules, not individual interface ports.

Run these commands from this skill's directory, replacing the example paths with the intended files:

```powershell
node scripts/build.mjs examples/task-board.json examples/task-board.html
node scripts/check.mjs examples/task-board.html
```

The JSON is an agent-side build input, not a second file the user must maintain. Deliver the HTML. `examples/task-board.*` is a design example, not evidence about real code. Webpage and module templates are maintained separately in `templates/canvas.html` and `templates/module-node.html`.

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
