import { Controller, Get, Module, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiOperation, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsOptional, IsUUID } from "class-validator";
import { AuthUser, OptionalUser, Public } from "../../common/auth/auth.common";
import { Display, DisplayHints, MoneyService } from "../../common/money/money.service";
import { DisplayQuery, PRICE_TYPES } from "../geo/geo.dto";
import { PricesModule } from "../prices/prices.module";
import { ForecastsService } from "./forecasts.service";

class ForecastQuery extends DisplayQuery {
  @IsUUID() commodity_id: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() market_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() region_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(PRICE_TYPES) price_type: string = "wholesale";
}
class ExplanationQuery {
  @ApiPropertyOptional({ enum: [1, 3, 6] }) @IsOptional() @Type(() => Number) @IsIn([1, 3, 6]) horizon_months: number = 1;
}

@ApiTags("forecasts")
@Public()
@Controller("v1/forecasts")
export class ForecastsController {
  constructor(private readonly forecasts: ForecastsService, private readonly money: MoneyService) {}

  @Get() @ApiOperation({ operationId: "forecasts_get" })
  get(@Query() q: ForecastQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) { return this.forecasts.get(q, d, u); }

  @Get(":id/explanation") @ApiOperation({ operationId: "forecasts_explanation" })
  async explanation(@Param("id", ParseUUIDPipe) id: string, @Query() q: ExplanationQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) {
    const ctx = await this.money.resolveDisplay(d, u);
    return this.forecasts.explanation(id, q.horizon_months, ctx.locale);
  }
}

@Module({ imports: [PricesModule], controllers: [ForecastsController], providers: [ForecastsService], exports: [ForecastsService] })
export class ForecastsModule {}
