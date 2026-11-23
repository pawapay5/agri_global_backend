import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

export const PRICE_TYPES = ["retail", "wholesale", "farm_gate"] as const;
export const upperIso = ({ value }: { value: unknown }) => (typeof value === "string" ? value.toUpperCase() : value);
const toBool = ({ value }: { value: unknown }) => (value === "true" ? true : value === "false" ? false : value);

/** Common query params (?currency, ?unit) are read by @Display(); they're declared so whitelisting accepts them. */
export class DisplayQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) unit?: string;
}

export class PagedQuery extends DisplayQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) cursor?: string;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
}

export class CountriesQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() active?: boolean;
}

export class RegionsQuery {
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parent_id?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) level?: number;
}

export class RegionsGeoJsonQuery {
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) level: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(0.1) simplify: number = 0.005;
}

export class ChoroplethQuery extends DisplayQuery {
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @IsUUID() commodity_id: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) level: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days: number = 30;
}

export class MarketsQuery extends PagedQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() region_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(["retail", "wholesale", "farm_gate", "rural_periodic", "urban_daily", "border", "export_hub"]) type?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class NearbyQuery extends DisplayQuery {
  @Type(() => Number) @IsLatitude() lat: number;
  @Type(() => Number) @IsLongitude() lng: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0.1) @Max(500) radius_km: number = 50;
  @ApiPropertyOptional() @IsOptional() @IsUUID() commodity_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 20;
}

export class MarketsGeoJsonQuery {
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() commodity_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
}
