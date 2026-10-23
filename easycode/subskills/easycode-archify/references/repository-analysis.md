# Analyze and recheck real code

The agent reads source; the HTML only records and edits findings. Start with the user's scope and existing canvas, if supplied. Inspect repository instructions and the relevant source files before naming interfaces or relationships. Use `rg` to locate definitions and callers, then read their surrounding code; a filename or search hit alone is not enough.

Record `repository.path`. For Git sources, record `git rev-parse HEAD` in `repository.revision` as a baseline, then check whether the cited files match it. Set `repository.dirty` from the entire actual repository worktree (`git status --porcelain`), not just the inspected files or the use of a local snapshot. Git HEAD alone does not prove the contents of modified, untracked, or ignored files.

Store portable repository-relative paths and 1-based line ranges in `sources`; include a symbol when useful. Lines describe the exact bytes you actually read, which may differ from HEAD. For modified, untracked, or ignored source, record file diffs and/or content hashes and explain the snapshot in project description/unknowns. For a non-Git directory, `repository.revision` may be empty: disclose that no Git revision is available and record snapshot details or file hashes instead. Do not invent revision evidence or use `repository.dirty` as a generic snapshot flag. Recheck line ranges and hashes after source changes.

| Claim | Evidence required before marking verified |
| --- | --- |
| Module responsibility | The actual implementation in the stated scope; avoid claims about unread files |
| Interface and parameters | Definition plus relevant defaults, branches, and return sites; distinguish omitted values from required values |
| Directed call | A real caller expression with resolved callee; attach the call-site source to the relationship |
| Dependency | A concrete import/reference or other visible dependency; label it as dependency rather than inventing a call |
| No inputs or outputs | Confirmed signature/behavior; an unread or empty list is unknown |

Use `verified` for checked facts and `planned` for proposed behavior. Keep inference explicit in purpose/unknowns and unconfirmed claims out of verified relationships. Interface parameters may use source-level types such as `object` or `Promise<string>` only when supported; put unresolved details in `unknowns`. The validator checks source shape, not its truth. Testing a generator does not verify a proposed application's implementation.

For updates, read the current HTML through `Serialization.readProject`. Preserve user IDs, text, layout, grouping, relationships and expanded state outside scope. Use semantic editing helpers so previously verified content becomes `modified`. Reinspect the changed source and direct callers, update evidence and repository revision, and only then restore `verified`. If only part of a project was rechecked, name the scope and keep stale items `modified` with an unknown explaining the prior revision.

Build and check the HTML with the package scripts, then read it back and compare data. A small source-backed example can live in an ignored execution directory; it must not replace the planned task-board example. Source-backed data validates recorded findings, not the visual behavior of the browser editor. Report browser, screenshot, and native-picker tests separately from Node checks.
