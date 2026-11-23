import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthUser, CurrentUser, OptionalUser, Public, Roles } from "../../common/auth/auth.common";
import { AppError } from "../../common/http/problem";
import { Client, ClientMeta } from "../../common/http/request-context";
import { Display, DisplayHints } from "../../common/money/money.service";
import { PriceIngestService } from "./ingest.service";
import {
  CompareQuery, CountryRequired, HistoryQuery, ImportDto, LatestQuery, PriceSubmissionDto, RegionalQuery, ReviewDecisionDto, ReviewQueueQuery, TrendingQuery,
} from "./prices.dto";
import { PricesService } from "./prices.service";

@ApiTags("prices")
@ApiBearerAuth()
@Controller("v1")
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Post("prices/submissions")
  @ApiOperation({ operationId: "prices_submit" }) @ApiHeader({ name: "Idempotency-Key", required: false })
  submit(@Body() dto: PriceSubmissionDto, @CurrentUser() u: AuthUser, @Headers("idempotency-key") key: string | undefined, @Display() d: DisplayHints, @Client() c: ClientMeta) {
    if (key && !/^[\w-]{8,128}$/.test(key)) throw AppError.badRequest("idempotency_key_invalid");
    return this.prices.submit(dto, u, key, d, c);
  }

  @Public() @Get("prices/latest") @ApiOperation({ operationId: "prices_latest" })
  latest(@Query() q: LatestQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) { return this.prices.latest(q, d, u); }

  @Public() @Get("prices/history") @ApiOperation({ operationId: "prices_history" })
  history(@Query() q: HistoryQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) { return this.prices.history(q, d, u); }

  @Public() @Get("prices/compare") @ApiOperation({ operationId: "prices_compare" })
  compare(@Query() q: CompareQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) { return this.prices.compare(q, d, u); }

  @Public() @Get("prices/regional-averages") @ApiOperation({ operationId: "prices_regional_averages" })
  regional(@Query() q: RegionalQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) { return this.prices.regionalAverages(q, d, u); }

  @Public() @Get("prices/trending") @ApiOperation({ operationId: "prices_trending" })
  trending(@Query() q: TrendingQuery, @Display() d: DisplayHints, @OptionalUser() u: AuthUser | null) { return this.prices.trending(q, d, u); }

  @Public() @Get("dashboard/snapshot") @ApiOperation({ operationId: "prices_dashboard_snapshot" })
  snapshot(@Query() q: CountryRequired) { return this.prices.snapshot(q.country); }
}

@ApiTags("admin-prices")
@ApiBearerAuth()
@Roles("admin", "org_admin", "enumerator")
@Controller("v1/admin/prices")
export class AdminPricesController {
  constructor(private readonly prices: PricesService, private readonly ingest: PriceIngestService) {}

  @Post("import") @HttpCode(202)
  @ApiOperation({ operationId: "admin_prices_import" }) @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  import(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: ImportDto, @CurrentUser() u: AuthUser, @Client() c: ClientMeta) {
    if (!file) throw AppError.unprocessable("file_required", "Attach a CSV file in the 'file' field");
    if (!/csv|text\/plain|application\/vnd\.ms-excel/.test(file.mimetype) && !file.originalname.toLowerCase().endsWith(".csv"))
      throw AppError.unprocessable("file_type", "Only CSV files are accepted");
    return this.ingest.importCsv(file.buffer, file.originalname, dto.country, dto.source_id, dto.dry_run, u, c);
  }

  @Roles("admin", "org_admin") @Get("review-queue") @ApiOperation({ operationId: "admin_prices_review_queue" })
  queue(@Query() q: ReviewQueueQuery, @CurrentUser() u: AuthUser, @Display() d: DisplayHints) { return this.prices.reviewQueue(q, u, d); }

  @Roles("admin", "org_admin") @Post(":id/review") @HttpCode(200) @ApiOperation({ operationId: "admin_prices_review" })
  review(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ReviewDecisionDto, @CurrentUser() u: AuthUser, @Display() d: DisplayHints, @Client() c: ClientMeta) {
    return this.prices.review(id, dto.action, dto.reason, u, d, c);
  }
}
