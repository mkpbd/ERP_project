# Step 1 — Menus, page access, identity mapping

Status: **done** (2026-10-25). Previous: — · Next: step 2 (Admin masters).

## Scope

| Old API | Outcome |
|---|---|
| `Application/Features/Menus/*`, `Domain/Entities/Menu/*`, `ProjectMenuController`, `MenuPermissionController` | Ported to the new `navigation` module |
| `Server.Api/Permission/MenuAccessAttribute.cs`, `Application/Features/Menus/MenuActivation.cs` | Ported: `@MenuAccess()` + `MenuAccessGuard`, tree rules in `navigation/domain` |
| ASP.NET Identity (`HealthCareUser`, `HealthCareRole`, `HealthCareRoleClaim`), `TokenController`, `UserController`, `RoleController`, `RoleClaimController`, `AccountController` | **Not re-implemented**: the existing `identity` and `access-control` modules already cover them. Mapped below. |
| `Application/Features/Authentication/*` (patient-portal login with OTP, `AnonymousUser*`) | Moved to step 11. It is a separate patient sign-in that depends on `InvestigationInvoice` (Diagnosis). |
| `Domain/Entities/Admin/Tenant.cs`, `TenantService` | Moved to step 2 with the other Admin masters |
| gRPC `GRPCProjectMenuService` | Not ported: the REST endpoints replace it. Re-add only if a gRPC client still needs menus. |
| Reports | None in this scope |

## What was built

Module `src/modules/navigation` (domain → application → infrastructure → presentation, same layout as `access-control`).

### Tables (migration `0001_navigation.sql`)

| Table | From | Notes |
|---|---|---|
| `menus` | `Admin.ProjectMenus` | `parent_id` self-FK (`ON DELETE RESTRICT`), `path` stored normalized, checks for name length, path format, no self-parent |
| `role_menus` | `Menu.MenuPermissions` | PK `(role_id, menu_id)`; FK to `roles` and `menus` (`CASCADE`) and `users` for `granted_by` |

`role_menus.role_id → roles.id` is a cross-module foreign key. The architecture test now allows any module's
`*.schema.ts` to reference another module's tables for foreign keys, and nothing else
(`test/architecture/boundaries.spec.ts`).

### Permissions (added to the catalog; `super-admin` gets them automatically)

| Key | Allows |
|---|---|
| `menus:read` | List all menus, see a role's menus |
| `menus:manage` | Create, edit, move, activate/deactivate, delete menus |
| `menus:assign` | Replace a role's menus — only menus the actor can use, unless they also hold `menus:access-all` |
| `menus:access-all` | Use every **active** menu without a role grant (the old "Administrator / Super Admin" role-name bypass) |

### Endpoints

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/v1/menus` | `menus:read` | All menus, flat list in tree order (`depth`, `effectivelyActive`) |
| `GET /api/v1/menus/me` | signed in | The caller's navigation: active menus their roles hold, plus parents |
| `GET /api/v1/menus/resolve?path=/x/y` | signed in | The caller-visible menu for a route and its ancestors (breadcrumbs) |
| `POST /api/v1/menus` | `menus:manage` | Create |
| `GET /api/v1/menus/:id` | `menus:read` | One menu |
| `PATCH /api/v1/menus/:id` | `menus:manage` | Edit / move / (de)activate |
| `DELETE /api/v1/menus/:id` | `menus:manage` | Delete a menu with no sub-menus (409 `menu_has_children` otherwise) |
| `GET /api/v1/roles/:id/menus` | `menus:read` | Menu ids a role holds |
| `PUT /api/v1/roles/:id/menus` | `menus:assign` | Replace a role's menus; parents are added automatically |

Menu lists are flat (`parentId`, `depth`) rather than nested `ChildMenu` arrays; build the tree on the client.

### `@MenuAccess` for later steps

```ts
@Post()
@RequirePermissions('pharmacy:manage')
@MenuAccess('/pharmacy/sales', '/pharmacy/returns') // pages that legitimately call this endpoint
create(...) {}
```

The guard (after `AuthorizationGuard`) refuses with 403 when:

| Code | When |
|---|---|
| `menu_inactive` | Every menu for the listed pages is inactive, or under an inactive parent — even for `menus:access-all` |
| `menu_admin_only` | No menu has any of the paths; only `menus:access-all` passes |
| `menu_not_granted` | None of the caller's roles holds an active menu for the pages |

Denials are audited as `authz.denied` with the pages and reason. A method-level `@MenuAccess` replaces the
class-level one, as in the old attribute. In the old API only 4 endpoints used it; port it where it was used.

## Rules carried over (and tested)

* **Path normalization** (`normalizeMenuPath`): trim, drop `?query`/`#fragment`, leading `/`, no trailing `/`,
  lower case. Blank or `/` means "no page" (`null`).
