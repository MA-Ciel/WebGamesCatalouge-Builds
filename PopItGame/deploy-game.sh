#!/usr/bin/env bash
# ==============================================================================
# CIEL WebGames - Automated Game Deployment Helper Script
# ==============================================================================
# Usage:
#   ./deploy-game.sh [BranchName]
# Example:
#   ./deploy-game.sh PopItGame
# ==============================================================================

set -e

# Color helpers
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}   CIEL WebGames - New Game Deployment Tool         ${NC}"
echo -e "${BLUE}====================================================${NC}"

# 1. Determine Branch
TARGET_BRANCH="$1"
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ -z "$TARGET_BRANCH" ]; then
    if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "gh-pages" ]; then
        echo -e "${YELLOW}You are currently on branch '${CURRENT_BRANCH}'.${NC}"
        read -p "Enter new game branch name (e.g., PopItGame): " TARGET_BRANCH
    else
        TARGET_BRANCH="$CURRENT_BRANCH"
    fi
fi

if [ -z "$TARGET_BRANCH" ]; then
    echo -e "${RED}Error: Branch name cannot be empty.${NC}"
    exit 1
fi

echo -e "\n${GREEN}[Step 1/4] Checking Branch: ${TARGET_BRANCH}${NC}"
if [ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]; then
    # Check if branch exists
    if git show-ref --verify --quiet "refs/heads/$TARGET_BRANCH"; then
        echo "Switching to existing branch $TARGET_BRANCH..."
        git checkout "$TARGET_BRANCH"
    else
        echo "Creating new branch $TARGET_BRANCH from main..."
        git checkout -b "$TARGET_BRANCH" main
    fi
fi

# 2. Verify Build Files
echo -e "\n${GREEN}[Step 2/4] Verifying Unity WebGL Build Files...${NC}"
if [ ! -d "Build" ]; then
    echo -e "${RED}Error: 'Build/' folder not found!${NC}"
    echo "Please export your Unity WebGL build into this repository root first."
    exit 1
fi

if [ ! -f "index.html" ]; then
    echo -e "${RED}Error: 'index.html' not found!${NC}"
    exit 1
fi

BUILD_FILES_COUNT=$(ls -1 Build | wc -l | tr -d ' ')
echo -e "Found ${BUILD_FILES_COUNT} files in Build/ directory."

# Check for files larger than 100MB (GitHub limit)
OVERSIZED=$(find Build -type f -size +95M 2>/dev/null || true)
if [ -n "$OVERSIZED" ]; then
    echo -e "${RED}WARNING: File(s) larger than 95MB detected:${NC}"
    echo "$OVERSIZED"
    echo -e "${YELLOW}GitHub does not allow pushing files >100MB without Git LFS.${NC}"
    echo "Ensure Unity WebGL Compression is set to 'Brotli' or 'Gzip' in Player Settings."
fi

# 3. Commit and Push Game Branch
echo -e "\n${GREEN}[Step 3/4] Staging and Committing Game Build...${NC}"
git add -f Build/
git add index.html TemplateData/ StreamingAssets/ game-config.json assets/ games.json portal.js portal.css .gitignore .github/ 2>/dev/null || true
git add -A

if git diff --staged --quiet; then
    echo -e "${YELLOW}No new changes to commit on ${TARGET_BRANCH}.${NC}"
else
    git commit -m "Deploy ${TARGET_BRANCH} WebGL Build"
fi

echo -e "\n${YELLOW}Pushing to GitHub (origin ${TARGET_BRANCH})...${NC}"
git push -u origin "$TARGET_BRANCH"

GAME_URL="https://ma-ciel.github.io/WebGamesCatalouge-Builds/${TARGET_BRANCH}/"

# 4. Instructions for Catalog
echo -e "\n${GREEN}[Step 4/4] Game Branch Deployed Successfully! 🎉${NC}"
echo -e "${BLUE}====================================================${NC}"
echo -e "Direct Game URL: ${GREEN}${GAME_URL}${NC}"
echo -e "(GitHub Actions will finish deploying in ~1-2 minutes)"
echo -e "${BLUE}====================================================${NC}"

echo -e "\n${YELLOW}To make this game visible on the Main Portal:${NC}"
echo "1. Ensure '${TARGET_BRANCH}' is registered in 'games.json' with:"
echo "   - id: '${TARGET_BRANCH,,}'"
echo "   - branch: '${TARGET_BRANCH}'"
echo "   - path: './${TARGET_BRANCH}/'"
echo "   - thumbnail: './assets/${TARGET_BRANCH,,}.jpg'"
echo "2. Commit and push 'games.json' and 'assets/' to the 'main' branch."
echo ""
