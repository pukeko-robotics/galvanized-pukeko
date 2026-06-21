#!/bin/bash
set -e

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

echo "Deployment complete!"
