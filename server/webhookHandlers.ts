import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { sendWelcomeEmail } from './gmailService';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
    
    // Parse the event to check for subscription events
    try {
      const stripe = await getUncachableStripeClient();
      const endpointSecret = await sync.getWebhookSecret();
      const event = stripe.webhooks.constructEvent(payload, signature, endpointSecret);
      
      console.log(`Received webhook ${event.id}: ${event.type}`);
      
      // Send welcome email when subscription is created or checkout completed
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as any;
        if (session.mode === 'subscription' && session.customer_email) {
          console.log(`Sending welcome email to ${session.customer_email}`);
          await sendWelcomeEmail(session.customer_email);
        } else if (session.mode === 'subscription' && session.customer) {
          // Fetch customer email from Stripe
          const customer = await stripe.customers.retrieve(session.customer as string);
          if (customer && !customer.deleted && customer.email) {
            console.log(`Sending welcome email to ${customer.email}`);
            await sendWelcomeEmail(customer.email);
          }
        }
      }
    } catch (webhookErr: any) {
      // Don't fail the webhook processing if email fails
      console.error('Error processing webhook for email:', webhookErr.message);
    }
  }
}
