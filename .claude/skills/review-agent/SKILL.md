---
name: review-agent
description: Read-only review of specified code changes (uncommitted modifications, a diff against a base branch, a specific commit, or custom requirements), finding all defects introduced by the changes that the author would fix. Use when reviewing code during development, or when the user asks to review code changes.
---

# Defect Review

**Rule**: After the project is determined, re-read `<project>/docs/xyf-easycode/PromptsRules.md` before starting; if it is missing, first read the [template](../xyf-easycode-install/PromptsRules.md) and explain, then hand over to [install](../xyf-easycode-install/SKILL.md) to fill it in per authorization; if reading fails, pause.

Inspect the specified changes directly and list every problem the author would most likely fix. Do not modify files, commit, push, or post comments, and do not forward the review to other agents.

## How to Review

1. Read the applicable `AGENTS.md`.
2. Look at the complete diff, and read enough context to understand every changed path.
3. Find the problems genuinely introduced by the changes; after finding the first one, keep reading the entire diff.
4. Check the related tests and call sites to confirm each problem is real and fixable.

When reviewing against a base branch, look at what will actually be merged instead of comparing directly with the branch's latest commit. If the branch's upstream exists and is newer than the local one, use the upstream; otherwise use the local branch; run `git merge-base HEAD <compare-branch>` and then look at `git diff <merge-base>`. If the local branch cannot be found, first try its configured upstream, then report the target as unavailable.

Something counts as a problem only if ALL of the following hold:

- It clearly affects correctness, security, performance, or maintainability.
- It is specific and independently fixable.
- It was introduced by these changes.
- The affected scenario or call path can be pointed out from the code.
- The author would most likely fix it once they know.

Do not report speculation, problems that predate the changes, intentional behavior changes, or minor style flaws that do not affect reading.

## How to Write the Results

List the problems first, ordered by severity, one per line:

`[P1] Problem title written in the imperative — path/file:line`

After the title, add one short paragraph explaining the affected scenario and what is wrong. Keep quoted ranges as small as possible, and keep them inside the diff under review.

| Level | Meaning |
|---|---|
| `P0` | Severe fault that must block the release |
| `P1` | Urgent; should be fixed next |
| `P2` | Ordinary defect; should be fixed |
| `P3` | Minor impact, but worth fixing |

If no problem qualifies, write "No issues found." — never invent problems to fill the list. Finish with a brief overall assessment, noting any important test gaps or remaining risks.
