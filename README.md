# Castletool Web

[![React](https://img.shields.io/badge/React-149ECA?style=flat&logo=react&logoColor=white)](https://react.dev/)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-18181B?style=flat&logo=shadcnui&logoColor=white)](https://ui.shadcn.com/)
[![MIT License](https://img.shields.io/github/license/MGoosePlayZ/castletool-web?style=flat&label=License&logo=opensourceinitiative&logoColor=white)](./LICENSE)

**Castletool, in your browser.** A web port of [Castletool for Android](https://github.com/MGoosePlayZ/castletool-android) (CTA) and the Castletool CLI.

Sign in with your Castle account, clone decks, add images, animations, video, SVGs, fonts, MIDI, and audio to blueprints, then save your card back to Castle.

> [!NOTE]
> This is an unofficial project. It isn't affiliated with, endorsed by, or sponsored by Castle or Montarey's Coast, Inc.

## Features

- **Castle integration:** Sign in, clone decks, edit blueprints, and save cards back to Castle.
- **Rich media:** Add images, animations, videos, SVGs, fonts, MIDI, and audio.
- **Responsive layout:** An Android-style experience on phones and narrow windows, with a three-pane layout (decks, cards, blueprints/editor) on wider screens.
- **Browser storage:** Deck data is stored locally in IndexedDB.

## What is the url of castletoolweb?

It's https://mgooseplayz.github.io/castletool-web

## Development

```sh
npm install
npm run dev        # start the Vite development server
npm run typecheck  # check TypeScript types
npm run build      # build the app into docs/
```

The application uses React, TypeScript, Vite, Tailwind CSS, and shadcn/ui components.

- `src/components/ui` contains the UI components.
- `src/lib` contains the Castle API integration and the engines for drawing, layers, media conversion, synthesis, and saving.
- `src/screens` contains the application screens.

## Browser notes

- Animated WebP/APNG frames need a browser with `ImageDecoder` (Chrome, Edge, Safari 17+); animated GIFs work everywhere.
- Video frame rate is measured by playing the video briefly; audio extraction uses Web Audio and requires browser support for the video's audio format.
- Audio and video sound are re-encoded to MP3 in the browser in 30-second segments, like CTA.
- HEIC/HEIF support depends on the browser (notably Safari). `.tar.bz2` and `.tar.xz` archives aren't supported; use `.zip` or `.tar.gz`.

