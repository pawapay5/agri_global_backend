import { Module } from "@nestjs/common";
import { GeoModule } from "../geo/geo.module";
import { PriceIngestService } from "./ingest.service";
import { AdminPricesController, PricesController } from "./prices.controller";
import { PricesService } from "./prices.service";

@Module({
  imports: [GeoModule],
  controllers: [PricesController, AdminPricesController],
  providers: [PricesService, PriceIngestService],
  exports: [PricesService, PriceIngestService],
})
export class PricesModule {}
