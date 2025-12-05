#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const propPath = process.argv[2];
const cfgPath = process.env.BRIDGE_CONFIG_PATH || path.join(process.cwd(), 'config', 'bridge.config.json');

let config;
try {
  const raw = fs.readFileSync(cfgPath, 'utf8');
  config = raw.trim() ? JSON.parse(raw) : undefined;
} catch (error) {
  config = undefined;
}

if (!propPath || !config) {
  process.exit(0);
}

const value = propPath.split('.').reduce((acc, key) => acc?.[key], config);
if (value === undefined || value === null) {
  process.exit(0);
}

if (typeof value === 'object') {
  process.stdout.write(JSON.stringify(value));
} else {
  process.stdout.write(String(value));
}
