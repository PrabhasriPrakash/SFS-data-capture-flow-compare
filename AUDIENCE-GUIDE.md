# Data Capture Flow Compare — install and use

**Version:** 0.4.45  
**For:** Windows, macOS, and Linux  
**You install three pieces.** They share one compare engine. Install all three if you want both the side panel and chat.

| Piece | What you get | Required |
| --- | --- | --- |
| Extension (VSIX) | Colored compare panel inside Cursor or VS Code | For the panel |
| CLI | `dc-flow-compare` command the chat tools run | For chat |
| Subagent | A selectable agent named **dc-flow-compare** | For chat |
| Skill | The same compare rules, applied automatically when you ask for a Flow compare in chat | For chat |

The subagent and the skill both call the CLI. The CLI uses the same diff rules as the extension.

---

## Before you start

Install these first:

- **Cursor** (the VSIX also installs in VS Code; the skill and subagent are Cursor-only)
- **Node.js 18 or newer** and **npm** (`node -v`, `npm -v`)
- **Salesforce CLI** (`sf --version`) if you will compare flows stored in an org
- An authorized org: `sf org login web --alias MyOrg`
- A Salesforce DX project open in Cursor (the folder that contains `sfdx-project.json`) when you compare from an org

You do not need an org login to compare two Flow XML files that are already on disk.

---

The same VSIX file installs on Windows, macOS, and Linux. Cursor keeps the CLI, subagent, and skill in your user profile:

| | Windows | macOS and Linux |
| --- | --- | --- |
| CLI | `%USERPROFILE%\.cursor\tools\dc-flow-compare` | `~/.cursor/tools/dc-flow-compare` |
| Subagent | `%USERPROFILE%\.cursor\agents\dc-flow-compare.md` | `~/.cursor/agents/dc-flow-compare.md` |
| Skill | `%USERPROFILE%\.cursor\skills\dc-flow-compare\SKILL.md` | `~/.cursor/skills/dc-flow-compare/SKILL.md` |

Chat always starts the CLI with `node`, so Windows does not need a shell script on `PATH`.

---

## 1. Install the extension (the panel)

1. Take `data-capture-flow-compare-0.4.45.vsix` from the `Data Capture compare` folder (or from the file shared with you).
2. In Cursor: **Extensions** → **⋯** → **Install from VSIX…**
3. Choose that file.
4. Run **Developer: Reload Window** from the Command Palette.

Confirm the commands exist. Open the Command Palette and search for **Data Capture Flow**. You should see:

- **Data Capture Flow: Compare from Org (Same or Across Orgs)**
- **Data Capture Flow: Compare Two Local Flow Files**
- **Data Capture Flow: Show Structured Change Summary**

---

## 2. Install the CLI, subagent, and skill (chat)

Run this once. It copies the package onto your machine, builds the CLI, and registers the subagent and skill for every Cursor project.

Replace the package path with the full path of the `Data Capture compare` folder you were given.

### Windows (PowerShell)

```powershell
$Package = "C:\path\to\Data Capture compare"
$Tool = Join-Path $env:USERPROFILE ".cursor\tools\dc-flow-compare"
New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE ".cursor\agents"), (Join-Path $env:USERPROFILE ".cursor\skills\dc-flow-compare") | Out-Null
if (Test-Path $Tool) { Remove-Item -Recurse -Force $Tool }
Copy-Item -Recurse -LiteralPath $Package -Destination $Tool
Set-Location -LiteralPath $Tool
npm install
npm run compile
Copy-Item -Force (Join-Path $Tool ".cursor\agents\dc-flow-compare.md") (Join-Path $env:USERPROFILE ".cursor\agents\dc-flow-compare.md")
Copy-Item -Force (Join-Path $Tool "skills\dc-flow-compare\SKILL.md") (Join-Path $env:USERPROFILE ".cursor\skills\dc-flow-compare\SKILL.md")
node .\bin\dc-flow-compare.js --help
```

### macOS and Linux (Terminal)

```bash
PACKAGE="/path/to/Data Capture compare"

mkdir -p ~/.cursor/tools ~/.cursor/agents ~/.cursor/skills/dc-flow-compare

rm -rf ~/.cursor/tools/dc-flow-compare
cp -R "$PACKAGE" ~/.cursor/tools/dc-flow-compare
cd ~/.cursor/tools/dc-flow-compare
npm install
npm run compile

cp .cursor/agents/dc-flow-compare.md ~/.cursor/agents/dc-flow-compare.md
mkdir -p ~/.cursor/skills/dc-flow-compare
cp skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/SKILL.md

node ./bin/dc-flow-compare.js --help
```

You should see usage text for `local` and `org` compares.

Optional on macOS and Linux, if you want a short command in Terminal:

```bash
mkdir -p ~/.local/bin
ln -sfn ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js ~/.local/bin/dc-flow-compare
chmod +x ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js
```

