# Global setup (any Cursor project)

Install once per Mac. After this, **dc-flow-compare** works no matter which folder you open in Cursor.


## 1. Install CLI + Cursor helpers

```bash
mkdir -p ~/.cursor/tools ~/.cursor/agents ~/.cursor/skills ~/.local/bin

git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
rm -rf ~/.cursor/tools/dc-flow-compare
cp -R "/tmp/SFS-data-capture-flow-compare/Data Capture compare" ~/.cursor/tools/dc-flow-compare
cd ~/.cursor/tools/dc-flow-compare
npm install
npm run compile

ln -sfn ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js ~/.local/bin/dc-flow-compare
chmod +x ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js

cp .cursor/agents/dc-flow-compare.md ~/.cursor/agents/
mkdir -p ~/.cursor/skills/dc-flow-compare
cp .cursor/skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/
```

Ensure `~/.local/bin` is on your PATH. Then **reload Cursor**.

## 2. Use in any project

1. Open any Salesforce DX project in Cursor.
2. Chat: `/dc-flow-compare` or pick the **dc-flow-compare** subagent.
3. Example: `Compare WWDigsForm v60 vs v61 --org MyOrg`

Org compares use the **open project** as `--project-dir`. You still need `sf org login`.

## 3. Optional: VSIX UI

Install `data-capture-flow-compare-0.4.44.vsix` from the `Data Capture compare` folder via **Install from VSIX…**.

## 4. Update later

```bash
git clone --depth 1 https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
rm -rf ~/.cursor/tools/dc-flow-compare
cp -R "/tmp/SFS-data-capture-flow-compare/Data Capture compare" ~/.cursor/tools/dc-flow-compare
cd ~/.cursor/tools/dc-flow-compare
npm install && npm run compile
cp .cursor/agents/dc-flow-compare.md ~/.cursor/agents/
cp .cursor/skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/
```
