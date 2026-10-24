## Game Information
- **New Port for**: OMORI (PMJS)
- **URL**: https://store.steampowered.com/app/1150690/OMORI/

## Authorship & Testing

- [ ] I wrote and understand this script/patch myself, or clearly marked which parts came from an AI assistant and reviewed them
- [ ] I can explain every non-standard line in my launch script

The launch script and packaging were developed with Claude Code. Review every line before checking the boxes above.

## Submission Requirements

### CFW Tests
Ensure your game has been tested on all major CFWs:
- [ ] ArkOS
- [ ] AmberELEC
- [ ] ROCKNIX
- [ ] muOS
- [ ] Knulli
- [ ] Crossmix (Optional)
- [ ] Other (add here)

Only muOS 2502.0 on an RG40XX-H has been tested so far.

### Resolution Tests
Test all major resolutions:
- [ ] 480x320 (Optional)
- [ ] 640x480
- [ ] 720x720 (RGB30) (Optional)
- [ ] Higher resolutions (e.g., 1280x720)

Only 640x480 has been tested.

## File Structure
```
omori-pmjs/
  port.json
  README.md
  gameinfo.xml
  screenshot.png
  OMORI (PMJS).sh
  omori-pmjs/
    runtime/
    patches/
    perf/
    tools/
    licenses/
    gamedata/
    config.json
    VERSION
```

## Script Conventions

Non-standard lines and their reasons:

- `BINARY=node` and `pm_platform_helper "$RUNTIME/bin/node"`: PMJS is a Node runtime. The running process is Node, so the gptokeyb2 kill target and the platform helper use that real process name.
- `PMJS_EXIT_HOTKEY=none`: PortMaster's gptokeyb2 owns the quit hotkey.
- `export XDG_CACHE_HOME="$GAMEDIR/.cache"`: PMJS keeps its prepared bootstrap under the port folder.
- `export NODE_OPTIONS=--max-old-space-size=480`: 1 GB devices fail inside Node instead of a device-wide OOM.
- The first-launch conversion block: the Steam release stores its assets in an encrypted format, so the launcher converts the player's own files to a plain game tree before PMJS starts. The package contains no key; the converter finds the player's key in a launch script, appinfo.vdf, environment, key file, or `--key`.
- `patches/` and `perf/` are JavaScript modules loaded with `--patch`, not compiled binaries.

## Additional Resources
For an in-depth guide on creating a pull request, refer to: [PortMaster Game Packaging Guide](https://portmaster.games/packaging.html#creating-a-pull-request)
