import { Injectable } from '@nestjs/common';
import { EmailInterface } from '@gitroom/nestjs-libraries/emails/email.interface';
import { ResendProvider } from '@gitroom/nestjs-libraries/emails/resend.provider';
import { EmptyProvider } from '@gitroom/nestjs-libraries/emails/empty.provider';
import { NodeMailerProvider } from '@gitroom/nestjs-libraries/emails/node.mailer.provider';
import { SesProvider } from '@gitroom/nestjs-libraries/emails/ses.provider';
import { TemporalService } from 'nestjs-temporal-core';
import { timer } from '@gitroom/helpers/utils/timer';
import { randomUUID } from 'crypto';

@Injectable()
export class EmailService {
  emailService: EmailInterface;
  constructor(private _temporalService: TemporalService) {
    this.emailService = this.selectProvider(process.env.EMAIL_PROVIDER!);
    console.log('Email service provider:', this.emailService.name);
    for (const key of this.emailService.validateEnvKeys) {
      if (!process.env[key]) {
        console.error(`Missing environment variable: ${key}`);
      }
    }
  }

  hasProvider() {
    return !(this.emailService instanceof EmptyProvider);
  }
  hasDeliveryConfiguration() {
    return this.hasProvider() && !!process.env.EMAIL_FROM_ADDRESS && !!process.env.EMAIL_FROM_NAME && this.emailService.validateEnvKeys.every((key) => !!process.env[key]);
  }

  selectProvider(provider: string) {
    switch (provider) {
      case 'resend':
        return new ResendProvider();
      case 'nodemailer':
        return new NodeMailerProvider();
      case 'ses':
        return new SesProvider();
      default:
        return new EmptyProvider();
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    addTo: 'top' | 'bottom',
    replyTo?: string
  ) {
    if (!to || !subject) {
      return;
    }

    return this._temporalService.client
      .getRawClient()
      ?.workflow.start('sendSingleEmailWorkflow', {
        taskQueue: 'main',
        workflowId: `send_email_${randomUUID()}`,
        args: [{ to, subject, html, replyTo, addTo }],
      });
  }

  async sendEmailSync(
    to: string,
    subject: string,
    html: string,
    replyTo?: string,
    requireReceipt = false
  ) {
    if (to.indexOf('@') === -1) {
      if (requireReceipt) throw new Error('EMAIL_RECIPIENT_INVALID');
      return;
    }

    if (requireReceipt && (!this.hasProvider() || this.emailService.validateEnvKeys.some((key) => !process.env[key]))) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');

    if (!process.env.EMAIL_FROM_ADDRESS || !process.env.EMAIL_FROM_NAME) {
      if (requireReceipt) throw new Error('EMAIL_SENDER_NOT_CONFIGURED');
      console.log(
        'Email sender information not found in environment variables'
      );
      return;
    }

    const modifiedHtml = `
    <div style="
        background: linear-gradient(to bottom right, #e6f2ff, #f0e6ff);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
    ">
        <div style="
            background-color: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(4px);
            border-radius: 0.5rem;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            max-width: 48rem;
            width: 100%;
            padding: 2rem;
        ">
            <h1 style="
                font-size: 1.875rem;
                font-weight: bold;
                margin-bottom: 1.5rem;
                text-align: left;
                color: #1f2937;
            ">${subject}</h1>
            
            <div style="
                margin-bottom: 2rem;
                color: #374151;
            ">
                ${html}
            </div>
            
            <div style="
                display: flex;
                align-items: center;
                border-top: 1px solid #e5e7eb;
                padding-top: 1.5rem;
            ">
                <div>
                    <h2 style="
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: #1f2937;
                        margin: 0;
                    ">${process.env.EMAIL_FROM_NAME}</h2>
                    <div style="font-size: 12px">
                      You can change your notification preferences in your <a href="${process.env.FRONTEND_URL}/settings">account settings.</a>
                     </div>
                </div>
            </div>
        </div>
    </div>
    `;

    const attempts = requireReceipt ? 1 : 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const sends = await this.emailService.sendEmail(
          to,
          subject,
          modifiedHtml,
          process.env.EMAIL_FROM_NAME,
          process.env.EMAIL_FROM_ADDRESS,
          replyTo
        );
        if (requireReceipt) {
          const accepted = Array.isArray(sends?.accepted) ? sends.accepted.some((address: unknown) => typeof address === 'string' && address.toLowerCase() === to.toLowerCase()) : false;
          const messageId = sends?.MessageId || sends?.data?.id || (accepted ? sends?.messageId : undefined);
          if (!messageId || typeof messageId !== 'string' || sends?.error || sends?.rejected?.includes(to)) throw new Error('EMAIL_ACCEPTANCE_NOT_CONFIRMED');
          return { accepted: true, provider: this.emailService.name, messageId: messageId.slice(0, 200) };
        }
        // Never log provider responses: the optional EmptyProvider response can
        // include password-reset links and provider errors can contain secrets.
        return;
      } catch {
        if (requireReceipt) throw new Error('EMAIL_ACCEPTANCE_UNCONFIRMED');
        console.log(`Email attempt ${attempt + 1}/${attempts} was not confirmed`);
        if (attempt < attempts - 1) {
          await timer(700);
        }
      }
    }
    console.log('Email notification was not confirmed after bounded retries');
  }
}
