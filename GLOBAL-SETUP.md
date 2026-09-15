# Global setup (any Cursor project)

Install once per Mac. After this, **dc-flow-compare** works no matter which folder you open in Cursor.

## 1. Install CLI + Cursor helpers

```bash
# CLI tool (stable path)
mkdir -p ~/.cursor/tools
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git ~/.cursor/tools/dc-flow-compare
cd ~/.cursor/tools/dc-flow-compare
npm install
npm run compile

# Command on PATH
mkdir -p ~/.local/bin
ln -sfn ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js ~/.local/bin/dc-flow-compare
chmod +x ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js

# Global subagent + skill (all projects)
mkdir -p ~/.cursor/agents ~/.cursor/skills
cp ~/.cursor/tools/dc-flow-compare/.cursor/agents/dc-flow-compare.md ~/.cursor/agents/
mkdir -p ~/.cursor/skills/dc-flow-compare
cp ~/.cursor/tools/dc-flow-compare/.cursor/skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/
```

> If the repo still has project-relative agent paths, replace the copied agent/skill with the **global** versions that call `$HOME/.cursor/tools/dc-flow-compare` (or ask the author for the global files).

Ensure `~/.local/bin` is on your PATH (default on many Mac setups). Then **reload Cursor**.

## 2. Use in any project

1. Open any Salesforce DX project in Cursor.
2. Chat: `/dc-flow-compare` or pick the **dc-flow-compare** subagent.
3. Example: `Compare WWDigsForm v60 vs v61 --org MyOrg`

Org compares use the **open project** as `--project-dir` (for `sf` retrieve). You still need `sf org login`.

## 3. Optional: VSIX UI

Download `data-capture-flow-compare-0.4.44.vsix` from the GitHub repo → **Install from VSIX…** once. That UI is also global to Cursor (not tied to one project).

## 4. Update later

```bash
cd ~/.cursor/tools/dc-flow-compare
git pull
npm install
npm run compile
cp .cursor/agents/dc-flow-compare.md ~/.cursor/agents/
cp .cursor/skills/dc-flow-compare/SKILL.md ~/.cursor/skills/dc-flow-compare/
```
