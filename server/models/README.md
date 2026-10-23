# Adding your own 3D buddies

1. Export your character as a single **`.glb`** file (glTF binary, textures embedded) and put it in this folder,
   e.g. `server/models/fox.glb`.
2. Add an entry to `server/catalog.json` → `items`:

```json
{
  "id": "fox",
  "name": "Fern",
  "kind": "Fox",
  "price": 299,
  "model": "/models/fox.glb",
  "blurb": "A clever fox who never forgets a deadline.",
  "hello": "Hey there! Fern here.",
  "voice": { "pitch": 1.3, "rate": 1.05 }
}
```

`price` is in cents (`299` = $2.99, `0` = free). The catalog is re-read on every request, so no restart is needed.

That's it — the buddy appears in the web store, in the desktop app's Buddy tab (locked until bought), and on screen
for anyone who owns it. "Every Buddy" bundle owners get it automatically.

## Model tips

- **Size and position don't matter** — Peeky scales every model to the same height, stands it on the ground and centers it.
- **Face +Z** (toward the camera) in your 3D tool.
- **Animations are optional.** If the file has clips, Peeky picks them by name:

| Peeky moment | Clip names it looks for |
|---|---|
| Standing / idle | `Idle`, `Breathe`, `Stand` |
| Walking on/off screen | `Walk`, `Run` |
| Reminding you | `Wave`, `Hello`, `Greet` |
| You tapped Done | `Happy`, `Jump`, `Dance`, `Victory` |
| Ignored (nagging) | `No`, `Shake`, `Angry` |
| Snoozed | `Sleep`, `Sit`, `Lie` |

  Without clips, Peeky animates the whole model (bobbing, hopping, turning toward the cursor).
- Keep files under ~5 MB so they load quickly.
