# Version policy

## Versions of this repository

Both Actions and the JavaScript helpers share one repository version,
`vX.Y.Z`. Consumers still pin immutable commit SHAs rather than moving aliases.
API-compatible additions use minor versions; fixes use patch versions; changing
an existing Action path, input/output contract or exported helper incompatibly
requires a breaking-change release. A new unreleased Action can be renamed
within its introducing PR.

The repository's own policy is
[`.release/units/github-actions.json`](../.release/units/github-actions.json).
`auto_on_main` is currently **false**: merging to main does not automatically
create a version tag. Use the **Release tags** workflow to inspect its default
dry-run, then explicitly dispatch with `dry-run: false` when releasing. This
workflow creates the annotated version tag; it does not publish an npm package
or automatically create a GitHub Release page. `package.json`'s `0.0.0` is
development metadata, not a version counter to bump by hand.

## Versions of products using the Actions

semantic-release 26.0.1 computes versions from reachable tags and Conventional
Commits. Include/ignore patterns select changes for each release unit:

| Commit | Default version effect |
| --- | --- |
| `feat` | Minor |
| `fix`, `perf` | Patch |
| `!` or a `BREAKING CHANGE` footer | Major |
| Other types, without a breaking change | No release on their own |

All relevant commits since the previous unit tag participate, including
accumulated changes. Source version files remain development metadata; packaging
injects the planned version into the build checkout. No version commit is pushed.

Stable versions are `X.Y.Z`; declared Preview channels use `X.Y.Z-preview.N`.
The generic tag Action respects `auto_on_main` on branch pushes and plans stable
versions on explicit dispatch. Maintenance ranges and release promotion belong
to the product's declared branch policy. Promote and backsync Apple release
branches with reviewed merge commits and CI on the resulting SHA.

A legacy updater may explicitly use `preview_tag_compatibility: "timestamp"`.
Its adapter projects the canonical Preview version into its existing timestamp
tag/asset format and retains `semantic_tag` and `semantic_version` in the
annotation. This preserves installed-client compatibility; it is not a second
version generator. Python/PEP 440 projection is likewise a publisher-adapter concern.

Choose one version/tag owner per unit: use `release` for tag-driven downstream
publication, or the macOS pipeline to tag only after verified signed packages
exist. Do not run both tag producers for the same unit.

See [release flow](release-flow.md) for how version planning and concrete
release Actions compose.
