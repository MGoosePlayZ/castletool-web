# Castletool Web

Castletool for the browser: a web port of [Castletool for Android](https://github.com/MGoosePlayZ/castletool-android) (CTA) and the Castletool CLI.
Sign in with your Castle account, clone decks, add images, animations, video, SVG, fonts, MIDI and audio to blueprints, and save the card back to Castle.

Unofficial. Not affiliated with, endorsed by, or sponsored by Castle or Montarey's Coast, Inc.

## Using it

Open the GitHub Pages site for this repo. Phones and narrow windows get the same screens as the Android app; wide windows get a three-pane layout (decks | cards | blueprints and editor).
Decks are stored in your browser (IndexedDB). Nothing goes anywhere but Castle.

## Hosting on GitHub Pages

Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder: `/docs`**.

`docs/` is the built app, committed so no build step is needed.

## Developing

```sh
npm install
npm run dev        # local dev server
npm run build      # rebuilds docs/
```

Vite + React + TypeScript + Tailwind + shadcn/ui (the components are in `src/components/ui`). `src/lib` holds the engine (Castle API, drawing/layers, image/SVG/video/font/MIDI conversion, synth, saving); `src/screens` holds the screens.

## Browser notes

- Animated WebP/APNG frames need a browser with `ImageDecoder` (Chrome, Edge, Safari 17+); animated GIFs work everywhere.
- Video frame rate is measured by playing the video briefly; the sound is extracted with Web Audio, so it needs a browser that can decode the video's audio.
- Audio and video sound are re-encoded to MP3 in the browser (30 second segments, like CTA).
- HEIC/HEIF only opens where the browser can read it (Safari). `.tar.bz2` / `.tar.xz` archives aren't supported; use `.zip` or `.tar.gz`.

## License

MIT, see `LICENSE`.
