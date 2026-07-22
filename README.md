# Yokaiste's Sandbox Mod (YSM) for WARNO

[![Steam Workshop](https://img.shields.io/badge/Steam_Workshop-Stable-2563eb?style=for-the-badge)](https://steamcommunity.com/sharedfiles/filedetails/?id=3296415395)
[![Auto Deploy](https://img.shields.io/badge/Installation-Auto_Deploy-f59e0b?style=for-the-badge)](https://github.com/Yokaiste/YSM/releases/latest)
[![Community](https://img.shields.io/badge/Discord-YSM_Community-5865F2?style=for-the-badge)](https://discord.gg/VwsfZhuWQq)
[![Toolkit](https://img.shields.io/badge/Deck_Recovery_&_More-Yuri's_WARNO_Toolkit-15803d?style=for-the-badge)](https://github.com/dary1337/yuri-warno-toolkit)
[![License](https://img.shields.io/badge/License-See_LICENSE-1d4ed8?style=for-the-badge)](LICENSE)

> An advanced WARNO sandbox overhaul built with [YMB](https://github.com/Yokaiste/YMB).

## Learn More

For feature details, screenshots, updates, compatibility notes, and support:

- read the [Steam Workshop page](https://steamcommunity.com/sharedfiles/filedetails/?id=3296415395)
- join the [YSM Community](https://discord.gg/VwsfZhuWQq)
- use the [Yuri's WARNO Toolkit](https://github.com/dary1337/yuri-warno-toolkit) to recover your decks and more

## Automatic deployment

Requirements:

- a WARNO mod created with `CreateNewMod.bat`
- [Git for Windows](https://git-scm.com/download/win)
- [Git LFS](https://git-lfs.com/)

Install YSM:

1. In Steam, open **WARNO → Properties → Installed Files → Browse**.
2. Open `Mods` and run `CreateNewMod.bat YourModName`.
3. Download [Deploy-YSM.bat](https://github.com/Yokaiste/YSM/releases/latest) into the created mod folder, beside `CommonData` and `GameData`.
4. Double-click `Deploy-YSM.bat`.

The installer checks the folder and required tools, installs YMB and YSM, validates the configuration, and builds a preview. It does not change live WARNO files.

Apply it:

```bat
YMB\YMB.bat sync --mod ysm --yes
```

Restore the files saved before the sync:

```bat
YMB\YMB.bat recover --mod ysm --yes
```

Do not delete `YMB/.ymb-state` before recovery.

## Manual deployment

1. Create a WARNO mod as described above.
2. Download and extract the full [YMB release](https://github.com/Yokaiste/YMB/releases/latest) into the mod folder. The resulting `YMB` folder must be beside `CommonData` and `GameData`.
3. Open a terminal in the mod folder and run:

```bat
git lfs install
git clone https://github.com/Yokaiste/YSM.git YMB\mods\YSM
git -C YMB\mods\YSM lfs pull
YMB\YMB.bat validate --mod ysm
YMB\YMB.bat build --mod ysm
```

Review `YMB/.ymb-build/output`, then sync:

```bat
YMB\YMB.bat sync --mod ysm --yes
```

Recover later with:

```bat
YMB\YMB.bat recover --mod ysm --yes
```

## Updating

Run from the mod folder:

```bat
git -C YMB\mods\YSM pull --ff-only
git -C YMB\mods\YSM lfs pull
YMB\YMB.bat sync --mod ysm --yes
```

If the checkout contains local changes, commit or stash them before updating.

## License

YSM uses a custom non-commercial attribution + source-link license in [LICENSE](LICENSE).

In plain language:

- non-commercial use, modification, and sharing are allowed under the license terms
- redistribution must keep clear and reasonably visible attribution, a working source link, and the required notices
- exact attribution wording does not matter as long as the attribution is truthful and reasonably visible
- commercial use requires explicit prior written permission
- if you intentionally submit contributions, you confirm you have rights to do so and allow Yokaiste to use and relicense the accepted contribution as part of YSM
- the patent section gives a narrow patent permission for allowed licensed use, and removes that patent permission if someone makes a written patent infringement claim against YSM

See [NOTICE](NOTICE) and [LICENSE](LICENSE) for the full terms.
