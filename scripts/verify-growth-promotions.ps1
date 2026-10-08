param([ValidateSet('Behavior','Integration')][string]$Suite='Behavior')
$ErrorActionPreference='Stop'
node scripts/generate-promotion-types.mjs --check
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
node --experimental-strip-types --test scripts/growth-promotions-behavior.test.mjs scripts/growth-promotions-read-state.test.mjs scripts/growth-promotions-capture.test.mjs scripts/growth-promotions-visual-gate.test.mjs
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
node scripts/no-double-sign-terms.mjs
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
npx.cmd tsc --noEmit
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
if($Suite -eq 'Integration'){
  npm.cmd run verify
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
}
exit 0
