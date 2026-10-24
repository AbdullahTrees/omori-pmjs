# Publishing an OMORI (PMJS) release

This is the short, end-to-end playbook. The full reference is [docs/RELEASING.md](docs/RELEASING.md).

The normal path starts with your work already committed and pushed to `main`, and ends with a Latest GitHub release. Run these steps from the repository root on Windows (Git Bash + WSL) or Linux with `gh`, Python 3 and the PMJS build environment available. On Windows, WSL builds the ARM64 ZIP; on Linux the build runs locally. `gh` publishes either way.

## 0. Start from a clean, pushed main

```bash
git switch main
git pull --ff-only
git status --porcelain          # must print nothing
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

Your last commit is the work you want to release. If `git status` is not empty, commit or stash it first. If `HEAD` is not `origin/main`, push.

Check authentication and the build environment:

```bash
gh auth status
# The account that pushes must have write access. To use the port owner:
gh auth switch --hostname github.com --user AbdullahTrees
# Switch back to your usual account afterwards if you use another one.
```

The build expects:

- On Windows, WSL with the PMJS build environment at `~/omori-test/build-env/env.sh`.
- On Linux, the same build tools on `PATH`; the script runs the build locally.
- A built ARM64 runtime at `~/omori-test/pmjs-int3/dist/pmjs-arm64`.

If the runtime itself changed, rebuild it first (see the README's build section), then point the release at it:

```bash
export PMJS_RUNTIME="$HOME/omori-test/pmjs-int3/dist/pmjs-arm64"
export PMJS_RUNTIME_SRC="$HOME/omori-test/pmjs-int3"
```

Game-side JavaScript, metadata, patches or documentation changes do not need a runtime rebuild.

## 1. Choose the version

Use `YYYY.MM.DD`. For a second release on the same day, use `YYYY.MM.DD.2`, `.3`, and so on. The tag is `OMORI-PMJS-<version>` and the ZIP is `OMORI-PMJS-<version>.zip`.

## 2. Prepare the release

```bash
tools/release.sh prepare \
  --version 2026.10.25 \
  --changes "Fixed the title-screen crash; Improved cache reuse on the first map."
```

This command:

1. writes `docs/releases/2026.10.25.md` from the template and updates `CHANGELOG.md`;
2. commits `Release 2026.10.25` and pushes `main` (the release is built from this commit);
3. builds `share/out/OMORI-PMJS-2026.10.25.zip` in WSL;
4. validates the ZIP: top-level layout, metadata, screenshot size, licenses, key-free converter and provenance;
5. prints the artifact path and SHA-256.

Use `--changes-file FILE` for a longer note, `--co-author` to add the Claude Code co-author trailer, `--force` to overwrite an existing notes file, or `--no-build` to prepare only the notes/commit. Separate changes with semicolons or put each on its own bullet in a file.

If you must release the exact commit you already pushed without `prepare`'s extra release commit, add `docs/releases/<version>.md` and the `CHANGELOG.md` entry before pushing your work (or make one more commit), push, build with `python3 tools/release-build.py --version <version> --require-screenshot`, then continue at step 3. The normal path is `prepare`.

## 3. Test the exact artifact on a device

Install `share/out/OMORI-PMJS-<version>.zip` on the device and run it. Test at least a launch/warm start and the patches you changed.

Write a receipt next to the artifact (outside the repository, or in the git-ignored `share/out/`):

```json
{
  "schema": 1,
  "version": "2026.10.25",
  "sha256": "<the 64-character hash from the first field of share/out/OMORI-PMJS-2026.10.25.zip.sha256>",
  "device": "Anbernic RG40XX-H",
  "cfw": "muOS 2502.0",
  "resolution": "640x480",
  "tests": ["launch", "warm-start", "patches-installed"],
  "verifiedUtc": "2026-10-25T12:00:00Z",
  "notes": "Optional details"
}
```

`docs/device-receipt.example.json` is a copyable example and `docs/device-receipt.schema.json` defines the fields. The SHA-256 must match the ZIP exactly. A full release requires this receipt.

## 4. Publish

With a device receipt:

```bash
tools/release.sh publish \
  --version 2026.10.25 \
  --receipt /path/to/device-receipt.json
