import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from "class-validator";
import { DisplayQuery, PagedQuery, PRICE_TYPES, upperIso } from "../geo/geo.dto";
import { GeoPointDto } from "../users/users.dto";

const DECIMAL = /^\d{1,12}(\.\d{1,4})?$/;
const csv = ({ value }: { value: unknown }) => (typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : value);

export class PriceSubmissionDto {
  @ApiProperty() @IsUUID() commodityId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() varietyId?: string;
  @ApiProperty() @IsUUID() marketId: string;
  @ApiProperty({ enum: PRICE_TYPES }) @IsIn(PRICE_TYPES) priceType: string;
  @ApiProperty() @Matches(DECIMAL, { message: "amount must be a positive decimal string" }) amount: string;
  @ApiProperty() @Matches(/^[A-Z]{3}$/) currency: string;
  @ApiProperty() @IsString() @MaxLength(32) unit: string;
  @ApiPropertyOptional({ enum: ["low", "medium", "high"] }) @IsOptional() @IsIn(["low", "medium", "high"]) quality?: string;
  @ApiProperty() @IsDateString({ strict: true }) observedAt: string;
  @ApiPropertyOptional({ type: GeoPointDto }) @IsOptional() @ValidateNested() @Type(() => GeoPointDto) location?: GeoPointDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class LatestQuery extends DisplayQuery {
  @IsUUID() commodity_id: string;
  @ApiPropertyOptional() @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() region_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
}

export class HistoryQuery extends LatestQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() market_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(["1M", "3M", "6M", "1Y", "ALL"]) range: string = "3M";
  @ApiPropertyOptional() @IsOptional() @IsIn(["day", "week"]) interval: "day" | "week" = "day";
}

export class CompareQuery extends DisplayQuery {
  @IsUUID() commodity_id: string;
  @ApiProperty({ type: [String] }) @Transform(csv) @ArrayMinSize(2) @ArrayMaxSize(10) @IsUUID("all", { each: true }) market_ids: string[];
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
  @ApiPropertyOptional() @IsOptional() @IsIn(["1M", "3M", "6M", "1Y"]) range: string = "1M";
}

export class RegionalQuery extends DisplayQuery {
  @IsUUID() commodity_id: string;
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days: number = 7;
}

export class TrendingQuery extends DisplayQuery {
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
  @ApiPropertyOptional() @IsOptional() @IsIn(["7d", "30d"]) window: "7d" | "30d" = "7d";
  @ApiPropertyOptional() @IsOptional() @IsIn(["up", "down", "both"]) direction: "up" | "down" | "both" = "both";
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit: number = 10;
}

export class CountryRequired { @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string }

export class ImportDto {
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() source_id?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === "true" || value === true) @IsBoolean() dry_run: boolean = false;
}

export class ReviewQueueQuery extends PagedQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(["pending", "flagged"]) status: string = "pending";
}

export class ReviewDecisionDto {
  @ApiProperty({ enum: ["approve", "reject"] }) @IsIn(["approve", "reject"]) action: "approve" | "reject";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
