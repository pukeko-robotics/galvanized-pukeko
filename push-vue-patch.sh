pnpm version patch --no-git-tag-version -w @galvanized-pukeko/vue-ui
VERSION=$(node -p "require('./packages/galvanized-pukeko-vue-ui/package.json').version")
git add packages/galvanized-pukeko-vue-ui/package.json package-lock.json
git commit -m "@galvanized-pukeko/vue-ui@$VERSION"
git tag -a "@galvanized-pukeko/vue-ui@$VERSION" -m "@galvanized-pukeko/vue-ui@$VERSION"
git push --follow-tags
