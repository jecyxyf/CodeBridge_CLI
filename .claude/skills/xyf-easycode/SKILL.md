---
name: xyf-easycode
description: Selects and chains EasyCode skills (requirements design, web installation, content review, code development, architecture sync, and defect review) according to the user's goals. Use when the user mentions EasyCode or the software architecture workflow, or when it is unclear which EasyCode skill fits the task.
---

# XYF EasyCode Main Skill

This skill determines task ownership, checks prerequisites, and chains skills; concrete execution is decided by the corresponding skill. Determine the target project and scope from the user's request and the existing context, asking only for missing key information; deliver once the current scope is complete, and continue only when explicit follow-up tasks and authorization exist.

**Rule**: After the project is determined, re-read `<project>/docs/xyf-easycode/PromptsRules.md` before starting and before every batch of writes; if it is missing, first read the [template](../xyf-easycode-install/PromptsRules.md) and explain, then hand over to [install](../xyf-easycode-install/SKILL.md) to fill it in per authorization; if reading fails, pause.

When installing, place this directory together with the six skill directories listed below into the skill directory supported by the current Agent, keeping the same parent directory and keeping every file inside each directory. Do not overwrite existing user modifications.

## Skill Routing

Choose the skill by the result the user wants, and read only the selected skill's `SKILL.md` and the resources currently needed. Before invoking, confirm the target skill and its required dependencies exist; if anything is missing, report the specific missing items and pause the affected tasks — never claim something is loaded or available when it is not. All links below are relative to this file's directory.

| Task | Skill |
| --- | --- |
| Discuss requirements; generate or update the software architecture file | [xyf-easycode-requirements](../xyf-easycode-requirements/SKILL.md) |
| Deploy the architecture web page or fill in PromptsRules.md | [xyf-easycode-install](../xyf-easycode-install/SKILL.md) |
| Compare architecture and code for differences; produce a review report | [xyf-easycode-check](../xyf-easycode-check/SKILL.md) |
| Plan, code, test, and deliver per the architecture and the review report | [xyf-easycode-code](../xyf-easycode-code/SKILL.md) |
| After code changes, sync the architecture JSON to the actual code (manual user trigger only) | [xyf-easycode-sync](../xyf-easycode-sync/SKILL.md) |
| Read-only review of new defects introduced by specified code changes | [review-agent](../review-agent/SKILL.md) |

## Workflow

0. **Install the web page**: If the project does not yet have `docs/xyf-easycode/html/` or `PromptsRules.md`, first call install to fill them in per authorization.
1. **Requirements discussion and architecture design**: Call requirements, discuss the requirements, and after confirmation generate or update the architecture file.
2. **Difference review**: Call check to compare the architecture with the code and produce a review report listing missing items and differences.
3. **Code development**: Call code. The main agent splits the work per the report; after user confirmation, subagents write code and tests module by module. Each module is first checked against the architecture with check, then reviewed for defects with review-agent; problems go back to the subagent to fix, then are reviewed again. After all modules pass, run an overall review and integration testing. Work is complete only when the review report shows every item meets the requirements.
4. **Architecture sync**: code does not call sync. When code was changed outside this workflow and the architecture lags behind the actual code, suggest that the user trigger sync manually.
