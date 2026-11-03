import 'reflect-metadata';
import { UsersController } from '../../apps/backend/src/api/routes/users.controller';
import { WorkspaceDto } from '../../libraries/nestjs-libraries/src/dtos/settings/workspace.dto';
import { ValidationPipe } from '@nestjs/common';
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/payment/payment.service', () => ({ PaymentService: class {} }));
jest.mock('@gitroom/backend/services/auth/auth.service', () => ({ AuthService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({ TrackService: class {} }));

const original = process.env.FRONTEND_URL;
let orgs: any, controller: UsersController;
beforeEach(() => {
  process.env.FRONTEND_URL = 'https://social.example.com';
  orgs = { createWorkspace: jest.fn(async () => ({ id: 'new', name: 'Client' })),
    requireMembership: jest.fn(), renameWorkspace: jest.fn() };
  controller = new UsersController({} as any, {} as any, {} as any, orgs, {} as any, {} as any);
});
afterEach(() => { if (original === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = original; });
const req = () => ({ headers: { origin: 'https://social.example.com' }, cookies: {} } as any);

test('creation uses only authenticated account and validated name; injected owner/plan are ignored', async () => {
  const body = { name: 'Client', userId: 'victim', role: 'USER', subscription: { isLifetime: true } };
  await expect(controller.createWorkspace({ id: 'alice' } as any, body, req())).resolves.toEqual({ id: 'new', name: 'Client' });
  expect(orgs.createWorkspace).toHaveBeenCalledWith('alice', 'Client');
});
test('impersonation and cross-origin writes cannot create workspaces', async () => {
  const request = req(); request.cookies.impersonate = 'victim';
  await expect(controller.createWorkspace({ id: 'alice' } as any, { name: 'Client' }, request)).rejects.toMatchObject({ status: 403 });
  const foreign = req(); foreign.headers.origin = 'https://evil.example.com';
  await expect(controller.createWorkspace({ id: 'alice' } as any, { name: 'Client' }, foreign)).rejects.toMatchObject({ status: 403 });
  expect(orgs.createWorkspace).not.toHaveBeenCalled();
});
test('unauthorized switch cannot write cookie or success response', async () => {
  orgs.requireMembership.mockRejectedValue(new Error('Denied'));
  const response = { cookie: jest.fn(), status: jest.fn() } as any;
  await expect(controller.changeOrg({ id: 'alice' } as any, 'foreign', req(), response)).rejects.toThrow('Denied');
  expect(orgs.requireMembership).toHaveBeenCalledWith('alice', 'foreign');
  expect(response.cookie).not.toHaveBeenCalled();
  expect(response.status).not.toHaveBeenCalled();
});
test('authorized switch persists the approved selection after membership check', async () => {
  const response: any = { cookie: jest.fn(), status: jest.fn(() => response), send: jest.fn(), header: jest.fn() };
  await controller.changeOrg({ id: 'alice' } as any, 'b', req(), response);
  expect(response.cookie).toHaveBeenCalledWith('showorg', 'b', expect.any(Object));
  expect(response.status).toHaveBeenCalledWith(200);
});
test('rename takes target from authenticated workspace, not body organizationId', () => {
  controller.renameWorkspace({ id: 'alice' } as any, { id: 'a' } as any,
    { name: 'Renamed', organizationId: 'foreign' } as any, req());
  expect(orgs.renameWorkspace).toHaveBeenCalledWith('alice', 'a', 'Renamed');
});
test('Nest validation trims names and rejects invalid payloads before controller', async () => {
  const pipe = new ValidationPipe({ transform: true });
  const metadata = { type: 'body', metatype: WorkspaceDto } as const;
  await expect(pipe.transform({ name: '  Client  ' }, metadata)).resolves.toMatchObject({ name: 'Client' });
  for (const body of [{}, { name: 42 }, { name: '' }, { name: '\t' }, { name: '<bad>' }]) {
    await expect(pipe.transform(body, metadata)).rejects.toMatchObject({ status: 400 });
  }
});
