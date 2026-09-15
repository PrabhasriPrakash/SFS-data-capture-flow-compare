# Data Capture Flow Compare

## VS Code / Cursor UI

Install [`data-capture-flow-compare-0.4.44.vsix`](./data-capture-flow-compare-0.4.44.vsix) via **Extensions → Install from VSIX…**

## Cursor subagent + skill

1. Clone into your DX project:

```bash
mkdir -p extensions
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git extensions/data-capture-flow-compare
cd extensions/data-capture-flow-compare
npm install
npm run compile
```

2. Copy Cursor helpers into your **project root** (Cursor loads them from there):

```bash
mkdir -p ../../.cursor/agents ../../.cursor/skills
cp .cursor/agents/dc-flow-compare.md ../../.cursor/agents/
cp -R .cursor/skills/dc-flow-compare ../../.cursor/skills/
```

3. Open the DX project in Cursor and run **dc-flow-compare** (subagent or `/dc-flow-compare`).

Large compares open in a **Cursor Canvas** with the same columns as the VSIX summary:
`Change Type` | `Label` | `API name` | `Element` | left version | right version.

Requires Salesforce CLI (`sf`) and an authorized org for org compares.
