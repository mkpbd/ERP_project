import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../../shared/application/contracts/access-control.js';
import type { Page } from '../../../../shared/application/pagination.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { GetCurrentUserQuery, GetUserByIdQuery, ListMySessionsQuery, ListUsersQuery } from '../queries/user.queries.js';
import { UserReadRepository, type CurrentUserView, type SessionView, type UserView } from '../read-models.js';

@QueryHandler(GetCurrentUserQuery)
export class GetCurrentUserHandler implements IQueryHandler<GetCurrentUserQuery> {
  constructor(
    private readonly read: UserReadRepository,
    private readonly accessControl: AccessControl,
  ) {}

  async execute({ actor }: GetCurrentUserQuery): Promise<CurrentUserView> {
    const [view, profile] = await Promise.all([
      this.read.getView(actor.userId),
      this.accessControl.getProfile(actor.userId),
    ]);
    if (!view) throw new NotFoundError('user');
    return { ...view, roles: [...profile.roles], permissions: [...profile.permissions].sort() };
  }
}

@QueryHandler(GetUserByIdQuery)
export class GetUserByIdHandler implements IQueryHandler<GetUserByIdQuery> {
  constructor(
    private readonly read: UserReadRepository,
    private readonly accessControl: AccessControl,
  ) {}

  async execute({ actor, userId }: GetUserByIdQuery): Promise<UserView> {
    await this.accessControl.authorize(actor.userId, { permissions: ['users:read'], ownerId: userId });
    const view = await this.read.getView(userId);
    if (!view) throw new NotFoundError('user');
    return view;
  }
}

@QueryHandler(ListUsersQuery)
export class ListUsersHandler implements IQueryHandler<ListUsersQuery> {
  constructor(
    private readonly read: UserReadRepository,
    private readonly accessControl: AccessControl,
  ) {}

  async execute({ actor, filter }: ListUsersQuery): Promise<Page<UserView>> {
    await this.accessControl.authorize(actor.userId, { permissions: ['users:read'] });
    return this.read.list(filter);
  }
}

@QueryHandler(ListMySessionsQuery)
export class ListMySessionsHandler implements IQueryHandler<ListMySessionsQuery> {
  constructor(
    private readonly read: UserReadRepository,
    private readonly clock: Clock,
  ) {}

  async execute({ actor }: ListMySessionsQuery): Promise<SessionView[]> {
    const sessions = await this.read.listActiveSessions(actor.userId, this.clock.now());
    return sessions.map((session) => ({ ...session, current: session.id === actor.sessionId }));
  }
}
