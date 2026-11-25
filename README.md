# Release Actions

Public semantic-release tooling for popomore applications. Consumers pin a full commit SHA. No private Meta checkout, registry credentials, signing identity, application assets or product source is required to use this repository.

## Version planning and tags

`semantic-release/action.yml` runs semantic-release 26.0.1 against full Git history. Each `.release/units/*.json` declares its branch, non-overlapping tag prefix, paths, ignored paths and existing automatic-release switch:

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

Writes require a dedicated `RELEASE_TAG_TOKEN` because the separate tag-push product workflow must run. The action never falls back to `GITHUB_TOKEN`. Caller workflows serialize all units that share pointers. Annotated tags persist the exact source SHA, manifest digest, channel, version and release notes; conflicts fail without moving tags. The product workflow validates this identity and builds/publishes the tested source through its existing adapter. Python previews project to `X.Y.Z.devN`; other artifacts retain SemVer.

Source version files remain development metadata. Product packaging injects the resolved release version only into the build checkout. Public APIs are `@popomore/release-actions/planner` and `@popomore/release-actions/apple`; install this repository by immutable Git/tarball SHA, using the consumer's committed lockfile. This repository does not publish an npm package.

## Apple applications

The Apple helpers are extracted from MusicX and Folio. `appleReleaseConfig` supplies the Conventional Commits analyzer and explicit stable/preview/maintenance routing. `semanticEnvironment` normalizes GitHub installation-token authentication. `verifyPlannedRelease` stops tagging if packaging changed the version or source. `verifyArtifactReceipt` binds an exact asset set, signing mode and SHA-256 digests to the retained plan. `recoverChannelNote` repairs only the original tag's missing channel note after confirming its source.

Products retain CI provenance dispatch, signing, packaging, notarization, Sparkle/Tauri signing, feed rules and platform-specific publication. Successful same-repository push CI must validate the exact branch tip before credential-bearing execution. PRs have no signing credentials. Stable direct distribution requires Developer ID Application, Hardened Runtime, notarization, stapling and an independently signed updater archive; missing credentials fail closed. App Store/TestFlight uses its separate distribution identity and entitlement/profile path.

Persist the plan before building and retain the signed bytes and their receipts. Retry the original run and those byte-identical artifacts after interruption. Never rebuild an already tagged version or overwrite conflicting assets. Publish fixed-version assets before channel pointers; previews and maintenance feeds cannot become the stable Latest. Stable promotion and backsync preserve tag ancestry through merge commits. Build numbers, workflow identity, installed-client compatibility and real-device checks remain product contracts.

## Development

Use Node from `.node-version` and pnpm from `package.json`. Run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm check`, and `pnpm test`. Tests use disposable Git repositories and fixture bytes; they do not sign, publish, deploy or install an application. CI covers Linux and macOS.

References: [MusicX](https://github.com/popomore/MusicX), [Folio](https://github.com/popomore/folio-reader), [semantic-release API](https://semantic-release.org/developer-guide/js-api/).
