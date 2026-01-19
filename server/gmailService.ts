import { google } from 'googleapis';

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

export async function sendWelcomeEmail(toEmail: string): Promise<void> {
  try {
    const gmail = await getUncachableGmailClient();
    
    const subject = 'Welcome to Virtual Studio Pro!';
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
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <h1>Virtual Studio</h1>
    </div>
    <div class="content">
      <h2>Welcome to Virtual Studio Pro!</h2>
      <p>Thank you for subscribing! You now have full access to our remote music collaboration platform.</p>
      
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
      
      <p>If you have any questions, just reply to this email.</p>
      
      <p>Happy creating!</p>
      <p class="highlight">- The Virtual Studio Team</p>
    </div>
    <div class="footer">
      <p>Virtual Studio | Remote Music Recording Collaboration</p>
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
