import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUrl, IsUUID,
  Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from "class-validator";
import { SELF_ASSIGNABLE_ROLES } from "../auth/auth.dto";

export class UserUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) fullName?: string;
  @ApiPropertyOptional({ enum: SELF_ASSIGNABLE_ROLES }) @IsOptional() @IsIn(SELF_ASSIGNABLE_ROLES) role?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUrl({ protocols: ["https"] }) avatarUrl?: string | null;
}

export class FarmingProfileDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID("all", { each: true }) cropIds?: string[];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) farmSize?: number | null;
  @ApiPropertyOptional({ nullable: true, enum: ["ha", "acre", "m2", "plot"] }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(["ha", "acre", "m2", "plot"]) areaUnit?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null)
  @IsIn(["subsistence", "commercial", "mixed", "organic", "irrigated", "rainfed"]) farmingType?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() regionId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) @Max(80) yearsOfExperience?: number | null;
}

export class PreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) locale?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) unit?: string;
  @ApiPropertyOptional({ enum: ["system", "light", "dark"] }) @IsOptional() @IsIn(["system", "light", "dark"]) theme?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() defaultRegionId?: string | null;
  @ApiPropertyOptional({ enum: ["retail", "wholesale", "farm_gate"] }) @IsOptional() @IsIn(["retail", "wholesale", "farm_gate"]) defaultPriceType?: string;
}

export class InterestsDto {
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID("all", { each: true }) commodityIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID("all", { each: true }) marketIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsIn(["prices", "forecasts", "weather", "export", "policy", "research"], { each: true }) topics?: string[];
}

export class GeoPointDto {
  @ApiProperty() @IsLatitude() lat: number;
  @ApiProperty() @IsLongitude() lng: number;
}

export class SavedLocationCreateDto {
  @ApiProperty() @IsString() @Length(1, 80) label: string;
  @ApiProperty({ type: GeoPointDto }) @ValidateNested() @Type(() => GeoPointDto) point: GeoPointDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export const CONSENT_TYPES = ["terms", "privacy", "marketing", "data_sharing_research", "location", "sms_alerts", "whatsapp_alerts"] as const;
class ConsentItemDto {
  @ApiProperty({ enum: CONSENT_TYPES }) @IsIn(CONSENT_TYPES) type: string;
  @ApiProperty() @IsBoolean() granted: boolean;
  @ApiProperty() @IsString() @MaxLength(32) version: string;
}
export class ConsentUpdateDto {
  @ApiProperty({ type: [ConsentItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ConsentItemDto) consents: ConsentItemDto[];
}
