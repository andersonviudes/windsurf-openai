#!/usr/bin/env node
// Published CLI launcher. The real CLI is the built bundle at dist/app/cli.js
// (produced by scripts/build-js.mjs at publish time). This thin shim only exists
// so the package has a bin/ dir; importing the bundle runs its dispatch().
import '../dist/app/cli.js';
