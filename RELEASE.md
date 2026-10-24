# OMORI (PMJS) <version>

Unofficial OMORI port for ARM64 PortMaster handhelds, running on PMJS.

## Requirements

- OMORI 1.0.8 from Steam, or an already-decrypted copy.
- ARM64 device with PortMaster, SDL2, EGL, OpenGL ES 3.0, glibc 2.28 or newer.
- About 5.5 GB free on the SD card for the first launch.

## Install

1. Copy `OMORI (PMJS).sh` to `/mnt/mmc/ROMS/Ports/` on muOS, or the firmware's Ports folder.
2. Copy `omori-pmjs/` to the firmware's ports folder (`/mnt/mmc/ports/` on muOS).
3. Copy your Steam OMORI install into `omori-pmjs/gamedata/`, so that `omori-pmjs/gamedata/www/index.html` exists.
4. If the install has no launch script, copy Steam's `appcache/appinfo.vdf` into `gamedata/` too.
5. Launch OMORI (PMJS) from the Ports menu.

The first launch converts the files and prepares a cache. It takes about 25 minutes and about 5.5 GB of free space. Later launches take about a minute to the title screen.

## Decryption key

The package contains no key. The converter finds the player's own key in a launch script next to `OMORI.exe`, `gamedata/appinfo.vdf`, `OMORI_KEY`, `gamedata/omori-key.txt`, or `--key`. A decrypted copy needs no key.

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

## Verified

- Anbernic RG40XX-H, muOS 2502.0, 640x480, Mali-G31.
- Cold start with full preparation and warm start.
- Steam conversion with the player's own key: 5,093 files, 0 missing, 0 changed against the reference.

Other CFWs and resolutions have not been tested.

## Files

- `OMORI (PMJS).sh`
- `omori-pmjs/` with the runtime, launcher patches, converter, metadata, licenses and an empty `gamedata/`.

## SHA-256

See the attached `.sha256` file.

## Credits

OMORI by OMOCAT, LLC. PMJS by bbbreaddd. Unofficial fan port; you must own the game.