* **Effective activity**: a menu is unusable if it or any ancestor is inactive (`inactiveMenuIds`).
* **Lock-out protection**: a change that leaves every `/administrator/project-menu` menu unusable is refused
  (422 `menu_admin_lockout`). Same message intent as the old `MenuActivation.LockOutReason`.
* **Parent auto-grant**: granting a sub-menu also grants its parents (old `AddEditMenuPermissionCommand`).

## Behaviour changes from the old API

| Old | New | Why |
|---|---|---|
| `IsActive` was `int` | `isActive` boolean | Only 0/non-0 was ever meaningful |
| `ParentId = Guid.Empty` for top level | `parentId: null` | Real foreign key |
| `AddEditProjectMenuCommand` ignored `0`/empty for `DisplayOrder`/`ParentId` on edit | `PATCH` changes exactly the fields sent; `parentId: null` moves a menu to the top | Explicit partial update |
| No cycle check when moving menus | 422 `menu_cycle` | Cycles broke tree walks |
| Delete of a parent left orphans | 409 `menu_has_children` | Integrity |
| `MenuPermissions.IsPermissionGranted` | Dropped; a row is the grant | The flag was written but never read |
| Admin bypass by role **name** (`Administrator`, `Super Admin`, `Admin2`, `sadmin`, …) | `menus:access-all` permission | No name-based bypass in this codebase |
| User menu tree listed every top-level menu (even with no granted children) and hard-coded two excluded menu GUIDs "from live" | Only granted active menus and their parents | Deactivate menus instead of hard-coding ids |
| `GetAllUserMenusQuery` path aliases (`/hr/staffs/new` → `hr/staffs`, …) | Not ported | Frontend route knowledge; resolve the canonical path in the client |
| `TenantMenuPermissions` allow-list (only if the table existed) | Not ported | Tenancy is step 2; add the allow-list there if a client actually uses it |
| `AccessControl:EnforceInactiveMenus=false` roll-back switch | Not ported | Inactive menus are always enforced |
| Any role could be given any menu by anyone allowed to call the endpoint | `menus:assign` + you can only grant/remove menus you can use (403 `privilege_escalation`) | Menus gate endpoints, so they are privileges |
| Cache: 60 s tree, 30 s per user, global generation counter | One snapshot per process, `PERMISSION_CACHE_TTL` seconds, dropped on every menu change in this process | Same multi-instance caveat as the permission cache (see architecture.md) |

## Identity mapping (no new code)

