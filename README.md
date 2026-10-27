# CFOP Coach

A browser app that times your Rubik's cube solves with your webcam, tracks your moves, and reviews each CFOP stage
(cross → F2L pairs → 2-look OLL → 2-look PLL), suggesting shorter solutions where you lost moves.

```bash
npm install
npm run dev      # open the printed localhost URL in Chrome
npm test         # unit tests (cube model, solvers, analysis, simulated tracker)
```

Open `http://localhost:5173/?demo` to see the review screen with a made-up solve; no camera needed.

## Flow

1. **Scramble.** Shows a random 21-move scramble (held white on the bottom, green in front — change `SCRAMBLE_HOLD` in `src/cube/scramble.ts` to use another hold) and what the cube should
   look like afterwards. You can also paste your own.
2. **Verify.** Hold each face up anywhere in view; the purple grid locks onto it (or use the fixed center grid) and
   press Space. The scan is checked for a valid cube
   and compared sticker by sticker with the scramble; click any misread sticker to fix it. The scan also calibrates the
   sticker colors for move tracking.
3. **Solve.** Two start/stop modes, both stackmat-style:
   - **Hands anywhere** (default): rest both hands still wherever is comfortable until the clock turns green, lift
     to start, and put your hands back where they rested to stop.
   - **Pads**: two pads on the camera view; drag them anywhere and resize them with the corner dot (remembered).
   The space bar also works: hold and release to start, press any key to stop.
4. **Review.** Your solve is split into stages. For each stage you see your moves and time, a better solution, why it
   is better, and a 3D replay of both (powered by [cubing.js](https://js.cubing.net/cubing/)).

## How the review works

- **Cross.** An exact solver (full 24⁴ lookup table) gives the optimal cross. It also checks whether another color's cross
  was shorter, as a color-neutrality hint.
- **F2L.** For the pair you inserted, a search finds the shortest insertion that keeps the cross and the solved pairs
  intact. It is shown from the "slot at front-right" angle and ranked toward R/U-style algorithms. It also tells you
  when a different pair was cheaper at that point.
- **OLL / PLL.** The beginner 2-look algorithm sets: edges (line, L, dot), corners (Sune, Antisune, H, Pi,
  Headlights, T, Bowtie), corner permutation (T-perm, Y-perm), and edge permutation (Ua, Ub, H, Z). The case is
  recognized by simulation, with AUFs.
- An **example full CFOP solve** of the scramble is included.

## Move tracking: be aware

- **Camera (experimental).** A webcam only sees the face pointed at it, and hands cover stickers, so moves can't be
  read directly. The tracker keeps many guesses about the cube's state and, whenever the front face holds still for
  ~100 ms, keeps the move sequences (up to 2–3 moves) that best explain what it sees. Turns hidden at the time, such
  as B, are inferred once their effect becomes visible. In simulation it reconstructs full solves reliably. The cube is found
  anywhere in the frame (it searches near your hands first), but the face must be roughly upright and facing the
  camera. On a real cube it works best with **slow, deliberate turning, one face toward the camera, and good, even
  lighting**. It will
  lose track at real speedsolving speed. When it does, the review says where. Fix the reconstruction text and
  re-analyze.
- **Smart cube.** "Connect smart cube" uses Web Bluetooth through cubing.js (GAN, Giiker, and similar cubes, in Chrome).
  This gives exact move tracking.
- **Off.** Type your solution after the solve, like a cstimer reconstruction.

## Face detection

Faces are found by shape with [OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html), not by
color, so detection works before your colors are calibrated:

1. Edges are traced into outlines, and outlines that look like stickers are kept: compact, roughly square, similar
   size and shape.
2. Neighboring stickers are linked, the face's two grid directions are estimated from those links, and each
   sticker gets a row and column.
3. The 3×3 window with the most stickers is fit with an affine map. That handles a tilted or angled face and fills in
   stickers hidden by fingers or glare (at least 5 of 9 must be visible).

It works best on cubes with black borders between stickers. On rendered test frames (angled up to ~30°, tilted up to
~20°, cluttered backgrounds, finger-like blobs) it found the face in 84 of 84 frames and read all 9 colors correctly
in 82. OpenCV.js is about 10 MB and loads in the background the first time the scan or solve screen opens.

**Tuning on your own camera.** Use **Save frame** on the scan or solve screen to download what the camera sees.
Then:

```bash
mkdir frames && mv ~/Downloads/cube-*.png frames/
npm run detect          # writes annotated copies to frames/out/
```

In the annotated copies, magenta dots are sticker candidates, the purple outline is the fitted face, and black dots
are the 9 sampling points.

## Layout

- `src/cube/model.ts`: facelet cube model; all moves (faces, wide, slices, rotations) derived from 3D geometry
- `src/cube/solver.ts`: cross / F2L searches, 2-look OLL/PLL tables
- `src/cube/analysis.ts`: stage segmentation, suggestions, tips
- `src/vision/`: OpenCV face detector (`stickers.ts`), color classification, color-based fallback finder, MediaPipe
  hands, start/stop logic, move tracker
- `src/ui/`: React screens
