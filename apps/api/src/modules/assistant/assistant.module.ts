import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, StreamableFile, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from "class-validator";
import { AuthUser, CurrentUser } from "../../common/auth/auth.common";
import { CatalogueModule } from "../catalogue/catalogue.controller";
import { ForecastsModule } from "../forecasts/forecasts.module";
import { InsightsModule } from "../insights/insights.module";
import { PricesModule } from "../prices/prices.module";
import { AssistantService, MAX_AUDIO_BYTES, MAX_QUESTION_CHARS } from "./assistant.service";
import { KhayaService } from "./khaya.service";

const LANGS = ["eng", "twi", "fat", "ewe", "gaa", "dag"];
class AskDto {
  @IsIn(LANGS) language: string;
  @IsOptional() @IsString() @MaxLength(MAX_QUESTION_CHARS) text?: string;
  @IsOptional() @IsUUID() conversationId?: string;
}
class TranslateDto {
  @IsString() @Length(1, 2000) text: string;
  @IsIn(LANGS) from: string;
  @IsIn(LANGS) to: string;
}
class HistoryQuery { @IsOptional() @IsUUID() conversationId?: string }

/** Each question costs an AI call and a translation, so requests are also rate-limited per minute (the daily quota is in the service). */
const PER_MINUTE = { default: { limit: 6, ttl: 60_000 } };

@ApiTags("assistant")
@ApiBearerAuth()
@Controller("v1/assistant")
export class AssistantController {
  constructor(private readonly a: AssistantService) {}

  @Get("status") @ApiOperation({ operationId: "assistant_status" })
  status(@CurrentUser() u: AuthUser) { return this.a.status(u); }

  @Get("messages") @ApiOperation({ operationId: "assistant_history" })
  history(@CurrentUser() u: AuthUser, @Query() q: HistoryQuery) { return this.a.history(u, q.conversationId); }

  @Delete("messages") @HttpCode(204) @ApiOperation({ operationId: "assistant_clear" })
  async clear(@CurrentUser() u: AuthUser) { await this.a.clear(u); }

  @Throttle(PER_MINUTE) @Post("messages") @ApiOperation({ operationId: "assistant_ask" }) @ApiConsumes("application/json", "multipart/form-data")
  @UseInterceptors(FileInterceptor("audio", { limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }))
  ask(@CurrentUser() u: AuthUser, @Body() d: AskDto, @UploadedFile() audio?: Express.Multer.File) { return this.a.ask(u, d, audio); }

  @Get("messages/:id/audio") @ApiOperation({ operationId: "assistant_audio" })
  async audio(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    const out = await this.a.audio(u, id);
    return new StreamableFile(out.audio, { type: out.contentType, disposition: "inline", length: out.audio.length });
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Post("translate") @HttpCode(200) @ApiOperation({ operationId: "assistant_translate" })
  translate(@CurrentUser() u: AuthUser, @Body() d: TranslateDto) { return this.a.translate(u, d); }
}

@Module({ imports: [CatalogueModule, PricesModule, ForecastsModule, InsightsModule], controllers: [AssistantController], providers: [AssistantService, KhayaService] })
export class AssistantModule {}
