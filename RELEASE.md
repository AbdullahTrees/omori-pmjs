# Publishing an OMORI (PMJS) release

This is the short, end-to-end playbook. The full reference is [docs/RELEASING.md](docs/RELEASING.md).

The normal path starts with your work already committed and pushed to `main`, and ends with a Latest GitHub release. Run these steps from the repository root on Windows (Git Bash) or Linux with `gh`, Python 3 and the PMJS build environment available. On Windows the ZIP builds natively with Python (pass `--no-strip`; MSYS `strip` cannot read ARM64 ELF); on Linux the build runs locally. `gh` publishes either way.

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
- The ARM64 libatomic package at `~/omori-test/libatomic/root/usr/lib/aarch64-linux-gnu/libatomic.so.1.2.0` (the builder's default path).

The builder already uses the two default runtime paths above inside WSL/Linux. If the runtime changed, rebuild it first (see the README's build section). Only for a non-default runtime, set both paths as WSL/Linux sees them; never pass a Git Bash `$HOME` path:

```bash
export PMJS_RUNTIME="/home/<wsl-user>/omori-test/pmjs-int3/dist/pmjs-arm64"
export PMJS_RUNTIME_SRC="/home/<wsl-user>/omori-test/pmjs-int3"
```

Game-side JavaScript, metadata, patches or documentation changes do not need a runtime rebuild.

## 1. Choose the version

Use semantic versioning with a leading `v`: `vMAJOR.MINOR.PATCH`. Start at `v0.7.2`; the next patch fix is `v0.7.3`, a feature release `v0.8.0`, and a breaking change `v1.0.0`. The tag is the version (`v0.7.2`), the ZIP is `OMORI-PMJS-v0.7.2.zip`, and the notes are `docs/releases/v0.7.2.md`. Historical date-tagged releases keep their `OMORI-PMJS-<date>` tags.

## 2. Prepare the release

```bash
tools/release.sh prepare \
  --version v0.7.2 \
  --changes "Fixed the title-screen crash; Improved cache reuse on the first map."
```

This command:

1. writes `docs/releases/v0.7.2.md` from the template and updates `CHANGELOG.md`;
2. commits `Release v0.7.2` and pushes `main` (the release is built from this commit);
3. builds `share/out/OMORI-PMJS-v0.7.2.zip` (natively on Windows or Linux);
4. validates the ZIP: top-level layout, metadata, screenshot size, licenses, key-free converter, LF shell scripts and provenance;
5. prints the artifact path and SHA-256.

Use `--changes-file FILE` for a longer note, `--force` to overwrite an existing notes file, or `--no-build` to prepare only the notes/commit. Keep a changes file outside the repository or in the git-ignored `share/out/`; an untracked file inside the repo makes `prepare` refuse a dirty tree. Separate changes with semicolons or put each on its own bullet in a file. Re-running `prepare` after its release commit resumes at the build instead of adding a second commit; the changelog section is replaced, not duplicated.

If `prepare` commits and pushes but the build or artifact check fails, fix the cause and run:

```bash
tools/release.sh build --version v0.7.2
```

That builds and checks the current pushed commit without another commit. Do not re-run `prepare` with `--force` for this; use a new version if the notes themselves need to change.

If you must release the exact commit you already pushed without `prepare`'s extra release commit, add `docs/releases/<version>.md` and the `CHANGELOG.md` entry before pushing your work (or make one more commit), push, run `tools/release.sh build --version <version>`, then continue at step 3. The normal path is `prepare`.

## 3. Test the exact artifact on a device

Install `share/out/OMORI-PMJS-<version>.zip` on the device and run it. Test at least a launch/warm start and the patches you changed.

Write a receipt next to the artifact (outside the repository, or in the git-ignored `share/out/`):

```json
{
  "schema": 1,
  "version": "v0.7.2",
  "sha256": "<the 64-character hash from the first field of share/out/OMORI-PMJS-v0.7.2.zip.sha256>",
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
  --version v0.7.2 \
  --receipt /path/to/device-receipt.json
```

This checks that:

- the artifact was built from the current `main` commit and its source tree was clean;
- the receipt's version and SHA-256 match the artifact;
- the working tree is clean and `main` is pushed;
- the tag and GitHub release do not already exist.

It then tags the commit, pushes `v0.7.2`, and creates a **Latest** GitHub release with:

- `OMORI-PMJS-v0.7.2.zip`
- `OMORI-PMJS.zip` (stable name, so `/releases/latest/download/OMORI-PMJS.zip` always works)
- the `.sha256`, manifest JSON, gameplay screenshot and device receipt

### No device on hand

Publish the full release anyway, explicitly:

```bash
tools/release.sh publish --version v0.7.2 --skip-device-check
```

`--allow-unverified` is an alias. The release is created as **Latest** and marked **Unverified** in its body. When a device becomes available, test the same ZIP and promote it:

```bash
tools/release.sh promote --version v0.7.2 --receipt /path/to/device-receipt.json
```

`promote` verifies the artifact against the release tag, uploads the receipt, replaces the Unverified note with the device verification, and marks the release **Latest**. The tag and download URLs do not move. It needs a clean working tree and the original `share/out/OMORI-PMJS-<version>.zip`; keep that file until you have promoted or decided to publish a new version.

### Test-only release

```bash
tools/release.sh publish --version v0.7.2 --prerelease
```

A prerelease is not Latest; `promote` can turn it into the verified Latest release later.

### Check without publishing

Validate the artifact and receipt, or render the release body without changing GitHub:

```bash
tools/release.sh check --version v0.7.2 --receipt /path/to/device-receipt.json
tools/release.sh publish --version v0.7.2 --receipt /path/to/device-receipt.json --dry-run
```

`publish --dry-run` writes the body to `share/out/release-body-<version>.md` and prints its path; it does not tag, push or upload. `check` does not need a clean tree; `publish --dry-run` still requires `main` to be clean and pushed because it is the final preflight. To check an artifact that was built before later commits, add `--commit <tag>`; the script resolves the tag to its commit (`v0.7.2` for a semantic release, `OMORI-PMJS-<date>` for a historical one).

## 5. Verify the result

```bash
tools/release.sh status
gh release view v0.7.2 -R AbdullahTrees/omori-pmjs
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
| `tag ... already exists` | If no release is public, run the cleanup below and retry; otherwise use a new version. |
| `release ... already exists` | Delete an unpublished release first; otherwise use a new version. |
| `receipt sha256 does not match` | The receipt is for a different ZIP; use the `.sha256` next to the artifact. |
| `a device receipt is required` | Test and pass `--receipt`, or use `--skip-device-check`/`--prerelease`. |
| `gh: ... not logged in` or 403 | `gh auth switch --user AbdullahTrees`, or set `GH_TOKEN`. |
| `warning: no strip tool found` or `strip: Unable to recognise the format` | On Windows, pass `--no-strip` to `tools/release-build.py`; MSYS `strip` cannot read ARM64 ELF. On Linux, source `~/omori-test/build-env/env.sh`; `release.sh` does this automatically when present. |
| Device exits immediately and no `log.txt` appears; `bad interpreter` in a shell | The launcher has CRLF line endings. Rebuild with the current builder (it writes LF and refuses CRLF); do not publish the ZIP. |

If the tag was pushed but the release was not published, fix the cause, remove the local and remote tag (and any partial release), then retry:

```bash
TAG=v0.7.2
gh release delete "$TAG" -R AbdullahTrees/omori-pmjs --yes --cleanup-tag || true
git tag -d "$TAG" || true
git push origin ":refs/tags/$TAG" || true
```

Deleting only the remote tag is not enough: `publish` checks the local tag first.

Never move a tag whose release is already public. Publish a new version instead.

## What gets committed and what gets published

- `prepare` commits only the release notes and `CHANGELOG.md`; the code is whatever you already pushed.
- The artifact's `manifest.json` records the exact source commit. The GitHub tag points at that commit.
- The release assets are the versioned ZIP, the stable ZIP, checksum, manifest, screenshot and (for a verified release) the device receipt.
- Tags and releases are immutable history; use a new version for fixes.
