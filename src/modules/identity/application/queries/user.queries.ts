import { Query } from '@nestjs/cqrs';
import type { Actor } from '../../../../shared/application/actor.js';
import type { Page } from '../../../../shared/application/pagination.js';
import type { CurrentUserView, SessionView, UserListFilter, UserView } from '../read-models.js';

export class GetCurrentUserQuery extends Query<CurrentUserView> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetUserByIdQuery extends Query<UserView> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
  ) {
    super();
  }
}

export class ListUsersQuery extends Query<Page<UserView>> {
  constructor(
    readonly actor: Actor,
    readonly filter: UserListFilter,
  ) {
    super();
  }
}

export class ListMySessionsQuery extends Query<SessionView[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}
