# YSM development

YSM's promise is a larger, customizable sandbox. Design features around the experience
they provide. This guide governs YSM as an independent product. YMB is its build
dependency; changes to YSM do not authorize changes to the builder or other mods.

- The repository README is a feature showcase, not a usage or configuration guide.
  YSM currently has no end-user documentation. Do not create it unless requested;
  keep development instructions here and implementation rationale beside its code.
- Author changes under `config/`. Use YMB's public `ymb/api` and declarative patches;
  never import builder internals or duplicate its NDF parser.
- Respect YMB's variable scope and merge contracts. Folders do not confer inheritance;
  objects merge and lists replace. Do not add a sibling-config loader.
- Zombies own zombie units, attacks, tuning, descriptions, and their validation.
  Sandbox features own their supply, nuclear, and cheat-unit rules. UI features own
  their presentation. A mod-level script must not become a catalogue of their exceptions.
- Deck generation owns roster construction and saved-deck serialization. Zombie Horde
  content is zombie policy even when the deck generator renders it. Keep composition
  explicit; preserve the existing batch's identity allocation when moving ownership.
- Put feature-only defaults in the relevant patch config. Keep root variables only
  for mod identity or a real agreement between features, such as deck capacity shared
  by generation and the deck UI. A derived expression is not another user choice.
- Keep designed balance at its use sites. Expose useful feature and category scales
  as multipliers defaulting to `1.0`; retain direct player choices such as match
  defaults, deck capacity and veterancy. Do not scale bottomless pools, unlimited
  counts or extreme cheat values. Preserve the disabled default of support customization.
- Generic division descriptions express identity, play style, and the differences a
  player needs to choose between division types. Do not enumerate
  units or append availability and slot details unless that surface needs them to
  support an actual player decision. Keep YSM's character and feature brands.
- A fixed GUID, serializer limit, token, or NDF field is an identity or format contract,
  not a tuning option. Preserve mod/patch ids, generated-block owners, GUIDs, serializer
  ids, and localisation tokens. Persistent deck stores are authored state.
- Keep generation helpers with the feature using them. A `shared` helper must serve
  independent features through explicit inputs; it must not discover them by prefixes.
- Keep authored translations in the feature's `localisation.csv`. The mod initializer
  seeds dictionaries and mod identity; selected features contribute their own text.
  Return generated text as build output. Only persistent identities need authored writes.
- Trace consumers before removing settings. Root overrides currently outrank patch
  defaults, and folders do not confer variable inheritance. Update affected callers
  and report supported-setting migrations in the change; do not silently ignore a choice.
- Test with invented inputs and observable behavior. General format validation belongs
  to YMB; feature-specific invariants and regression checks belong to the feature.
- Keep installer updates compatible with local `ymb.config.yaml` overrides and
  authored identity stores. Verify this product's deployment changes in its own checkout.

Edit authored source; preserve existing staged and unstaged work. Do not edit live
GameData/CommonData, reset identity stores, sync, recover, compile, publish, stage,
or commit unless the task authorizes that action. Leave legal files unchanged.

For README or agent-guide changes, run YMB's `fix:mods` and `lint:mods` tasks.
For scripts, also run `bun run check:mods`; for config or script changes, build the
affected selection with
`bun run ymb build --mod ysm`. Include WTO when changing their integration. Inspect
this repository's diff separately from any other product.
