# Extend or build on this project

## Integrate another macOS product

Use `apple-macos-release` and implement the local adapter contract rather than
copying the orchestration. The adapter supplies `setup`, `plan`, `env`, `build`,
`verify` and `publish` hooks. Keep application identities, minimum OS/architecture,
signing credentials, updater formats, feeds and build-number allocation with the
product. The [adapter guide](apple-macos-release.md#product-adapter) describes
the exact data exchanged with the shared Action.

Retain the original plan and final signed bytes. An existing tag cannot be
rebuilt; an expired, ambiguous or mismatched artifact requires recovery. Product
publishers verify staged downloads before exposing a channel and refuse stale
updates to Latest. Real signing, installed-app upgrades and platform acceptance
remain separate validation from unit tests and green CI.

## Add a platform Action or another publisher

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

## Reuse the helpers or maintain a fork

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
