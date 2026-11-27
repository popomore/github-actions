# GitHub Actions

Public release Actions and reusable JavaScript helpers for popomore projects.
Applications keep their source, build commands and signing credentials in their
own repositories. This project has no dependency on private Meta tooling.

## Actions

| Action | Responsibility | Product-specific work |
| --- | --- | --- |
| [`release`](release/action.yml) | Scope Conventional Commits to release units, plan versions and create source-bound annotated tags. | Build and publish the package, image or service after its tag is created. |
| [`apple-macos-release`](apple-macos-release/action.yml) | Run `plan`, `build` and `publish` phases with source validation, retained signed artifacts and receipt checks. | Provide a local macOS adapter for packaging, signing, notarization and distribution. |

Each Action owns its parameters in its own `action.yml`. Shared behavior lives
in `release/src/`; platform rules stay in the platform Action. A future iOS
Action can reuse the scripts while defining its own signing and distribution
parameters. There is no iOS Action today.

## Supported releases

| Release or artifact | Current support |
| --- | --- |
| Stable and Preview semantic tags | `release`; independent prefixes and paths for each unit. |
| macOS downloads on GitHub Releases | `apple-macos-release` with a product publisher adapter. |
| Signed Sparkle or Tauri updates | Product adapters in the macOS pipeline. The app retains its update key and feed rules. |
| Maintenance releases | macOS `maintenance` profile; product publishers keep maintenance feeds separate. |
| macOS TestFlight | A separate product job with App Store identities and provisioning; no built-in upload in this Action. |
| npm, PyPI, container images, Workers or K3s | Version/tag planning is available; their publisher/deployer is outside this repository. |
| iOS, iPadOS or watchOS | Not implemented. Their archive/export, signing, provisioning and platform upload need a separate Action. |

The tag Action does not publish artifacts. The macOS Action calls product
adapters; it does not replace their build, signing or updater implementation.

## Use the Actions

Pin every remote Action and helper dependency to a full commit SHA. Examples
use `<full-commit-sha>` as a placeholder; replace it with a reviewed commit.

### Version and tag a product

Commit a release unit such as `.release/units/app.json`:

```json
{
  "schema": 1,
  "unit": "app",
  "type": "assets",
  "versioning": "semantic-release",
  "branch": "main",
  "tag_prefix": "app-v",
  "auto_on_main": true,
  "prerelease": "preview",
  "paths": ["app/**"],
  "ignore": ["**/*.md"]
}
```

Run a read-only plan against full history:

```yaml
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
    with:
      fetch-depth: 0
      persist-credentials: false
  - uses: popomore/github-actions/release@<full-commit-sha>
    with:
      manifest: .release/units/app.json
      dry-run: 'true'
```

Select `manifest-directory` instead of `manifest` to process multiple units.
Prefixes must not overlap. `exclude-units` selects units owned by another
pipeline. The Action defaults to dry-run and emits `status`, `tag`, `tags`,
`version`, `created`, `source-sha` and the batch `receipt` path.

To create tags, set `dry-run: 'false'` in an approved branch workflow and supply
`tag-token: ${{ secrets.RELEASE_TAG_TOKEN }}`. The dedicated App/PAT lets the
resulting tag push start the product's downstream workflow. There is no implicit
`GITHUB_TOKEN` fallback. Serialize workflows that share tags or channel pointers.

### Publish a macOS application

Use the same pinned `apple-macos-release` Action with `phase: plan`,
`phase: build` and `phase: publish`. A project provides
`.github/actions/apple-macos-release/action.yml` for its product hooks.
[macOS integration and adapter contract](docs/apple-macos-release.md) includes a
complete workflow, required plan/receipt fields and signing boundaries.

| Profile | Branches | Publication policy |
| --- | --- | --- |
| `preview-only` | `main` | Previews only; stable plans are rejected. |
| `preview-stable` | `main`, `release` | Preview on main; stable on release. |
| `maintenance` | Above plus `N.x` / `N.N.x` | Also allows stable maintenance releases with a separate product feed. |

Stable macOS artifacts require `developer-id` receipts. Preview signing is
explicitly `ad-hoc` or `developer-id`; missing Developer ID credentials do not
fall back to ad-hoc. Actual certificate, codesign, notarization and updater
checks belong to the adapter. TestFlight stays a separate job.

### Configure the registry when needed

Both Actions expose `registry-url`, defaulting to
`https://registry.npmjs.org/`, matching GitHub-hosted runners. Omit it when using
that default. A self-hosted runner can explicitly override it:

```yaml
with:
  registry-url: https://registry.example.com/
```

The selected registry applies to pnpm bootstrap and release-engine installation,
and to macOS adapter setup/build dependencies. It does not change the runner's
registry configuration.