Add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` on macOS or `~/.bashrc` on Linux, then open a new terminal. Chat does not need this. It runs `node` on the script.

Reload Cursor: Command Palette → **Developer: Reload Window**.

One DX project only, instead of every project: copy the same two markdown files into that project's `.cursor/agents/` and `.cursor/skills/dc-flow-compare/` instead of the user-profile paths.

---

## 3. How to use it

Open the Salesforce DX project in Cursor first. Org compares retrieve into that project.

### Panel

Command Palette → **Data Capture Flow: Compare from Org** or **Compare Two Local Flow Files**.

Pick the flow and the two versions (or the two XML files). The summary opens beside the editor.

### Chat, any Agent conversation

Ask in normal language. The skill applies the compare rules.

```text
Compare WWDigsForm version 60 and version 61 in org MyOrg
```

```text
Compare these two flow files: force-app/main/default/flows/WWDigsForm.flow-meta.xml and /tmp/WWDigsForm-v61.flow-meta.xml
```

### Subagent

Start a new Agent chat, choose **dc-flow-compare**, then ask for the compare. Use this when you want that agent and not the general assistant.

### Terminal

Use `node` and the script path. On Windows the script is under `%USERPROFILE%\.cursor\tools\dc-flow-compare\bin\dc-flow-compare.js`. On macOS and Linux it is `~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js`. The examples below use `dc-flow-compare` after the optional PATH link. On Windows, put `node` and that script path in front of the same arguments.

Same org:

```bash
dc-flow-compare org WWDigsForm --left 60 --right 61 --org MyOrg --project-dir "$PWD" --format table
```

Two orgs:

```bash
dc-flow-compare org WWDigsForm --left 60 --right 61 --left-org DevOrg --right-org UatOrg --project-dir "$PWD" --format table
```

Two files:

```bash
dc-flow-compare local ./left.flow-meta.xml ./right.flow-meta.xml --format table
```

Windows PowerShell, same org:

```powershell
node "$env:USERPROFILE\.cursor\tools\dc-flow-compare\bin\dc-flow-compare.js" org WWDigsForm --left 60 --right 61 --org MyOrg --project-dir (Get-Location).Path --format table
```

`--project-dir` must be the DX project (the folder with `sfdx-project.json`), not the tool install folder.

---

## 4. How to read the result

Columns are the same in the panel and in chat:

**Change type · Label · API name · Element · Left version · Right version**

Change type is about the Flow element, not the single line:

- **Added** — the element exists only on the right
- **Removed** — the element exists only on the left
- **Updated** — the element exists on both sides and something inside it changed

Value colors:

| What you see | Meaning |
| --- | --- |
| Left text is **red**, right cell is `—` | That value is on the left version and missing on the right |
| Right text is **green**, left cell is `—` | That value is on the right version and missing on the left |
| Normal text, **red bar** on the left cell and **green bar** on the right cell | Both versions have a value, and the values differ |

A long formula uses the same colors as a short one. Length does not change the color.

An assignment line can be red inside an **Updated** row. That means the assignment element is still there, and that one line was removed. It does not move the row into **Removed**.

When two left-side assignments write the same field with the same value, and the right side has one matching assignment, the compare pairs the closer variable name. Example: `GetSADetails` pairs with `SARecord`. A name that only ends in `_SA` is not treated as that same record.

---

## 5. Confirm the install

1. Help text prints. Windows: `node "$env:USERPROFILE\.cursor\tools\dc-flow-compare\bin\dc-flow-compare.js" --help`. macOS and Linux: `node ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js --help`.
2. The subagent file exists in the user-profile path from the table above.
3. The skill file exists in the user-profile path from the table above.
4. After reload, **dc-flow-compare** appears when you pick a subagent.
5. Command Palette shows **Data Capture Flow: Compare from Org**.
6. Run one known compare. The row count in chat and in the panel should match.

---

## 6. Update later

Replace the package folder, rebuild, and copy the two markdown files again. Use the same Windows or macOS/Linux commands as section 2. Then reload Cursor.

Install the new VSIX from **Extensions → Install from VSIX…** and reload the window. A new VSIX version replaces the panel. Copying the markdown files replaces the chat behavior.

---

## 7. If something fails

| What you see | What to do |
| --- | --- |
| `dc-flow-compare: command not found` | Chat does not need that name. Run `node` on `bin/dc-flow-compare.js` under the CLI path in the table above. The optional PATH link is only for macOS and Linux terminals. |
| Subagent is not in the picker | Confirm `dc-flow-compare.md` is in the user-profile `.cursor/agents` folder, then **Developer: Reload Window**. |
| Chat compares by reading XML itself and misses rows | Confirm `SKILL.md` is in the user-profile `.cursor/skills/dc-flow-compare` folder, then reload. Ask again to compare the flow. |
| Org compare says you are not authorized | `sf org login web --alias MyOrg`, then retry. Use that alias in the request. |
| Retrieve fails or writes outside the project | Open the DX project and pass that folder as `--project-dir`. |
| Panel colors look like the old build | Install `data-capture-flow-compare-0.4.45.vsix` and reload. Version 0.4.44 does not have this coloring. |

The compare does not edit Flow XML and does not deploy.
