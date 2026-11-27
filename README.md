# GitHub Actions

Shared GitHub Actions for popomore projects. This version adds the `release/` action and shared release helpers. Consumers pin a full commit SHA. No private Meta checkout, registry credentials, signing identity, application assets or product source is required to use this repository.

## Release: version planning and tags

`popomore/github-actions/release@<full commit SHA>` runs semantic-release 26.0.1 against full Git history. Each `.release/units/*.json` declares its branch, non-overlapping tag prefix, paths, ignored paths and existing automatic-release switch:

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

`feat` selects minor, `fix` and `perf` select patch, and breaking headers/footers select major. Documentation and other non-releasing commits do not create tags. Scoping applies to every commit since the last unit tag, including accumulated changes. No version commit is pushed.

The action defaults to `dry-run: 'true'`. Planning uses a disposable local mirror with no GitHub credentials and leaves the consumer checkout unchanged. It requires full Git history (`fetch-depth: 0`). Branch pushes respect `auto_on_main`; enabled units declaring `prerelease: "preview"` produce `app-vX.Y.Z-preview.N`. An explicitly dispatched tag workflow plans a stable `app-vX.Y.Z`. Existing disabled channels remain disabled on push.

Writes require a dedicated `RELEASE_TAG_TOKEN` because the separate tag-push product workflow must run. The action never falls back to `GITHUB_TOKEN`. Caller workflows serialize all units that share pointers. Annotated tags persist the exact source SHA, manifest digest, channel, version and release notes; conflicts fail without moving tags. Retries at the same source recover the stored stable or preview plan, validate the existing remote tag, and emit its original tag/version without creating another tag. The product workflow validates this identity and builds/publishes the tested source through its existing adapter. Python previews project to `X.Y.Z.devN`; other artifacts retain SemVer.

An existing Apple updater may explicitly declare `preview_tag_compatibility: "timestamp"`. Its adapter uses `previewCompatibilityPlan` to project the semantic version into the already-supported timestamp tag/asset format. The annotated tag retains `semantic_tag` and `semantic_version`; subsequent planning reconstructs these references only in its disposable mirror. The installed-client discovery URL stays compatible, and semantic-release still owns the version sequence. This exception never changes stable tags or other products.

Source version files remain development metadata. Product packaging injects the resolved release version only into the build checkout. Public APIs are `@popomore/github-actions/release/planner`, `@popomore/github-actions/release/tags` and `@popomore/github-actions/release/apple`; install this repository by immutable Git/tarball SHA, using the consumer's committed lockfile. This repository does not publish an npm package.

## Apple applications

The Apple helpers are extracted from MusicX and Folio. `appleReleaseConfig` supplies the Conventional Commits analyzer and explicit stable/preview/maintenance routing. `semanticEnvironment` normalizes GitHub installation-token authentication. `verifyPlannedRelease` stops tagging if packaging changed the version or source. `verifyArtifactReceipt` binds an exact asset set, signing mode and SHA-256 digests to the retained plan. `recoverChannelNote` repairs only the original tag's missing channel note after confirming its source.

`apple-release` is the common composite pipeline used by MusicX, Folio and Mokisu.
Call the same pinned Action with `phase: plan`, `phase: build` and `phase: publish`
in jobs with the appropriate runner, Environment and permissions. Only the last
phase can call a product's tag/publication hook. Products keep a small local
`.github/actions/apple-release` adapter for packaging, signing, notarization,
Sparkle/Tauri formats and store-specific operations.

The common Action verifies official successful push CI at the selected tip,
checks out exactly that source, retains the original plan, restores the original
signed packages, rejects rebuilding an existing tag, and verifies the complete
file set, signing policy, plan digest and package digests before publication.
An explicitly declared `source-mode: push` supports products that run all app
checks in the build adapter. PR code never enters a signing job.

Profiles are `preview-only` (main), `preview-stable` (main/release) and
`maintenance` (also N.x/N.N.x). Stable always requires Developer ID receipts.
Preview signing is explicit, allowing the existing Developer ID or ad-hoc
product policy; there is no automatic downgrade. `credentials` contains only
explicitly mapped build or publication secrets and reaches only the relevant
adapter phase. Never pass all repository secrets with `toJSON(secrets)`.

The adapter phases are `setup`, `plan`, `env`, `build`, `verify`, `publish`.
Planning writes `target/release-plan/plan.json` with schema, sourceSha, branch,
runId, ciRunId, release, tag, version, channel and notes. The build adapter records
`validated-artifacts.json` with schema 1, planSha256, sourceSha, tag, signingMode
and a filename-to-SHA256 files map. Only those regular files and the receipt are
uploaded. Adapter commands fail closed on missing credentials or validation.
App Store/TestFlight remains a separate product job using its own identities,
entitlements, provisioning profile and the original workflow build counter.

Persist the plan before building and retain the signed bytes and their receipts. Retry the original run and those byte-identical artifacts after interruption. Never rebuild an already tagged version or overwrite conflicting assets. Publish fixed-version assets before channel pointers; previews and maintenance feeds cannot become the stable Latest. Stable promotion and backsync preserve tag ancestry through merge commits. Build numbers, workflow identity, installed-client compatibility and real-device checks remain product contracts.

## Development

Public tool bootstrap and release-engine dependencies always use
`https://registry.npmjs.org/` inside the shared Actions. Consumers do not configure
a registry for these steps, and the runner's registry configuration is unchanged.

Use Node from `.node-version` and pnpm from `package.json`. Run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm check`, and `pnpm test`. Tests use disposable Git repositories and fixture bytes; they do not sign, publish, deploy or install an application. CI covers Linux and macOS.

References: [MusicX](https://github.com/popomore/MusicX), [Folio](https://github.com/popomore/folio-reader), [semantic-release API](https://semantic-release.org/developer-guide/js-api/).
