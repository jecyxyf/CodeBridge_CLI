---
name: xyf-easycode-check
description: Reviews code and test contents against the software architecture, outputs missing items, mismatches, and evidence, and saves the review report per authorization; does not modify business code or the architecture, and does not run programs or tests. Use to find differences before development and to accept work after development.
---

# Content Review

## What This Skill Does

Read the architecture JSON from `docs/xyf-easycode/html/software_architecture.js` and, against the source code, list missing items, differences, and evidence. Documents are relative to the project; source code is located via `repository.path` and `codeLocation` (one path per line) — verify the root first when unclear; skill links are relative to this directory.

Read-only review: do not modify business code, the architecture, or any state; do not run programs, tests, or builds; save reports only per authorization. Actual defects introduced by changes are reviewed by [review-agent](../review-agent/SKILL.md).

**Rule**: After the project is determined, re-read `<project>/docs/xyf-easycode/PromptsRules.md` before starting and before every batch of writes; if it is missing, first read the [template](../xyf-easycode-install/PromptsRules.md) and explain, then hand over to [install](../xyf-easycode-install/SKILL.md) to fill it in per authorization; if reading fails, pause.

## How to Review

1. **Read the source of truth**: Read the JS with [ProjectFile.parse](../xyf-easycode-install/html/assert/project-file.js) without executing the configuration code; validate it against the [data reference](../xyf-easycode-install/html/references/architecture-data.jsonc) and [Model.validate](../xyf-easycode-install/html/assert/model.js). If reading fails, report the review as incomplete — do not invent design. Items listed in `unknowns`, and parts where `inputsConfirmed/outputsConfirmed` are false, are marked unverified, not judged as code errors.
2. **Determine the scope**: Record the architecture and source versions, uncommitted changes, and the scope. When called by [code](../xyf-easycode-code/SKILL.md), check this batch and the affected parts; when called standalone, follow the specified scope, or check everything if no scope is specified.
3. **Compare item by item**: Check by module and member ID:

| Content | Review requirements |
|---|---|
| Modules and classes | Responsibilities, constraints, class names, language, and file location from `purpose/requirements` |
| Properties and data | Names, types, descriptions, and `required/defaultValue` of parameters; `structures[].fields`; do not fill in empty defaults |
| Methods and interfaces | Purpose and inputs/outputs of `interfaces`; verify step by step against the order and conditions of `flow` and the error handling in `errors` |
| Calls and events | Verify calls, data, and the direction and parameters of `events` against `dependencies` and `flow`; `relations` only helps locate things |
| Test contents | `tests.steps/expected` turned into normal, boundary, and error cases with explicit assertions; located in `docs/xyf-easycode/tests/` |
| Code comments | Per the [code conventions](../xyf-easycode-code/SKILL.md#2-write-code-and-tests): at least 1 comment line per 5 lines, content matching the implementation, with template sentences and restated code not counted, language consistent with the architecture web page |

4. **Find evidence**: Follow the entry points, registrations, calls, and data flow to locate the implementation, recording paths and line numbers. Whatever cannot be found is listed as missing; never judge conformance by names, comments, diagram states, or passing tests.
5. **Check everything before concluding**: Follow up on omissions and affected parts; list whatever cannot be clarified as unverified; needed architecture changes go to [requirements](../xyf-easycode-requirements/SKILL.md). Re-review after requirements, code, or scope change.

## How to Write the Review Report

First list the project, the full architecture path, the architecture and source versions, and the checked and unchecked scope, then fill in item by item:

| Module | Interface | Architecture requirement | Implementation evidence | Conclusion | Issue |
|---|---|---|---|---|---|
| Name and ID | Name and ID; the module as a whole if none | The specific provision | Path and line number | Conforms / Does not conform / Unverified | Missing item or difference; "none" if none |

The overall conclusion is "Pass", "Differences found", or "Incomplete". A pass requires everything checked, no differences, and no unverified items; a static review is never treated as a run result.

- **Save location**: `docs/xyf-easycode/reports/<review-ID>_check.md`. The ID uses local time `yyyy_mm_dd_hh_mm_ss_ms`, 24-hour clock, 3-digit milliseconds; on a name collision, take a new ID — never overwrite.
- **Write authorization**: Before saving, state the file and scope; reuse a valid authorization, otherwise wait for the user to separately reply “执行”. Write only this report.
- **Save and deliver**: After reading back and verifying, deliver the full path, the conclusion, and the incomplete items; never claim a report is saved when it is not.
