import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Actor } from '../../../shared/application/actor.js';
import { AuthenticationError } from '../../../shared/domain/errors.js';
import { AuthRateLimit, CurrentUser, Public } from '../../../shared/presentation/auth.decorators.js';
import { MessageResponseDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  ChangePasswordCommand,
  LoginCommand,
  LogoutAllCommand,
  LogoutCommand,
  RefreshTokensCommand,
  RegisterUserCommand,
  RequestPasswordResetCommand,
  ResendEmailVerificationCommand,
  ResetPasswordCommand,
  RevokeSessionCommand,
  VerifyEmailCommand,
  type AuthTokens,
  type ClientInfo,
} from '../application/commands/auth.commands.js';
import { ListMySessionsQuery } from '../application/queries/user.queries.js';
import type { SessionView } from '../application/read-models.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  SessionIdParamDto,
  SessionResponseDto,
  TokenResponseDto,
  VerifyEmailDto,
} from './dto/identity.dto.js';
import { CSRF_HEADER, RefreshCookie, TOKEN_DELIVERY_HEADER } from './refresh-cookie.js';

const ACCEPTED = { message: 'If the request can be fulfilled, you will receive an email shortly.' };

const tokenDeliveryHeader = {
  name: TOKEN_DELIVERY_HEADER,
  required: false,
  description:
    'Send "body" (non-browser clients) to receive the refresh token in the response body instead of a cookie',
};

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly refreshCookie: RefreshCookie,
  ) {}

  @Public()
  @AuthRateLimit()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Self-register (if enabled). Responds identically whether or not the email exists.' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  async register(@Body() dto: RegisterDto): Promise<MessageResponseDto> {
    await this.commandBus.execute(
      new RegisterUserCommand(dto.email, dto.password, dto.displayName, dto.username ?? null),
    );
    return ACCEPTED;
  }

  @Public()
  @AuthRateLimit()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email or username and password' })
  @ApiHeader(tokenDeliveryHeader)
  @ApiOkResponse({ type: TokenResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TokenResponseDto> {
    const tokens = await this.commandBus.execute(new LoginCommand(dto.identifier, dto.password, clientInfo(request)));
    return this.respondWithTokens(tokens, request, response);
  }

  @Public()
  @AuthRateLimit()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token and obtain a new access token',
    description: `Browsers send the refresh cookie and must echo the ${CSRF_HEADER} header from the erp_csrf cookie. Presenting an already-rotated token revokes the whole session.`,
  })
  @ApiCookieAuth('refresh-cookie')
  @ApiHeader(tokenDeliveryHeader)
  @ApiHeader({ name: CSRF_HEADER, required: false, description: 'Required when refreshing with the cookie' })
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TokenResponseDto> {
    const refreshToken = dto.refreshToken ?? this.refreshCookie.readVerified(request);
    if (!refreshToken) throw new AuthenticationError('invalid_refresh_token', 'Refresh token is invalid or expired');
    try {
      const tokens = await this.commandBus.execute(new RefreshTokensCommand(refreshToken, clientInfo(request)));
      return this.respondWithTokens(tokens, request, response);
    } catch (error) {
      if (error instanceof AuthenticationError) this.refreshCookie.clear(response);
      throw error;
    }
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session' })
  @ApiNoContentResponse()
  async logout(@CurrentUser() actor: Actor, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.commandBus.execute(new LogoutCommand(actor));
    this.refreshCookie.clear(response);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every session of the current user' })
  @ApiNoContentResponse()
  async logoutAll(@CurrentUser() actor: Actor, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.commandBus.execute(new LogoutAllCommand(actor));
    this.refreshCookie.clear(response);
  }

  @Public()
  @AuthRateLimit()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Email a password-reset link. Responds identically for unknown emails.' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponseDto> {
    await this.commandBus.execute(new RequestPasswordResetCommand(dto.email));
    return ACCEPTED;
  }

  @Public()
  @AuthRateLimit()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with a reset token; signs out every session' })
  @ApiNoContentResponse()
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.commandBus.execute(new ResetPasswordCommand(dto.token, dto.newPassword));
  }

  @ApiBearerAuth()
  @AuthRateLimit()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change password; signs out all other sessions' })
  @ApiNoContentResponse()
  async changePassword(@CurrentUser() actor: Actor, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.commandBus.execute(new ChangePasswordCommand(actor, dto.currentPassword, dto.newPassword));
  }

  @Public()
  @AuthRateLimit()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm an email address with the emailed token' })
  @ApiNoContentResponse()
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.commandBus.execute(new VerifyEmailCommand(dto.token));
  }

  @Public()
  @AuthRateLimit()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a new verification email. Responds identically for unknown emails.' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<MessageResponseDto> {
    await this.commandBus.execute(new ResendEmailVerificationCommand(dto.email));
    return ACCEPTED;
  }

  @ApiBearerAuth()
  @Get('sessions')
  @ApiOperation({ summary: "List the current user's active sessions" })
  @ApiOkResponse({ type: SessionResponseDto, isArray: true })
  listSessions(@CurrentUser() actor: Actor): Promise<SessionView[]> {
    return this.queryBus.execute(new ListMySessionsQuery(actor));
  }

  @ApiBearerAuth()
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke one of your own sessions' })
  @ApiNoContentResponse()
  async revokeSession(@CurrentUser() actor: Actor, @Param() params: SessionIdParamDto): Promise<void> {
    await this.commandBus.execute(new RevokeSessionCommand(actor, params.sessionId));
  }

  private respondWithTokens(tokens: AuthTokens, request: Request, response: Response): TokenResponseDto {
    const body: TokenResponseDto = {
      accessToken: tokens.accessToken,
      tokenType: 'Bearer',
      expiresIn: Math.max(0, Math.round((tokens.accessTokenExpiresAt.getTime() - Date.now()) / 1000)),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
    };
    if (this.refreshCookie.wantsBodyDelivery(request)) return { ...body, refreshToken: tokens.refreshToken };
    this.refreshCookie.set(response, tokens.refreshToken, tokens.refreshTokenExpiresAt);
    return body;
  }
}

function clientInfo(request: Request): ClientInfo {
  const userAgent = request.headers['user-agent'];
  return { userAgent: typeof userAgent === 'string' ? userAgent : null, ipAddress: request.ip ?? null };
}
