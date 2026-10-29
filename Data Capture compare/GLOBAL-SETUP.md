# Global setup (any Cursor project)

Install once per computer (Windows, macOS, or Linux). After this, the **dc-flow-compare** subagent works no matter which folder you open in Cursor. Windows PowerShell steps are in [`../AUDIENCE-GUIDE.md`](../AUDIENCE-GUIDE.md). The commands below are for macOS and Linux.

All repo package files are under the **`Data Capture compare`** folder.

## 1. Install CLI + subagent

```bash
mkdir -p ~/.cursor/tools ~/.cursor/agents ~/.local/bin

git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
rm -rf ~/.cursor/tools/dc-flow-compare
cp -R "/tmp/SFS-data-capture-flow-compare/Data Capture compare" ~/.cursor/tools/dc-flow-compare
cd ~/.cursor/tools/dc-flow-compare
npm install
npm run compile

ln -sfn ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js ~/.local/bin/dc-flow-compare
chmod +x ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js

cp .cursor/agents/dc-flow-compare.md ~/.cursor/agents/dc-flow-compare.md
mkdir -p ~/.cursor/skills/dc-flow-compare
cp skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/SKILL.md
```

Ensure `~/.local/bin` is on your PATH. Then **reload Cursor**.

## 2. Use in any project

1. Open any Salesforce DX project in Cursor.
2. Pick the **dc-flow-compare** subagent (or ask to use it).
3. Example: `Compare WWDigsForm v60 vs v61 --org MyOrg`

Org compares use the **open project** as `--project-dir`. You still need `sf org login`.

## 3. Skill

```bash
mkdir -p ~/.cursor/skills/dc-flow-compare
cp ~/.cursor/tools/dc-flow-compare/skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/SKILL.md
```

Reload Cursor after this copy. Full audience steps are in [`../AUDIENCE-GUIDE.md`](../AUDIENCE-GUIDE.md).

## 4. Optional: VSIX UI

Install `data-capture-flow-compare-0.4.45.vsix` from the `Data Capture compare` folder via **Install from VSIX…**.

## 5. Update later

```bash
git clone --depth 1 https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
rm -rf ~/.cursor/tools/dc-flow-compare
cp -R "/tmp/SFS-data-capture-flow-compare/Data Capture compare" ~/.cursor/tools/dc-flow-compare
cd ~/.cursor/tools/dc-flow-compare
npm install && npm run compile
cp .cursor/agents/dc-flow-compare.md ~/.cursor/agents/dc-flow-compare.md
mkdir -p ~/.cursor/skills/dc-flow-compare
cp skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/SKILL.md
```
