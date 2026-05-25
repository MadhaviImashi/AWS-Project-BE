import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const FROM_EMAIL = process.env.SES_FROM_EMAIL!;

export interface RegistrationConfirmationPayload {
  type: 'REGISTRATION_CONFIRMATION';
  to: string;
  data: {
    userName: string;
    eventTitle: string;
    eventDate: string;
    eventTime: string;
    eventDescription?: string;
  };
}

export type EmailPayload = RegistrationConfirmationPayload;
// Add more union members here as new email types are needed

const templates: Record<EmailPayload['type'], (payload: EmailPayload) => { subject: string; html: string; text: string }> = {
  REGISTRATION_CONFIRMATION: (payload) => {
    const { userName, eventTitle, eventDate, eventTime, eventDescription } = (payload as RegistrationConfirmationPayload).data;
    return {
      subject: `Registration Confirmed: ${eventTitle}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>You're registered for ${eventTitle}!</h2>
          <p>Hi ${userName},</p>
          <p>Your registration for <strong>${eventTitle}</strong> has been confirmed.</p>
          <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
            <tr><td style="padding: 8px; font-weight: bold;">Date</td><td style="padding: 8px;">${eventDate}</td></tr>
            <tr><td style="padding: 8px; font-weight: bold;">Time</td><td style="padding: 8px;">${eventTime}</td></tr>
            ${eventDescription ? `<tr><td style="padding: 8px; font-weight: bold;">About</td><td style="padding: 8px;">${eventDescription}</td></tr>` : ''}
          </table>
          <p style="color: #666; font-size: 14px;">We look forward to seeing you there!</p>
        </div>
      `,
      text: `Hi ${userName},\n\nYour registration for ${eventTitle} on ${eventDate} at ${eventTime} has been confirmed.\n\nWe look forward to seeing you there!`,
    };
  },
};

export const handler = async (event: EmailPayload): Promise<void> => {
  const template = templates[event.type];
  if (!template) {
    console.error(`Unknown email type: ${event.type}`);
    return;
  }

  const { subject, html, text } = template(event);

  await ses.send(
    new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [event.to] },
      Message: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: html },
          Text: { Data: text },
        },
      },
    }),
  );

  console.log(`Email sent: type=${event.type} to=${event.to}`);
};
