# Develop this repository

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

For a new product, platform Action or fork, see
[extension development](extending.md). For compatibility and release decisions,
see [version policy](versioning.md).
