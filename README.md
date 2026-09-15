# Data Capture Flow Compare

Compare Salesforce Data Capture Flow versions in VS Code / Cursor (VSIX UI) or via Cursor **subagent** (CLI).

All package files live in **[`Data Capture compare/`](./Data%20Capture%20compare/)**.

## Quick start

### Extension (UI)

1. Download [`Data Capture compare/data-capture-flow-compare-0.4.44.vsix`](./Data%20Capture%20compare/data-capture-flow-compare-0.4.44.vsix)
2. Cursor / VS Code → **Extensions** → **Install from VSIX…**

### Subagent (any Cursor project — recommended)

See **[`Data Capture compare/GLOBAL-SETUP.md`](./Data%20Capture%20compare/GLOBAL-SETUP.md)** for a one-time machine install under `~/.cursor/`.

### Subagent (this project only)

```bash
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git
cd "SFS-data-capture-flow-compare/Data Capture compare"
npm install
npm run compile

# From your DX project root (folder with sfdx-project.json):
mkdir -p .cursor/agents
cp "/path/to/SFS-data-capture-flow-compare/Data Capture compare/.cursor/agents/dc-flow-compare.md" .cursor/agents/
```

Requires Salesforce CLI (`sf`) and an authorized org for org compares.
