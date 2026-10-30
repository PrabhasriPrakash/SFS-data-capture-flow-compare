# Data Capture Flow Compare

Compare two versions of a Salesforce Data Capture Flow. You get a table of what changed: change type, label, API name, element, and the left and right values.

- Two versions of one flow in one org
- The same flow in two orgs
- Two local `.flow-meta.xml` files

**Added** is only on the right, **Removed** is only on the left, and **Updated** is on both sides with a change inside. The compare reads Flow XML. It does not edit the flow or deploy.

Package files are in [`Data Capture compare/`](./Data%20Capture%20compare/). Version **0.4.45**.

| Piece | What it does |
| --- | --- |
| **Extension** | Compare panel in Cursor or VS Code |
| **CLI** | `dc-flow-compare`, the command chat runs |
| **Subagent** | Cursor agent **dc-flow-compare**. Pick it in a new Agent chat |
| **Skill** | Same compare in a normal Agent chat, without picking the subagent |

**Need:** Cursor, Node.js 18 or newer, and npm. An org compare also needs Salesforce CLI (`sf org login web --alias MyOrg`) and the DX project open (the folder with `sfdx-project.json`).

Run each block in order, in the same terminal. Wait until it finishes before the next block.

## 1. Extension

1. Open [`Data Capture compare/data-capture-flow-compare-0.4.45.vsix`](./Data%20Capture%20compare/data-capture-flow-compare-0.4.45.vsix).
2. **Extensions** → **⋯** → **Install from VSIX…**
3. **Developer: Reload Window**.

## 2. Package path

Skip the clone if you already have this repo. Set the path to its `Data Capture compare` folder.

```bash
rm -rf /tmp/SFS-data-capture-flow-compare
```

```bash
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
```

```bash
PACKAGE="/tmp/SFS-data-capture-flow-compare/Data Capture compare"
```

If the repo is already on the machine, use that path instead of the `/tmp` path above. On Windows, set `$Package` in the next section to the same folder.

## 3. CLI, subagent, and skill

Installed once per computer, for every Cursor project.

### macOS and Linux

```bash
mkdir -p ~/.cursor/tools ~/.cursor/agents ~/.cursor/skills/dc-flow-compare
```

```bash
rm -rf ~/.cursor/tools/dc-flow-compare
```

```bash
cp -R "$PACKAGE" ~/.cursor/tools/dc-flow-compare
```

```bash
cd ~/.cursor/tools/dc-flow-compare
```

```bash
npm install
```

```bash
npm run compile
```

```bash
cp ~/.cursor/tools/dc-flow-compare/.cursor/agents/dc-flow-compare.md ~/.cursor/agents/dc-flow-compare.md
```

```bash
cp ~/.cursor/tools/dc-flow-compare/skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/SKILL.md
```

```bash
node ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js --help
```

You should see usage text for `local` and `org`.

### Windows (PowerShell)

Use one PowerShell window so `$Package` and `$Tool` stay set. Replace the package path.

```powershell
$Package = "C:\path\to\Data Capture compare"
```

```powershell
$Tool = Join-Path $env:USERPROFILE ".cursor\tools\dc-flow-compare"
```

```powershell
New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE ".cursor\tools"), (Join-Path $env:USERPROFILE ".cursor\agents"), (Join-Path $env:USERPROFILE ".cursor\skills\dc-flow-compare") | Out-Null
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

## 4. Reload

**Developer: Reload Window.** Then **dc-flow-compare** should appear in the subagent list, and **Data Capture Flow: Compare from Org** should appear in the Command Palette.

## Use

Open the DX project first.

**Panel.** Command Palette → **Data Capture Flow: Compare from Org** or **Compare Two Local Flow Files**.

Use the Salesforce org alias in the message. Use the same alias as `sf org login web --alias MyOrg`, including capitals.

**Subagent.** New Agent chat, pick **dc-flow-compare**, then:

`Compare WWDigsForm version 60 and version 61 in org MyOrg`

**Skill.** Normal Agent chat. Do not pick the subagent. Same prompt, with the org alias in the message:

`Compare WWDigsForm version 60 and version 61 in org MyOrg`

**Terminal.** `--project-dir` is the DX project, not the tool folder.

```bash
node ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js org WWDigsForm --left 60 --right 61 --org MyOrg --project-dir "$PWD" --format table
```

Two orgs: use `--left-org` and `--right-org` instead of `--org`. Two files: `local ./left.flow-meta.xml ./right.flow-meta.xml --format table`.

```powershell
node "$env:USERPROFILE\.cursor\tools\dc-flow-compare\bin\dc-flow-compare.js" org WWDigsForm --left 60 --right 61 --org MyOrg --project-dir (Get-Location).Path --format table
```

## If it fails

| What you see | What to do |
| --- | --- |
| Subagent is missing | Confirm `~/.cursor/agents/dc-flow-compare.md` exists, then reload. |
| Chat misses rows | Confirm `~/.cursor/skills/dc-flow-compare/SKILL.md` exists, then reload. |
| Not authorized | `sf org login web --alias MyOrg`, then use that alias. |
| Retrieve writes to the wrong folder | Pass the DX project as `--project-dir`. |
