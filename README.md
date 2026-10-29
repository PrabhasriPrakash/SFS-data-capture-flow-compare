# Data Capture Flow Compare

Compare Salesforce Data Capture Flow versions in VS Code / Cursor (VSIX UI) or via Cursor **subagent** (CLI).

All package files live in **[`Data Capture compare/`](./Data%20Capture%20compare/)**.

Audience install steps for the extension, CLI, subagent, and skill are in [`AUDIENCE-GUIDE.md`](./AUDIENCE-GUIDE.md). Use that document for hub submission and for teammates.

## Quick start

### Extension (UI)

1. Download [`Data Capture compare/data-capture-flow-compare-0.4.45.vsix`](./Data%20Capture%20compare/data-capture-flow-compare-0.4.45.vsix)
2. Cursor / VS Code → **Extensions** → **Install from VSIX…**

### Subagent (any Cursor project — recommended)

Install **once per computer**. After this, the **dc-flow-compare** subagent works in every Cursor project. Windows steps are in [`AUDIENCE-GUIDE.md`](./AUDIENCE-GUIDE.md). The steps below are for macOS and Linux.

**Need:** Git, Node.js (`npm`), Salesforce CLI (`sf`), Cursor.

Run **one command at a time**. Wait until it finishes, then run the next. If a command fails, stop and fix that step before continuing.

#### 1. Create the install folders

```bash
mkdir -p ~/.cursor/tools ~/.cursor/agents ~/.local/bin
```

| Folder | Why |
|--------|-----|
| `~/.cursor/tools` | CLI lives here |
| `~/.cursor/agents` | Subagent file Cursor loads in every project |
| `~/.local/bin` | So you can run `dc-flow-compare` from a terminal |

#### 2. Download the repo

```bash
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
```

This copies GitHub into a temporary folder. Package files are inside **`Data Capture compare/`**.

#### 3. Copy the package onto this machine

```bash
rm -rf ~/.cursor/tools/dc-flow-compare
```

Removes an older copy. Safe if none exists.

```bash
cp -R "/tmp/SFS-data-capture-flow-compare/Data Capture compare" ~/.cursor/tools/dc-flow-compare
```

Copies the package. Keep the quotes; the folder name contains a space.

#### 4. Install dependencies and build

```bash
cd ~/.cursor/tools/dc-flow-compare
```

```bash
npm install
```

Downloads dependencies.

```bash
npm run compile
```

Builds `out/cli.js`, which the subagent runs.

#### 5. Put the command on your PATH

```bash
ln -sfn ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js ~/.local/bin/dc-flow-compare
```

```bash
chmod +x ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js
```

Open a **new** Terminal window, then check the command:

```bash
dc-flow-compare --help
```

You should see CLI usage text. If the shell says the command was not found, add this line to `~/.zshrc`, save the file, and open a new Terminal:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then run `dc-flow-compare --help` again.

#### 6. Register the Cursor subagent

```bash
cp ~/.cursor/tools/dc-flow-compare/.cursor/agents/dc-flow-compare.md ~/.cursor/agents/
```

This is the file Cursor reads for every project.

#### 7. Reload Cursor and run a compare

1. In Cursor: **Developer: Reload Window** (Command Palette).
2. Open **any** Salesforce DX project (folder with `sfdx-project.json`).
3. New Agent chat → pick **dc-flow-compare** (or ask to use that subagent).
4. Example: `Compare WWDigsForm v60 vs v61 --org MyOrg`

Org compares need `sf org login web --alias MyOrg` first. Retrieve uses the **open project** as `--project-dir`.

#### Update later

Run these one at a time, in this order, then reload Cursor.

```bash
git clone --depth 1 https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
```

```bash
rm -rf ~/.cursor/tools/dc-flow-compare
```

```bash
cp -R "/tmp/SFS-data-capture-flow-compare/Data Capture compare" ~/.cursor/tools/dc-flow-compare
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
cp .cursor/agents/dc-flow-compare.md ~/.cursor/agents/
```

Also documented in [`Data Capture compare/GLOBAL-SETUP.md`](./Data%20Capture%20compare/GLOBAL-SETUP.md).

### Subagent (this project only)

Run these one at a time from the folder where you want the clone.

```bash
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git
```

```bash
cd "SFS-data-capture-flow-compare/Data Capture compare"
```

```bash
npm install
```

```bash
npm run compile
```

From your DX project root (the folder with `sfdx-project.json`):

```bash
mkdir -p .cursor/agents
```

```bash
cp "/path/to/SFS-data-capture-flow-compare/Data Capture compare/.cursor/agents/dc-flow-compare.md" .cursor/agents/
```

Replace `/path/to/` with the real path of the clone. Requires Salesforce CLI (`sf`) and an authorized org for org compares.
