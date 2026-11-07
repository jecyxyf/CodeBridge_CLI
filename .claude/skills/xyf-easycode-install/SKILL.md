---
name: xyf-easycode-install
description: Installs the software architecture web page and the shared PromptsRules.md rules into a project, filling in only missing files and keeping existing data and settings; does not install the skill package or design the project architecture. Use when the project does not yet have the architecture web page or the rules file.
---

# Install the Architecture Web Page into a Project

This skill installs the software architecture web page into a project. The web files come from this skill's `html/` folder and go to `<project>/docs/xyf-easycode/html/`.

**Rule**: After the project is determined, re-read `<project>/docs/xyf-easycode/PromptsRules.md` before starting and before every batch of writes; if it is missing, first read this skill's [template](PromptsRules.md) and explain, then fill it in per authorization; if reading fails, pause.

| Step | What to do |
| --- | --- |
| 1. Check whether it is already installed | Let the script check the required files and folders — only whether they exist and are the right type, without reading the contents of existing web files. If the web files are complete, skip the web installation; fill in only what is missing. Extra files in the project are left alone. |
| 2. Keep existing files | Existing data, language, `PromptsRules.md`, and user-edited content are kept — the script never overwrites them. New folders are copied in full; existing folders get only their missing files added. On conflicts, such as a file and a folder sharing a name, stop and explain. When replacement is needed, first state exactly what would change and wait for the user to separately reply “执行” to that plan. |
| 3. Determine the web language | Keep a previously chosen language. Use `zh` for Chinese and `en` for English. If a new language file must be created but no language has been chosen yet, ask first. Other languages: split the text into groups, one group per assistant, with no overlap; the main assistant then unifies the wording and checks for missing, duplicated, or blank translations. |
| 4. Run the install script | Use this skill's Python script to check, copy, and verify everything uniformly. Stage new files in a temporary location first, then move them into the project after verification. Even when an existing web file differs from the template, never overwrite it directly. Handle script errors first, then re-check. |
| 5. Verify the installation | The script checks the copied contents, the files the web page needs, and the language text. Every item must have a translation, and the same item must not be filled in twice; different locations may share the same text. Placeholders like `{name}` must be kept as-is, and language names and codes must be correct. Fix any problem found first, then re-check. |
| 6. Tell the user the result | Give the full paths of the target directory, `start.py`, and `index.html`, and state how much was copied, what was skipped, whether the rules file was newly copied or kept, the check results, and the time taken. With browser capability you may open it for a look; if you did not open it, say so directly — never claim the web page was verified to run. |

Python 3 is required, and the target disk must support the hard-link copy method the script uses. When it does not, report the error and handle that first.

```bash
python3 "<skill>/scripts/install.py" --project "<project>" --language zh
```

- Replace `<skill>` with the full path of this skill's folder, and `<project>` with the full path of the target project.
- On Windows without `python3`, use `python` or `py -3` instead.
- For English, replace `zh` with `en`. The language argument may be omitted only when keeping the existing language is confirmed.
- For other languages, check the translation first, then point to the file with `--language-file "<translation-file>"`; do not pass `--language` at the same time.

The main files after installation are listed below; the other files in the source must also be kept in full:

```text
docs/xyf-easycode/
├── PromptsRules.md             # Common rules read before skills run
└── html/
    ├── start.py               # Double-click or run to open the web page (popup-free saving)
    ├── index.html             # Can also be double-clicked to open the web page
    ├── software_architecture.js # The project's architecture data
    ├── language.js            # The web page's language and text
    ├── assert/                # Files used by the web page
    │   ├── language_zh.js     # Chinese template
    │   └── language_eng.js    # English template
    ├── module/                # Canvas and card templates
    └── references/
        └── architecture-data.jsonc # Data reference for assistants
```

When the web page is opened by running `start.py`, `software_architecture.js` is loaded automatically and written back directly, with no file-picker popups at any point; when opening `index.html` directly by double-click, the first save needs file-picker authorization, or you download a JS copy to replace it. A freshly installed architecture is a blank template — it does not mean the project already has these features; do not automatically migrate old data into it. See the [web page README](html/README.md) for details.

Once installation is complete, this run ends. Follow-up work such as drawing the architecture or writing code is handled separately per the user's request.
