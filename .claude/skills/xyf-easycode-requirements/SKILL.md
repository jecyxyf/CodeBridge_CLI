---
name: xyf-easycode-requirements
description: Reads the current software architecture, interviews the user, sorts out requirements, and proposes optimization plans and an optimization list; after confirmation with the user, edits the existing architecture JSON locally and re-checks it. Use when adding or adjusting requirements or designing the architecture.
---

# Requirements Discussion

Acting as a senior software architect, understand the architecture JSON in `docs/xyf-easycode/html/software_architecture.js`, interview the user to sort out the requirements, propose structural optimization plans and a list, and after discussion and confirmation edit the existing architecture JSON locally. After editing, re-check the whole architecture for contradictions, infeasible designs, ambiguity, omissions, and overlapping nodes; when problems exist, confirm with the user first, then modify and re-check until every problem is resolved.

**Rule**: The paths above are relative to the target project. After the project is determined, re-read `<project>/docs/xyf-easycode/PromptsRules.md` before starting and before every batch of writes; if it is missing, first read the [template](../xyf-easycode-install/PromptsRules.md) and explain, then hand over to [install](../xyf-easycode-install/SKILL.md) to fill it in per authorization; if reading fails, pause.

## How to Interview

- **Check the current state first**: When the architecture is empty but the project already has code, first read the code to sort out the existing modules and interfaces; the current state follows the code.
- **Listen before asking**: Combining the architecture and the conversation, clarify the goals, success criteria, and constraints; ask only for missing key information, one question at a time; do not ask about anything you can verify yourself.
- **Confirm while asking**: Recap briefly so the user can correct you; tell user requirements apart from assistant assumptions. When the user cannot articulate something, offer a few options.
- **Compare, then recommend**: Compare the feasible approaches yourself and give a recommendation and optimization points; when the user must make a trade-off, explain the benefits and the costs.

## Modules and Classes

- **Split responsibilities**: Split all features and services into classes by responsibility, collaborating through objects; one class maps to one module node, and one file may contain multiple classes.
- **Fill in the modules**: Keep the project's language, follow the [module template](../xyf-easycode-install/html/module/module.js), and fill in the responsibilities per the [data reference](../xyf-easycode-install/html/references/architecture-data.jsonc); plan only the `public` externally exposed properties, methods, messages, and other interfaces, plus test conventions; for methods, state the inputs, outputs, external behavior, and error handling — not the internal implementation steps. `private` and `protected` members are not written into the architecture.
- **Inter-class collaboration**: Make dependencies, calls, and message passing explicit; verify that methods, parameters, and return results agree.
- **Fill in the status**: New items get `status` `planned`; existing items whose meaning changed get `modified`; unresolved questions go into `unknowns`. For interfaces the user has confirmed, set `inputsConfirmed/outputsConfirmed` to `true`; otherwise check treats them as unverified.

## Layout Lock

- **Module nodes**: Change the content only — never the position or appearance; new modules go into the blank area below all existing nodes.
- **Connections**: Add or remove only as the requirements demand, never change ports, and new connections carry no ports.
- **Modify, never rebuild**: Make local edits on the old JSON; rebuilding the whole file is forbidden; existing coordinates and ports stay unchanged, id by id.

## How to Write the Optimization List

List the optimization points in a table, one per row. Fill in the current situation from the actual architecture — never guess. For modules and interfaces, state which module owns the work and which concrete interfaces are involved; mark newly designed modules or interfaces as "proposed". Use wording a primary-school student can understand — concise, clear, and accurate.

| Requirement | Current situation | Optimization plan | Module and interface |
|---|---|---|---|
| The problem the user wants solved | How it works now and where it falls short | The concrete change, and why this way | The owning module's name and the concrete interface names |

## Architecture File I/O

- **Save location**: Write back to `docs/xyf-easycode/html/software_architecture.js`, or keep the other confirmed path if one exists; change only the confirmed content, keeping untouched fields, existing IDs, and `formatVersion`; a rename keeps its ID; new IDs are globally unique.
- **Data format**: Read and write `globalThis.softwareArchitecture = <strict JSON>;` with [ProjectFile.parse/stringify](../xyf-easycode-install/html/assert/project-file.js); do not execute the configuration code and do not add other statements; validate against the [data reference](../xyf-easycode-install/html/references/architecture-data.jsonc) and [Model.validate](../xyf-easycode-install/html/assert/model.js), and save after it passes.
- **Write verification**: Before saving, check for external modifications and pause on conflict; after saving, read back, parse, and validate to confirm the write succeeded.
- **Change records**: When retention is needed, save as `docs/xyf-easycode/reports/<ID>_requirements.md`, with the ID rule same as [check](../xyf-easycode-check/SKILL.md); do not save under the review report's file name.
