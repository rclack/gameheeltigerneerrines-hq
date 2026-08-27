#!/bin/sh
set -eu

repository_root=$(git rev-parse --show-toplevel)
current_directory=$(pwd -P)

if [ "$current_directory" != "$repository_root" ]; then
  echo "Run this deployment guard from the repository root: $repository_root" >&2
  exit 1
fi

if [ ! -f "$repository_root/app/package.json" ]; then
  echo "Expected Next.js application at app/package.json." >&2
  exit 1
fi

if [ ! -f "$repository_root/.vercel/project.json" ]; then
  echo "Repository-root Vercel linkage is missing. Link the project from the repository root first." >&2
  exit 1
fi

if [ -e "$repository_root/app/.vercel" ]; then
  echo "Refusing deployment while nested app/.vercel linkage exists." >&2
  exit 1
fi

exec npx vercel deploy --prod --yes
