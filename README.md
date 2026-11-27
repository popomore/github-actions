# GitHub Actions

Public release Actions for popomore projects.

## Actions

| Action | Use | Guide |
| --- | --- | --- |
| [`release`](release/action.yml) | Run the common semantic version/tag flow from scoped Conventional Commits. | [Version and tag a product](docs/release.md) |
| [`apple-macos-release`](apple-macos-release/action.yml) | Build, sign, verify and publish a macOS application through a product adapter. | [macOS integration](docs/apple-macos-release.md) |

Use the common semantic flow with independent Actions for concrete release
work. [Release flow](docs/release-flow.md) explains the composition and current
support. Each Action defines its own parameters.

## Quick start

Commit a [release unit](docs/release.md#use-the-action) and run a read-only plan:

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

Replace `<full-commit-sha>` with a reviewed full commit SHA. See the
[release guide](docs/release.md) to create tags and connect a separate publisher.
For macOS, use the [three-stage workflow](docs/apple-macos-release.md#workflow)
with the product's local adapter. The registry defaults to the GitHub-hosted
runner's official npm registry; `registry-url` optionally overrides it.

## Documentation

- [Release flow and supported releases](docs/release-flow.md)
- [Version policy](docs/versioning.md)
- [Develop this repository](docs/development.md)
- [Extend this project or maintain a fork](docs/extending.md)

[MIT license](LICENSE).
