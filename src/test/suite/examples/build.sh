#!/usr/bin/env bash

location="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 || exit 1 ; pwd -P )"
cd "$location" || exit 1

for file in "$location"/*.wast
do
  if grep -q "error" <<< "$file"; then
    continue
  fi
  wat2wasm "$file" > /dev/null && echo ". compiled $(basename -- "$file")"
done

exit 0
