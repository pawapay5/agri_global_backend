import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthUser, OptionalUser, Public } from "../../common/auth/auth.common";
import { Display, DisplayHints } from "../../common/money/money.service";
import { ChoroplethQuery, CountriesQuery, MarketsGeoJsonQuery, MarketsQuery, NearbyQuery, RegionsGeoJsonQuery, RegionsQuery } from "./geo.dto";
import { GeoService } from "./geo.service";

@ApiTags("geo")
@Public()
@Controller("v1")
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get("countries") @ApiOperation({ operationId: "geo_countries_list" })
  countries(@Query() q: CountriesQuery) { return this.geo.countries(q.active); }

  @Get("countries/:iso2") @ApiOperation({ operationId: "geo_countries_get" })
  country(@Param("iso2") iso2: string) { return this.geo.country(iso2); }

  @Get("regions") @ApiOperation({ operationId: "geo_regions_list" })
  regions(@Query() q: RegionsQuery) { return this.geo.regions(q); }

  @Get("regions/geojson") @Header("Content-Type", "application/geo+json") @Header("Cache-Control", "public, max-age=3600")
  @ApiOperation({ operationId: "geo_regions_geojson" })
  regionsGeoJson(@Query() q: RegionsGeoJsonQuery) { return this.geo.regionsGeoJson(q); }

  @Get("regions/choropleth") @ApiOperation({ operationId: "geo_regions_choropleth" })
  choropleth(@Query() q: ChoroplethQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) { return this.geo.choropleth(q, d, u); }

  @Get("markets") @ApiOperation({ operationId: "geo_markets_list" })
  markets(@Query() q: MarketsQuery) { return this.geo.markets(q); }

  @Get("markets/nearby") @ApiOperation({ operationId: "geo_markets_nearby" })
  nearby(@Query() q: NearbyQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) { return this.geo.nearby(q, d, u); }

  @Get("markets/geojson") @Header("Content-Type", "application/geo+json")
  @ApiOperation({ operationId: "geo_markets_geojson" })
  marketsGeoJson(@Query() q: MarketsGeoJsonQuery) { return this.geo.marketsGeoJson(q); }

  @Get("markets/:id") @ApiOperation({ operationId: "geo_markets_get" })
  market(@Param("id", ParseUUIDPipe) id: string) { return this.geo.market(id); }
}
