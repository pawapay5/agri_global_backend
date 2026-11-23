import { Body, Controller, Delete, Get, Headers, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from "class-validator";
import { AuthUser, CurrentUser, OptionalUser, Public } from "../../common/auth/auth.common";
import { Req } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { AuditService } from "../../common/audit/audit.service";
import { Sql } from "../../common/db/database.module";
import { AppError } from "../../common/http/problem";
import { RawRequest, verifyWebhook } from "../../common/http/webhooks";
import { PagedQuery, upperIso } from "../geo/geo.dto";
import { GeoPointDto } from "../users/users.dto";
import { MarketplaceService } from "./marketplace.service";
import { OrdersService } from "./orders.service";

const DEC = /^\d{1,12}(\.\d{1,4})?$/;
const LISTING_STATUSES = ["draft", "active", "low_stock", "sold_out", "removed"];
const MAX_IMG = { limits: { fileSize: 10 * 1024 * 1024, files: 1 } };

class SellerDto {
  @ApiProperty() @IsString() @Length(2, 80) displayName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) bio?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() regionId?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => GeoPointDto) location?: GeoPointDto;
  @ApiPropertyOptional() @IsOptional() @IsObject() deliverySettings?: Record<string, any>;
}
class KycDto {
  @IsIn(["national_id", "passport", "voter_id", "drivers_licence"]) idType: string;
  @IsString() @MaxLength(40) idNumber: string;
}
class ListingCreateDto {
  @IsIn(["product", "service"]) type: "product" | "service";
  @IsOptional() @IsIn(["transport", "storage", "input_supply"]) serviceKind?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() commodityId?: string;
  @IsString() @Length(3, 120) title: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @Matches(DEC) pricePerUnit: string;
  @Matches(/^[A-Z]{3}$/) currency: string;
  @IsString() @MaxLength(32) unit: string;
  @Matches(DEC) quantity: string;
  @IsOptional() @Matches(DEC) minOrderQty?: string;
  @IsOptional() @Matches(DEC) lowStockThreshold?: string;
  @IsOptional() @IsIn(["A", "B", "C", "ungraded"]) qualityGrade?: string;
  @IsOptional() @IsDateString() harvestDate?: string;
  @IsOptional() @IsUUID() regionId?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoPointDto) location?: GeoPointDto;
}
class ListingUpdateDto {
  @IsOptional() @IsString() @Length(3, 120) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @Matches(DEC) pricePerUnit?: string;
  @IsOptional() @Matches(DEC) quantity?: string;
  @IsOptional() @Matches(DEC) minOrderQty?: string;
  @IsOptional() @Matches(DEC) lowStockThreshold?: string;
  @IsOptional() @IsIn(["A", "B", "C", "ungraded"]) qualityGrade?: string;
  @IsOptional() @IsDateString() harvestDate?: string;
  @IsOptional() @IsIn(["draft", "active", "removed"]) status?: string;
}
class SearchQuery extends PagedQuery {
  @Transform(upperIso) @Matches(/^[A-Z]{2}$/) country: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(["product", "service"]) type?: string;
  @IsOptional() @IsIn(["transport", "storage", "input_supply"]) service_kind?: string;
  @IsOptional() @IsUUID() category_id?: string;
  @IsOptional() @IsUUID() commodity_id?: string;
  @IsOptional() @IsUUID() region_id?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) min_price?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) max_price?: number;
  @IsOptional() @IsIn(["recent", "lowest", "highest", "nearest"]) sort: string = "recent";
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}
class MineQuery extends PagedQuery { @IsOptional() @IsIn(LISTING_STATUSES) status?: string }
class OfferDto { @Matches(DEC) quantity: string; @Matches(DEC) pricePerUnit: string }
class OfferRespondDto {
  @IsIn(["accept", "reject", "counter", "withdraw"]) action: "accept" | "reject" | "counter" | "withdraw";
  @IsOptional() @Matches(DEC) pricePerUnit?: string;
  @IsOptional() @Matches(DEC) quantity?: string;
}
class OffersQuery {
  @IsOptional() @IsIn(["buyer", "seller"]) role: "buyer" | "seller" = "buyer";
  @IsOptional() @IsIn(["open", "accepted", "rejected", "countered", "expired", "withdrawn", "used"]) status?: string;
}
class CartItemDto { @IsUUID() listingId: string; @Matches(DEC) quantity: string; @IsOptional() @IsUUID() offerId?: string }
class DeliveryChoice { @IsUUID() sellerId: string; @IsIn(["pickup", "standard", "express"]) option: "pickup" | "standard" | "express" }
class CheckoutDto {
  @IsIn(["momo", "card", "pay_on_delivery"]) paymentMethod: "momo" | "card" | "pay_on_delivery";
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DeliveryChoice) delivery: DeliveryChoice[];
  @IsOptional() @IsObject() address?: Record<string, unknown>;
}
class OrdersQuery extends PagedQuery {
  @IsOptional() @IsIn(["buyer", "seller"]) role: "buyer" | "seller" = "buyer";
  @IsOptional() @IsIn(["pending_payment", "paid_in_escrow", "accepted", "in_transit", "delivered", "completed", "cancelled", "disputed", "refunded"]) status?: string;
}
class TransitionDto {
  @IsIn(["accept", "ship", "deliver", "confirm", "collect_cash", "cancel", "dispute"]) action: "accept" | "ship" | "deliver" | "confirm" | "collect_cash" | "cancel" | "dispute";
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
  @IsOptional() @IsIn(["not_received", "not_as_described", "damaged", "wrong_quantity", "other"]) disputeReason?: string;
  @IsOptional() @IsInt() expectedVersion?: number;
}
class ReviewDto { @IsInt() @Min(1) @Max(5) rating: number; @IsOptional() @IsString() @MaxLength(2000) comment?: string }

