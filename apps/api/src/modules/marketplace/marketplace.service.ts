import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "../../common/redis/redis.module";
import Decimal from "decimal.js";
import type { AuthUser } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { cursor } from "../../common/http/request-context";
import { MoneyService } from "../../common/money/money.service";
import { QueueService } from "../../common/queue/queues";
import { StorageService } from "../../common/storage/storage.service";
import { MediaService } from "../uploads/media.service";
import { deliveryFee, DeliverySettings, priceFlag, stockStatus } from "./marketplace.logic";

const OFFER_TTL_HOURS = 48;

interface ListingRow {
  id: string; seller_id: string; country_iso2: string; type: string; service_kind: string | null; category_id: string | null; commodity_id: string | null;
  title: string; description: string | null; price_per_unit: string; currency: string; unit_code: string; quantity: string; min_order_qty: string;
  low_stock_threshold: string | null; quality_grade: string | null; harvest_date: Date | null; region_id: string | null; lat: number | null; lng: number | null;
  status: string; price_flag: string | null; price_deviation_pct: number | null; published_at: Date | null; created_at: Date;
  display_name?: string; verified?: boolean; rating_avg?: string | null; response_time_mins?: number | null; distance_km?: number | null; fav?: boolean;
}
const LISTING_COLS = `l.*, ST_Y(l.location::geometry) AS lat, ST_X(l.location::geometry) AS lng, sp.display_name, sp.kyc_status = 'verified' AS verified,
  sp.rating_avg::text, sp.response_time_mins`;

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly sql: Sql, private readonly money: MoneyService, private readonly media: MediaService, private readonly storage: StorageService,
    private readonly queue: QueueService, private readonly audit: AuditService, @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Marketplace activity feed for seller analytics and the demand index. Views are deduplicated per viewer per day. */
  async event(kind: "listing_view" | "favourite" | "offer", l: ListingRow, buyerId: string | null) {
    if (l.seller_id === buyerId) return;
    if (kind === "listing_view") {
      const key = `mv:${l.id}:${buyerId ?? "anon"}:${new Date().toISOString().slice(0, 10)}`;
      if (buyerId === null || (await this.redis.set(key, "1", "EX", 86_400, "NX")) !== "OK") return; // anonymous views are not counted
    }
    await this.sql.exec(
      `INSERT INTO marketplace_events (kind, seller_id, buyer_id, listing_id, commodity_id, region_id, country_iso2, currency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [kind, l.seller_id, buyerId, l.id, l.commodity_id, l.region_id, l.country_iso2, l.currency]).catch(() => undefined);
  }

  // ── sellers ──
  private sellerDto(s: Record<string, any>, owner: boolean, activeListings = 0) {
    return {
      userId: s.user_id, displayName: s.display_name, bio: s.bio, country: s.country_iso2, regionId: s.region_id, verified: s.kyc_status === "verified",
      ...(owner ? { kycStatus: s.kyc_status } : {}), rating: s.rating_avg != null ? Number(s.rating_avg) : null, ratingCount: s.rating_count,
      responseTimeMins: s.response_time_mins, deliverySettings: s.delivery_settings, activeListings,
    };
  }

  async mySeller(user: AuthUser) {
    const s = await this.sql.one(`SELECT * FROM seller_profiles WHERE user_id = $1`, [user.id]);
    if (!s) throw AppError.notFound("seller_profile", "Create a seller profile first");
    return this.sellerDto(s, true, await this.activeCount(user.id));
  }

  async seller(id: string) {
    const s = await this.sql.one(`SELECT * FROM seller_profiles WHERE user_id = $1`, [id]);
    if (!s) throw AppError.notFound("seller");
    return this.sellerDto(s, false, await this.activeCount(id));
  }

  private async activeCount(id: string) {
    return (await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM listings WHERE seller_id = $1 AND status IN ('active','low_stock')`, [id]))?.n ?? 0;
  }

  async putSeller(user: AuthUser, d: { displayName: string; bio?: string; regionId?: string; location?: { lat: number; lng: number }; deliverySettings?: DeliverySettings }) {
    if (d.deliverySettings) validateDelivery(d.deliverySettings);
    await this.sql.exec(
      `INSERT INTO seller_profiles (user_id, display_name, bio, country_iso2, region_id, location, delivery_settings)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($7,$6),4326)::geography END, coalesce($8::jsonb, '{"pickup":{"enabled":true}}'))
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio, region_id = coalesce(EXCLUDED.region_id, seller_profiles.region_id),
         location = coalesce(EXCLUDED.location, seller_profiles.location), delivery_settings = coalesce($8::jsonb, seller_profiles.delivery_settings)`,
      [user.id, d.displayName, d.bio ?? null, user.country, d.regionId ?? null, d.location?.lat ?? null, d.location?.lng ?? null, d.deliverySettings ? JSON.stringify(d.deliverySettings) : null]);
    return this.mySeller(user);
  }

  /** KYC: the selfie is stored privately; the ID number is passed to the KYC provider and never stored by us. */
  async submitKyc(user: AuthUser, d: { idType: string; idNumber: string }, selfie: Express.Multer.File | undefined) {
    await this.mySeller(user);
    if (!/^[A-Z0-9-]{5,40}$/i.test(d.idNumber)) throw AppError.unprocessable("id_number_invalid", "Check the ID number");
    const img = await this.media.processImage(selfie, `kyc/${user.id}`);
    const ref = `kyc_${user.id}_${Date.now()}`;
    await this.sql.exec(`UPDATE seller_profiles SET kyc_status = 'pending', kyc_provider_ref = $2 WHERE user_id = $1`, [user.id, ref]);
    await this.queue.raw("commerce", "kyc-submit", { userId: user.id, reference: ref, idType: d.idType, idNumber: d.idNumber, selfieKey: img.variants.large, country: user.country }, ref);
    await this.audit.record({ actorId: user.id, action: "seller.kyc.submitted", data: { idType: d.idType } });
    return this.mySeller(user);
  }

  // ── listings ──
  async listingDto(l: ListingRow, viewerId?: string) {
    const photos = await this.sql.many<{ id: string; position: number; variants: Record<string, string>; width: number; height: number }>(
      `SELECT id, position, variants, width, height FROM listing_photos WHERE listing_id = $1 ORDER BY position`, [l.id]);
    return {
      id: l.id, sellerId: l.seller_id, seller: { displayName: l.display_name, verified: l.verified ?? false, rating: l.rating_avg != null ? Number(l.rating_avg) : null, responseTimeMins: l.response_time_mins ?? null },
      type: l.type, serviceKind: l.service_kind, categoryId: l.category_id, commodityId: l.commodity_id, title: l.title, description: l.description,
      pricePerUnit: l.price_per_unit, currency: l.currency, unit: l.unit_code, quantity: l.quantity, minOrderQty: l.min_order_qty,
      qualityGrade: l.quality_grade, harvestDate: l.harvest_date?.toISOString().slice(0, 10) ?? null, regionId: l.region_id,
      location: l.lat != null && l.lng != null ? { lat: Math.round(l.lat * 100) / 100, lng: Math.round(l.lng * 100) / 100 } : null, // ~1 km precision publicly
      distanceKm: l.distance_km != null ? Math.round(l.distance_km * 10) / 10 : null, status: l.status, priceFlag: l.price_flag, priceDeviationPct: l.price_deviation_pct,
      photos: photos.map((p) => ({ id: p.id, position: p.position, width: p.width, height: p.height, urls: this.media.urls(p.variants) })),
      favourite: viewerId ? Boolean(l.fav) : false, publishedAt: l.published_at?.toISOString() ?? null, createdAt: l.created_at.toISOString(),
    };
  }

  private async load(id: string, viewerId?: string) {
    return this.sql.one<ListingRow>(
      `SELECT ${LISTING_COLS}, EXISTS (SELECT 1 FROM favourites f WHERE f.listing_id = l.id AND f.user_id = $2) AS fav
       FROM listings l JOIN seller_profiles sp ON sp.user_id = l.seller_id WHERE l.id = $1`, [id, viewerId ?? null]);
  }

  async get(id: string, viewer: AuthUser | null) {
    const l = await this.load(id, viewer?.id);
    if (!l || (["draft", "removed"].includes(l.status) && l.seller_id !== viewer?.id && viewer?.role !== "admin")) throw AppError.notFound("listing");
    if (["active", "low_stock"].includes(l.status)) void this.event("listing_view", l, viewer?.id ?? null);
    return this.listingDto(l, viewer?.id);
  }

  /** Compare the listing's per-kg price with the 30-day market band (wholesale low end, retail high end). */
  private async priceCheck(commodityId: string | null, pricePerUnit: string, currency: string, unit: string, country: string, regionId: string | null): Promise<{ perKg: number | null; flag: "far_above_market" | "far_below_market" | null; deviationPct: number | null }> {
    if (!commodityId) return { perKg: null, flag: null, deviationPct: null };
    const ctx = await this.money.resolveDisplay({}, null, country);
    if (currency !== ctx.localCurrency) return { perKg: null, flag: null, deviationPct: null };
    const kg = await this.money.kgPerUnit(commodityId, unit, country).catch(() => null);
    if (!kg) return { perKg: null, flag: null, deviationPct: null };
    const perKg = new Decimal(pricePerUnit).div(kg).toNumber();
    const band = await this.sql.one<{ wholesale: string | null; retail: string | null }>(
      `WITH r AS (
         SELECT price_type, sum(sum_kg_local) / nullif(sum(n), 0) AS avg FROM price_daily
         WHERE commodity_id = $1 AND country_iso2 = $2 AND bucket >= now() - interval '30 days'
           AND ($3::uuid IS NULL OR region_ancestor_at_level(region_id, 1) = region_ancestor_at_level($3, 1))
         GROUP BY price_type)
       SELECT (SELECT avg FROM r WHERE price_type = 'wholesale')::text AS wholesale, (SELECT avg FROM r WHERE price_type = 'retail')::text AS retail`,
      [commodityId, country, regionId]);
    let ws = band?.wholesale ? Number(band.wholesale) : null, rt = band?.retail ? Number(band.retail) : null;
    if (ws == null && rt == null && regionId) return this.priceCheck(commodityId, pricePerUnit, currency, unit, country, null); // fall back to national
    const hi = priceFlag(perKg, rt ?? ws), lo = priceFlag(perKg, ws ?? rt);
    const flag = hi.flag === "far_above_market" ? hi.flag : lo.flag === "far_below_market" ? lo.flag : null;
    return { perKg, flag, deviationPct: flag === "far_below_market" ? lo.deviationPct : hi.deviationPct };
  }

  async create(user: AuthUser, d: Record<string, any>) {
    const seller = await this.sql.one<{ country_iso2: string; region_id: string | null }>(`SELECT country_iso2, region_id FROM seller_profiles WHERE user_id = $1`, [user.id]);
    if (!seller) throw AppError.unprocessable("seller_profile_required", "Create a seller profile first");
    if (d.type === "service" && !d.serviceKind) throw AppError.unprocessable("service_kind_required", "Choose transport, storage or input supply");
    if (d.type === "product" && !d.commodityId && !d.categoryId) throw AppError.unprocessable("category_required", "Choose a commodity or category");
    if (!(await this.sql.one(`SELECT 1 FROM units WHERE code = $1`, [d.unit]))) throw AppError.unprocessable("unit_unknown", d.unit);
    let categoryId = d.categoryId ?? null;
    if (d.commodityId) categoryId = (await this.sql.one<{ category_id: string }>(`SELECT category_id FROM commodities WHERE id = $1`, [d.commodityId]))?.category_id ?? null;
    if (d.commodityId && !categoryId) throw AppError.unprocessable("commodity_unknown", "Commodity not found");
    const regionId = d.regionId ?? seller.region_id;
    const pc = await this.priceCheck(d.commodityId ?? null, d.pricePerUnit, d.currency, d.unit, seller.country_iso2, regionId);
    const row = await this.sql.one<{ id: string }>(
      `INSERT INTO listings (seller_id, country_iso2, type, service_kind, category_id, commodity_id, title, description, price_per_unit, currency, unit_code, price_per_kg_local,
         quantity, min_order_qty, low_stock_threshold, quality_grade, harvest_date, region_id, location, price_flag, price_deviation_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,coalesce($14,1),$15,$16,$17,$18,
         CASE WHEN $19::float8 IS NULL THEN (SELECT location FROM seller_profiles WHERE user_id = $1) ELSE ST_SetSRID(ST_MakePoint($20,$19),4326)::geography END, $21, $22)
       RETURNING id`,
      [user.id, seller.country_iso2, d.type, d.serviceKind ?? null, categoryId, d.commodityId ?? null, d.title, d.description ?? null, d.pricePerUnit, d.currency, d.unit, pc.perKg,
        d.quantity, d.minOrderQty ?? null, d.lowStockThreshold ?? null, d.qualityGrade ?? null, d.harvestDate ?? null, regionId, d.location?.lat ?? null, d.location?.lng ?? null, pc.flag, pc.deviationPct]);
    if (pc.flag) await this.flagForReview(row!.id, pc.flag, pc.deviationPct);
    return this.get(row!.id, user);
  }

  private async flagForReview(listingId: string, flag: string, deviation: number | null) {
    await this.sql.exec(
      `INSERT INTO moderation_items (target_type, target_id, reason, signals) SELECT 'listing', $1, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM moderation_items WHERE target_type = 'listing' AND target_id = $1 AND reporter_id IS NULL AND status = 'open')`,
      [listingId, flag, { deviationPct: deviation }]);
  }

  async update(user: AuthUser, id: string, d: Record<string, any>) {
    const l = await this.load(id);
    if (!l || l.seller_id !== user.id) throw AppError.notFound("listing");
    if (l.status === "removed") throw AppError.unprocessable("listing_removed", "Removed listings can't be edited");
    if (d.status === "active") {
      const photos = (await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM listing_photos WHERE listing_id = $1`, [id]))?.n ?? 0;
      if (l.type === "product" && photos === 0) throw AppError.unprocessable("photo_required", "Add at least one photo before publishing");
      const s = await this.sql.one<{ suspended_at: Date | null }>(`SELECT suspended_at FROM users WHERE id = $1`, [user.id]);
      if (s?.suspended_at) throw AppError.forbidden("account_suspended");
    }
    const price = d.pricePerUnit ?? l.price_per_unit;
    const pc = d.pricePerUnit ? await this.priceCheck(l.commodity_id, price, l.currency, l.unit_code, l.country_iso2, l.region_id) : null;
    const qty = d.quantity ?? l.quantity;
    const requested = d.status ?? l.status;
    const status = requested === "removed" || requested === "draft" ? requested : stockStatus(Number(qty), d.lowStockThreshold != null ? Number(d.lowStockThreshold) : l.low_stock_threshold != null ? Number(l.low_stock_threshold) : null, "active");
    await this.sql.exec(
      `UPDATE listings SET title = coalesce($2, title), description = coalesce($3, description), price_per_unit = $4, quantity = $5,
         min_order_qty = coalesce($6, min_order_qty), low_stock_threshold = coalesce($7, low_stock_threshold), quality_grade = coalesce($8, quality_grade),
         harvest_date = coalesce($9::date, harvest_date), status = $10, published_at = CASE WHEN $10 = 'active' AND published_at IS NULL THEN now() ELSE published_at END,
         price_per_kg_local = CASE WHEN $11 THEN $12 ELSE price_per_kg_local END, price_flag = CASE WHEN $11 THEN $13 ELSE price_flag END,
         price_deviation_pct = CASE WHEN $11 THEN $14 ELSE price_deviation_pct END
       WHERE id = $1`,
      [id, d.title ?? null, d.description ?? null, price, qty, d.minOrderQty ?? null, d.lowStockThreshold ?? null, d.qualityGrade ?? null, d.harvestDate ?? null, status,
        Boolean(pc), pc?.perKg ?? null, pc?.flag ?? null, pc?.deviationPct ?? null]);
    if (pc?.flag) await this.flagForReview(id, pc.flag, pc.deviationPct);
    return this.get(id, user);
  }

  async search(q: Record<string, any>, viewer: AuthUser | null) {
    const c = cursor.decode<{ k: string; id: string }>(q.cursor);
    const near = q.sort === "nearest";
    if (near && (q.lat == null || q.lng == null)) throw AppError.unprocessable("location_required", "Sorting by nearest needs lat and lng");
    const orderExpr = { recent: "l.published_at DESC, l.id DESC", lowest: "l.price_per_unit ASC, l.id ASC", highest: "l.price_per_unit DESC, l.id DESC", nearest: "distance_km ASC, l.id ASC" }[q.sort as string] ?? "l.published_at DESC, l.id DESC";
    // Offset-free pagination: the cursor carries the last sort key.
    const keyExpr = { recent: "l.published_at::text", lowest: "lpad(l.price_per_unit::text, 24, '0')", highest: "lpad(l.price_per_unit::text, 24, '0')", nearest: "lpad(round((ST_Distance(l.location, ST_SetSRID(ST_MakePoint($12,$11),4326)::geography)/1000)::numeric, 3)::text, 16, '0')" }[q.sort as string] ?? "l.published_at::text";
    const cmp = ["highest", "recent"].includes(q.sort ?? "recent") ? "<" : ">";
    const rows = await this.sql.many<ListingRow & { k: string }>(
      `SELECT ${LISTING_COLS}, ${keyExpr} AS k,
         CASE WHEN $11::float8 IS NULL THEN NULL ELSE ST_Distance(l.location, ST_SetSRID(ST_MakePoint($12,$11),4326)::geography) / 1000 END AS distance_km,
         EXISTS (SELECT 1 FROM favourites f WHERE f.listing_id = l.id AND f.user_id = $15) AS fav
       FROM listings l JOIN seller_profiles sp ON sp.user_id = l.seller_id JOIN users u ON u.id = l.seller_id
       WHERE l.country_iso2 = $1 AND l.status IN ('active','low_stock') AND u.suspended_at IS NULL
         AND ($2::text IS NULL OR l.search @@ plainto_tsquery('simple', immutable_unaccent($2)) OR l.title ILIKE '%' || $2 || '%')
         AND ($3::text IS NULL OR l.type = $3) AND ($4::text IS NULL OR l.service_kind = $4)
         AND ($5::uuid IS NULL OR l.category_id = $5) AND ($6::uuid IS NULL OR l.commodity_id = $6)
         AND ($7::uuid IS NULL OR l.region_id = $7 OR region_ancestor_at_level(l.region_id, 1) = $7)
         AND ($8::numeric IS NULL OR l.price_per_unit >= $8) AND ($9::numeric IS NULL OR l.price_per_unit <= $9)
         AND ($13::text IS NULL OR (${keyExpr}, l.id::text) ${cmp} ($13, $14))
         AND ($10::boolean IS FALSE OR l.location IS NOT NULL)
       ORDER BY ${orderExpr} LIMIT $16`,
      [q.country, q.q ?? null, q.type ?? null, q.service_kind ?? null, q.category_id ?? null, q.commodity_id ?? null, q.region_id ?? null, q.min_price ?? null, q.max_price ?? null,
        near, q.lat ?? null, q.lng ?? null, c?.k ?? null, c?.id ?? null, viewer?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: await Promise.all(page.map((l) => this.listingDto(l, viewer?.id))), nextCursor: rows.length > q.limit && last ? cursor.encode({ k: last.k, id: last.id }) : null };
  }

  async mine(user: AuthUser, q: { status?: string; cursor?: string; limit: number }) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<ListingRow>(
      `SELECT ${LISTING_COLS} FROM listings l JOIN seller_profiles sp ON sp.user_id = l.seller_id
       WHERE l.seller_id = $1 AND ($2::text IS NULL OR l.status = $2) AND ($3::timestamptz IS NULL OR (l.created_at, l.id) < ($3, $4::uuid))
       ORDER BY l.created_at DESC, l.id DESC LIMIT $5`, [user.id, q.status ?? null, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: await Promise.all(page.map((l) => this.listingDto(l, user.id))), nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null };
  }

  async addPhoto(user: AuthUser, id: string, file: Express.Multer.File | undefined) {
    const l = await this.load(id);
    if (!l || l.seller_id !== user.id) throw AppError.notFound("listing");
    const used = (await this.sql.many<{ position: number }>(`SELECT position FROM listing_photos WHERE listing_id = $1`, [id])).map((r) => r.position);
    const position = [0, 1, 2, 3, 4].find((p) => !used.includes(p));
    if (position === undefined) throw AppError.unprocessable("photo_limit", "A listing can have up to 5 photos");
    const img = await this.media.processImage(file, `listings/${id}`);
    const r = await this.sql.one<{ id: string }>(`INSERT INTO listing_photos (listing_id, position, variants, width, height, sha256) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [id, position, img.variants, img.width, img.height, img.sha256]);
    return { id: r!.id, position, width: img.width, height: img.height, urls: this.media.urls(img.variants) };
  }

  async deletePhoto(user: AuthUser, id: string, photoId: string) {
    const p = await this.sql.one<{ variants: Record<string, string> }>(
      `DELETE FROM listing_photos p USING listings l WHERE p.id = $2 AND p.listing_id = $1 AND l.id = p.listing_id AND l.seller_id = $3 RETURNING p.variants`, [id, photoId, user.id]);
    if (!p) throw AppError.notFound("photo");
    await this.media.removeVariants(p.variants);
  }

  // ── favourites ──
  async favourite(user: AuthUser, id: string, on: boolean) {
    if (on) {
      const l = await this.load(id);
      if (!l) throw AppError.notFound("listing");
      const n = await this.sql.exec(`INSERT INTO favourites (user_id, listing_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [user.id, id]);
      if (n) await this.event("favourite", l, user.id);
    } else await this.sql.exec(`DELETE FROM favourites WHERE user_id = $1 AND listing_id = $2`, [user.id, id]);
  }

  async favourites(user: AuthUser, q: { cursor?: string; limit: number }) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<ListingRow & { fav_at: Date }>(
      `SELECT ${LISTING_COLS}, true AS fav, f.created_at AS fav_at FROM favourites f JOIN listings l ON l.id = f.listing_id JOIN seller_profiles sp ON sp.user_id = l.seller_id
       WHERE f.user_id = $1 AND l.status <> 'removed' AND ($2::timestamptz IS NULL OR (f.created_at, l.id) < ($2, $3::uuid))
       ORDER BY f.created_at DESC, l.id DESC LIMIT $4`, [user.id, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: await Promise.all(page.map((l) => this.listingDto(l, user.id))), nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.fav_at.toISOString(), id: last.id }) : null };
  }

  // ── offers ──
  private offerDto(o: Record<string, any>) {
    return { id: o.id, listingId: o.listing_id, buyerId: o.buyer_id, sellerId: o.seller_id, fromUserId: o.from_user_id, parentId: o.parent_id,
      quantity: o.quantity, pricePerUnit: o.price_per_unit, status: o.status, expiresAt: o.expires_at.toISOString(), createdAt: o.created_at.toISOString() };
  }

  async createOffer(user: AuthUser, listingId: string, d: { quantity: string; pricePerUnit: string }) {
    const l = await this.load(listingId);
    if (!l || !["active", "low_stock"].includes(l.status)) throw AppError.notFound("listing");
    if (l.seller_id === user.id) throw AppError.unprocessable("own_listing", "You can't make an offer on your own listing");
    if (new Decimal(d.quantity).gt(l.quantity) || new Decimal(d.quantity).lt(l.min_order_qty)) throw AppError.unprocessable("quantity_invalid", `Offer between ${l.min_order_qty} and ${l.quantity} ${l.unit_code}`);
    if (await this.blocked(user.id, l.seller_id)) throw AppError.forbidden("blocked");
    const o = await this.sql.one(
      `INSERT INTO offers (listing_id, buyer_id, seller_id, from_user_id, quantity, price_per_unit, expires_at) VALUES ($1,$2,$3,$2,$4,$5, now() + make_interval(hours => $6)) RETURNING *`,
      [listingId, user.id, l.seller_id, d.quantity, d.pricePerUnit, OFFER_TTL_HOURS]);
    await this.event("offer", l, user.id);
    await this.queue.dispatch({ userId: l.seller_id, category: "market_update", templateKey: "offer.new", params: { title: "New offer", body: `New offer on "${l.title}": ${l.currency} ${d.pricePerUnit}/${l.unit_code}` },
      data: { offerId: o!.id, listingId }, dedupeKey: `offer:${o!.id}` });
    return this.offerDto(o!);
  }

  async offers(user: AuthUser, role: "buyer" | "seller", status?: string) {
    const rows = await this.sql.many(`SELECT * FROM offers WHERE ${role === "seller" ? "seller_id" : "buyer_id"} = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC LIMIT 100`, [user.id, status ?? null]);
    return rows.map((o) => this.offerDto(o));
  }

  async respondOffer(user: AuthUser, id: string, d: { action: "accept" | "reject" | "counter" | "withdraw"; pricePerUnit?: string; quantity?: string }) {
    return this.sql.tx(async (c) => {
      const o = (await c.query(`SELECT * FROM offers WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!o || (o.buyer_id !== user.id && o.seller_id !== user.id)) throw AppError.notFound("offer");
      if (o.status !== "open" || o.expires_at <= new Date()) throw AppError.conflict("offer_closed", "This offer is no longer open");
      const isRecipient = o.from_user_id !== user.id;
      if (d.action === "withdraw") {
        if (isRecipient) throw AppError.forbidden("not_offer_author");
        await c.query(`UPDATE offers SET status = 'withdrawn' WHERE id = $1`, [id]);
        return this.offerDto({ ...o, status: "withdrawn" });
      }
      if (!isRecipient) throw AppError.forbidden("cannot_respond_to_own_offer");
      if (d.action === "accept" || d.action === "reject") {
        const status = d.action === "accept" ? "accepted" : "rejected";
        await c.query(`UPDATE offers SET status = $2, expires_at = CASE WHEN $2 = 'accepted' THEN now() + interval '48 hours' ELSE expires_at END WHERE id = $1`, [id, status]);
        if (status === "accepted") {
          // Put the agreed deal straight in the buyer's cart.
          await c.query(`INSERT INTO cart_items (user_id, listing_id, quantity, offer_id) VALUES ($1,$2,$3,$4)
                         ON CONFLICT (user_id, listing_id) DO UPDATE SET quantity = EXCLUDED.quantity, offer_id = EXCLUDED.offer_id`, [o.buyer_id, o.listing_id, o.quantity, id]);
        }
        await this.queue.dispatch({ userId: o.from_user_id, category: "market_update", templateKey: "offer.update", params: { title: `Offer ${status}`, body: `Your offer was ${status}.` }, data: { offerId: id }, dedupeKey: `offer_resp:${id}` });
        return this.offerDto({ ...o, status });
      }
      if (!d.pricePerUnit) throw AppError.unprocessable("price_required", "A counter-offer needs a price");
      await c.query(`UPDATE offers SET status = 'countered' WHERE id = $1`, [id]);
      const counter = (await c.query(
        `INSERT INTO offers (listing_id, buyer_id, seller_id, parent_id, from_user_id, quantity, price_per_unit, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '48 hours') RETURNING *`,
        [o.listing_id, o.buyer_id, o.seller_id, id, user.id, d.quantity ?? o.quantity, d.pricePerUnit])).rows[0];
      await this.queue.dispatch({ userId: o.from_user_id, category: "market_update", templateKey: "offer.update", params: { title: "Counter-offer", body: `You received a counter-offer: ${d.pricePerUnit} per unit.` }, data: { offerId: counter.id }, dedupeKey: `offer:${counter.id}` });
      return this.offerDto(counter);
    });
  }

  // ── cart ──
  async cart(user: AuthUser) {
    const rows = await this.sql.many<{ listing_id: string; quantity: string; offer_id: string | null; title: string; status: string; stock: string; price_per_unit: string; offer_price: string | null;
      currency: string; unit_code: string; seller_id: string; display_name: string; delivery_settings: DeliverySettings; min_order_qty: string }>(
      `SELECT ci.listing_id, ci.quantity::text, ci.offer_id, l.title, l.status, l.quantity::text AS stock, l.price_per_unit::text, o.price_per_unit::text AS offer_price,
              l.currency, l.unit_code, l.seller_id, sp.display_name, sp.delivery_settings, l.min_order_qty::text
       FROM cart_items ci JOIN listings l ON l.id = ci.listing_id JOIN seller_profiles sp ON sp.user_id = l.seller_id
       LEFT JOIN offers o ON o.id = ci.offer_id AND o.status = 'accepted' AND o.expires_at > now()
       WHERE ci.user_id = $1 ORDER BY ci.added_at`, [user.id]);
    const problems: { listingId: string; code: string }[] = [];
    const groups = new Map<string, any>();
    for (const r of rows) {
      if (!["active", "low_stock"].includes(r.status)) problems.push({ listingId: r.listing_id, code: "unavailable" });
      else if (new Decimal(r.quantity).gt(r.stock)) problems.push({ listingId: r.listing_id, code: "insufficient_stock" });
      if (r.offer_id && !r.offer_price) problems.push({ listingId: r.listing_id, code: "offer_expired" });
      const price = r.offer_price ?? r.price_per_unit;
      const line = new Decimal(r.quantity).mul(price).toDecimalPlaces(2);
      const key = `${r.seller_id}|${r.currency}`;
      const g = groups.get(key) ?? { sellerId: r.seller_id, sellerName: r.display_name, currency: r.currency, subtotal: new Decimal(0), settings: r.delivery_settings, items: [] };
      g.subtotal = g.subtotal.plus(line);
      g.items.push({ listingId: r.listing_id, title: r.title, quantity: r.quantity, unit: r.unit_code, pricePerUnit: price, lineTotal: line.toFixed(2), offerId: r.offer_price ? r.offer_id : null });
      groups.set(key, g);
    }
    return {
      groups: [...groups.values()].map((g) => ({
        sellerId: g.sellerId, sellerName: g.sellerName, currency: g.currency, subtotal: g.subtotal.toFixed(2), items: g.items,
        deliveryOptions: (["pickup", "standard", "express"] as const).map((o) => ({ option: o, ...deliveryFee(g.settings, o, g.subtotal.toFixed(2)) }))
          .filter((x): x is { option: "pickup" | "standard" | "express"; ok: true; fee: string; days: number } => x.ok).map(({ option, fee, days }) => ({ option, fee, days })),
      })),
      problems,
    };
  }

  async upsertCart(user: AuthUser, d: { listingId: string; quantity: string; offerId?: string }) {
    const l = await this.load(d.listingId);
    if (!l || !["active", "low_stock"].includes(l.status)) throw AppError.notFound("listing");
    if (l.seller_id === user.id) throw AppError.unprocessable("own_listing", "You can't buy your own listing");
    if (new Decimal(d.quantity).lt(l.min_order_qty)) throw AppError.unprocessable("below_min_order", `Minimum order is ${l.min_order_qty} ${l.unit_code}`);
    if (new Decimal(d.quantity).gt(l.quantity)) throw AppError.unprocessable("insufficient_stock", `Only ${l.quantity} ${l.unit_code} left`);
    if (d.offerId && !(await this.sql.one(`SELECT 1 FROM offers WHERE id = $1 AND buyer_id = $2 AND listing_id = $3 AND status = 'accepted'`, [d.offerId, user.id, d.listingId])))
      throw AppError.unprocessable("offer_invalid", "That offer can't be used");
    await this.sql.exec(`INSERT INTO cart_items (user_id, listing_id, quantity, offer_id) VALUES ($1,$2,$3,$4)
                         ON CONFLICT (user_id, listing_id) DO UPDATE SET quantity = EXCLUDED.quantity, offer_id = EXCLUDED.offer_id`, [user.id, d.listingId, d.quantity, d.offerId ?? null]);
    return this.cart(user);
  }

  async removeCart(user: AuthUser, listingId: string) {
    await this.sql.exec(`DELETE FROM cart_items WHERE user_id = $1 AND listing_id = $2`, [user.id, listingId]);
    return this.cart(user);
  }

  async sellerReviews(sellerId: string, q: { cursor?: string; limit: number }) {
    const c = cursor.decode<{ t: string; id: string }>(q.cursor);
    const rows = await this.sql.many<{ id: string; rating: number; comment: string | null; created_at: Date; reviewer: string | null }>(
      `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name AS reviewer FROM reviews r JOIN users u ON u.id = r.reviewer_id
       WHERE r.seller_id = $1 AND ($2::timestamptz IS NULL OR (r.created_at, r.id) < ($2, $3::uuid)) ORDER BY r.created_at DESC, r.id DESC LIMIT $4`,
      [sellerId, c?.t ?? null, c?.id ?? null, q.limit + 1]);
    const page = rows.slice(0, q.limit); const last = page[page.length - 1];
    return { data: page.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, reviewer: r.reviewer?.split(" ")[0] ?? null, createdAt: r.created_at.toISOString() })),
      nextCursor: rows.length > q.limit && last ? cursor.encode({ t: last.created_at.toISOString(), id: last.id }) : null };
  }

  async blocked(a: string, b: string) {
    return Boolean(await this.sql.one(`SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`, [a, b]));
  }
}

function validateDelivery(s: DeliverySettings) {
  for (const k of ["standard", "express"] as const) {
    const o = s[k];
    if (o?.enabled && (!/^\d{1,8}(\.\d{1,2})?$/.test(String(o.fee)) || !(o.days >= 0 && o.days <= 60))) throw AppError.unprocessable("delivery_settings_invalid", `Invalid ${k} delivery settings`);
  }
}