```

This checks that:

- the artifact was built from the current `main` commit and its source tree was clean;
- the receipt's version and SHA-256 match the artifact;
- the working tree is clean and `main` is pushed;
- the tag and GitHub release do not already exist.

It then tags the commit, pushes `OMORI-PMJS-2026.10.25`, and creates a **Latest** GitHub release with:

- `OMORI-PMJS-2026.10.25.zip`
- `OMORI-PMJS.zip` (stable name, so `/releases/latest/download/OMORI-PMJS.zip` always works)
- the `.sha256`, manifest JSON, gameplay screenshot and device receipt

### No device on hand

Publish the full release anyway, explicitly:

```bash
tools/release.sh publish --version 2026.10.25 --skip-device-check
```

`--allow-unverified` is an alias. The release is created as **Latest** and marked **Unverified** in its body. When a device becomes available, test the same ZIP and promote it:

```bash
tools/release.sh promote --version 2026.10.25 --receipt /path/to/device-receipt.json
```

`promote` verifies the artifact against the release tag, uploads the receipt, replaces the Unverified note with the device verification, and marks the release **Latest**. The tag and download URLs do not move. It needs a clean working tree and the original `share/out/OMORI-PMJS-<version>.zip`; keep that file until you have promoted or decided to publish a new version.

### Test-only release

```bash
tools/release.sh publish --version 2026.10.25 --prerelease
```

A prerelease is not Latest; `promote` can turn it into the verified Latest release later.

### Check without publishing

Validate the artifact and receipt, or print the release body without touching GitHub:

```bash
tools/release.sh check --version 2026.10.25 --receipt /path/to/device-receipt.json
tools/release.sh publish --version 2026.10.25 --receipt /path/to/device-receipt.json --dry-run
```

`check` does not need a clean tree; `publish --dry-run` still requires `main` to be clean and pushed because it is the final preflight. To check an artifact that was built before later commits, add `--commit OMORI-PMJS-<version>`; the script resolves the tag to its commit.

## 5. Verify the result

```bash
tools/release.sh status
gh release view OMORI-PMJS-2026.10.25 -R AbdullahTrees/omori-pmjs
gh api repos/AbdullahTrees/omori-pmjs/releases/latest --jq .tag_name
```

Open the release page and check the assets and notes. The repository's Releases card and the README download badge update automatically. The stable download link is:

```text
https://github.com/AbdullahTrees/omori-pmjs/releases/latest/download/OMORI-PMJS.zip
```

## If something fails

| Message | Fix |
| --- | --- |
| `working tree is not clean` | Commit or stash your changes. |
| `local main is not pushed to origin` | `git push origin main`. |
| `tag ... already exists` | Use a new version; never reuse a tag. |
| `release ... already exists` | Use a new version, or delete an unpublished release first. |
| `receipt sha256 does not match` | The receipt is for a different ZIP; use the `.sha256` next to the artifact. |
| `a device receipt is required` | Test and pass `--receipt`, or use `--skip-device-check`/`--prerelease`. |
| `gh: ... not logged in` or 403 | `gh auth switch --user AbdullahTrees`, or set `GH_TOKEN`. |
| `no such file: llvm-strip-20` | Source `~/omori-test/build-env/env.sh`; the script does this automatically when present. |

If the tag was pushed but release creation failed, fix the cause and delete the unpublished tag before retrying:

```bash
git push origin :refs/tags/OMORI-PMJS-2026.10.25
```

Never move a tag whose release is already public. Publish a new version instead.

## What gets committed and what gets published

- `prepare` commits only the release notes and `CHANGELOG.md`; the code is whatever you already pushed.
- The artifact's `manifest.json` records the exact source commit. The GitHub tag points at that commit.
- The release assets are the versioned ZIP, the stable ZIP, checksum, manifest, screenshot and (for a verified release) the device receipt.
- Tags and releases are immutable history; use a new version for fixes.
