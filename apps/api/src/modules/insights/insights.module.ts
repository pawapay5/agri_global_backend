import { Controller, Get, Module, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";
import { AuthUser, CurrentUser, OptionalUser, Public } from "../../common/auth/auth.common";
import { Display, DisplayHints } from "../../common/money/money.service";
import { ForecastsModule } from "../forecasts/forecasts.module";
import { DisplayQuery, PRICE_TYPES, upperIso } from "../geo/geo.dto";
import { GeoModule } from "../geo/geo.module";
import { PricesModule } from "../prices/prices.module";
import { InsightsService } from "./insights.service";

const csv = ({ value }: { value: unknown }) => (typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : value);

class SeasonalQuery extends DisplayQuery {
  @IsUUID() commodity_id: string;
  @ApiPropertyOptional() @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() region_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() market_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
}
class RecQuery extends DisplayQuery {
  @IsUUID() commodity_id: string;
  @IsUUID() market_id: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
}
class AltQuery extends RecQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(1000) radius_km: number = 200;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) transport_cost_per_kg_km?: number;
}
class PlantingQuery {
  @IsUUID() region_id: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
}
class WeatherQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() location_id?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @Transform(csv) @ArrayMaxSize(10) @IsUUID("all", { each: true }) commodity_ids?: string[];
}
class ExportQuery {
  @IsUUID() commodity_id: string;
  @ApiPropertyOptional() @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(upperIso) @IsString() @MaxLength(8) destination?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
}

@ApiTags("insights")
@ApiBearerAuth()
@Controller("v1/insights")
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Public() @Get("seasonal") @ApiOperation({ operationId: "insights_seasonal" })
  seasonal(@Query() q: SeasonalQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) { return this.insights.seasonal(q, d, u); }

  @Get("recommendations") @ApiOperation({ operationId: "insights_recommendations" })
  recommendations(@Query() q: RecQuery, @Display() d: DisplayHints, @CurrentUser() u: AuthUser) { return this.insights.recommendations(q, d, u); }

  @Get("alternative-markets") @ApiOperation({ operationId: "insights_alternative_markets" })
  alternatives(@Query() q: AltQuery, @Display() d: DisplayHints, @CurrentUser() u: AuthUser) { return this.insights.alternativeMarkets(q, d, u); }

  @Get("planting") @ApiOperation({ operationId: "insights_planting" })
  planting(@Query() q: PlantingQuery, @CurrentUser() u: AuthUser) { return this.insights.planting(q, u); }

  @Get("weather") @ApiOperation({ operationId: "insights_weather" })
  weather(@Query() q: WeatherQuery, @CurrentUser() u: AuthUser) { return this.insights.weather(q, u); }

  @Get("export") @ApiOperation({ operationId: "insights_export" })
  exportInsights(@Query() q: ExportQuery, @Display() d: DisplayHints, @CurrentUser() u: AuthUser) { return this.insights.exportInsights(q, d, u); }
}

@Module({ imports: [PricesModule, ForecastsModule, GeoModule], controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}