## Version policy

### Versions of this repository

Both Actions and the JavaScript helpers share one repository version,
`vX.Y.Z`. Consumers still pin immutable commit SHAs rather than moving aliases.
API-compatible additions use minor versions; fixes use patch versions; changing
an existing Action path, input/output contract or exported helper incompatibly
requires a breaking-change release. A new unreleased Action can be renamed
within its introducing PR.

The repository's own policy is
[`.release/units/github-actions.json`](.release/units/github-actions.json).
`auto_on_main` is currently **false**: merging to main does not automatically
create a version tag. Use the **Release tags** workflow to inspect its default
dry-run, then explicitly dispatch with `dry-run: false` when releasing. This
workflow creates the annotated version tag; it does not publish an npm package
or automatically create a GitHub Release page. `package.json`'s `0.0.0` is
development metadata, not a version counter to bump by hand.

### Versions of products using the Actions

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

## Develop this repository

Use Node **26.13.0** from `.node-version` and pnpm **10.34.9** from
`package.json`:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
```

The layout separates entry points from implementation:

```text
release/action.yml                  # Version/tag Action and its parameters
apple-macos-release/action.yml      # macOS Action and its parameters/policy
release/src/planner.mjs             # Scoped semantic-release planning
release/src/tags.mjs                # Annotated tags and legacy projection
release/src/apple.mjs               # Shared configuration, receipts and recovery
release/src/apple-pipeline.mjs      # Shared source/artifact/phase helpers and CLI
release/tests/                     # Regression tests with Git and byte fixtures
```

Develop common behavior in the scripts and keep an Action's parameter schema
and platform policy in its own entry point. Change exported APIs deliberately
and keep callers and full-SHA references aligned. Submit focused Conventional
Commit PRs. CI runs on Linux and macOS, including a credential-free dry-run of
the tag Action. Tests use disposable Git repositories, fixture APIs and bytes;
they do not sign or install a product, publish a release or deploy a service.

## Extend or build on this project

### Integrate another macOS product

Use `apple-macos-release` and implement the local adapter contract rather than
copying the orchestration. The adapter supplies `setup`, `plan`, `env`, `build`,
`verify` and `publish` hooks. Keep application identities, minimum OS/architecture,
signing credentials, updater formats, feeds and build-number allocation with the
product. The [adapter guide](docs/apple-macos-release.md#product-adapter) describes
the exact data exchanged with the shared Action.

Retain the original plan and final signed bytes. An existing tag cannot be
rebuilt; an expired, ambiguous or mismatched artifact requires recovery. Product
publishers verify staged downloads before exposing a channel and refuse stale
updates to Latest. Real signing, installed-app upgrades and platform acceptance
remain separate validation from unit tests and green CI.

### Add a platform Action or another publisher

Add a separately named entry point with its own parameters, such as a future
`apple-ios-release/action.yml`; do not add iOS distribution flags to the macOS
Action. Reuse source verification, scoped version planning, receipt validation
and artifact lookup from the shared scripts. Platform signing policy is explicit
in the Action; the macOS entry point declares Developer ID for stable artifacts.
A new platform still needs its own signing/provisioning and publication checks.

For npm, Python, container or service releases, the existing `release` Action can
own version/tag planning while your publisher validates the tagged source and
publishes its own artifact. Keep version conversion, registry upload, image
identity and deployment acceptance in that publisher. These are extension points,
not additional built-in publishers.

### Reuse the helpers or maintain a fork

Install the repository from an immutable Git/tarball SHA using your committed
lockfile. There is no published npm package. The public module exports are:

| Module | Reusable behavior |
| --- | --- |
| `@popomore/github-actions/release/planner` | `planUnit`, unit validation and scoped commits. |
| `@popomore/github-actions/release/tags` | Source-bound tag creation, branch-tip checks and timestamp projection. |
| `@popomore/github-actions/release/apple` | Branch configuration, token normalization, receipt checks and channel-note recovery. |
| `@popomore/github-actions/release/apple-pipeline` | CI/main-push validation, plan checks, original-artifact selection and package verification. |

For example, a custom adapter can plan a unit without creating a tag:

```js
import { planUnit } from '@popomore/github-actions/release/planner';

const plan = await planUnit({
  manifestPath: '.release/units/app.json',
  repository: 'example/product',
  preview: true,
});
```

Keep the manifest committed and full Git history available. The planner's raw
`source_sha` / `prerelease` fields differ from the macOS adapter envelope's
`sourceSha` / `preview`; map them explicitly when building an adapter. A fork
must update its owner/path/SHA references and metadata, retain the MIT license,
and cover source, channel, signing-policy and byte-conflict behavior before use.

## License

[MIT](LICENSE).
