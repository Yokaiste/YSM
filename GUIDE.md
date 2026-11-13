# Use and customize YSM

For the ready-made mod, [subscribe on Steam](https://steamcommunity.com/sharedfiles/filedetails/?id=3296415395) and activate YSM in WARNO's Mod Center. The steps below are for a local version with your own settings.

## Install a local copy

1. In Steam, open WARNO's installed files, then open its `Mods` folder. Open a terminal in `Mods` and run:

   ```powershell
   .\CreateNewMod.bat MySandbox
   ```

2. Download `Deploy-YSM.bat` from the [latest release](https://github.com/Yokaiste/YSM/releases/latest). Save it in `WARNO\Mods\MySandbox`, beside `GameData` and `CommonData`, then double-click it.
3. The installer downloads YMB and the YSM mod project. Choose **N** at the apply prompt if you want to adjust settings first. Choose **Y** to apply the defaults.
4. After applying, run `GenerateMod.bat` in `MySandbox`. This compiles the files for WARNO. Open the game and activate your local mod in the Mod Center.

You need Windows and an internet connection for the installer. It supplies YMB's runtime; you do not need Git or a separate Bun installation. WARNO's mod scripts also need Python; follow the setup in the game's `Mods/ReadMe.txt` if those scripts fail to start.

```text
WARNO/Mods/MySandbox/
  Deploy-YSM.bat
  GenerateMod.bat          compile for the game
  GameData/               files YMB applies
  CommonData/
  YMB/
    YMB.bat               open YMB here
    ymb.config.yaml       your local settings
    mods/YSM/             the editable mod project
```

## Change a setting

Open `YMB/ymb.config.yaml` in a text editor. Merge this example into the existing `mods` section; keep the file's other settings. YAML uses spaces for indentation, so leave the Tab key out of this one.

```yaml
mods:
  ysm:
    variables:
      planeCap: 60
      multipliers:
        health: 1.25
    patches:
      ysm.ui.ingame.dark-theme:
        enabled: false
```

This allows 60 aircraft slots, gives YSM's tunable units 25% more health, and disables the dark HUD. The health multiplier affects the YSM features that use it; it is not a global boost to every WARNO unit.

| Setting              | Default | Effect                                                         |
| -------------------- | ------- | -------------------------------------------------------------- |
| `planeCap`           | `297`   | Available aircraft slots and their interface                   |
| `deckSlotCount`      | `80`    | Cards per category in generated divisions and the deck creator |
| `multipliers.health` | `1.0`   | Health scale for YSM features that use it                      |
| `multipliers.cost`   | `1.0`   | Cost scale for YSM features that use it                        |

`1.0` keeps a multiplier's default, `0.5` halves it, and `1.25` adds 25%. Start with one small change so you can see its effect.

For feature settings, the patch ID is the `id` at the top of its `ymb.patch.yaml`. Put overrides under that ID in `mods.ysm.patches`. Disabling a prerequisite makes builds of its dependent features fail. Keep the prerequisite enabled or disable those features too. Open `YMB.bat` and run `explain --mod ysm` to inspect the selection.

## Build and play your changes

Double-click `YMB/YMB.bat`. In that window, run:

```text
build --mod ysm
```

YMB checks the project and writes a preview to `YMB/.ymb-build/output`. Read the changed files there. When they look right, run:

```text
sync --mod ysm --yes
```

Then run `GenerateMod.bat` in the WARNO mod folder and test in game. A successful YMB build produces game source files; WARNO still needs to compile them.

Use the same mod build on every player's computer for multiplayer.

## Update without losing your settings

Run the installer again to update its downloaded files. It preserves `YMB/ymb.config.yaml` and the `*.store.json` files that keep saved-deck identities stable. It replaces other downloaded configuration files. Keep edits to those files in your own development checkout before updating.

Keep `modTag`, the deck identity stores, and `YMB/.ymb-state`. Changing the identities can break saved decks; deleting the state removes YMB's recovery information.

After a WARNO update, follow the [YMB update workflow](https://github.com/Yokaiste/YMB/blob/master/docs/workflow.md) to refresh the game files and rebuild.

## Undo or get help

To restore the game files saved by YMB, open `YMB.bat` and run:

```text
recover --mod ysm --yes
```

Compile again with `GenerateMod.bat` to update the playable mod. Recovery leaves your editable YSM project in place.

Recovery restores whole tracked files. If YSM shares a file with another mod, restoring it can also remove that mod's changes. Rebuild and sync the combination you want afterwards.

If a build stops, read the named file and suggested fix. `doctor` checks folder setup; `explain --mod ysm` explains skipped patches. Bring questions, feedback, and bug reports to the [YSM Community](https://discord.gg/33Sqn6dTjf). For build problems, use its troubleshooting forum and include the command, error, YMB version, and whether you are combining mods.

For more settings and your own patches, continue with the [YMB docs](https://github.com/Yokaiste/YMB/blob/master/docs/README.md). Before sharing a modified build, read YSM's [LICENSE](LICENSE) and the terms of any other included mod.
