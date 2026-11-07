---
name: xyf-easycode-sync
description: After code changes, lists the architecture differences against the actual code and, once confirmed, writes only intentional changes back into the software architecture JSON; wrong code is not written back, and code is never changed. Manual trigger by the user only; agents and other skills must never invoke it automatically.
disable-model-invocation: true
---

# Architecture Sync

Acting as a senior software architect, once code changes are complete, sync `docs/xyf-easycode/html/software_architecture.js` to the actual code, so the next check does not judge intentional changes as nonconforming. The code is the source of truth; this skill changes only the architecture JSON — never the code — and does not run programs or tests.

**Rule**: The paths above are relative to the target project. After the project is determined, re-read `<project>/docs/xyf-easycode/PromptsRules.md` before starting and before every batch of writes; if it is missing, first read the [template](../xyf-easycode-install/PromptsRules.md) and explain, then hand over to [install](../xyf-easycode-install/SKILL.md) to fill it in per authorization; if reading fails, pause.

**Trigger restriction**: Only the user may trigger this skill manually; agents and other skills must not invoke it automatically, and when a sync seems needed, only suggest it to the user.

## How to Sync

1. **Read both sides**: Read the architecture JSON and the actual code using the reading and locating methods of [check](../xyf-easycode-check/SKILL.md), recording the architecture and source versions and the uncommitted changes.
2. **List the differences**: Per module, list the differences where "the code is implemented but the architecture lags": added or removed modules, interfaces, parameters, `structures` fields, events, tests; `codeLocation` file paths; the `sources` path, `line/endLine`, and `symbol`; and `repository.revision/dirty`; present them in a table, one row each with the module and ID, the difference, the JSON field to change, and the code evidence (path and line number).
3. **Direction judgment**: Write back only the real intent found in the code; items where the code went wrong and the architecture is right are not written back — list them as code problems and hand them to [code](../xyf-easycode-code/SKILL.md); never cement defects into the architecture.
4. **Fill in the status**: Items with source evidence and matching content get `status` `verified`; items whose meaning changed this time get `modified`; whatever cannot be clarified goes into `unknowns`, never `verified`.
5. **Write after confirmation**: Hand the difference list to the user for confirmation; reuse a valid authorization, otherwise wait for the user to separately reply “执行”; the write follows the architecture file I/O rules and the layout lock of [requirements](../xyf-easycode-requirements/SKILL.md), keeping untouched fields, existing IDs, and `formatVersion`, with new IDs globally unique.
6. **Write verification**: Before saving, check for external modifications and pause on conflict; after saving, read back, parse, and validate to confirm the write succeeded.

## How to Deliver Results

Deliver the difference list, a summary of the fields actually updated, and the read-back validation result; never write without confirmation, and never claim a sync happened when nothing was written.
