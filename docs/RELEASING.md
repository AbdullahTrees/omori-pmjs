# Releasing OMORI (PMJS)

Quick playbook: [RELEASE.md](../RELEASE.md). This page is the full reference.

`tools/release.sh` turns a source commit into a verified GitHub release. It builds the PortMaster ZIP, checks provenance and contents, requires a device receipt for a full release, tags the commit, and publishes the assets. The release is marked **Latest**, so it appears in the repository's Releases card and at `/releases/latest`.

## Prerequisites

- On Windows, WSL (Ubuntu 22.04 by default) with the PMJS build environment; on Linux, the same build tools on `PATH` (the build runs locally).
  - `~/omori-test/build-env/env.sh` provides `llvm-strip-20`.
  - A built ARM64 runtime at `~/omori-test/pmjs-int3/dist/pmjs-arm64` (the default).
  - The ARM64 libatomic package at `~/omori-test/libatomic/root/usr/lib/aarch64-linux-gnu/libatomic.so.1.2.0` (the default).
- `gh` logged in with access to `AbdullahTrees/omori-pmjs`.
- A device for verification.

One-time authentication. Do not commit a token:

```bash
gh auth switch --user AbdullahTrees
# or, for one command:
GH_TOKEN=... tools/release.sh publish ...
```

## Versioning

Use `YYYY.MM.DD` for a release, and append `.2`, `.3` for a second release on the same day. The tag is `OMORI-PMJS-<version>`, the ZIP is `OMORI-PMJS-<version>.zip`.

The builder already uses the default runtime paths inside WSL/Linux. If the PMJS runtime changed, build it first; only for a non-default runtime pass its path as WSL/Linux sees it (never a Git Bash `$HOME` path). A game-side-only fix can reuse the existing runtime:

```bash
export PMJS_RUNTIME="/home/<wsl-user>/omori-test/pmjs-int3/dist/pmjs-arm64"
export PMJS_RUNTIME_SRC="/home/<wsl-user>/omori-test/pmjs-int3"
```

## Prepare

```bash
tools/release.sh prepare \
  --version 2026.10.25 \
  --changes "Fixed the title-screen crash; Improved cache reuse on the first map." \
  --co-author
```

This:

1. writes `docs/releases/2026.10.25.md` and updates `CHANGELOG.md`;
2. commits `Release 2026.10.25` and pushes `main`;
3. builds `share/out/OMORI-PMJS-2026.10.25.zip` from that commit (WSL);
4. verifies the ZIP layout, metadata, screenshot, licenses, key-free converter and provenance, and prints its SHA-256.

The build is clean only if the committed tree is clean. The artifact records the source commit in its `manifest.json`.

## Verify on the device

Install the exact ZIP and run it. First confirm that `omori-pmjs/log.txt` exists and starts with `[launcher] start`; if it does not, the launcher never ran (wrong layout, or a CRLF launcher from a Windows build). The current builder writes LF and the release check rejects CRLF, but always test the exact artifact. Record the artifact SHA-256 from `share/out/OMORI-PMJS-<version>.zip.sha256` in a receipt:

```json
{
  "schema": 1,
  "version": "2026.10.25",
  "sha256": "<the artifact sha256>",
  "device": "Anbernic RG40XX-H",
  "cfw": "muOS 2502.0",
  "resolution": "640x480",
  "tests": [
    "launch",
    "warm-start",
    "patches-installed",
    "conversion-5093-files-0-missing-0-changed"
  ],
  "verifiedUtc": "2026-10-25T12:00:00Z",
  "notes": "Optional details"
}
```

The schema is in `docs/device-receipt.schema.json`; an example is in `docs/device-receipt.example.json`. A full release requires a receipt whose SHA-256 matches the artifact. A build without device verification can be published as a prerelease instead.

Save the receipt outside the repository (or in an ignored directory) so it does not dirty the release commit.

## Publish

```bash
tools/release.sh publish \
  --version 2026.10.25 \
  --receipt /path/to/device-receipt.json
```

This:

1. re-checks the artifact against the current `main` commit, the receipt and the notes;
2. requires a clean tree whose `HEAD` equals `origin/main`;
3. refuses an existing tag or release;
4. creates and pushes `OMORI-PMJS-2026.10.25`;
5. creates a **Latest** GitHub release with:
   - `OMORI-PMJS-2026.10.25.zip`
   - `OMORI-PMJS.zip` (stable name, so `/releases/latest/download/OMORI-PMJS.zip` always works)
   - the `.sha256` file and manifest JSON
   - the gameplay screenshot
   - the device receipt

For a full release without a device on hand, skip the receipt explicitly:

```bash
tools/release.sh publish --version 2026.10.25 --skip-device-check
```

`--allow-unverified` is an alias. The release body is marked **Unverified** and the release is not held back. The default path still requires a receipt, so nobody ships an unverified build by accident.

For a test build that should not become Latest:

```bash
tools/release.sh publish --version 2026.10.25 --prerelease
```

### Promote after the device test

If a release was published without a receipt, test the exact ZIP later and promote it:

```bash
tools/release.sh promote --version 2026.10.25 --receipt /path/to/device-receipt.json
```

`promote` verifies the artifact against the release tag, uploads the receipt, replaces the Unverified/Pre-release note with the device verification, and marks the release **Latest**. The tag and download URL do not move. It needs a clean working tree and the original `share/out/OMORI-PMJS-<version>.zip`.

## Check without publishing

```bash
tools/release.sh check --version 2026.10.25 --receipt /path/to/device-receipt.json
tools/release.sh publish --version 2026.10.25 --receipt ... --dry-run
```

`check` verifies the artifact and receipt but does not tag or upload; add `--commit OMORI-PMJS-<version>` to check an artifact built before later commits. `--dry-run` writes the release body to `share/out/release-body-<version>.md` and prints its path; it does not touch GitHub.

## How the release stays prominent

- The release is marked **Latest**, so GitHub shows it in the repository sidebar's Releases card.
- Every release carries a stable `OMORI-PMJS.zip` asset; the README links to `/releases/latest/download/OMORI-PMJS.zip`.
- The README has a download badge that follows the latest release.
- `CHANGELOG.md` and `docs/releases/<version>.md` keep the history in the repository.

## If a publish step fails

- The tag is pushed before the release is created. If upload fails, fix the cause and remove the local and remote tag (and any partial release), then retry. Deleting only the remote tag is not enough because `publish` checks the local tag first:
  ```bash
  TAG=OMORI-PMJS-2026.10.25
  gh release delete "$TAG" -R AbdullahTrees/omori-pmjs --yes --cleanup-tag || true
  git tag -d "$TAG" || true
  git push origin ":refs/tags/$TAG" || true
  ```
  Never move a tag whose release is already public.
- A failed check changes nothing on GitHub.
- If `prepare` pushed the release commit but the build/check failed, fix the cause and run `tools/release.sh build --version <version>`; do not re-run `prepare` with `--force` (use a new version to change the notes). `prepare` refuses to overwrite an existing notes file unless `--force` is given; the changelog section is replaced, not duplicated.
