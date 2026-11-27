# macOS integration

`apple-macos-release` manages source verification, immutable plans, retained
signed packages and publication gates. A product adapter supplies the actual
macOS build, signing, notarization and distribution commands. The shared
semantic engine supplies version decisions; this independent Action supplies
the macOS release stages. See [release flow](release-flow.md) for composition
and [version policy](versioning.md) for channel/version rules.

## Workflow

This example admits a successful push run of `ci.yml` and uses separate jobs
for planning, macOS signing and publication. Dispatch it on the same tested
branch. Replace the SHA placeholder and implement the adapter below first.

```yaml
name: Release macOS
on:
  workflow_dispatch:
    inputs:
      ci-run-id:
        description: Successful official push CI run for this branch
        type: string
        required: true
permissions:
  contents: read
concurrency:
  group: macos-release
  cancel-in-progress: false
jobs:
  plan:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      actions: read
    outputs:
      release: ${{ steps.plan.outputs.release }}
      source-sha: ${{ steps.plan.outputs.source-sha }}
      branch: ${{ steps.plan.outputs.branch }}
    steps:
      - id: plan
        uses: popomore/github-actions/apple-macos-release@<full-commit-sha>
        with:
          phase: plan
          profile: preview-stable
          ci-workflow: ci.yml
          ci-run-id: ${{ inputs.ci-run-id }}
          settings: ${{ vars.MACOS_RELEASE_SETTINGS || '{}' }}
  build:
    needs: plan
    if: needs.plan.outputs.release == 'true'
    runs-on: macos-15
    environment: ${{ needs.plan.outputs.branch == 'main' && 'macos-preview' || 'macos-stable' }}
    permissions:
      contents: read
      actions: read
    steps:
      - uses: popomore/github-actions/apple-macos-release@<full-commit-sha>
        with:
          phase: build
          profile: preview-stable
          ci-run-id: ${{ inputs.ci-run-id }}
          source-sha: ${{ needs.plan.outputs.source-sha }}
          settings: ${{ vars.MACOS_RELEASE_SETTINGS || '{}' }}
          credentials: >-
            {"APPLE_CERTIFICATE": ${{ toJSON(secrets.APPLE_CERTIFICATE) }},
             "APPLE_CERTIFICATE_PASSWORD": ${{ toJSON(secrets.APPLE_CERTIFICATE_PASSWORD) }},
             "APPLE_SIGNING_IDENTITY": ${{ toJSON(secrets.APPLE_SIGNING_IDENTITY) }},
             "APPLE_API_PRIVATE_KEY": ${{ toJSON(secrets.APPLE_API_PRIVATE_KEY) }},
             "APPLE_API_KEY": ${{ toJSON(secrets.APPLE_API_KEY) }},
             "APPLE_API_ISSUER": ${{ toJSON(secrets.APPLE_API_ISSUER) }}}
  publish:
    needs: [plan, build]
    runs-on: ubuntu-latest
    permissions:
      contents: write
      actions: read
    steps:
      - uses: popomore/github-actions/apple-macos-release@<full-commit-sha>
        with:
          phase: publish
          profile: preview-stable
          ci-run-id: ${{ inputs.ci-run-id }}
          source-sha: ${{ needs.plan.outputs.source-sha }}
          settings: ${{ vars.MACOS_RELEASE_SETTINGS || '{}' }}
```

`MACOS_RELEASE_SETTINGS` is optional JSON containing only public product settings;
you can supply the same values inline instead. Map only the credential names
your adapter uses, including its updater signing key when required. Do not pass
`toJSON(secrets)`. A separate distribution repository may need its own scoped
publication credential in the publish phase. Branch-restricted signing
Environments belong to the product.

For products that run full app checks in the build adapter, `source-mode: push`
admits an official main push instead of a completed-CI dispatch. Keep that
choice explicit and run all required checks before producing signed artifacts.

## Inputs and outputs

The definitive schema is [`action.yml`](../apple-macos-release/action.yml).
All phases use the same immutable Action SHA and matching configuration.

