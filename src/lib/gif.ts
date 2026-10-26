// Minimal animated-GIF reader for browsers without ImageDecoder (Firefox).
// @ts-ignore
import { parseGIF, decompressFrames } from "gifuct-js";
import { makeCanvas } from "./drawing";

export class GifReader {
  private gif: any;
  constructor(data: Uint8Array) {
    this.gif = parseGIF(data.slice().buffer as ArrayBuffer);
  }
  frameCount(): number { return (this.gif.frames || []).filter((f: any) => f.image).length; }
  /** Fully composited frames (disposal methods applied). */
  async *compose(): AsyncGenerator<{ canvas: HTMLCanvasElement; delay: number }> {
    const frames = decompressFrames(this.gif, true), W = this.gif.lsd.width, H = this.gif.lsd.height;
    const canvas = makeCanvas(W, H), x = canvas.getContext("2d", { willReadFrequently: true })!;
    const patch = makeCanvas(1, 1), px = patch.getContext("2d")!;
    let restore: ImageData | null = null;
    let prev: any = null;
    for (const f of frames) {
      if (prev) {
        if (prev.disposalType === 2) x.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
        else if (prev.disposalType === 3 && restore) x.putImageData(restore, 0, 0);
      }
      restore = f.disposalType === 3 ? x.getImageData(0, 0, W, H) : null;
      patch.width = f.dims.width; patch.height = f.dims.height;
      px.putImageData(new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0);
      x.drawImage(patch, f.dims.left, f.dims.top);
      const out = makeCanvas(W, H);
      out.getContext("2d")!.drawImage(canvas, 0, 0);
      yield { canvas: out, delay: f.delay || 100 };
      prev = f;
    }
  }
}
