# Background repair candidate v2

This stage changes only `scene-main-clean.png`. The output stays 1355×580, matching v1. Its approved source crop remains x181,y0,w1157,h556; the additional right 198px and bottom 24px are reconstructed compatibility extensions. No whole-image scaling of the approved crop was used.

## Files

- `scene-main-clean.png`: opaque clean candidate for main-thread integration.
- `reconstruction-mask.png`: same output size. Black = exact original RGB, white = reconstructed, gray = smooth original/reconstruction mixture. It enumerates all foreground holes plus the explicit seam/extension support; the entire hero is not exempted.
- `normal-layout-preview.png`: evidence only. Original approved foreground pixels were put back to show their layout over the candidate. This raster preview is not a product asset or DOM/browser acceptance proof.
- `generated-crop-repair.png`, `generated-full-repair.png`: two built-in image_gen edit outputs, retained for reproducibility; neither is shipped directly.
- `manifest.json`: source SHA, dimensions, source masks, output SHAs, reconstruction partition and limitations.
- `build-scene.cjs`: minimal assembly and assert-based self-check; reads v1 but writes only this directory.

The four v1 podium cutouts, original lower orbit accent and star accent remain unchanged and should continue to be loaded from v1. No identity, rank, name, amount, metric or control belongs in the clean asset; the application should render these from live DOM.

## Generation and assembly

Tool: built-in `image_gen` edit, two attempts; no CLI/API fallback. Edit targets were inspected with `view_image` before tool use. First edit removed four dark circular portrait shadows, flat podium silhouettes and rectangular text patches from the 1157×556 crop. Second edit used full v1 plus the first repaired crop to continue the right background across the straight seam while keeping the planet position and ring geometry. Both prompts explicitly prohibited people, avatars, names, text, ranks, metrics, controls and new rings, and required the lower lime ring to remain at y546.

Only the enumerated original foreground masks plus a 26px outward smooth feather use repaired texture. The 32px transition at x1125..1157 joins the generated continuation; original unobstructed bright ring pixels are retained across that transition. The bottom 24px extension smoothly continues the last approved-height row. All remaining approved pixels retain their original coordinates and exact decoded RGB.

Mask partition: 228450 exact original pixels, 190325 feather-mixture pixels, 367125 reconstructed/extension pixels; total 785900. The build asserts the partition, approved source hash, and zero changed RGB channels outside declared support. Occluded material is reconstruction, so 100% original pixel fidelity is not claimed.

## Visual review and remaining acceptance

The full clean scene, full normal-layout comparison and full mask were actually opened with `view_image`. The four circular holes and black rectangular patches are gone; no full-height straight right seam remains. The large rocky planet still spans the same top/center/right position and the bottom orbit remains at y546. The generated underlay is deliberately subtle and can introduce different stars or rock texture only where the mask declares reconstruction.

This is an asset candidate, not whole-task completion. The main thread must perform independent actual browser acceptance with normal, unknown, loading, no-podium, few-entry and narrow layouts, plus refresh/readback. Small source-exact ROI checks alone do not establish a seamless scene. No product, service, database, Git or frozen v1 file was changed.

Done-review matrix: saved asset and decoded assertions passed; all requested stage deliverables present; identity/data-free clean asset inspected; all four circles/all name and metric patches and right/bottom seams inspected; approved source coordinates and frozen decorative assets preserved; independent product runtime remains pending.