@ApiTags("marketplace")
@ApiBearerAuth()
@Controller("v1/marketplace")
export class MarketplaceController {
  constructor(private readonly m: MarketplaceService, private readonly orders: OrdersService) {}

  @Get("seller-profile") @ApiOperation({ operationId: "market_seller_me_get" })
  mySeller(@CurrentUser() u: AuthUser) { return this.m.mySeller(u); }

  @Put("seller-profile") @ApiOperation({ operationId: "market_seller_me_put" })
  putSeller(@CurrentUser() u: AuthUser, @Body() d: SellerDto) { return this.m.putSeller(u, d as never); }

  @Post("seller-profile/kyc") @HttpCode(202) @ApiOperation({ operationId: "market_seller_kyc" }) @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("selfie", MAX_IMG))
  kyc(@CurrentUser() u: AuthUser, @Body() d: KycDto, @UploadedFile() f?: Express.Multer.File) { return this.m.submitKyc(u, d, f); }

  @Public() @Get("sellers/:id") @ApiOperation({ operationId: "market_seller_get" })
  seller(@Param("id", ParseUUIDPipe) id: string) { return this.m.seller(id); }

  @Public() @Get("sellers/:id/reviews") @ApiOperation({ operationId: "market_seller_reviews" })
  reviews(@Param("id", ParseUUIDPipe) id: string, @Query() q: PagedQuery) { return this.m.sellerReviews(id, q); }

  @Public() @Get("listings") @ApiOperation({ operationId: "market_listings_search" })
  search(@Query() q: SearchQuery, @OptionalUser() u: AuthUser | null) { return this.m.search(q, u); }

  @Post("listings") @ApiOperation({ operationId: "market_listings_create" })
  create(@CurrentUser() u: AuthUser, @Body() d: ListingCreateDto) { return this.m.create(u, d as never); }

  @Get("listings/mine") @ApiOperation({ operationId: "market_listings_mine" })
  mine(@CurrentUser() u: AuthUser, @Query() q: MineQuery) { return this.m.mine(u, q); }

  @Public() @Get("listings/:id") @ApiOperation({ operationId: "market_listings_get" })
  get(@Param("id", ParseUUIDPipe) id: string, @OptionalUser() u: AuthUser | null) { return this.m.get(id, u); }

  @Patch("listings/:id") @ApiOperation({ operationId: "market_listings_update" })
  update(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: ListingUpdateDto) { return this.m.update(u, id, d as never); }

  @Post("listings/:id/photos") @ApiOperation({ operationId: "market_listing_photo_upload" }) @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", MAX_IMG))
  photo(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @UploadedFile() f?: Express.Multer.File) { return this.m.addPhoto(u, id, f); }

  @Delete("listings/:id/photos/:photoId") @HttpCode(204) @ApiOperation({ operationId: "market_listing_photo_delete" })
  async delPhoto(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Param("photoId", ParseUUIDPipe) photoId: string) { await this.m.deletePhoto(u, id, photoId); }

  @Post("listings/:id/favourite") @HttpCode(204) @ApiOperation({ operationId: "market_favourite_add" })
  async fav(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.m.favourite(u, id, true); }

  @Delete("listings/:id/favourite") @HttpCode(204) @ApiOperation({ operationId: "market_favourite_remove" })
  async unfav(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.m.favourite(u, id, false); }

  @Get("favourites") @ApiOperation({ operationId: "market_favourites_list" })
  favourites(@CurrentUser() u: AuthUser, @Query() q: PagedQuery) { return this.m.favourites(u, q); }

  @Post("listings/:id/offers") @ApiOperation({ operationId: "market_offer_create" })
  offer(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: OfferDto) { return this.m.createOffer(u, id, d); }

  @Get("offers") @ApiOperation({ operationId: "market_offers_list" })
  offers(@CurrentUser() u: AuthUser, @Query() q: OffersQuery) { return this.m.offers(u, q.role, q.status); }

  @Post("offers/:id/respond") @HttpCode(200) @ApiOperation({ operationId: "market_offer_respond" })
  respond(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: OfferRespondDto) { return this.m.respondOffer(u, id, d); }

  @Get("cart") @ApiOperation({ operationId: "market_cart_get" })
  cart(@CurrentUser() u: AuthUser) { return this.m.cart(u); }

  @Put("cart/items") @ApiOperation({ operationId: "market_cart_upsert" })
  upsertCart(@CurrentUser() u: AuthUser, @Body() d: CartItemDto) { return this.m.upsertCart(u, d); }

  @Delete("cart/items/:id") @ApiOperation({ operationId: "market_cart_remove" })
  removeCart(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.m.removeCart(u, id); }

  @Post("checkout") @ApiOperation({ operationId: "market_checkout" })
  checkout(@CurrentUser() u: AuthUser, @Body() d: CheckoutDto, @Headers("idempotency-key") key?: string) { return this.orders.checkout(u, d, key?.slice(0, 128)); }

  @Get("orders") @ApiOperation({ operationId: "market_orders_list" })
  ordersList(@CurrentUser() u: AuthUser, @Query() q: OrdersQuery) { return this.orders.list(u, q); }

  @Get("orders/:id") @ApiOperation({ operationId: "market_orders_get" })
  order(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { return this.orders.get(u, id); }

  @Post("orders/:id/transition") @HttpCode(200) @ApiOperation({ operationId: "market_orders_transition" })
  transition(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: TransitionDto) { return this.orders.transitionAs(u, id, d); }

  @Post("orders/:id/review") @ApiOperation({ operationId: "market_orders_review" })
  review(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() d: ReviewDto) { return this.orders.review(u, id, d); }
}

