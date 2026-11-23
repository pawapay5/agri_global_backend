import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthUser, CurrentUser, OptionalUser, Public } from "../../common/auth/auth.common";
import { AuditService } from "../../common/audit/audit.service";
import { AppError } from "../../common/http/problem";
import { Client, ClientMeta } from "../../common/http/request-context";
import { UsersRepository } from "../users/users.repository";
import {
  ChangePasswordDto, DeviceUpdateDto, ForgotPasswordDto, LoginDto, MfaVerifyDto, OAuthDto, OtpRequestDto, OtpVerifyDto, RefreshDto, RegisterDto,
  ResetPasswordDto, TotpCodeDto,
} from "./auth.dto";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";

const STRICT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags("auth")
@ApiBearerAuth()
@Controller("v1/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  @Public() @Throttle(STRICT) @Post("register")
  @ApiOperation({ operationId: "auth_register" })
  register(@Body() dto: RegisterDto, @Client() c: ClientMeta) { return this.auth.register(dto, c); }

  @Public() @Throttle(STRICT) @Post("login") @HttpCode(200)
  @ApiOperation({ operationId: "auth_login" })
  login(@Body() dto: LoginDto, @Client() c: ClientMeta) { return this.auth.login(dto, c); }

  @Public() @Throttle(STRICT) @Post("otp/request") @HttpCode(202)
  @ApiOperation({ operationId: "auth_otp_request" })
  otpRequest(@Body() dto: OtpRequestDto) { return this.auth.requestOtp(dto); }

  @Public() @Throttle(STRICT) @Post("otp/verify") @HttpCode(200)
  @ApiOperation({ operationId: "auth_otp_verify" })
  otpVerify(@Body() dto: OtpVerifyDto, @Client() c: ClientMeta, @OptionalUser() u: AuthUser | null) { return this.auth.verifyOtp(dto, c, u); }

  @Public() @Throttle(STRICT) @Post("oauth/:provider") @HttpCode(200)
  @ApiOperation({ operationId: "auth_oauth" }) @ApiParam({ name: "provider", enum: ["google", "apple", "facebook"] })
  oauth(@Param("provider") provider: string, @Body() dto: OAuthDto, @Client() c: ClientMeta) {
    if (!["google", "apple", "facebook"].includes(provider)) throw AppError.notFound("provider");
    return this.auth.oauthSignIn(provider, dto, c);
  }

  @Public() @Throttle(STRICT) @Post("mfa/verify") @HttpCode(200)
  @ApiOperation({ operationId: "auth_mfa_verify" })
  mfa(@Body() dto: MfaVerifyDto, @Client() c: ClientMeta) { return this.auth.verifyMfa(dto, c); }

  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @Post("refresh") @HttpCode(200)
  @ApiOperation({ operationId: "auth_refresh" })
  refresh(@Body() dto: RefreshDto, @Client() c: ClientMeta) { return this.sessions.rotate(dto.refreshToken, c, (id) => this.users.byId(id)); }

  @Post("logout") @HttpCode(204)
  @ApiOperation({ operationId: "auth_logout" })
  async logout(@Body() dto: RefreshDto, @CurrentUser() u: AuthUser, @Client() c: ClientMeta) {
    await this.sessions.logout(dto.refreshToken, u.id);
    await this.audit.record({ actorId: u.id, action: "auth.logout" }, c);
  }

  @Post("logout-all") @HttpCode(204)
  @ApiOperation({ operationId: "auth_logout_all" })
  async logoutAll(@CurrentUser() u: AuthUser, @Client() c: ClientMeta) {
    await this.sessions.revokeAll(u.id, "logout_all");
    await this.audit.record({ actorId: u.id, action: "auth.logout_all" }, c);
  }

  @Public() @Throttle(STRICT) @Post("password/forgot") @HttpCode(202)
  @ApiOperation({ operationId: "auth_password_forgot" })
  async forgot(@Body() dto: ForgotPasswordDto) { await this.auth.forgotPassword(dto.email); }

  @Public() @Throttle(STRICT) @Post("password/reset") @HttpCode(204)
  @ApiOperation({ operationId: "auth_password_reset" })
  async reset(@Body() dto: ResetPasswordDto, @Client() c: ClientMeta) { await this.auth.resetPassword(dto, c); }

  @Throttle(STRICT) @Post("password/change") @HttpCode(204)
  @ApiOperation({ operationId: "auth_password_change" })
  async change(@Body() dto: ChangePasswordDto, @CurrentUser() u: AuthUser, @Client() c: ClientMeta) { await this.auth.changePassword(u, dto, c); }

  @Post("2fa/totp/setup") @HttpCode(200)
  @ApiOperation({ operationId: "auth_totp_setup" })
  totpSetup(@CurrentUser() u: AuthUser) { return this.auth.totpSetup(u); }

  @Throttle(STRICT) @Post("2fa/totp/enable") @HttpCode(200)
  @ApiOperation({ operationId: "auth_totp_enable" })
  totpEnable(@Body() dto: TotpCodeDto, @CurrentUser() u: AuthUser, @Client() c: ClientMeta) { return this.auth.totpEnable(u, dto.code, c); }

  @Throttle(STRICT) @Post("2fa/totp/disable") @HttpCode(204)
  @ApiOperation({ operationId: "auth_totp_disable" })
  async totpDisable(@Body() dto: TotpCodeDto, @CurrentUser() u: AuthUser, @Client() c: ClientMeta) { await this.auth.totpDisable(u, dto.code, c); }

  @Get("devices")
  @ApiOperation({ operationId: "auth_devices_list" })
  devices(@CurrentUser() u: AuthUser) { return this.auth.listDevices(u); }

  @Patch("devices/current")
  @ApiOperation({ operationId: "auth_devices_update_current" })
  updateDevice(@Body() dto: DeviceUpdateDto, @CurrentUser() u: AuthUser) { return this.auth.updateCurrentDevice(u, dto); }

  @Delete("devices/:id") @HttpCode(204)
  @ApiOperation({ operationId: "auth_devices_revoke" })
  async revokeDevice(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Client() c: ClientMeta) {
    await this.sessions.revokeDevice(u.id, id);
    await this.audit.record({ actorId: u.id, action: "auth.device.revoked", entity: "device", entityId: id }, c);
  }
}
