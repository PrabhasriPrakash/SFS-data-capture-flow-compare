# Data Capture Flow Compare

Compare Salesforce Data Capture Flow versions in VS Code / Cursor — org retrieve, XML diff, structured summary, and a CLI that uses the same engine.

## Prerequisites

- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) on `PATH`
- An authorized org (`sf org login web`)
- A Salesforce DX project open in the editor

## Setup (clone)

From your DX project root (folder with `sfdx-project.json`):

```bash
mkdir -p extensions
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git extensions/data-capture-flow-compare
cd extensions/data-capture-flow-compare
npm install
npm run compile
```

### Install as extension (VSIX)

```bash
npx vsce package --allow-missing-repository
```

Then **Extensions** → **Install from VSIX…** and pick the generated `.vsix`. Reload the window.

## Usage

1. Command Palette → **Data Capture Flow: Compare from Org (Same or Across Orgs)**
2. Pick org(s), flow, and versions
3. Review XML diff + structured summary

Or right-click a `*.flow-meta.xml` → compare / change summary against another local file.

### CLI

```bash
npm run compile
node bin/dc-flow-compare.js local left.flow-meta.xml right.flow-meta.xml
node bin/dc-flow-compare.js org FlowApiName --left 36 --right 37 --org myAlias --project-dir ../..
```

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `dcFlowCompare.targetOrg` | `""` | Default org for same-org compares; empty = CLI default |
| `dcFlowCompare.onlyDataCaptureFlows` | `true` | List Data Capture flows only |
| `dcFlowCompare.ignoreLayoutNoise` | `true` | Ignore `locationX` / `locationY` |
| `dcFlowCompare.ignoreProcessMetadata` | `true` | Ignore builder `processMetadataValues` |

## Develop

```bash
npm install
npm test
npm run watch
```
