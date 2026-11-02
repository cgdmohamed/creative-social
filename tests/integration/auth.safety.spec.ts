import 'reflect-metadata';
import { AuthMiddleware } from '../../apps/backend/src/services/auth/auth.middleware';
import { AuthService } from '../../libraries/helpers/src/auth/auth.service';
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { verifyJWT: jest.fn() },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({ UsersService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({
  setSentryUserContext: jest.fn(),
}));
const org = (id: string, disabled = false) => ({
  id,
  apiKey: 'synthetic',
  users: [{ disabled, role: 'USER' }],
  createdAt: new Date(),
});
let organizations: any,
  users: any,
  middleware: AuthMiddleware,
  req: any,
  next: jest.Mock;
beforeEach(() => {
  (AuthService.verifyJWT as jest.Mock).mockReturnValue({
    id: 'user',
    activated: true,
    isSuperAdmin: true,
  });
  organizations = {
    getOrgsByUserId: jest.fn(async () => [
      org('org-a'),
      org('org-disabled', true),
    ]),
    updateApiKey: jest.fn(),
    getUserOrg: jest.fn(),
  };
  users = {
    getUserById: jest.fn(async () => ({
      id: 'user',
      activated: true,
      isSuperAdmin: false,
      password: 'private',
    })),
  };
  middleware = new AuthMiddleware(organizations, users);
  req = { headers: { auth: 'synthetic-token' }, cookies: {} };
  next = jest.fn();
});

test.each(['org-foreign', 'org-disabled', '', ['org-a'], { id: 'org-a' }])(
  'rejects invalid or disabled explicit tenant selection without a fallback: %j',
  async (selection) => {
    req.headers.showorg = selection;
    await expect(middleware.use(req, {} as any, next)).rejects.toMatchObject({
      status: 403,
    });
    expect(next).not.toHaveBeenCalled();
    expect(req.org).toBeUndefined();
    expect(organizations.updateApiKey).not.toHaveBeenCalled();
  }
);

test('cookie tenant selection is checked against active database memberships', async () => {
  req.cookies.showorg = 'org-foreign';
  await expect(middleware.use(req, {} as any, next)).rejects.toMatchObject({
    status: 403,
  });
  expect(next).not.toHaveBeenCalled();
});

test('accepts the selected membership and strips the password', async () => {
  req.headers.showorg = 'org-a';
  await middleware.use(req, {} as any, next);
  expect(req.org.id).toBe('org-a');
  expect(req.user.password).toBeUndefined();
  expect(next).toHaveBeenCalledTimes(1);
});

test('only an absent selection may use a default active membership', async () => {
  await middleware.use(req, {} as any, next);
  expect(req.org.id).toBe('org-a');
  expect(next).toHaveBeenCalledTimes(1);
});

test('no active memberships fail closed', async () => {
  organizations.getOrgsByUserId.mockResolvedValueOnce([
    org('org-disabled', true),
  ]);
  await expect(middleware.use(req, {} as any, next)).rejects.toMatchObject({
    status: 403,
  });
  expect(next).not.toHaveBeenCalled();
});

test('database activation and superadmin status override signed token claims', async () => {
  req.headers.impersonate = 'foreign-user';
  await middleware.use(req, {} as any, next);
  expect(organizations.getUserOrg).not.toHaveBeenCalled();
  expect(req.user.isSuperAdmin).toBe(false);
  users.getUserById.mockResolvedValueOnce({
    id: 'user',
    activated: false,
    isSuperAdmin: false,
  });
  next.mockClear();
  await expect(middleware.use(req, {} as any, next)).rejects.toMatchObject({
    status: 403,
  });
  expect(next).not.toHaveBeenCalled();
});
