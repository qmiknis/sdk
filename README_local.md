# Building the IQM SDK docs locally

These instructions reproduce, on your own machine, what the GitHub Actions workflow
(`.github/workflows/publish.yml`) does — everything except the final deployment.

## Building with Mise

[Mise](https://mise.jdx.dev/) is a tool that automates the building of the SDK docs.
It handles the Python environment, package installation, Sphinx build, site building
and HTTP server for you.

To install necessary tools (`uv`, `node`, `python`), run:

```bash
mise list # To see what tools are installed
mise install
```

Separate tasks can be listed with

```bash
mise tasks
```

Mise can run all necessary tasks with one command, or you can run each task
separately. Tasks declare their dependencies, so `serve-http` transparently
runs `build-sphinx` and `package-docs` first if needed.

All in one command (build everything, then serve):

```bash
mise run serve-http          # open http://127.0.0.1:8000
```

One task at a time:

```bash
mise run build-sphinx        # build each package's Sphinx docs
mise run package-docs        # build the React site + search index
mise run serve-http          # serve docs/public over HTTP
```

Other useful tasks:

```bash
mise run build-sphinx --current-only   # skip old SDK versions (faster)
mise run serve-http-hot-reload         # Vite dev server with hot reload
mise run wipe                          # remove build artifacts
```

## Building without Mise

### Prerequisites

- [`uv`](https://github.com/astral-sh/uv) — Python environment & installer
- Node.js (v24 has been tested) + `npm` — for the React front page
- [`graphviz`](https://graphviz.org/download/) — optional; some diagrams won't
  render without the `dot` binary

### ⚠️ Watch out for internal package indexes

CI runs in a clean environment that installs everything from public PyPI. If
your shell has an internal index configured, it can **shadow** the versions
pinned in the `sdk*.txt` files and break the build with a confusing
`Invalid version: 'unknown'` error deep inside Sphinx.

Check for these before building:

```bash
env | grep -iE 'UV_INDEX|UV_EXTRA_INDEX|PIP_INDEX|PIP_EXTRA_INDEX'
```

If anything is set, run the build with those
variables unset.

### 1. Create the Python environment

Match CI's Python version:

```bash
uv venv --python 3.12
source .venv/bin/activate
```

### 2. Build the package documentation + search index

```bash
bash build.sh  # add --current-only to skip old SDK versions (faster)
```

`build.sh`:

- reads SDK file `sdk*.txt`,
- downloads and installs the pinned package versions,
- builds each package's Sphinx docs into `docs/public/<package-name>/`,
- generates the search index (`search.json`).

Useful flags:

| Flag | Purpose |
| --- | --- |
| `--current-only` | Build only the default SDK version. Much faster for local iteration. |
| `--local-pypi DIR` | Resolve packages from a local PEP 503 index (for unreleased packages). |

### 3. Build the React front page

```bash
cd docs

npm ci
npm run build                    # `prebuild` runs copy-sdk-files.sh automatically

mkdir -p public
cp -r dist/* public/
cp src/favicon.ico public/favicon.ico
```

`npm run build` triggers the `prebuild` hook, which runs `copy-sdk-files.sh`
to copy `../sdk*.txt` **and** `../advertised_sdk.txt` into `docs/public/`.
The front page reads `advertised_sdk.txt` at runtime to discover which SDK
versions to show, so those files must be present alongside the built site.

### 4. Serve it

```bash
cd docs/public
python3 -m http.server --bind 127.0.0.1 8000
# open http://localhost:8000
```

### Faster front-end-only workflow

If you're only changing the React front page and don't need freshly built
package docs, you can skip `build.sh` and reuse the search indexes from the
published site. The front page fetches a **per-version** index at
`./sdkX_Y/search_sdkX_Y.json` (not a single `search.json`), so download the
`sdkX_Y/` directories you care about — including their `search_sdkX_Y.json`
files — from the
[`gh-pages` branch](https://github.com/iqm-finland/docs/tree/gh-pages) into
`docs/public/`.

The `dev` server does **not** run the `prebuild` hook, so copy the SDK
manifest files in manually before starting it (otherwise version discovery
finds nothing):

```bash
cd docs
./copy-sdk-files.sh    # copies ../sdk*.txt and ../advertised_sdk.txt into docs/public
npm install
npm run dev            # Vite dev server with hot reload
```

(Yarn users: `yarn install && yarn dev`.)

## Adding new OS versions

The docs website derives its version list from the `advertised_sdk.txt`
manifest — no code changes or per-version config are needed.

### How It Works

`advertised_sdk.txt` lists one SDK file per line; only files listed there are
built and shown. Both `build.sh` (which builds each version) and the front page
(`docs/src/configs.ts`, which renders the version switcher) read this manifest:

- **Manifest-driven**: each non-comment line names an `sdkX_Y.txt` file, e.g.
  `sdk4_5.txt`. Merely creating an `sdkX_Y.txt` file is not enough — it must be
  listed in `advertised_sdk.txt`.
- **Version id**: `sdkX_Y.txt` produces version id `X_Y`.
- **Default version**: the line with a trailing `,default` suffix, e.g.
  `sdk4_5.txt,default`. Exactly one line should carry it.
- **Path mapping**: every version — the default included — is built into its own
  `./sdkX_Y/` directory and served from that path prefix.
- **Automatic sorting**: versions are sorted by number, newest first.
- **Preview warnings**: versions newer than the default are flagged as preview
  in the UI; the default gets a `(Resonance)` label suffix.

### To Add a New Version

1. **Create the SDK file** in the project root, e.g. `sdk5_0.txt`:

   ```
   iqm-pulla[qiskit,qir]==12.0
   iqm-client[qiskit,cirq,cli]==35.0
   iqm-pulse==15.0
   iqm-data-definitions==8.0
   ```

2. **List it in `advertised_sdk.txt`** so it gets built and shown:

   ```
   sdk4_4.txt
   sdk4_5.txt,default
   sdk5_0.txt              # add this line
   ```

3. **(Optional) Make it the default** by moving the `,default` suffix onto its
   line and removing it from the previous default:

   ```
   sdk4_4.txt
   sdk4_5.txt
   sdk5_0.txt,default
   ```

Rebuild (`mise run serve-http`, or `build.sh` + the front-page steps) and the
version appears in the UI with:

- Proper sorting (newest versions on the left)
- Its own `./sdk5_0/` path
- Package list detected from the SDK file
- A preview warning if it's newer than the default
- URL persistence (e.g., `?version=5_0`)

### SDK File Format

Each line should contain a package name, optionally with extras and versions:

```
package-name
package-with-extras[extra1,extra2]
package-with-version==1.2.3
package-with-extras-and-version[extras]==1.0.0
```

### Configuration Properties (Auto-Generated)

- **id**: Version identifier (e.g., `4_5`, `5_0`)
- **label**: Display name — `IQM OS X.Y`, with a ` (Resonance)` suffix on the default
- **pathPrefix**: URL path `./sdkX_Y/` for every version, including the default
- **packages**: Extracted from SDK file content
- **isDefault**: `true` for the version marked with `,default` in `advertised_sdk.txt`
- **isPreview**: `true` for versions newer than the default
- **description**: Auto-generated notice for preview/on-premises versions
