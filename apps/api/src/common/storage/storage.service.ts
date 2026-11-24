import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Global, Inject, Injectable, Module } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../../config/config";

/** S3-compatible object storage (MinIO locally). */
@Injectable()
export class StorageService {
  readonly client: S3Client;
  constructor(@Inject(APP_CONFIG) readonly cfg: AppConfig) {
    this.client = new S3Client({
      region: cfg.s3.region,
      endpoint: cfg.s3.endpoint,
      forcePathStyle: Boolean(cfg.s3.endpoint),
      credentials: cfg.s3.accessKey && cfg.s3.secretKey ? { accessKeyId: cfg.s3.accessKey, secretAccessKey: cfg.s3.secretKey } : undefined,
    });
  }

  async put(bucket: string, key: string, body: Buffer | string, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: this.cfg.s3.endpoint ? undefined : "AES256" }));
    return key;
  }

  async get(bucket: string, key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  /** Time-limited download link (reports: 24 h). */
  signedGetUrl(bucket: string, key: string, expiresInSeconds = 86_400, filename?: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: bucket, Key: key, ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"` } : {}),
    }), { expiresIn: expiresInSeconds });
  }

  async remove(bucket: string, key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }

  /** Public URL for images served through the CDN / MinIO public bucket policy. */
  publicUrl(bucket: string, key: string | null | undefined): string | null {
    if (!key) return null;
    if (/^https?:\/\//.test(key)) return key;
    const base = this.cfg.s3.endpoint ?? `https://${bucket}.s3.${this.cfg.s3.region}.amazonaws.com`;
    return this.cfg.s3.endpoint ? `${base}/${bucket}/${key}` : `${base}/${key}`;
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
