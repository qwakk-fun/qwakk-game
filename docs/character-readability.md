# Character visibility check

Toski uses a bright turquoise head, brand-yellow body and cap, peach breast, and
blue wing feathers. Both ducks use the same thin 7.5 mm game outline; these are
visual hulls only. Both use exactly the same simulation hitboxes, rig and animation clips.
The cap is a separate material primitive, hidden with either helmet equipped.
The helmet shell now sits above the authored skull instead of inside it.

Run `npm run shots:characters -- /tmp/qwakk-characters`. This starts only a local
Vite viewer and Chrome, with no game server or production connection. Full PNGs
and `contrast.json` go to the output directory.

The controlled stage uses the shipped terrain shader/textures, the shipped hedge
mesh, the game's camera and toon materials, fixed lighting and no shadows. For
each background and distance, the test captures the empty stage, Qwakk and
Toski at the same position and pose, then both side by side. Contrast is the sum
of per-pixel RGB Euclidean distances from the identical empty background. This
includes target coverage. The test checks that both ducks render in all nine
cases and reports their contrast ratio. Matching outline thickness takes
priority over requiring Toski to exceed Qwakk on every background. It also
saves images with level 1 and level 2 helmets.

Recorded on 17 October 2026, 1280 x 720, Chrome/WebGL2:

| Background | 10 m | 25 m | 50 m |
| --- | ---: | ---: | ---: |
| Grass | 1.088 | 1.084 | 1.066 |
| Hedge | 0.958 | 0.916 | 0.872 |
| Cobble | 0.947 | 0.895 | 0.853 |

Values are Toski / Qwakk. This is a reproducible visibility proxy, not a human
detection study. It covers a standing front view in these three controlled
backgrounds; other angles, gear, weather and real phone displays can differ.
Original Blender PNGs remain regenerable and gitignored. Only the two compact
WebP review sheets are kept in Git (about 48 KB instead of 15 MB).
