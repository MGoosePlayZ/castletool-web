// Builds the Android icon/splash source images from public/favicon.png (used by CI before capacitor-assets).
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SRC = "public/favicon.png";
const black = { r: 0, g: 0, b: 0, alpha: 1 };
mkdirSync("resources", { recursive: true });

const icon = await sharp(SRC).resize(1024, 1024, { kernel: "lanczos3" }).png().toBuffer();
const onBlack = async (size, inner) =>
  sharp({ create: { width: size, height: size, channels: 4, background: black } })
    .composite([{ input: await sharp(icon).resize(inner, inner).png().toBuffer(), gravity: "center" }])
    .png();

await sharp(icon).toFile("resources/icon-only.png");
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: black } }).png().toFile("resources/icon-background.png");
await (await onBlack(1024, 676)).toFile("resources/icon-foreground.png");
await (await onBlack(2732, 512)).toFile("resources/splash.png");
await (await onBlack(2732, 512)).toFile("resources/splash-dark.png");
console.log("resources ready");
