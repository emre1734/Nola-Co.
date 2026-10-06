#!/usr/bin/env node
// Patches @capgo/native-purchases android/build.gradle to add
// `publishing { singleVariant("release") }` which is required by
// Android Gradle Plugin 8.x to resolve the plugin's release variant
// during a release AAB/APK build. Without this, AGP reports:
//   "No matching variant of project :capgo-native-purchases"
//
// All official Capacitor 8 plugins include this block; the capgo
// plugin omits it. This patch is idempotent and safe to re-run.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const pluginGradle = join(
  process.cwd(),
  'node_modules',
  '@capgo',
  'native-purchases',
  'android',
  'build.gradle',
);

if (!existsSync(pluginGradle)) {
  console.log('[patch-capgo-billing] Plugin not installed, skipping.');
  process.exit(0);
}

let content = readFileSync(pluginGradle, 'utf8');

if (content.includes('singleVariant')) {
  console.log('[patch-capgo-billing] Already patched, skipping.');
  process.exit(0);
}

const target = '    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_21\n        targetCompatibility JavaVersion.VERSION_21\n    }\n}';
const replacement =
  '    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_21\n        targetCompatibility JavaVersion.VERSION_21\n    }\n    publishing {\n        singleVariant("release")\n    }\n}';

if (!content.includes(target)) {
  console.warn('[patch-capgo-billing] Could not find expected anchor in build.gradle. Skipping.');
  process.exit(0);
}

content = content.replace(target, replacement);
writeFileSync(pluginGradle, content, 'utf8');
console.log('[patch-capgo-billing] Added publishing { singleVariant("release") } to @capgo/native-purchases/android/build.gradle');
