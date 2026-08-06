import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runnerPath =
  'D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/child-j234-D-handoff/run-j234-child-wave.ps1';
const source = readFileSync(runnerPath, 'utf8');

assert.match(source, /function Test-ReleasedListener/, 'runtime gate must centralize listener verification');
assert.match(source, /Get-NetTCPConnection -State Listen -LocalPort \$Port/, 'Get-NetTCPConnection remains the preferred listener source');
assert.match(source, /netstat -ano/, 'when Get-NetTCPConnection is unavailable, listener evidence must fall back to netstat');
assert.match(source, /LISTENING/, 'netstat fallback must require a listening socket');
assert.match(source, /\$Port/, 'fallback must bind its decision to the requested port');
assert.match(source, /\$ExpectedPid/, 'fallback must bind its decision to the released PID');
assert.match(source, /Test-NetConnection -ComputerName 127\.0\.0\.1 -Port \$Port -InformationLevel Quiet/, 'fallback must also prove TCP reachability');
assert.match(source, /Test-ReleasedListener -Port 18120 -ExpectedPid \(\[int\]\$bound\.Resources\.backendPid\)/, 'backend must use the unified exact-PID gate');
assert.match(source, /Test-ReleasedListener -Port 3303 -ExpectedPid \(\[int\]\$bound\.Resources\.pcPid\)/, 'PC must use the unified exact-PID gate');

console.log('j234 child runtime fallback contract: PASS');
