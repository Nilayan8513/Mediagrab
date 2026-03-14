#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

const projectDir = 'D:\\Mediagrab';

try {
  console.log(`Running npm build in ${projectDir}...`);
  console.log('=' .repeat(60));
  
  const output = execSync('npm run build', {
    cwd: projectDir,
    stdio: 'inherit',
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
  });
  
  console.log('=' .repeat(60));
  console.log('✓ Build completed successfully!');
  process.exit(0);
} catch (error) {
  console.error('✗ Build failed');
  process.exit(1);
}
