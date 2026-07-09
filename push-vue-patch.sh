#!/usr/bin/env bash
set -euo pipefail

# Bump the patch version of @galvanized-pukeko/vue-ui (no git tag from the bump
# itself; we tag explicitly below). Runs npm version inside the package dir via
# a pnpm filter so only that package's package.json changes.
pnpm --filter @galvanized-pukeko/vue-ui exec npm version patch --no-git-tag-version

VERSION=$(node -p "require('./packages/galvanized-pukeko-vue-ui/package.json').version")
git add packages/galvanized-pukeko-vue-ui/package.json
git commit -m "@galvanized-pukeko/vue-ui@$VERSION"
git tag -a "@galvanized-pukeko/vue-ui@$VERSION" -m "@galvanized-pukeko/vue-ui@$VERSION"
git push --follow-tags
