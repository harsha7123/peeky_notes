# Adding your own buddies

Two kinds of buddy can be added without touching the app's code. Both show up in the web store, the desktop
Buddy tab (locked until bought) and on screen for anyone who owns them. The catalog (`server/catalog.json`) is
re-read on every request, so no restart is needed.

## 1. Realistic "cut-out" buddies (from one picture)

A cut-out buddy is a single picture of a character **standing upright, facing the camera, feet slightly apart**,
on a **plain background**. Peeky removes the background, splits the legs at the hip and animates them, so the
character walks in, breathes, hops and leans toward the cursor.

```
npm run cutout -- path/to/picture.jpg mybuddy
```

This writes `server/models/mybuddy.png` (transparent and trimmed) and prints the catalog entry to paste into
`server/catalog.json` → `items`, with the hip line and leg gap already measured:

```json
{
  "id": "mybuddy", "name": "Mybuddy", "kind": "Realistic", "price": 199,
  "image": "/models/mybuddy.png", "hip": 0.47, "split": 0.5,
  "blurb": "One line about this buddy.", "hello": "Hey! Quick reminder.", "voice": { "pitch": 1, "rate": 1 }
}
```

### Poses (optional, recommended)

Extra pictures of the same character make it feel alive, like `veer` in the catalog:

```
npm run cutout -- path/to/walk.jpg mybuddy walk     # side-on, mid-stride, FACING RIGHT
npm run cutout -- path/to/cheer.jpg mybuddy cheer   # facing the camera, thumbs-up or celebrating
```

Then add to the buddy's catalog entry:

```json
"poses": { "walk": "/models/mybuddy-walk.png", "cheer": "/models/mybuddy-cheer.png" }
```

- **walk** is shown while the buddy walks on and off screen, mirrored automatically to face the way it's going.
  Give a list of pictures (`"walk": ["…-walk1.png", "…-walk2.png"]`) for a frame-by-frame walk cycle.
- **cheer** is shown when you press Done / Yes.
- Without poses the buddy uses the main picture and swings its legs.

Tips:
- Use a picture **at least 1000 px tall** (2000+ is better). `kai.png` and `mira.png` here are small previews —
  replace them with full-size versions for a crisp result.
- The background must be one flat colour that the character doesn't wear (light grey or green works well).
- `hip` is where the legs join the body (0 = feet, 1 = head). `split` is the gap between the legs (0 = left edge,
  1 = right edge). Nudge them if the walk looks off.
- Only use characters you have the rights to: your own art, commissioned work, or images you generated.
  Don't use real people's likenesses or other apps' characters.

## 2. 3D models (`.glb`)

Export the character as a single **`.glb`** file (textures embedded), put it in this folder, and add:

```json
{
  "id": "fox", "name": "Fern", "kind": "Fox", "price": 299, "model": "/models/fox.glb",
  "blurb": "A clever fox who never forgets a deadline.", "hello": "Hey there! Fern here.", "voice": { "pitch": 1.3, "rate": 1.05 }
}
```

- Size and position don't matter — Peeky scales every model to the same height and stands it on the ground.
- Face **+Z** (toward the camera) in your 3D tool. Add `"tall": false` to show it at toy size instead of full height.
- Animations are optional. If the file has clips, Peeky picks them by name:

| Peeky moment | Clip names it looks for |
|---|---|
| Standing / idle | `Idle`, `Breathe`, `Stand` |
| Walking on/off screen | `Walk`, `Run` |
| Reminding you | `Wave`, `Hello`, `Greet` |
| You tapped Done | `Happy`, `Jump`, `Dance`, `Victory` |
| Ignored (nagging) | `No`, `Shake`, `Angry` |
| Snoozed | `Sleep`, `Sit`, `Lie` |

`price` is in cents (`299` = $2.99, `0` = free). "Every Buddy" owners get new buddies automatically.
