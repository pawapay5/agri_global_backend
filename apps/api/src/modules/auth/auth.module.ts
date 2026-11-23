import { Module } from "@nestjs/common";
import { FieldCipher } from "../../common/crypto/crypto";
import { UsersRepository } from "../users/users.repository";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OAuthService } from "./oauth.service";
import { OtpService } from "./otp.service";
import { SessionService } from "./session.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, OtpService, OAuthService, FieldCipher, UsersRepository],
  exports: [SessionService, UsersRepository],
})
export class AuthModule {}
