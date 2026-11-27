# Release flow and independent release Actions

semantic-release supplies the common flow for analyzing commits, deciding
whether a release is needed, computing its version and generating notes. A
product workflow composes that flow with a concrete release Action. The
concrete Action owns the artifact's build, validation and publication rules.

| Layer | Responsibility | Current entry point |
| --- | --- | --- |
| Semantic flow | Scoped commits, versions, notes and a source-bound plan. | Shared planner; `release` exposes version/tag automation. |
| Concrete release | Package, sign, verify and publish one kind of product. | `apple-macos-release` for macOS; other publishers are external. |
| Product integration | Application identities, build commands, credentials, feeds and build numbers. | The product's workflow and local adapter. |

A release Action keeps its own parameters. Shared scripts can be reused across
Actions without making the semantic flow depend on macOS, npm, PyPI, containers
or a particular deployment target. A unit's `type` is descriptive metadata, not
a switch that dispatches a publisher inside the semantic Action.

## Compose the flow

1. Validate the source and the product's admitted branch/CI.
2. Analyze that source's scoped commits and save one version plan.
3. Pass the planned identity into the concrete build and publication stages.
4. Verify the final artifacts and publish through the concrete Action's rules.

The GitHub workflow selects concrete Actions through explicit `uses` steps.
This repository does not provide a dispatcher that discovers an Action from a
unit type, and a dry-run does not publish a product.

There are two existing integration forms:

- **Tag-driven products:** `release` plans and creates the annotated tag. The
  product's separate release Action or tag workflow builds and publishes the
  package, image or service from that exact source.
- **Signed macOS products:** the independent `apple-macos-release` Action has
  `plan`, `build` and `publish` stages. Its product planner calls the common
  semantic engine without tagging, saves the platform plan, and the publisher
  creates/verifies the tag after the signed packages have been verified.

Both forms share the version policy. Choose one tag owner per unit. Exclude a
macOS unit from the generic tag producer; building twice or letting both create
its tag would break the source/artifact contract. macOS signing, notarization,
updater keys and distribution rules remain in the concrete Action and adapter.

A future `apple-ios-release`, npm publisher or image publisher needs its own
Action interface. It can reuse the same planner and source/receipt helpers;
adding it does not require platform inputs in the common semantic flow.

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

## Guides

- [Semantic version/tag Action](release.md)
- [macOS release Action and adapter](apple-macos-release.md)
- [Version policy](versioning.md)
- [Extension development](extending.md)