| Inputs | Purpose |
| --- | --- |
| `phase` | `plan`, `build` or `publish`. |
| `profile` | `preview-only` (default), `preview-stable` or `maintenance`. |
| `source-mode`, `ci-workflow`, `ci-run-id` | Verified CI dispatch by default, or a declared checked-main-push entry. |
| `source-sha` | Original plan's exact source; required by build/publish. |
| `plan-artifact`, `signed-artifact` | Unique artifact names within the original run. |
| `artifact-directory` | Dedicated workspace-relative package directory, default `dist`. |
| `preview-signing` | `ad-hoc` (default) or `developer-id`. Stable is always Developer ID. |
| `credentials` | Explicit JSON credentials for the current build or publish adapter. |
| `settings` | Non-secret product settings JSON. |
| `token` | Workflow token for source/artifact access and publication; defaults to `github.token`. |
| `install-engine` | Install this repository's pinned semantic engine for a planner adapter; default false. |
| `registry-url` | Tool/dependency registry, default `https://registry.npmjs.org/`. |

The plan phase emits `release`, `tag`, `version`, `channel`, `source-sha` and
`branch`. Build and publish consume its saved plan rather than recomputing a
version. The product retains its original workflow identity and build counter.

## Product adapter

Commit `.github/actions/apple-macos-release/action.yml` with three inputs:
`phase` (required), `credentials` (default `{}`), and `settings` (default `{}`).
Its composite steps implement these hooks:

| Hook | Contract |
| --- | --- |
| `setup` | Install the product's release tooling with locked dependencies. No Apple signing credentials are passed. |
| `plan` | Write or recover `target/release-plan/plan.json`; do not create tags. |
| `env` | Read that plan and export product build variables through `GITHUB_ENV`. |
| `build` | Run product checks, package/sign/notarize, verify the final app and updater, and write the artifact receipt. Always clean temporary signing material. |
| `verify` | Validate the exact product asset set and updater metadata without changing signed bytes. Runs on recovered packages too. |
| `publish` | Create/verify the planned tag, stage and verify the versioned Release, then publish its channel. Keep retries idempotent. |

The common Action exports `SOURCE_SHA`, `RELEASE_BRANCH`, `CI_RUN_ID`,
`RELEASE_PLAN`, `RELEASE_ARTIFACTS` and `APPLE_RELEASE_TOOLS`. Settings reach every
hook; credentials reach only build/publish. The registry reaches setup/build.
The macOS entry declares `APPLE_STABLE_SIGNING=developer-id` and its selected
`APPLE_PREVIEW_SIGNING`; the shared script consumes those platform policies.

A releasing plan contains at least:

```json
{
  "schema": 1,
  "repository": "example/product",
  "branch": "main",
  "sourceSha": "<40-character-source-SHA>",
  "runId": "<release-workflow-run-ID>",
  "ciRunId": "<successful-CI-run-ID>",
  "release": true,
  "tag": "v1.2.3-preview.1",
  "version": "1.2.3-preview.1",
  "channel": "preview",
  "signingMode": "ad-hoc",
  "notes": "English release notes"
}
```

For the push entry, `ciRunId` is empty and the build hook runs the complete app
checks. A no-release plan still binds schema, source, branch and run identities,
with `release: false`. Products can add build numbers or a raw semantic unit
plan. Raw planner fields use `source_sha` and `prerelease`; adapt them to this
envelope explicitly. A declared timestamp compatibility projection uses channel
`timestamp` and retains the canonical semantic identity in the product's plan.

After signing, notarization and stapling, write
`<artifact-directory>/validated-artifacts.json`:

```json
{
  "schema": 1,
  "planSha256": "<SHA-256-of-original-plan-file-bytes>",
  "sourceSha": "<40-character-source-SHA>",
  "tag": "v1.2.3-preview.1",
  "signingMode": "ad-hoc",
  "files": {
    "Product.dmg": "<SHA-256-of-final-signed-DMG>",
    "appcast.xml": "<SHA-256-of-signed-update-feed>"
  }
}
```

The receipt names the complete file set. The common Action retains only those
regular files and the receipt, checks every digest, rejects symlinks, and
refuses a rebuild when the tag exists without the original retained packages.
Recover the original run and bytes after interruption; never move a tag or
replace a mismatched signed package. Missing/expired artifacts and ongoing
notarization need product recovery, not a second build of the same version.

Real certificate validity, notarization, installed-app updates and store
acceptance require their own evidence. This macOS contract does not implement
an iOS archive, provisioning or TestFlight upload pipeline.
