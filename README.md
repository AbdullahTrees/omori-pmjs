# OMORI on PMJS

[![Download the latest release](https://img.shields.io/github/v/release/AbdullahTrees/omori-pmjs?style=for-the-badge&label=DOWNLOAD)](https://github.com/AbdullahTrees/omori-pmjs/releases/latest)

An unofficial port of OMORI (RPG Maker MV) to ARM64 PortMaster handhelds, running on [PMJS](https://github.com/bbbreaddd/pmjs), a lightweight native replacement for NW.js/Chromium. The game's own files are never bundled. You supply your own OMORI copy.

This repository contains the port's launcher, game-side patches, Steam-to-plain converter, PortMaster metadata and release builder. The PMJS runtime itself is built from the PMJS source.

## Download

Download the latest release:

- **[OMORI-PMJS.zip](https://github.com/AbdullahTrees/omori-pmjs/releases/latest/download/OMORI-PMJS.zip)** (always the newest build)
- [All releases and notes](https://github.com/AbdullahTrees/omori-pmjs/releases)
- [CHANGELOG.md](CHANGELOG.md)

## Requirements

- OMORI 1.0.8 from Steam, or an already-decrypted copy of the game.
- An ARM64 device running PortMaster, with SDL2, EGL and OpenGL ES 3.0, and glibc 2.28 or newer.
- About 5.5 GB free on the SD card for the first launch.

The port has been tested on an Anbernic RG40XX-H (Allwinner H700, Mali-G31) running muOS 2502.0 at 640x480. Other CFWs and resolutions have not been tested.

## Install

Download the ZIP from [Releases](https://github.com/AbdullahTrees/omori-pmjs/releases/latest).

1. Copy `OMORI (PMJS).sh` to the firmware's Ports folder (`/mnt/mmc/ROMS/Ports/` on muOS, `/roms/ports/` elsewhere).
2. Copy the `omori-pmjs/` folder to the firmware's ports storage (`/mnt/mmc/ports/` on muOS).
3. Copy your Steam OMORI install into `omori-pmjs/gamedata/`, so that `omori-pmjs/gamedata/www/index.html` exists.
4. Put the game's 32-character decryption key in `omori-pmjs/gamedata/key.txt` (see below).
5. Launch OMORI (PMJS) from the Ports menu.

The first launch converts the game files and prepares an image/map cache. It takes about 25 minutes and needs about 5.5 GB free. Later launches take about a minute to the title screen.

## Steam decryption key

The game files alone do not contain the key. Steam supplies it in its launch configuration. On the handheld:

1. On your PC, open Steam's `appcache/appinfo.vdf` with a text or hex editor. On Windows it is normally `C:\Program Files (x86)\Steam\appcache\appinfo.vdf`.
2. Search for `OMORI.exe`. The next string is `--` followed by 32 characters.
3. Save those 32 characters as `gamedata/key.txt` on the SD card.

Alternatively, copy `appinfo.vdf` itself into `gamedata/`; the converter finds the key automatically. A `.bat`, `.sh` or `.cmd` launch script next to `OMORI.exe`, the `OMORI_KEY` environment variable, and `--key` on `tools/extract.js` also work. A copy of the game that is already decrypted needs no key.

This package contains no key.

## Controls

| Button | Action |
|--|--|
| D-Pad / Left Stick | Move / navigate menus |
| A | Confirm / interact |
| B | Cancel / open menu |
| X | Dash (hold) |
| Y | Menu |
| L1 | Page up (menus) |
| R1 | Page down (menus) |
| Start + Select | Quit the game |

## Building the release

The runtime is PMJS for Linux ARM64. Build it on a Linux host:

```bash
git clone https://github.com/bbbreaddd/pmjs.git
cd pmjs
git checkout d551972
python3 tools/dependencies.py --jobs 4
./build.sh --target arm64 --jobs 12
```

The runtime is written to `dist/pmjs-arm64`. The 64-bit Linux build needs Python 3, CMake, Ninja, Clang/LLVM 20 and the development packages listed in PMJS's build guide.

Build and publish a release from this repository:

```bash
tools/release.sh prepare --version 2026.10.25 --changes "Fixed X; Improved Y"
# device-test share/out/OMORI-PMJS-2026.10.25.zip and write a receipt
tools/release.sh publish --version 2026.10.25 --receipt receipt.json
```

`prepare` commits the notes and changelog, pushes `main`, builds the ZIP and checks it. `publish` creates the Latest GitHub release with the versioned ZIP, the stable `OMORI-PMJS.zip`, the checksum, manifest, screenshot and device receipt. See [docs/RELEASING.md](docs/RELEASING.md) for the full process and the receipt format.

The lower-level builder can be run directly:

```bash
python3 tools/release-build.py \
  --runtime ~/omori-test/pmjs-int3/dist/pmjs-arm64 \
  --runtime-src ~/omori-test/pmjs-int3 \
  --version <version>
```

It stages the launcher, metadata, runtime, patches, converter, licenses and an empty `gamedata/`, then writes `share/out/OMORI-PMJS-<version>.zip` and `share/out/OMORI-PMJS.zip`.

## Repository layout

| Path | Contents |
| --- | --- |
| `launcher/` | Game-side JavaScript patches loaded by PMJS: sprite culling, character frames, fps log, experimental fast paths |
| `share/omori-pmjs/OMORI (PMJS).sh` | PortMaster launcher template |
| `share/omori-pmjs/metadata/` | `port.json`, `gameinfo.xml`, `README.md`, `testing_thread.txt` |
| `share/omori-pmjs/licenses-extra/` | License texts not already in the PMJS runtime notices |
| `tools/extract.js` | Converts an encrypted Steam install (or a plain copy) to a plain `www/` tree |
| `tools/reference.sha256` | SHA-256 manifest of the known-good decrypted game |
| `tools/steam-to-reference.patch` | Compatibility changes for the Steam scripts |
| `tools/release-build.py` | Builds the PortMaster ZIP |
| `tools/release.sh` | Prepares, checks and publishes a GitHub release |
| `tools/release_check.py` | Validates a ZIP and device receipt |
| `docs/releases/` | Per-version release notes and the notes template |
| `docs/RELEASING.md` | Release process, versioning, device receipt and troubleshooting |
| `CHANGELOG.md` | Short release history |

## Credits and licensing

OMORI is created and published by OMOCAT, LLC. This is an unofficial fan port, not affiliated with or endorsed by OMOCAT. You must own the game.

PMJS is by bbbreaddd and is MIT licensed; its bundled third-party components and their licenses are listed in `licenses/` in the release ZIP. The Steam key-discovery approach follows meetox-omori's builder.

The port's launcher, patches and tools do not have a declared license yet. The package contains no OMORI game files and no decryption key.
