---
name: xyf-easycode-code
description: The main agent organizes subagents to develop, test, review, and deliver.
---

# Code Development

- **Execution basis**: Prefer the current review report; otherwise take the latest scope-matching `*_check.md` in `docs/xyf-easycode/reports/`. For old reports without the suffix, count only those titled as reviews — not requirement changes or delivery records. The architecture defaults to `docs/xyf-easycode/html/software_architecture.js`, read with [ProjectFile.parse](../xyf-easycode-install/html/assert/project-file.js) without executing the configuration.
- **Locating**: Locate via `repository.path` and `codeLocation`, reuse existing code, keep user modifications, and change only the confirmed scope; documents and test paths are relative to the project, skill links relative to this directory.
- **Rule**: After the project is determined, re-read `<project>/docs/xyf-easycode/PromptsRules.md` before starting and before every batch of writes; if it is missing, first read the [template](../xyf-easycode-install/PromptsRules.md) and explain, then hand over to [install](../xyf-easycode-install/SKILL.md) to fill it in per authorization; if reading fails, pause.

## How to Organize Development

### 1. The Main Agent Assigns Tasks

Per the report, list module and member IDs, files, owners, dependencies, acceptance criteria, and write scopes. Reuse a valid authorization; otherwise wait for the user to separately reply “执行”; re-confirm when expanding the scope.
Record the report, architecture path, source version, uncommitted changes, and progress, updating every batch. Independent modules run in parallel; work on the same file runs in series; dependent modules start only after their prerequisite modules pass check and review.

### 2. Write Code and Tests

Subagents change only their assigned scope, stop writing once coding, testing, and self-check pass, and report back the changes, actual test results, self-check conclusions, and remaining issues.

- **Implement by class**: Use the project's existing language and write object-oriented code: one class per node, multiple classes per file allowed, interfaces as member methods; state and behavior are encapsulated in classes — do not replace business classes with global functions or shared data. `public` follows the architecture; `private` and `protected` members and internal flows are up to you and are not written into the architecture.
- **High-density comments**: Comment classes, methods, parameters, return values, and standalone logic segments, explaining purpose, conditions, data changes, exceptions, and collaboration; at least 1 comment line per 5 lines of code, updated along with the implementation. Comments must address the code they sit on; never pad the count with template sentences or by restating what the code literally says.
- **Comment language**: Follow `locale/name` in the `language.js` sitting in the architecture web page's directory; keep identifiers as they are; verify first when it cannot be confirmed.
- **Code by flow**: Obey the architecture's names, types, default values, and behavior; no empty shells or fake results; code per the order and conditions of `interfaces[].flow` and `errors`, writing an accurate long comment before implementing each step, numbering steps from 1 within a method; events likewise:

```text
/************************ Flow 1: step description ************************/
```

Adapt the example to the web page language and the programming language's comment syntax. Subagents test and self-check per `tests.steps/expected`, fixing and retesting on failure; when blocked, report the location and the cause — no guessing, no architecture changes.

### 3. The Main Agent Checks and Reviews Each Module

The main agent runs [check](../xyf-easycode-check/SKILL.md) against the architecture, then reviews the complete changes and their call sites per [review-agent](../review-agent/SKILL.md); do not trust subagent conclusions alone, and do not write or fix code in their place. Issues go back to the subagents to fix and retest, then get reviewed again; a module closes only when the check has no nonconforming and no unverified items. Every nonconforming item goes back to the subagents to fix the code; if the architecture itself seems wrong, pause and report to the user, and continue development only after the architecture is updated via [requirements](../xyf-easycode-requirements/SKILL.md).

### 4. The Main Agent Reviews the Whole

After all modules stop writing, run an overall check/review over all changes, interfaces, and data flow; organize integration testing, regression, and the necessary builds; send issues back for fixes and re-review. The whole run passes only by the same standard. Never call sync at any point; do not write changes back into the architecture in place of fixing code.

Tests, data, temporary files, logs, and build and type-check outputs all go into `docs/xyf-easycode/tests/`, in separate subdirectories when running in parallel; keep the old tests.

## How to Deliver Results

Summarize the project, the report and architecture paths, the scope, and the versions, then list:

| Work item | Module and interface | Files | Tests and build | Review | Result |
|---|---|---|---|---|---|
| Report entry | Name and ID | Paths and changes | Commands and results | check report and review conclusions | Completed / Incomplete, with the reason |

Report completion only when tests, check, and review are all done and no unresolved nonconforming or unverified items remain; anything that must be left over is listed item by item and explicitly accepted by the user. Whatever was not run, did not pass, or is blocked is likewise listed honestly. Commit, push, merge, or release only on explicit user request.
