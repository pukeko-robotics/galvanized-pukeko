# Release HOWTO

All commands run from the **repo root**.

Tags use the format `@galvanized-pukeko/vue-ui@<version>`.

## 1. Review changes

Review what changed since the last release:
```bash
git --no-pager diff @galvanized-pukeko/vue-ui@0.0.1..HEAD -- packages/galvanized-pukeko-vue-ui | gth review
```

To view diffs side by side:
```bash
git difftool @galvanized-pukeko/vue-ui@0.0.1 HEAD -- packages/galvanized-pukeko-vue-ui
```

## 2. Build

```bash
pnpm --filter @galvanized-pukeko/vue-ui run build
```

## 3. Version and tag

`npm version` requires a clean working tree. Commit any pending changes first:
```bash
git add -A && git commit -m "pre-release housekeeping"
```

Create and push the `patch` version:

```bash
sh push-vue-patch.sh
```

(creates patch, creates tag manually and pushes the tag)

**Why manual tagging?** `npm config set tag-version-prefix` does not work inside workspaces (`ENOWORKSPACES` in npm v11). Manual tagging avoids this and keeps full control.

## 4. Publish to npm

Ensure you're logged in (`npm login`), then publish:
```bash
npm publish --access public -w @galvanized-pukeko/vue-ui
```

`--access public` is required for scoped packages. Review the file list before confirming. The `files` field in package.json controls what gets included.

## 5. Create GitHub release

```bash
gh release create "@galvanized-pukeko/vue-ui@$VERSION" --notes-from-tag
```

Alternatives:
```bash
gh release create "@galvanized-pukeko/vue-ui@$VERSION" --notes-file path/to/notes.md
gh release create "@galvanized-pukeko/vue-ui@$VERSION" --notes "Release notes here"
```

Use `gh auth switch` if managing multiple GitHub accounts.

## Undoing mistakes

Delete an accidental tag:
```bash
git tag -d @galvanized-pukeko/vue-ui@0.0.2
git push --delete origin @galvanized-pukeko/vue-ui@0.0.2
```

Unpublish from npm (within 72 hours only):
```bash
npm unpublish @galvanized-pukeko/vue-ui@0.0.2
```
