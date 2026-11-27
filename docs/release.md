# Semantic version and tag Action

[`release`](../release/action.yml) exposes the common semantic version/tag flow.
It analyzes scoped commits and records versions and notes. Concrete builds and
artifact publication belong to independent release Actions selected by the
product workflow; see [release flow](release-flow.md).

## Use the Action

Pin the Action to a full commit SHA. Replace `<full-commit-sha>` in this example.

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

The unit's `type` describes its artifact; it does not select or execute a
publisher. For example, `type: image` does not build or push a container.

## Inputs and outputs

The definitive schema is [`action.yml`](../release/action.yml).

| Input | Purpose |
| --- | --- |
| `manifest` | One source-controlled release unit. Select this or `manifest-directory`. |
| `manifest-directory` | Directory of source-controlled release units with distinct prefixes. |
| `exclude-units` | JSON list of units handled by another explicitly gated flow; default `[]`. |
| `dry-run` | Plan without GitHub writes; default `true`. |
| `tag-token` | Dedicated App/PAT for tag creation and downstream tag-push workflows. |
| `receipt-file` | Optional path for the batch receipt. |
| `registry-url` | Tool/dependency registry; default `https://registry.npmjs.org/`. |

`status` is `disabled`, `unchanged`, `verified`, `created` or `exists`. `tag` and
`version` are populated when exactly one unit has a release; `tags` contains the
JSON list across units. `created`, `source-sha` and `receipt` report write status,
the exact source and the local batch receipt path. The receipt binds each unit's
plan to its source; it is not proof of artifact publication.

For a signed macOS application, use the [independent macOS Action](apple-macos-release.md)
and its planner adapter. The generic tag-producing Action must exclude that
unit so its tag is created only after the final signed packages are verified.

## Registry

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

## Version decisions

See [version policy](versioning.md) for commit types, preview and maintenance
channels, source version files and the repository's own release procedure.
