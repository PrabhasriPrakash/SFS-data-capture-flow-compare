# Data Capture Flow Compare

VS Code / Cursor extension that compares **Salesforce Data Capture Flow** versions — org retrieve, XML diff, and a clean structured change summary.

## Why

Data Capture flows (`processType = DataCaptureFlow`) are stored as normal Flow metadata, but the Data Capture builder UI does not give a solid version-compare experience. This extension fills that gap in the editor.

## Architecture (MVP)

```
Command Palette
    │
    ├─ Compare from Org (Same or Across Orgs)
    │     ├─ Same org: two versions of one flow
    │     └─ Across orgs: org A flow/version vs org B flow/version
    │           ├─ Tooling API per org
    │           ├─ sf project retrieve start --target-org …
    │           ├─ vscode.diff (XML)
    │           └─ Structured change summary
    │
    ├─ Compare Two Local Flow Files
    └─ Show Structured Change Summary
```

Auth is whatever `sf` already has (authenticated aliases). Same-org compares use the CLI default / `dcFlowCompare.targetOrg`. Cross-org compares prompt for both orgs.

## Prerequisites

- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) on `PATH`
- An authorized org (`sf org login web` / existing alias)
- A Salesforce DX project folder open in VS Code or Cursor

## Clone (share with a coworker)

```bash
# From your Salesforce DX project root (folder that has sfdx-project.json):
mkdir -p extensions
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git extensions/data-capture-flow-compare
cd extensions/data-capture-flow-compare
npm install
npm run compile
```

Copy Cursor helpers into the **project root** (so Cursor finds them):

```bash
# still from extensions/data-capture-flow-compare
mkdir -p ../../.cursor/agents ../../.cursor/skills
cp .cursor/agents/dc-flow-compare.md ../../.cursor/agents/
cp -R .cursor/skills/dc-flow-compare ../../.cursor/skills/
```

Then open the DX project in Cursor, authenticate Salesforce CLI (`sf org login web`), and ask to compare flows or run the CLI / install the VSIX.

## Install (local / downloadable)

From this folder:

```bash
cd extensions/data-capture-flow-compare
npm install
npm run compile
npx vsce package --allow-missing-repository
```

That produces `data-capture-flow-compare-0.1.0.vsix`.

### VS Code

`Extensions` → `…` → **Install from VSIX…** → pick the `.vsix`

### Cursor

Same flow: **Extensions** → **Install from VSIX…**, or:

```bash
cursor --install-extension ./data-capture-flow-compare-0.1.0.vsix
```

Reload the window after install.

## Usage

1. Open your MWS (or any SFDX) project.
2. Command Palette → **Data Capture Flow: Compare from Org (Same or Across Orgs)**
3. Choose **Same org** or **Across two orgs**.
4. Pick org(s), flow(s), and version(s).
5. Review the XML diff and structured summary.

Or right-click any `*.flow-meta.xml` → compare / change summary against another local file.

Org retrieves land in the **OS temp directory** for the compare session (XML diff + summary). Salesforce CLI still needs a short-lived staging folder inside the project (`tmp/dc-flow-compare/`), which is deleted as soon as the copy to temp finishes. Use **Export report** if you want a lasting markdown/HTML copy in a folder you choose.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `dcFlowCompare.targetOrg` | `""` | Default org for same-org compares; empty = CLI default. Cross-org always prompts. |
| `dcFlowCompare.onlyDataCaptureFlows` | `true` | Filter org list to Data Capture only |
| `dcFlowCompare.ignoreLayoutNoise` | `true` | Ignore `locationX` / `locationY` |
| `dcFlowCompare.ignoreProcessMetadata` | `true` | Ignore `processMetadataValues` builder noise |

## Roadmap ideas

- Property table + jump-from-summary-to-XML (Phase B)
- Cross-org and Git compare (Phase C)
- Diagram-style visual diff + Marketplace publish (Phase D)

## Reliability (0.2.0+)

- Retrieved files are **verified** (exist, non-empty, contain `<Flow>`, optional DataCapture check) before diffing.
- Rename detection requires **strong evidence** (exact body match, or label + structural overlap). Label-only matches stay as removed + added.
- Noise filters (settings):
  - `dcFlowCompare.ignoreLayoutNoise` (default on)
  - `dcFlowCompare.ignoreProcessMetadata` (default on)
- CLI JSON parsing tolerates leading warnings; auth failures include a next-step hint.
- Automated tests: `npm run test`

## Usability (0.3.0+ / Phase B)

- Interactive **summary webview** with:
  - Left/Right **property tables**
  - Filters (all / added / removed / renamed / modified)
  - Search
  - **Jump to Baseline/Compare XML** for an element
  - Export Markdown/HTML/PDF report
- **Active vs Latest** one-click version pick when both exist
- Command: **Export Last Report**
- Turn off `onlyDataCaptureFlows` to compare any Flow type

## Cursor CLI + skill

Same diff engine as the VSIX, for chat-driven compares in Cursor:

```bash
npm run compile
node bin/dc-flow-compare.js local left.flow-meta.xml right.flow-meta.xml
node bin/dc-flow-compare.js org RevisitForm --left 36 --right 37 --org myAlias --project-dir ../..
```

Project skill: `.cursor/skills/dc-flow-compare/SKILL.md` (auto-used when asking to compare Data Capture Flow versions in Cursor).

## Develop

```bash
npm install
npm test
npm run watch
```

Then **Run Extension** / open this folder in an Extension Development Host, or press F5 from a VS Code window that has this extension project open.
