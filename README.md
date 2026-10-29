# Data Capture Flow Compare

Compare Salesforce Data Capture Flow versions in VS Code / Cursor (VSIX UI) or via Cursor **subagent** (CLI).

All package files live in **[`Data Capture compare/`](./Data%20Capture%20compare/)**.

Audience install steps for the extension, CLI, subagent, and skill are in [`AUDIENCE-GUIDE.md`](./AUDIENCE-GUIDE.md). Use that document for hub submission and for teammates.

## Quick start

### Extension (UI)

1. Download [`Data Capture compare/data-capture-flow-compare-0.4.45.vsix`](./Data%20Capture%20compare/data-capture-flow-compare-0.4.45.vsix)
2. Cursor / VS Code → **Extensions** → **Install from VSIX…**

### Subagent (any Cursor project — recommended)

Install **once per computer** (Windows, macOS, or Linux). After this, the **dc-flow-compare** subagent works in every Cursor project (not only this repo). Windows, macOS, and Linux commands are in [`AUDIENCE-GUIDE.md`](./AUDIENCE-GUIDE.md). The block below is the macOS and Linux path.

**Need:** Git, Node.js (`npm`), Salesforce CLI (`sf`), Cursor.

#### Step 1 — Create the install folders

```bash
mkdir -p ~/.cursor/tools ~/.cursor/agents ~/.local/bin
```

| Folder | Why |
|--------|-----|
| `~/.cursor/tools` | CLI lives here |
| `~/.cursor/agents` | Subagent file Cursor loads in every project |
| `~/.local/bin` | So you can run `dc-flow-compare` from a terminal |

#### Step 2 — Download the repo

```bash
git clone https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
```

This copies GitHub into a temporary folder. Package files are inside **`Data Capture compare/`**.

#### Step 3 — Install the CLI on this machine

```bash
rm -rf ~/.cursor/tools/dc-flow-compare
cp -R "/tmp/SFS-data-capture-flow-compare/Data Capture compare" ~/.cursor/tools/dc-flow-compare
cd ~/.cursor/tools/dc-flow-compare
npm install
npm run compile
```

- `rm -rf` removes an older copy (safe if none exists).
- `cp -R` copies the package (quotes are required because of the space in the folder name).
- `npm install` downloads dependencies.
- `npm run compile` builds `out/cli.js` (what the subagent runs).

#### Step 4 — Put the command on your PATH

```bash
ln -sfn ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js ~/.local/bin/dc-flow-compare
chmod +x ~/.cursor/tools/dc-flow-compare/bin/dc-flow-compare.js
```

Check that `~/.local/bin` is on PATH (open a **new** Terminal window):

```bash
echo $PATH | grep -q "$HOME/.local/bin" && echo "PATH ok" || echo 'Add this to ~/.zshrc then restart Terminal: export PATH="$HOME/.local/bin:$PATH"'
dc-flow-compare --help
```

You should see CLI usage text.

#### Step 5 — Register the Cursor subagent (global)

```bash
cp ~/.cursor/tools/dc-flow-compare/.cursor/agents/dc-flow-compare.md ~/.cursor/agents/
```

This is the file Cursor reads for **all** projects.

#### Step 6 — Reload Cursor and run a compare

1. In Cursor: **Developer: Reload Window** (Command Palette).
2. Open **any** Salesforce DX project (folder with `sfdx-project.json`).
3. New Agent chat → pick **dc-flow-compare** (or ask to use that subagent).
4. Example: `Compare WWDigsForm v60 vs v61 --org MyOrg`

Org compares need `sf org login web --alias MyOrg` first. Retrieve uses the **open project** as `--project-dir`.

#### Update later (same steps, shorter)

```bash
git clone --depth 1 https://github.com/PrabhasriPrakash/SFS-data-capture-flow-compare.git /tmp/SFS-data-capture-flow-compare
rm -rf ~/.cursor/tools/dc-flow-compare
cp -R "/tmp/SFS-data-capture-flow-compare/Data Capture compare" ~/.cursor/tools/dc-flow-compare
cd ~/.cursor/tools/dc-flow-compare
npm install && npm run compile
cp .cursor/agents/dc-flow-compare.md ~/.cursor/agents/
```

Then reload Cursor.

Copy-paste block (all of the above in one go):

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

cp .cursor/agents/dc-flow-compare.md ~/.cursor/agents/
```

Also documented in [`Data Capture compare/GLOBAL-SETUP.md`](./Data%20Capture%20compare/GLOBAL-SETUP.md).

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
