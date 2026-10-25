## Changes

@CHANGES@

## Requirements

- OMORI 1.0.8 from Steam, or an already-decrypted copy.
- An ARM64 device with SDL2, EGL and OpenGL ES 3.0, and glibc 2.28 or newer. PortMaster is recommended; the launcher starts without it but controls are limited.
- About 5.5 GB free on the SD card for the first launch.

## Install

1. Copy `OMORI (PMJS).sh` and the `omori-pmjs/` folder to the Ports locations for your firmware: on muOS the `.sh` goes in `/mnt/mmc/ROMS/Ports/` and the folder in `/mnt/mmc/ports/`; on ArkOS/dArkOS both go in `/roms/ports/`; on Knulli/Batocera both go in `/userdata/roms/ports/`. PortMaster's autoinstall places both correctly.
2. Copy your Steam OMORI install into `omori-pmjs/gamedata/`, so that `omori-pmjs/gamedata/www/index.html` exists.
3. Put the game's 32-character decryption key in `omori-pmjs/gamedata/omori-key.txt` (replace the template's whole contents), or copy Steam's `appcache/appinfo.vdf` into `gamedata/`.
4. Launch OMORI (PMJS) from the Ports menu.

The first launch converts the files and prepares a cache. It takes about 25 minutes and about 5.5 GB of free space. Later launches take about a minute to the title screen.

## Decryption key

The game files alone do not contain the key; Steam supplies it in its launch configuration. On Windows, the key is the `--` argument after `OMORI.exe` in `C:\Program Files (x86)\Steam\appcache\appinfo.vdf`: open it with a text or hex editor, search for `OMORI.exe`, and copy the 32 characters after `--`. Save them as `omori-pmjs/gamedata/omori-key.txt`.

Alternatively, copy `appinfo.vdf` itself into `gamedata/` and the converter reads it automatically. A launch script next to `OMORI.exe`, the `OMORI_KEY` environment variable, and `--key` also work. A copy of the game that is already decrypted needs no key.

## If it does not start

Read `omori-pmjs/log.txt`; `log.prev.txt` keeps the previous run. If neither exists, the launcher did not find the `omori-pmjs/` folder (keep the `.sh` and folder in the locations above, and extract the whole ZIP). The launcher then writes `OMORI-PMJS-launch.log` next to the `.sh`.

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

## Credits

OMORI is created and published by OMOCAT, LLC. This is an unofficial fan port, not affiliated with or endorsed by OMOCAT. You must own the game. PMJS is by bbbreaddd and is MIT licensed; its bundled third-party components and licenses are in the release ZIP.
