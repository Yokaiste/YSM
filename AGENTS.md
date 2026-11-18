# YSM agent rules

YSM owns its gameplay policy; YMB supplies the builder and public SDK.
Read [GUIDE.md](GUIDE.md), the affected feature, and Git status when available.

## Scope and preservation

- Preserve existing work. Do not commit, post messages, or publish without a request.
- Change YMB only when the task includes a tool change; follow its source rules.
  Use the public SDK for mod work. Do not copy its parser or import builder internals.
- Follow [LICENSE](LICENSE), [NOTICE](NOTICE), and all included material's terms.
  A rights holder may authorize exceptions only for their own work. Preserve attribution.
- Edit authored inputs. Preserve ids, GUIDs, localisation keys, generated owners,
  and persistent identity stores. Do not treat those stores as caches.
- Live writes, recovery, compilation, publishing, and identity resets need authorization
  from the task. Use previews for ordinary checks; do not repeat an approval already given.
- For a suspected YMB defect, offer a report for the [community troubleshooting forum](https://discord.gg/33Sqn6dTjf)
  with version, command, expected/actual output, diagnostic, and minimal reproduction.

## Implementation: Ponytail

Trace callers, settings, tests, and output. Remove needless work; reuse the feature's
helper, YMB API, standard library, or installed dependency before adding code. Keep
policy with its owner. Share a mechanism only when independent callers need it.
Finish changed callers and examples together. Preserve validation, errors, stable
identities, and recovery. Avoid repeated full-file scans. Test nontrivial logic with
small invented inputs; do not snapshot prose or repeat production tuning values.
Comment hidden constraints only; use `shortcut: <limit>, <when to upgrade>` for a deliberate limit.

## Feature ownership

- Zombies own their units, attacks, settings, text, and checks. Sandbox features own supply, nuclear, and cheat content. UI features own presentation.
- Deck generation owns roster assembly and saved-deck encoding. Keep Zombie Horde policy with zombies even when deck generation renders it. Preserve batch identity allocation when moving code.
- Put feature defaults in its patch. Root variables hold identity or settings genuinely shared by independent features, such as deck capacity. Derived values are not extra user choices.
- Objects merge; lists replace. Directories do not create variable inheritance. Keep overrides working through YMB's existing config rules; do not add a sibling-config loader.
- Keep designed balance near its operations. Expose useful multipliers with default `1.0`, and retain direct choices such as veterancy or match defaults. Do not scale bottomless pools or deliberate cheat limits. Support customization stays disabled by default.
- Keep translations in each feature's `localisation.csv`. The initializer creates dictionaries and mod identity; selected features contribute text. Return generated text as output. Only persistent identities need authored writes.
- Keep division summaries about identity and play style. Preserve feature names including Zombie Horde and YSM x ANY MOD; avoid unit inventories unless the player needs them to choose.
- Installer updates warn and ask before full recovery and replacement of the entire YMB folder. Back up local settings, identities, and authored changes outside YMB first. A narrower sync does not remove another mod's work; recovery restores whole tracked files.

## Writing: Humanizer

Read affected text fully, cut filler and repeated claims, then check facts and examples.
Use plain verbs, sentence case, and no em or en dashes in prose. Keep commands, paths,
tokens, codes, product names, and measured claims exact. Keep instructions here concise
and neutral. User docs may use occasional humor; errors still need a cause and next action.
READMEs showcase the mod; guides teach tasks. Keep documentation media in docs/assets.
Use useful visuals and named navigation at both ends of guides. Showcase READMEs
have no previous/next tables; place links beside the relevant text.
Call editable inputs a mod project, output a preview, and the target a WARNO mod folder.
YMB sync applies files; WARNO's tools compile them.

## Checks and delivery

From a portable installation, run `YMB.exe build --mod ysm --json` in the containing
YMB folder. Add `--mod wto` when changing their integration. Use `--json` for other
inspection commands too; do not parse the human progress display.

From this mod project's root:

~~~powershell
cargo fmt --manifest-path config/generator/Cargo.toml --check
cargo clippy --manifest-path config/generator/Cargo.toml --all-targets --locked -- -D warnings
cargo test --manifest-path config/generator/Cargo.toml --locked
~~~

Run a selected builder preview when configuration or outputs change. Run a full --require-all build before packaging. A release includes one precompiled executable shared by feature registrations with root: mod. Sharing code must not change feature-owned paths or settings.

Preserve the persistent core and Horde stores independently, including inactive identities. Use transactional SDK writes. Validation, dry runs, and tests must not commit them. Generated-region ids survive relocation; their source label can identify the registered generator.
Keep those stores in config/.ymb/decks and use SDK persistent helpers. Generator
binaries and license records belong in config/.ymb/g. Mod session work belongs in
YMB/.ymb/mods/ysm. Keep dist beside ymb.mod.yaml, and ship only config plus explicit
release.include paths. Archive URLs are direct HTTPS downloads. Rust code uses src.

For deployment changes, verify archive contents, checksums, compiler-free use, full recovery before replacement, placement rejection, interrupted updates, sync, and cleanup in disposable fixtures. Build release artifacts locally; do not publish, retag, or upload them without the user's request.
Build includes validation. Inspect YSM's own diff, including identity stores, after a preview. Report the change, useful checks, anything unverified, and remaining risk. Do not add a second validation run without a reason.
