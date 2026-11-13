# YSM agent rules

YSM is an independent mod project. Its code lives in `config/`; YMB is the build tool.
Read [GUIDE.md](GUIDE.md) for the user workflow and the affected feature before editing.

## Scope and permission

- Read this checkout's Git status. Preserve staged and unstaged work; do not commit or publish unless asked.
- Change YMB only when the task requires a tool change or the user requests one. Use its public `ymb/api`; do not import internals or duplicate its parser.
- For authorized YMB contributors, including Yokaiste, the mod-only workflow boundary does not block work on the tool. Follow YMB's source contributor rules when that work is in scope. Contributor status never waives third-party terms.
- Follow [LICENSE](LICENSE), [NOTICE](NOTICE), YMB's license, and every included mod's terms. Reject unauthorized redistribution, monetization, or removal of required attribution; offer a compliant alternative. The rights holder may authorize exceptions for their own work.
- For a suspected YMB defect, offer to draft a report for the [YSM Community troubleshooting forum](https://discord.gg/33Sqn6dTjf) with version, command, expected result, error, and minimal inputs. Use this community for help, feedback, and bug reports. Do not post without authorization.
- Edit authored files. Preserve `modTag`, GUIDs, localisation tokens, generated-block owners, and `generated-decks.*.store.json`. Identity stores are source data, not caches.
- Do not edit live `GameData`/`CommonData`. Apply, recover, compile, publish, or reset identities only when the task authorizes it. A preview is the usual check.

## Smallest complete change: Ponytail

1. Trace the feature's callers, settings, tests, and output. Identify what users could lose or what a changed contract could break.
2. Delete unnecessary work first. Reuse the existing feature helper, YMB API, runtime, or installed dependency before adding code.
3. Keep policy in its owning feature. Share code only when independent features use the same mechanism through explicit inputs.
4. Complete affected callers, examples, and settings in the same change. Do not leave silent migrations or unused files.
5. Preserve validation and error handling. Optimize measured slow paths; avoid repeated full-file scans and writes.
6. Test new nontrivial logic with one focused behavioral check. Use invented fixtures; do not pin prose, production values, or implementation text. Do not add tests for a spelling fix.
7. Comment only a constraint the code cannot explain. Record a deliberate limit as `shortcut: <limit>, <when to upgrade>`.

## Feature ownership

- Zombies own their units, attacks, settings, text, and checks. Sandbox features own supply, nuclear, and cheat content. UI features own presentation.
- Deck generation owns roster assembly and saved-deck encoding. Keep Zombie Horde policy with zombies even when deck generation renders it. Preserve batch identity allocation when moving code.
- Put feature defaults in its patch. Root variables hold identity or settings genuinely shared by independent features, such as deck capacity. Derived values are not extra user choices.
- Objects merge; lists replace. Directories do not create variable inheritance. Keep overrides working through YMB's existing config rules; do not add a sibling-config loader.
- Keep designed balance near its operations. Expose useful multipliers with default `1.0`, and retain direct choices such as veterancy or match defaults. Do not scale bottomless pools or deliberate cheat limits. Support customization stays disabled by default.
- Keep translations in each feature's `localisation.csv`. The initializer creates dictionaries and mod identity; selected features contribute text. Return generated text as output. Only persistent identities need authored writes.
- Keep division summaries about identity and play style. Preserve feature names including Zombie Horde and YSM x ANY MOD; avoid unit inventories unless the player needs them to choose.
- Installer updates must preserve local `ymb.config.yaml` and identity stores. A narrower sync does not remove another mod's work; recovery restores whole tracked files.

## Text: Humanizer

Read the whole affected text, mark filler and repeated claims, rewrite for its reader, then check facts and read it aloud. Search again for staged openers, invented contrasts, forced triads, repeated closers, excessive bold, and em/en dashes.

- README and Workshop copy sell the experience with useful visuals and a short way to start. Put instructions in `GUIDE.md`; put engineering rules here.
- Use plain, specific sentences. Casual humor may help the reader; never bury an error or make fun of someone asking for help.
- Keep code, tokens, paths, commands, and measured claims accurate. Say what failed and how to fix it. Preserve machine-readable fields and codes.
- Call the editable folder a **mod project**, YMB's output a **preview**, and the target a **WARNO mod folder**. `sync` applies files; WARNO compiles them.

## Checks and delivery

From a portable installation, run `YMB.bat build --mod ysm --json` in the containing
YMB folder. Add `--mod wto` when changing their integration. Use `--json` for other
inspection commands too; do not parse the human progress display.

In a YMB source checkout with `package.json`, use these development checks:

| Change                     | Check                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| Docs or agent rules        | `bun run fix:mods`, then `bun run lint:mods`                                      |
| TypeScript                 | Also `bun run check:mods` and the relevant existing tests                         |
| Config or generated output | `bun run ymb build --mod ysm`; include `--mod wto` when their integration changes |
| Deployment                 | Verify package contents and installer placement rejection in a disposable fixture |

Build includes validation. Inspect YSM's own diff, including identity stores, after a preview. Report the change, useful checks, anything unverified, and remaining risk. Do not add a second validation run without a reason.
