import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthUser, CurrentUser } from "../../common/auth/auth.common";
import { Client, ClientMeta } from "../../common/http/request-context";
import { ConsentUpdateDto, FarmingProfileDto, InterestsDto, PreferencesDto, SavedLocationCreateDto, UserUpdateDto } from "./users.dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiBearerAuth()
@Controller("v1/me")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() @ApiOperation({ operationId: "users_me_get" })
  me(@CurrentUser() u: AuthUser) { return this.users.me(u); }

  @Patch() @ApiOperation({ operationId: "users_me_update" })
  update(@CurrentUser() u: AuthUser, @Body() dto: UserUpdateDto, @Client() c: ClientMeta) { return this.users.update(u, dto, c); }

  @Delete() @HttpCode(202) @ApiOperation({ operationId: "users_me_delete" })
  remove(@CurrentUser() u: AuthUser, @Client() c: ClientMeta) { return this.users.requestDeletion(u, c); }

  @Post("deletion/cancel") @HttpCode(204) @ApiOperation({ operationId: "users_me_deletion_cancel" })
  async cancel(@CurrentUser() u: AuthUser, @Client() c: ClientMeta) { await this.users.cancelDeletion(u, c); }

  @Get("farming-profile") @ApiOperation({ operationId: "users_farming_profile_get" })
  farming(@CurrentUser() u: AuthUser) { return this.users.getFarming(u); }

  @Put("farming-profile") @ApiOperation({ operationId: "users_farming_profile_put" })
  putFarming(@CurrentUser() u: AuthUser, @Body() dto: FarmingProfileDto) { return this.users.putFarming(u, dto); }

  @Get("preferences") @ApiOperation({ operationId: "users_preferences_get" })
  prefs(@CurrentUser() u: AuthUser) { return this.users.getPrefs(u); }

  @Put("preferences") @ApiOperation({ operationId: "users_preferences_put" })
  putPrefs(@CurrentUser() u: AuthUser, @Body() dto: PreferencesDto) { return this.users.putPrefs(u, dto); }

  @Get("interests") @ApiOperation({ operationId: "users_interests_get" })
  interests(@CurrentUser() u: AuthUser) { return this.users.getInterests(u); }

  @Put("interests") @ApiOperation({ operationId: "users_interests_put" })
  putInterests(@CurrentUser() u: AuthUser, @Body() dto: InterestsDto) { return this.users.putInterests(u, dto); }

  @Get("locations") @ApiOperation({ operationId: "users_locations_list" })
  locations(@CurrentUser() u: AuthUser) { return this.users.listLocations(u); }

  @Post("locations") @ApiOperation({ operationId: "users_locations_create" })
  createLocation(@CurrentUser() u: AuthUser, @Body() dto: SavedLocationCreateDto) { return this.users.createLocation(u, dto); }

  @Delete("locations/:id") @HttpCode(204) @ApiOperation({ operationId: "users_locations_delete" })
  async deleteLocation(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) { await this.users.deleteLocation(u, id); }

  @Get("consents") @ApiOperation({ operationId: "users_consents_get" })
  consents(@CurrentUser() u: AuthUser) { return this.users.getConsents(u); }

  @Put("consents") @ApiOperation({ operationId: "users_consents_put" })
  putConsents(@CurrentUser() u: AuthUser, @Body() dto: ConsentUpdateDto, @Client() c: ClientMeta) { return this.users.putConsents(u, dto, c); }
}