| Old | New |
|---|---|
| `Identity.Users` (`HealthCareUser`) | `users` |
| `UserName`, `Email` | `username`, `email` (both lower case, unique) |
| `FirstName`, `LastName`, `FullName` | `display_name` (= `FullName`, else first + last) |
| `IsActive` | `status` (`active` / `deactivated`) |
| `EmailConfirmed` | `email_verified_at` |
| `PasswordHash` (ASP.NET Identity PBKDF2) | `password_hash` (argon2id). ETL must either verify legacy hashes once and re-hash on login, or force a password reset — decide in step 13. |
| `RefreshToken`, `RefreshTokenExpiryTime` | `user_sessions` + `refresh_tokens` (hashed, rotated) |
| `ApiKey`, `Salt` | **Dropped** (see security notes) |
| `PhoneNumber` | Not ported yet; add with the first feature that needs it |
| `StaffRecordId`, `DoctorId`, `TechnologistId` | Belong to HR (step 4), Hospital (9), Diagnosis (10): those modules will reference `users.id` |
| `TenantId`, `Delay`, `ProfilePictureDataUrl`, `IsSynced` | Tenant → step 2; others not ported |
| `Identity.Roles` (`HealthCareRole`) | `roles`. Names must match `^[a-z][a-z0-9-]{1,63}$`: the ETL maps e.g. `Super Admin` → `super-admin`, `Lab Technologist` → `lab-technologist`. `ParentId`, `AllowedForDCExport` not ported (revisit with Diagnosis). |
| `Identity.RoleClaims` (`Permissions.Users.View`, …) | `role_permissions` with catalog keys: `Users.View/Search/Export → users:read`, `Users.Create → users:create`, `Users.Edit → users:update`, `Users.Delete → users:deactivate`, `Roles.View → roles:read`, `Roles.Create/Edit/Delete → roles:create/update/delete`, `RoleClaims.* → permissions:read / permissions:assign`, `AuditTrails.* → audit:read`, `Dashboards.View` → decided with the dashboard step |
| `Identity.UserRoles` | `user_roles` |
| `Admin.ProjectMenus`, `Menu.MenuPermissions` | `menus`, `role_menus` (rows with `IsDeleted = 1` are not copied; `NavigationPage` normalized; `IsActive <> 0`) |

## Old → new routes

| Old | New |
|---|---|
| `POST api/v1/identity/token` `{ email, password }` | `POST /api/v1/auth/login` `{ identifier, password }` (email or username) |
| `POST api/v1/identity/token/refresh` | `POST /api/v1/auth/refresh` (cookie + `X-CSRF-Token`, or body with `X-Refresh-Token-Delivery: body`) |
| `x-api-key` header on every call | `Authorization: Bearer <access token>` |
| `GET api/identity/user` | `GET /api/v1/users` (paged; `search`, `status`) |
| `POST api/identity/user/GetFilteredUser` | `GET /api/v1/users?search=…&status=…` |
| `GET api/identity/user/{id}` | `GET /api/v1/users/:id` |
| `GET api/identity/user/loggedIn` | `GET /api/v1/users/me` |
| `POST api/identity/user` (anonymous; create **or update** with `Id`, `RoleName`) | Admin: `POST /api/v1/users` then `POST /api/v1/users/:id/roles`; edit: `PATCH /api/v1/users/:id`. Self sign-up: `POST /api/v1/auth/register` (no role) |
| `GET api/identity/user/roles/{id}` | `GET /api/v1/users/:id/roles` |
| `PUT api/identity/user/roles/{id}` | `POST /api/v1/users/:id/roles`, `DELETE /api/v1/users/:id/roles/:roleId` |
| `GET api/identity/user/confirm-email` | `POST /api/v1/auth/verify-email` |
| `POST api/identity/user/toggle-status` | `POST /api/v1/users/:id/deactivate`, `POST /api/v1/users/:id/activate` |
| `POST api/identity/user/reset` | `POST /api/v1/auth/forgot-password`, `POST /api/v1/auth/reset-password` |
| `GET api/identity/user/export` | Not ported (Excel export comes with the reporting step) |
| `PUT api/identity/account/UpdateProfile` | `PATCH /api/v1/users/me` |
| `POST api/identity/account/ChangePassword` | `POST /api/v1/auth/change-password` |
| `GET api/identity/role` | `GET /api/v1/roles` |
| `POST api/identity/role` (create or update) | `POST /api/v1/roles`, `PATCH /api/v1/roles/:id` |
| `DELETE api/identity/role/{id}` | `DELETE /api/v1/roles/:id` |
| `GET api/identity/role/Permissions/{roleId}`, `GET api/identity/roleClaim/{roleId}` | `GET /api/v1/roles/:id/permissions` |
| `PUT api/identity/role/Permissions/update`, `POST/DELETE api/identity/roleClaim` | `POST /api/v1/roles/:id/permissions`, `DELETE /api/v1/roles/:id/permissions/:permission` |
| `POST api/v1/ProjectMenu` (create or update) | `POST /api/v1/menus`, `PATCH /api/v1/menus/:id` |
| `GET api/v1/ProjectMenu`, `GET api/v1/ProjectMenu/all` | `GET /api/v1/menus` |
| `GET api/v1/ProjectMenu/user/{userId}` | `GET /api/v1/menus/me` (only for yourself) |
| `POST api/v1/ProjectMenu/GetParentMenu` `{ role: "/route" }` | `GET /api/v1/menus/resolve?path=/route` |
| `POST api/v1/ProjectMenu/GetChildMenu`, `GET api/v1/ProjectMenu/parentmenu/{roleId}` | `GET /api/v1/menus` + `GET /api/v1/roles/:id/menus` (filter by `parentId` on the client) |
| `POST api/v1/MenuPermission` `{ roleId, menuId[], ids[] }` | `PUT /api/v1/roles/:id/menus` `{ menuIds }` (full replacement) |
| `GET api/v1/MenuPermission`, `GET api/v1/MenuPermission/role-menus/{roleId}` | `GET /api/v1/roles/:id/menus` |
| `DELETE api/v1/MenuPermission/{id}`, `DELETE api/v1/MenuPermission/menu/{role}` | `PUT /api/v1/roles/:id/menus` with the remaining (or empty) list |

