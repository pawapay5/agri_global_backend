import { Injectable } from "@nestjs/common";
import { Sql } from "../../common/db/database.module";
import { StorageService } from "../../common/storage/storage.service";

export interface MarketRow {
  id: string; country_iso2: string; region_id: string | null; region_name: Record<string, string> | null; code: string;
  name: Record<string, string>; type: string; lat: number; lng: number; operating_days: number[]; photo_key: string | null; active: boolean;
}

export const MARKET_COLS = `
  m.id, m.country_iso2, m.region_id, r.name AS region_name, m.code, m.name, m.type,
  ST_Y(m.location::geometry) AS lat, ST_X(m.location::geometry) AS lng, m.operating_days, m.photo_key, m.active`;

@Injectable()
export class GeoRepository {
  constructor(private readonly sql: Sql, private readonly storage: StorageService) {}

  toMarket(r: MarketRow) {
    return {
      id: r.id, country: r.country_iso2, code: r.code, regionId: r.region_id, regionName: r.region_name ?? undefined, name: r.name, type: r.type,
      location: { lat: r.lat, lng: r.lng }, operatingDays: r.operating_days ?? [],
      photoUrl: this.storage.publicUrl(this.storage.cfg.s3.imagesBucket, r.photo_key), active: r.active,
    };
  }

  async market(id: string) {
    return this.sql.one<MarketRow>(`SELECT ${MARKET_COLS} FROM markets m LEFT JOIN regions r ON r.id = m.region_id WHERE m.id = $1`, [id]);
  }

  async marketsWithin(lat: number, lng: number, radiusKm: number, limit: number, country?: string) {
    return this.sql.many<MarketRow & { distance_km: number }>(
      `SELECT ${MARKET_COLS}, ST_Distance(m.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 AS distance_km
       FROM markets m LEFT JOIN regions r ON r.id = m.region_id
       WHERE m.active AND ST_DWithin(m.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3 * 1000)
         AND ($5::char(2) IS NULL OR m.country_iso2 = $5)
       ORDER BY m.location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
       LIMIT $4`, [lat, lng, radiusKm, limit, country ?? null]);
  }
}
