# Yokaiste's Sandbox Mod (YSM) for WARNO

[![Steam Workshop](https://img.shields.io/badge/Steam_Workshop-Stable-2563eb?style=for-the-badge)](https://steamcommunity.com/sharedfiles/filedetails/?id=3296415395)
[![Built With YMB](https://img.shields.io/badge/Built_With-YMB-f59e0b?style=for-the-badge)](https://github.com/Yokaiste/YMB)
[![Community](https://img.shields.io/badge/Discord-YSM_Community-5865F2?style=for-the-badge)](https://discord.gg/VwsfZhuWQq)
[![Toolkit](https://img.shields.io/badge/Deck_Editor_and_more-Yuri's_WARNO_Toolkit-15803d?style=for-the-badge)](https://github.com/dary1337/yuri-warno-toolkit)
[![License](https://img.shields.io/badge/License-See_LICENSE-1d4ed8?style=for-the-badge)](LICENSE)

> An advanced WARNO sandbox overhaul built with [YMB](https://github.com/Yokaiste/YMB).

## Learn More

For feature details, screenshots, updates, compatibility notes, and support:

- read the [Steam Workshop page](https://steamcommunity.com/sharedfiles/filedetails/?id=3296415395)
- join the [YSM Community](https://discord.gg/VwsfZhuWQq)
- use the [Yuri's WARNO Toolkit](https://github.com/dary1337/yuri-warno-toolkit) to edit your decks or install YSM

## Build With YMB

> [!IMPORTANT]
> YSM is built with **YMB**.
>
> Before building YSM, follow the YMB installation and setup instructions first:
> [YMB](https://github.com/Yokaiste/YMB)

> [!IMPORTANT]
> This repo uses **Git LFS** for large media assets.
>
> Install `git lfs`, then run `git lfs install` once on your machine before cloning, pulling, or pushing YSM changes.

## Prerequisites

- WARNO's current modding tools and a generated mod root with `GameData` and `CommonData`
- [Bun](https://bun.com/) 1.3.14 or newer
- a compatible current checkout of [YMB](https://github.com/Yokaiste/YMB)
- Git LFS with every tracked media object downloaded (`git lfs pull`)

Place this project in the exact case-sensitive `YMB/mods/YSM` path used by its script source references:

```text
<YourModRoot>/
  CommonData/
  GameData/
  YMB/
    mods/
      YSM/
```

Then run these commands from the `YMB` directory:

```bash
bun install
bun run ymb validate --mod ysm
bun run ymb build --mod ysm
bun run ymb sync --mod ysm --yes
```

`validate` runs the configured companion tests for the welcome screen and both deck generators. `build` writes a staged preview under `YMB/.ymb-build/output`; inspect that preview before `sync` changes the live mod files.

If you want to roll tracked files back later:

```bash
bun run ymb recover --mod ysm --yes
```

## Clean Rebuild and Troubleshooting

```bash
bun run ymb cleanup
bun run ymb validate --mod ysm --no-cache
bun run ymb build --mod ysm --no-cache
```

- If validation reports missing targets or anchors, update the WARNO mod with its native `UpdateMod` operation before retrying.
- If Git LFS assets are pointer text instead of real media, run `git lfs pull` and validate again.
- Do not delete `YMB/.ymb-state` while live files are synced; it contains the originals required by `recover`.
- Do not reset the tracked `generated-decks.*.store.json` files casually. Their GUID, localisation-token, and DeckSerializer ID registries preserve generated deck identity across builds. Version 2 stores also prevent layered core/horde serializer IDs from drifting between otherwise identical runs.
- Report reproducible issues in the [YSM Community](https://discord.gg/VwsfZhuWQq), including the WARNO version and the full YMB error.

## Project Structure

- `config/ymb.mod.yaml` — mod identity, shared variables, links, and generation policy
- `config/patch/features` — feature-scoped declarative patches and generation entry points
- `config/patch/shared` — reusable deck-generation parsers, analysis, and rendering built on YMB's script APIs
- `config/replace` — intentionally owned localisation and media files
- `publish` — Workshop copy and source artwork; not part of normal YMB materialization

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
