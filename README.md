# Data Capture Flow Compare

## VS Code / Cursor UI

Install [`data-capture-flow-compare-0.4.44.vsix`](./data-capture-flow-compare-0.4.44.vsix) via **Extensions → Install from VSIX…**

## Cursor subagent

1. Clone into your DX project:

```bash
mkdir -p extensions
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git extensions/data-capture-flow-compare
cd extensions/data-capture-flow-compare
npm install
npm run compile
```

2. Copy the subagent to your **project root** (Cursor only loads agents from there):

```bash
mkdir -p ../../.cursor/agents
cp .cursor/agents/dc-flow-compare.md ../../.cursor/agents/
```

3. Open the DX project in Cursor and run the **dc-flow-compare** subagent.

Requires Salesforce CLI (`sf`) and an authorized org for org compares.