Errors are Problem Details with a stable `code` instead of HTTP 200 + `succeeded: false`.

## Security issues found in the old API

From reading the code; **not tested against a running instance**. The new API does not have them. If the old
system is still live, these need attention there too.

1. **No fallback authorization policy** (`PermissionPolicyProvider.GetFallbackPolicyAsync` returns `null`):
   controllers without `[Authorize]` accept anonymous calls. `RoleController` (create/delete roles, change role
   permissions), `RoleClaimController` and `AccountController` have none.
2. **Anonymous user create/update**: `POST api/identity/user` is `[AllowAnonymous]`. With `Id` set to an
   existing user it rewrites that user's email, username and role (`RoleName`) and adds a password — account
   takeover and privilege escalation without signing in.
3. **Static per-user API key**: `ApiKey` is a SHA-256 of user id + salt, created once, never rotated or
   expired, returned at login and accepted on every request (`x-api-key`). It works as a permanent bearer
   credential, including after logout.
4. **Refresh tokens are not rotated** (rotation is commented out) and are stored in clear text; issued access
   tokens last 120 minutes and cannot be revoked.
5. **Login responses reveal account state** ("User Not Found", "User Not Active", "E-Mail not confirmed"),
   which allows user enumeration. There is no lockout.

## Deferred

* Tenant allow-list for menus (`Admin.TenantMenuPermissions`) — with tenancy, step 2, if needed.
* Menu ETL (`ProjectMenus`, `MenuPermissions`) — step 13.
* Applying `@MenuAccess` to business endpoints — in each module's step, where the old API had `[MenuAccess]`.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test` (unit + architecture): 122 passed — new `test/unit/navigation/domain.spec.ts`,
  `test/unit/navigation/handlers.spec.ts` (handlers, delegation, guard)
* `npm run test:int`: 16 passed (migration set now `0000_init` + `0001_navigation`)
* `npm run test:e2e`: 32 passed — new `test/e2e/navigation.e2e-spec.ts` (tree CRUD, lock-out, cycle, grants,
  `/menus/me`, `/menus/resolve`, escalation, cascade on role delete)
* Dev server smoke test: created a menu tree, read `/menus/me` as the dev admin, then removed it
