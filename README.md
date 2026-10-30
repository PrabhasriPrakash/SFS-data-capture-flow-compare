# Data Capture Flow Compare

Compare two versions of a Salesforce Data Capture Flow and see what changed. The result is a table of flow elements: change type, label, API name, element, and the left and right values.

You can compare:

- Two versions of the same flow in one org
- The same flow across two orgs
- Two local `*.flow-meta.xml` files already on disk

A row is **Added** when the element exists only on the right, **Removed** when it exists only on the left, and **Updated** when it exists on both sides and something inside it changed. The compare reads Flow XML. It does not edit the flow and it does not deploy.

Package files are in **[`Data Capture compare/`](./Data%20Capture%20compare/)**. Version **0.4.45**.

## What each piece does

They share one compare engine. Install the extension for the panel, and the CLI plus subagent plus skill for chat.

| Piece | What it does |
| --- | --- |
| **Extension** | Side panel in Cursor or VS Code. Command Palette: **Data Capture Flow: Compare from Org (Same or Across Orgs)**, **Compare Two Local Flow Files**, or **Show Structured Change Summary**. |
| **CLI** | The `dc-flow-compare` command. It retrieves org versions and prints the same table the panel shows. Chat runs this command with `node`. |
| **Subagent** | A Cursor agent named **dc-flow-compare**. Pick it in a new Agent chat. It runs the CLI once and shows the table. |
| **Skill** | The same rules in a normal Agent chat. Ask for a Flow compare and Cursor runs the CLI. You do not pick the subagent. |

## Before you start

- **Cursor** (the extension also installs in VS Code; the skill and subagent are Cursor-only)
- **Node.js 18 or newer** and **npm** (`node -v`, `npm -v`)
- **Git**, if you clone the repo below
- **Salesforce CLI** (`sf --version`) and an authorized org (`sf org login web --alias MyOrg`) when you compare a flow stored in an org
- The Salesforce DX project open in Cursor (the folder with `sfdx-project.json`) for an org compare

Two Flow XML files already on disk do not need an org login.

Install once per computer. Run **one command at a time** in the same terminal window. Wait until it finishes before you run the next. If a command fails, stop and fix that step.

Files land in your user profile, so every Cursor project can use them:

| | Windows | macOS and Linux |
| --- | --- | --- |
| CLI | `%USERPROFILE%\.cursor\tools\dc-flow-compare` | `~/.cursor/tools/dc-flow-compare` |
| Subagent | `%USERPROFILE%\.cursor\agents\dc-flow-compare.md` | `~/.cursor/agents/dc-flow-compare.md` |
| Skill | `%USERPROFILE%\.cursor\skills\dc-flow-compare\SKILL.md` | `~/.cursor/skills/dc-flow-compare/SKILL.md` |

## 1. Install the extension

1. Take [`Data Capture compare/data-capture-flow-compare-0.4.45.vsix`](./Data%20Capture%20compare/data-capture-flow-compare-0.4.45.vsix).
2. Cursor or VS Code: **Extensions** → **⋯** → **Install from VSIX…**
3. Choose that file.
4. Command Palette → **Developer: Reload Window**.

Confirm the commands. Open the Command Palette and search for **Data Capture Flow**. You should see the three commands named in the table above.

## 2. Get the package folder

Skip this step if you already have this repo. The package is the `Data Capture compare` folder inside it.

Otherwise, clone it:

```bash
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
```

On macOS and Linux the package path is then:

`/tmp/SFS-data-capture-flow-compare/Data Capture compare`

On Windows, clone to a folder you choose and use that `Data Capture compare` path in `$Package` below. If your copy is somewhere else, use that path in the copy command and leave the rest unchanged.

## 3. Install the CLI, subagent, and skill

### macOS and Linux

Create the folders:

```bash
mkdir -p ~/.cursor/tools ~/.cursor/agents ~/.cursor/skills/dc-flow-compare
```

Remove an older copy. This is safe when none exists.

```bash
rm -rf ~/.cursor/tools/dc-flow-compare
```

Copy the package. Keep the quotes; the folder name contains a space.

```bash
cp -R "/tmp/SFS-data-capture-flow-compare/Data Capture compare" ~/.cursor/tools/dc-flow-compare
```

Go to the tool folder, install dependencies, and build `out/cli.js`:

```bash
cd ~/.cursor/tools/dc-flow-compare
```

```bash
npm install
```

```bash
npm run compile
```

Register the subagent and the skill:

```bash
cp ~/.cursor/tools/dc-flow-compare/.cursor/agents/dc-flow-compare.md ~/.cursor/agents/dc-flow-compare.md
```

```bash
cp ~/.cursor/tools/dc-flow-compare/skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/SKILL.md
```

Check the CLI. You should see usage text for `local` and `org` compares.

```bash
node ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js --help
```

Chat runs that `node` command. A short `dc-flow-compare` name in Terminal is optional:

```bash
mkdir -p ~/.local/bin
```

