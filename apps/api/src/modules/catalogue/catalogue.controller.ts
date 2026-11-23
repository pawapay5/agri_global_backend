import { Controller, Get, Module, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiOperation, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from "class-validator";
import { Public } from "../../common/auth/auth.common";
import { GeoModule } from "../geo/geo.module";
import { PagedQuery, upperIso } from "../geo/geo.dto";
import { CatalogueService } from "./catalogue.service";

class CountryOpt { @ApiPropertyOptional() @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string }
class CommoditiesQuery extends PagedQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() category_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
}
class UnitsQuery extends CountryOpt { @ApiPropertyOptional() @IsOptional() @IsUUID() commodity_id?: string }
class SearchQuery extends CountryOpt {
  @IsString() @Length(1, 100) q: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit: number = 10;
}

@ApiTags("catalogue")
@Public()
@Controller("v1")
export class CatalogueController {
  constructor(private readonly cat: CatalogueService) {}

  @Get("commodity-categories") @ApiOperation({ operationId: "catalogue_categories_list" })
  categories() { return this.cat.categories(); }

  @Get("commodities") @ApiOperation({ operationId: "catalogue_commodities_list" })
  commodities(@Query() q: CommoditiesQuery) { return this.cat.commodities(q); }

  @Get("commodities/:id") @ApiOperation({ operationId: "catalogue_commodities_get" })
  commodity(@Param("id", ParseUUIDPipe) id: string, @Query() q: CountryOpt) { return this.cat.commodity(id, q.country); }

  @Get("commodities/:id/varieties") @ApiOperation({ operationId: "catalogue_varieties_list" })
  varieties(@Param("id", ParseUUIDPipe) id: string) { return this.cat.varieties(id); }

  @Get("units") @ApiOperation({ operationId: "catalogue_units_list" })
  units(@Query() q: UnitsQuery) { return this.cat.units(q); }

  @Get("search") @ApiOperation({ operationId: "catalogue_search" })
  search(@Query() q: SearchQuery) { return this.cat.search(q.q, q.country, q.limit); }
}

@Module({ imports: [GeoModule], controllers: [CatalogueController], providers: [CatalogueService], exports: [CatalogueService] })
export class CatalogueModule {}
