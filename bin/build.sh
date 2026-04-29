#!/bin/bash

cd "$(dirname -- "$0")/../."
pnpm run build

git add .
