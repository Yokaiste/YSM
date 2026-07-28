<div align="center">

# Yokaiste's Sandbox Mod

### An advanced sandbox overhaul for WARNO.

[![Steam Workshop](https://img.shields.io/badge/🎮_Play-Steam_Workshop-2563eb?style=for-the-badge)](https://steamcommunity.com/sharedfiles/filedetails/?id=3296415395)
[![Source](https://img.shields.io/badge/⬇_Source-Auto_Deploy-f59e0b?style=for-the-badge)](https://github.com/Yokaiste/YSM/releases/latest)
[![Discord](https://img.shields.io/badge/💬_Join-YSM_Community-5865F2?style=for-the-badge)](https://discord.gg/VwsfZhuWQq)
[![Toolkit](https://img.shields.io/badge/🧰_Deck_recovery_&_more-Yuri's_WARNO_Toolkit-15803d?style=for-the-badge)](https://github.com/dary1337/yuri-warno-toolkit)

**Built with [YMB](https://github.com/Yokaiste/YMB)** — so it survives WARNO updates instead of breaking on them.

</div>

---

## 🚀 Install in one double-click

> **You need:** Windows, [Git for Windows](https://git-scm.com/download/win), and WARNO.

1. In Steam: **WARNO → Properties → Installed Files → Browse**.
2. Open `Mods` and run `CreateNewMod.bat YourModName`.
3. Download **[Deploy-YSM.bat](https://github.com/Yokaiste/YSM/releases/latest)** into that new folder,
   next to `CommonData` and `GameData`.
4. **Double-click it.**

The installer fetches YMB, clones YSM, checks everything, and builds a preview.
**It never changes your game on its own** — it prints the command to do that when it finishes:

```bat
YMB\YMB.bat sync --mod ysm --yes
```

### Changed your mind?

```bat
YMB\YMB.bat recover --mod ysm --yes
```

Every original file goes back.

> ⚠️ **Keep `YMB/.ymb-state`.** That folder is what makes the undo possible.

---

## 📖 Learn more

|                                                                                            |                                     |
| ------------------------------------------------------------------------------------------ | ----------------------------------- |
| 🎮 **[Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3296415395)** | Features, screenshots, changelog    |
| 💬 **[YSM Community](https://discord.gg/VwsfZhuWQq)**                                      | Questions, bug reports, ideas       |
| 🧰 **[Yuri's WARNO Toolkit](https://github.com/dary1337/yuri-warno-toolkit)**              | Recover decks lost to a game update |

---

<details>
<summary><b>🔧 Manual install (without the installer)</b></summary>

<br>

Create a WARNO mod as above, then extract the full
[YMB release](https://github.com/Yokaiste/YMB/releases/latest) into it so that `YMB` sits
beside `CommonData` and `GameData`. From a terminal in the mod folder:

```bat
git clone https://github.com/Yokaiste/YSM.git YMB\mods\YSM
YMB\YMB.bat validate --mod ysm
YMB\YMB.bat build --mod ysm
```

Review `YMB\.ymb-build\output`, then install:

```bat
YMB\YMB.bat sync --mod ysm --yes
```

</details>

<details>
<summary><b>🔄 Updating</b></summary>

<br>

```bat
git -C YMB\mods\YSM pull --ff-only
YMB\YMB.bat sync --mod ysm --yes
```

If the checkout has local changes, commit or stash them first.

After a **WARNO update**, restore the originals before updating the game mod:

```bat
YMB\YMB.bat recover --mod ysm --yes
```

</details>

---

## License

Custom non-commercial attribution + source-link license — see [LICENSE](LICENSE) and
[NOTICE](NOTICE).

- ✅ Play it, edit it, share it for free
- ✅ Upload it to a workshop or a code host at no charge
- 📣 Credit Yokaiste, link the source, say what you changed, pass the same license on
- ❌ No selling, paywalls, or monetized redistribution without written permission

> This list is a summary. The [LICENSE](LICENSE) is what actually applies.

YSM contains no WARNO game data — it describes changes applied to your own copy of the
game, and those files stay subject to Eugen Systems' terms.