```bash
ln -sfn ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js ~/.local/bin/dc-flow-compare
```

```bash
chmod +x ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js
```

If a new Terminal says the command was not found, add this line to `~/.zshrc` on macOS or `~/.bashrc` on Linux, save, and open a new Terminal:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Windows (PowerShell)

Use the **same** PowerShell window for every command below, so `$Package` and `$Tool` stay set. Replace the package path with the full path of your `Data Capture compare` folder.

```powershell
$Package = "C:\path\to\Data Capture compare"
```

```powershell
$Tool = Join-Path $env:USERPROFILE ".cursor\tools\dc-flow-compare"
```

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE ".cursor\agents") | Out-Null
```

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE ".cursor\skills\dc-flow-compare") | Out-Null
```

```powershell
if (Test-Path $Tool) { Remove-Item -Recurse -Force $Tool }
```

```powershell
Copy-Item -Recurse -LiteralPath $Package -Destination $Tool
```

```powershell
Set-Location -LiteralPath $Tool
```

```powershell
npm install
```

```powershell
npm run compile
```

```powershell
Copy-Item -Force (Join-Path $Tool ".cursor\agents\dc-flow-compare.md") (Join-Path $env:USERPROFILE ".cursor\agents\dc-flow-compare.md")
```

```powershell
Copy-Item -Force (Join-Path $Tool "skills\dc-flow-compare\SKILL.md") (Join-Path $env:USERPROFILE ".cursor\skills\dc-flow-compare\SKILL.md")
```

```powershell
node .\bin\dc-flow-compare.js --help
```

You should see usage text for `local` and `org` compares. Chat starts the CLI with `node`, so Windows does not need this command on `PATH`.

## 4. Reload Cursor

Command Palette → **Developer: Reload Window**.

Then confirm:

1. **dc-flow-compare** appears when you pick a subagent.
2. Command Palette shows **Data Capture Flow: Compare from Org**.
3. `dc-flow-compare.md` and `skills/dc-flow-compare/SKILL.md` are in the user-profile paths in the table above.

One Cursor project only, instead of every project: copy those two markdown files into that project's `.cursor/agents/` and `.cursor/skills/dc-flow-compare/` instead of the user-profile paths. The CLI copy under `.cursor/tools` stays in the user profile.

## Use it

Open the Salesforce DX project first. An org compare retrieves into that project.

**Panel.** Command Palette → **Data Capture Flow: Compare from Org** or **Compare Two Local Flow Files**. Pick the flow and the two versions, or the two XML files. The summary opens beside the editor.

**Any Agent chat.** The skill applies the compare rules.

```text
Compare WWDigsForm version 60 and version 61 in org MyOrg
```

```text
Compare these two flow files: force-app/main/default/flows/WWDigsForm.flow-meta.xml and /tmp/WWDigsForm-v61.flow-meta.xml
```

**Subagent.** New Agent chat → choose **dc-flow-compare** → ask for the compare.

**Terminal.** `--project-dir` is the DX project (the folder with `sfdx-project.json`), not the tool install folder. From that project:

```bash
dc-flow-compare org WWDigsForm --left 60 --right 61 --org MyOrg --project-dir "$PWD" --format table
```

```bash
dc-flow-compare org WWDigsForm --left 60 --right 61 --left-org DevOrg --right-org UatOrg --project-dir "$PWD" --format table
```

```bash
dc-flow-compare local ./left.flow-meta.xml ./right.flow-meta.xml --format table
```

On Windows, put `node` and the script path in front of the same arguments:

```powershell
node "$env:USERPROFILE\.cursor\tools\dc-flow-compare\bin\dc-flow-compare.js" org WWDigsForm --left 60 --right 61 --org MyOrg --project-dir (Get-Location).Path --format table
```

The table columns are **Change type · Label · API name · Element · Left version · Right version**. Left-only text is red. Right-only text is green. When both sides have a value and they differ, the text stays normal and each cell has a colored bar.

## Update later

Repeat section 3. Those commands replace the old CLI, subagent, and skill. Install the new VSIX from **Extensions → Install from VSIX…**, then **Developer: Reload Window**.

## If something fails

| What you see | What to do |
| --- | --- |
| `dc-flow-compare: command not found` | Chat does not need that name. Run `node` on `bin/dc-flow-compare.js` under the CLI path in the table above. |
| Subagent is not in the picker | Confirm `dc-flow-compare.md` is in the user-profile `.cursor/agents` folder, then **Developer: Reload Window**. |
| Chat compares by reading XML itself and misses rows | Confirm `SKILL.md` is in the user-profile `.cursor/skills/dc-flow-compare` folder, then reload. Ask again to compare the flow. |
| Org compare says you are not authorized | `sf org login web --alias MyOrg`, then retry with that alias. |
| Retrieve fails or writes outside the project | Open the DX project and pass that folder as `--project-dir`. |
| Panel colors look like an older build | Install `data-capture-flow-compare-0.4.45.vsix` and reload. |
