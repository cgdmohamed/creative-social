import { EmailService } from '../../libraries/nestjs-libraries/src/services/email.service';
const original = { ...process.env };
let service: EmailService, send: jest.Mock;
beforeEach(() => {
  process.env.EMAIL_FROM_ADDRESS = 'reports@example.test'; process.env.EMAIL_FROM_NAME = 'Client reports';
  service = Object.create(EmailService.prototype); send = jest.fn();
  service.emailService = { name: 'test-provider', validateEnvKeys: [], sendEmail: send } as any;
});
afterEach(() => { process.env = { ...original }; jest.restoreAllMocks(); });
test.each([{ MessageId: 'ses-id' }, { data: { id: 'resend-id' } }, { accepted: ['client@example.test'], messageId: 'smtp-id' }])('requires a positive provider acceptance receipt %j', async (receipt) => {
  send.mockResolvedValue(receipt);
  expect(await service.sendEmailSync('client@example.test', 'Report', '<p>Ready</p>', undefined, true)).toMatchObject({ accepted: true, provider: 'test-provider' });
  expect(send).toHaveBeenCalledTimes(1);
});
test.each([{}, undefined, { accepted: [], messageId: 'not-accepted' }, { error: { message: 'SECRET' }, data: { id: 'id' } }])('unconfirmed acceptance never retries or reports success %j', async (receipt) => {
  send.mockResolvedValue(receipt); const log = jest.spyOn(console, 'log');
  await expect(service.sendEmailSync('client@example.test', 'Report', 'SECRET-HTML', undefined, true)).rejects.toThrow('EMAIL_ACCEPTANCE_UNCONFIRMED');
  expect(send).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled();
});
test('missing sender prevents sending and legacy optional notification behavior stays compatible', async () => {
  delete process.env.EMAIL_FROM_ADDRESS;
  await expect(service.sendEmailSync('client@example.test', 'Report', '', undefined, true)).rejects.toThrow('EMAIL_SENDER_NOT_CONFIGURED');
  expect(send).not.toHaveBeenCalled();
});