/** KYC provider callback: { reference, status: verified|rejected, reason? } (secret URL token). */
@ApiTags("marketplace")
@Public()
@SkipThrottle()
@Controller("v1/webhooks")
export class KycWebhookController {
  constructor(private readonly sql: Sql, private readonly audit: AuditService) {}

  @Post("kyc") @HttpCode(204) @ApiOperation({ operationId: "kyc_webhook" })
  async kyc(@Req() req: RawRequest) {
    verifyWebhook("kyc", req);
    const b = req.body as { reference?: string; status?: string; reason?: string };
    if (!b.reference || !["verified", "rejected"].includes(String(b.status))) throw AppError.badRequest("payload_invalid");
    const r = await this.sql.one<{ user_id: string }>(
      `UPDATE seller_profiles SET kyc_status = $2, verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE NULL END
       WHERE kyc_provider_ref = $1 AND kyc_status = 'pending' RETURNING user_id`, [b.reference, b.status]);
    if (r) await this.audit.record({ actorId: null, action: `seller.kyc.${b.status}`, entity: "user", entityId: r.user_id, data: { reason: b.reason } });
  }
}

@Module({ controllers: [MarketplaceController, KycWebhookController], providers: [MarketplaceService, OrdersService], exports: [MarketplaceService, OrdersService] })
export class MarketplaceModule {}
