#!/bin/bash

# Variables
REPO_URL="https://github.com/DrewJSquared/attitudecontrol2a"
ZIP_FILE="attitudecontrol2a.zip"
TMP_DIR="attitudecontrol2a_tmp"

# Download the GitHub repository as a zip file
curl -L -o $ZIP_FILE "$REPO_URL/archive/refs/heads/main.zip"

# Unzip the downloaded file
unzip $ZIP_FILE -d $TMP_DIR

# Move the contents to the attitudecontrol2a directory
# Assuming the unzipped folder is named attitudecontrol2a-main
UNZIPPED_DIR="$TMP_DIR/attitudecontrol2a-main"
TARGET_DIR="./"

# Create the target directory if it doesn't exist
mkdir -p $TARGET_DIR

# Use rsync to move the contents to the target directory
rsync -av --remove-source-files $UNZIPPED_DIR/ $TARGET_DIR/

# Clean up temporary files
rm -rf $ZIP_FILE $TMP_DIR

echo "Attitude update.sh script v071724 complete!"
