#!/usr/bin/env bash

cd "$(dirname -- "$0")/../."
git config set --local include.path ../.gitconfig
