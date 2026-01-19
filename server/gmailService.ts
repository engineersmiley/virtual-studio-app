import { google } from 'googleapis';
import type { PaymentDetails } from './webhookHandlers';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
  }
  return accessToken;
}

async function getUncachableGmailClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function createEmailMessage(to: string, subject: string, body: string): string {
  const emailLines = [
    `To: ${to}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    body
  ];
  
  const email = emailLines.join('\r\n');
  return Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(amount / 100);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export async function sendWelcomeEmail(toEmail: string, paymentDetails?: PaymentDetails): Promise<void> {
  try {
    const gmail = await getUncachableGmailClient();
    
    const amountStr = paymentDetails ? formatCurrency(paymentDetails.amount, paymentDetails.currency) : '$9.99';
    const nextBillingStr = paymentDetails?.nextBillingDate ? formatDate(paymentDetails.nextBillingDate) : 'Monthly (see account for details)';
    
    const subject = 'Welcome to Virtual Studio Pro - Payment Confirmed!';
    const body = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background-color: #0a0a0f; color: #ffffff; padding: 40px; }
    .container { max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border-radius: 16px; padding: 40px; }
    .logo { text-align: center; margin-bottom: 30px; }
    .logo h1 { color: #00f0ff; font-size: 28px; margin: 0; }
    .content { color: #e0e0e0; line-height: 1.6; }
    .highlight { color: #00f0ff; font-weight: bold; }
    .button { display: inline-block; background: linear-gradient(90deg, #00f0ff, #ff00ff); color: #000; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 20px 0; }
    .features { background: rgba(0,240,255,0.1); border-radius: 8px; padding: 20px; margin: 20px 0; }
    .features li { margin: 10px 0; }
    .payment-box { background: rgba(0,240,255,0.15); border: 1px solid rgba(0,240,255,0.3); border-radius: 8px; padding: 20px; margin: 20px 0; }
    .payment-row { display: flex; justify-content: space-between; margin: 8px 0; }
    .payment-label { color: #888; }
    .payment-value { color: #00f0ff; font-weight: bold; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <h1>Virtual Studio</h1>
    </div>
    <div class="content">
      <h2>Payment Confirmed - Welcome to Pro!</h2>
      <p>Thank you for subscribing! Your payment has been processed and you now have full access to Virtual Studio Pro.</p>
      
      <div class="payment-box">
        <p style="margin: 0 0 15px 0; font-weight: bold; color: #fff;">Payment Details:</p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="color: #888; padding: 5px 0;">Plan:</td>
            <td style="color: #00f0ff; font-weight: bold; text-align: right;">Virtual Studio Pro (Monthly)</td>
          </tr>
          <tr>
            <td style="color: #888; padding: 5px 0;">Amount Paid:</td>
            <td style="color: #00f0ff; font-weight: bold; text-align: right;">${amountStr}</td>
          </tr>
          <tr>
            <td style="color: #888; padding: 5px 0;">Next Billing:</td>
            <td style="color: #00f0ff; font-weight: bold; text-align: right;">${nextBillingStr}</td>
          </tr>
        </table>
      </div>
      
      <div class="features">
        <p><strong>Your Pro membership includes:</strong></p>
        <ul>
          <li>Unlimited recording sessions</li>
          <li>HD audio & video streaming</li>
          <li>Cloud recording library</li>
          <li>Priority support</li>
        </ul>
      </div>
      
      <p>Ready to start your first session?</p>
      <a href="https://virtualstudio.sale" class="button">Open Virtual Studio</a>
      
      <div class="features" style="margin-top: 30px;">
        <p><strong>Install the App:</strong></p>
        <p>Add Virtual Studio to your desktop or phone for quick access:</p>
        <ul>
          <li><strong>Desktop (Chrome/Edge):</strong> Click the install icon in your browser's address bar</li>
          <li><strong>iPhone/iPad:</strong> Tap Share, then "Add to Home Screen"</li>
          <li><strong>Android:</strong> Tap the menu, then "Install App"</li>
        </ul>
      </div>
      
      <p style="margin-top: 30px;">Need to manage your subscription? <a href="https://virtualstudio.sale" style="color: #00f0ff;">Visit Virtual Studio</a> and click "Manage Subscription" in your account.</p>
      
      <p>If you have any questions, just reply to this email.</p>
      
      <p>Happy creating!</p>
      <p class="highlight">- The Virtual Studio Team</p>
    </div>
    <div class="footer">
      <p>Virtual Studio | Remote Music Recording Collaboration</p>
      <p style="margin-top: 10px;">You're receiving this email because you subscribed to Virtual Studio Pro.</p>
    </div>
  </div>
</body>
</html>
    `;
    
    const rawMessage = createEmailMessage(toEmail, subject, body);
    
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: rawMessage
      }
    });
    
    console.log(`Welcome email sent to ${toEmail}`);
  } catch (error) {
    console.error('Failed to send welcome email:', error);
  }
}
