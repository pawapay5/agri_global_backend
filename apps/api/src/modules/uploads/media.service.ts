import { Global, Inject, Injectable, Logger, Module } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { connect } from "node:net";
import sharp from "sharp";
import { APP_CONFIG, AppConfig } from "../../config/config";
import { AppError } from "../../common/http/problem";
import { StorageService } from "../../common/storage/storage.service";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const VARIANTS = { thumb: 320, medium: 800, large: 1600 } as const;
const ALLOWED = new Set(["jpeg", "png", "webp", "heif", "avif"]);

/**
 * clamd INSTREAM protocol: "zINSTREAM\0", then <uint32 length><chunk>…, then a zero-length chunk.
 * The reply is "stream: OK" or "stream: <signature> FOUND".
 */
export function clamdScan(buf: Buffer, host: string, port: number, timeoutMs = 15_000): Promise<{ clean: boolean; signature?: string }> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let reply = "";
    sock.setTimeout(timeoutMs, () => { sock.destroy(); reject(new Error("clamd timeout")); });
    sock.on("error", reject);
    sock.on("data", (d) => (reply += d.toString()));
    sock.on("end", () => {
      const r = reply.replace(/\0/g, "").trim();
      if (r.endsWith("OK")) resolve({ clean: true });
      else if (r.includes("FOUND")) resolve({ clean: false, signature: r.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "") });
      else reject(new Error(`clamd: ${r}`));
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
        sock.write(len); sock.write(chunk);
      }
      sock.end(Buffer.alloc(4));
    });
  });
}

export interface StoredImage { variants: Record<keyof typeof VARIANTS, string>; width: number; height: number; sha256: string }

/** Upload pipeline for every user image: size/type check → virus scan → decode → EXIF strip + auto-rotate → WebP variants → S3. */
@Injectable()
export class MediaService {
  private readonly log = new Logger(MediaService.name);
  constructor(private readonly storage: StorageService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async processImage(file: Express.Multer.File | undefined, prefix: string, opts: { bucket?: string; field?: string } = {}): Promise<StoredImage> {
    if (!file) throw AppError.unprocessable("file_required", `Attach an image in the '${opts.field ?? "file"}' field`);
    if (file.size > MAX_IMAGE_BYTES) throw AppError.unprocessable("file_too_large", "Images must be 10 MB or smaller");

    const host = process.env.CLAMAV_HOST;
    if (host) {
      const r = await clamdScan(file.buffer, host, Number(process.env.CLAMAV_PORT ?? 3310)).catch((e) => {
        this.log.error({ err: (e as Error).message }, "virus scan unavailable");
        throw new AppError(503, "scan_unavailable", "Service unavailable", "Uploads are temporarily unavailable");
      });
      if (!r.clean) {
        this.log.warn({ signature: r.signature, prefix }, "infected upload rejected");
        throw AppError.unprocessable("file_infected", "This file was rejected by the virus scanner");
      }
    } else if (this.cfg.env === "production") {
      throw new AppError(503, "scan_unavailable", "Service unavailable", "Virus scanning is not configured");
    }

    // Decode with sharp: the real format comes from the bytes, not the claimed MIME type.
    const img = sharp(file.buffer, { failOn: "error", limitInputPixels: 50_000_000 });
    const meta = await img.metadata().catch(() => { throw AppError.unprocessable("file_type", "Unsupported or corrupt image"); });
    if (!meta.format || !ALLOWED.has(meta.format)) throw AppError.unprocessable("file_type", "Use JPEG, PNG, WebP or HEIC images");

    const id = randomUUID();
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const variants = {} as Record<keyof typeof VARIANTS, string>;
    let width = 0, height = 0;
    for (const [name, max] of Object.entries(VARIANTS) as [keyof typeof VARIANTS, number][]) {
      // .rotate() applies EXIF orientation; sharp drops all metadata (GPS, camera) unless withMetadata() is called.
      const { data, info } = await sharp(file.buffer).rotate().resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
        .webp({ quality: name === "thumb" ? 70 : 80 }).toBuffer({ resolveWithObject: true });
      const key = `${prefix}/${id}/${name}.webp`;
      await this.storage.put(opts.bucket ?? this.cfg.s3.imagesBucket, key, data, "image/webp");
      variants[name] = key;
      if (name === "large") ({ width, height } = info);
    }
    return { variants, width, height, sha256 };
  }

  urls(variants: Record<string, string>): Record<string, string | null> {
    return Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, this.storage.publicUrl(this.cfg.s3.imagesBucket, v)]));
  }

  async removeVariants(variants: Record<string, string>) {
    await Promise.all(Object.values(variants).map((k) => this.storage.remove(this.cfg.s3.imagesBucket, k).catch(() => undefined)));
  }
}

@Global()
@Module({ providers: [MediaService], exports: [MediaService] })
export class MediaModule {}
