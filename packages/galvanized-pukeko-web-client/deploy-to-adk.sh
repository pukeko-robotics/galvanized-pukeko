#!/bin/bash
set -e

# Vendor the built web client into the ADK package's resources.
#
# Run it as `pnpm run vendor:adk` from the repository root. Paths below are
# relative to this package directory, so a direct invocation must be made from
# here (`cd packages/galvanized-pukeko-web-client && ./deploy-to-adk.sh`).
#
# The destination is a checked-in build output that no build produces and no lint
# reads, so the last step records what it was built from;
# `scripts/check-vendored-bundle.mjs` runs in `pnpm test` and fails when the
# sources have moved past it. Commit the regenerated directory AND that manifest
# together — a commit carrying only one of them is exactly the drift the gate is
# there to catch.

# Build the web client
echo "Building web client..."
pnpm install
pnpm run build

# Define paths
SOURCE_DIR="dist/client"
DEST_DIR="../galvanized-pukeko-agent-adk/src/main/resources/browser"

# Create destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Clear destination directory
echo "Cleaning destination directory..."
rm -rf "$DEST_DIR"/*

# Copy files
echo "Copying files to $DEST_DIR..."
cp -r "$SOURCE_DIR"/* "$DEST_DIR"

# Record what this bundle was built from, so the staleness gate has something to
# compare against.
echo "Recording bundle provenance..."
node ../../scripts/check-vendored-bundle.mjs --write

echo "Deployment complete!"
