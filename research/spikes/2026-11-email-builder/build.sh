#!/bin/bash
set -e
cd "$(dirname "$0")"
for n in grapes tpl; do
  ./node_modules/.bin/esbuild $n.js --bundle --minify --format=esm --splitting --outdir=dist/$n \
    --loader:.woff2=file --loader:.woff=file --loader:.ttf=file --loader:.svg=file \
    --define:process.env.NODE_ENV='"production"' --log-level=warning --metafile=dist/$n.meta.json
  printf '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="%s.css"><body style="margin:0"><div id="editor" style="height:100vh"></div><script type="module" src="%s.js"></script>' $n $n > dist/$n/index.html
done
for n in grapes tpl; do
  echo "== $n"
  ls -l dist/$n | awk '{print $5, $9}'
  raw=$(cat dist/$n/*.js dist/$n/*.css 2>/dev/null | wc -c)
  gz=0
  for f in dist/$n/*.js dist/$n/*.css; do s=$(gzip -9c "$f" | wc -c); gz=$((gz+s)); done
  echo "total js+css raw: $raw bytes; gzip -9 per file summed: $gz bytes"
done
