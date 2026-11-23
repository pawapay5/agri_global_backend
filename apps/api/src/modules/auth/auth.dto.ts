import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  Equals, IsEmail, IsIn, IsOptional, IsString, Length, Matches, MaxLength, MinLength, ValidateNested,
} from "class-validator";

export const SELF_ASSIGNABLE_ROLES = ["farmer", "trader", "consumer", "researcher", "student", "policymaker"] as const;
const ISO2 = /^[A-Z]{2}$/;

export class DeviceInfoDto {
  @ApiProperty() @IsString() @MaxLength(128) installationId: string;
  @ApiProperty({ enum: ["android", "ios", "web"] }) @IsIn(["android", "ios", "web"]) platform: "android" | "ios" | "web";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) appVersion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4096) pushToken?: string;
}

class WithDevice {
  @ApiPropertyOptional({ type: DeviceInfoDto }) @IsOptional() @ValidateNested() @Type(() => DeviceInfoDto) device?: DeviceInfoDto;
}

export class RegisterDto extends WithDevice {
  @ApiProperty() @IsEmail() @MaxLength(254) email: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(128) password: string;
  @ApiProperty() @IsString() @Length(1, 120) fullName: string;
  @ApiProperty() @Matches(ISO2) country: string;
  @ApiPropertyOptional({ enum: SELF_ASSIGNABLE_ROLES }) @IsOptional() @IsIn(SELF_ASSIGNABLE_ROLES) role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) locale?: string;
  @ApiProperty() @Equals(true) acceptTerms: true;
}

export class LoginDto extends WithDevice {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MaxLength(128) password: string;
}

export class OtpRequestDto {
  @ApiProperty({ enum: ["sms", "email"] }) @IsIn(["sms", "email"]) channel: "sms" | "email";
  @ApiProperty() @IsString() @MaxLength(254) destination: string;
  @ApiProperty({ enum: ["login", "verify_email", "verify_phone", "reset_password"] })
  @IsIn(["login", "verify_email", "verify_phone", "reset_password"]) purpose: "login" | "verify_email" | "verify_phone" | "reset_password";
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(16) locale?: string;
}

export class OtpVerifyDto extends WithDevice {
  @ApiProperty({ enum: ["sms", "email"] }) @IsIn(["sms", "email"]) channel: "sms" | "email";
  @ApiProperty() @IsString() @MaxLength(254) destination: string;
  @ApiProperty({ enum: ["login", "verify_email", "verify_phone"] }) @IsIn(["login", "verify_email", "verify_phone"]) purpose: "login" | "verify_email" | "verify_phone";
  @ApiProperty() @Matches(/^\d{6}$/) code: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO2) country?: string;
}

export class OAuthDto extends WithDevice {
  @ApiProperty() @IsString() @MaxLength(8192) token: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(256) nonce?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(ISO2) country?: string;
}

export class MfaVerifyDto extends WithDevice {
  @ApiProperty() @IsString() @MaxLength(2048) mfaToken: string;
  @ApiProperty() @IsString() @MaxLength(32) code: string;
}

export class RefreshDto { @ApiProperty() @IsString() @MaxLength(512) refreshToken: string }
export class ForgotPasswordDto { @ApiProperty() @IsEmail() email: string }
export class ResetPasswordDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @Matches(/^\d{6}$/) code: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(128) newPassword: string;
}
export class ChangePasswordDto {
  @ApiProperty() @IsString() @MaxLength(128) currentPassword: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(128) newPassword: string;
}
export class TotpCodeDto { @ApiProperty() @Matches(/^\d{6}$/) code: string }
export class DeviceUpdateDto {
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(4096) pushToken?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) appVersion?: string;
}
