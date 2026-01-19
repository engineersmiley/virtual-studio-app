import { getStripeSync, getUncachableStripeClient } from './stripeClient';
import { sendWelcomeEmail } from './gmailService';

export interface PaymentDetails {
  amount: number;
  currency: string;
  nextBillingDate: Date | null;
}

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
        if (session.mode === 'subscription') {
          let customerEmail = session.customer_email;
          let paymentDetails: PaymentDetails | undefined;
          
          // Fetch subscription details for payment info
          if (session.subscription) {
            try {
              const subscription = await stripe.subscriptions.retrieve(session.subscription as string) as any;
              const amount = subscription.items?.data?.[0]?.price?.unit_amount || 999;
              const currency = subscription.items?.data?.[0]?.price?.currency || 'usd';
              const nextBillingDate = subscription.current_period_end 
                ? new Date(subscription.current_period_end * 1000) 
                : null;
              
              paymentDetails = { amount, currency, nextBillingDate };
            } catch (subErr) {
              console.error('Error fetching subscription details:', subErr);
            }
          }
          
          // Get customer email if not in session
          if (!customerEmail && session.customer) {
            const customer = await stripe.customers.retrieve(session.customer as string);
            if (customer && !customer.deleted && customer.email) {
              customerEmail = customer.email;
            }
          }
          
          if (customerEmail) {
            console.log(`Sending welcome email to ${customerEmail}`);
            await sendWelcomeEmail(customerEmail, paymentDetails);
          }
        }
      }
    } catch (webhookErr: any) {
      // Don't fail the webhook processing if email fails
      console.error('Error processing webhook for email:', webhookErr.message);
    }
  }
}
