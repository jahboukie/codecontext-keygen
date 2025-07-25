/**
 * CodeContextPro-MES Firebase Functions v2
 * Security-first payment processing and license management
 * 
 * Converted to 2nd Generation functions to resolve deployment issues
 */

import * as admin from 'firebase-admin';
import Stripe from 'stripe';
import * as cors from 'cors';
import { Response, Request } from 'express';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';

// Initialize Firebase Admin
admin.initializeApp();

// Set global options for all 2nd Gen functions
setGlobalOptions({
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
});

// Define secrets using Firebase Secret Manager (v2 approach)
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const MEMORY_PRICE_ID = defineSecret('MEMORY_PRICE_ID');
const KEYGEN_API_KEY = defineSecret('KEYGEN_API_KEY');
const KEYGEN_ACCOUNT_ID = defineSecret('KEYGEN_ACCOUNT_ID');
const KEYGEN_PRODUCT_ID = defineSecret('KEYGEN_PRODUCT_ID');
const FIREBASE_WEB_API_KEY = defineSecret('FIREBASE_WEB_API_KEY');

// Note: Stripe instances are created within functions to access secrets properly

/**
 * Create license in Keygen.sh
 */
async function createKeygenLicense(email: string, tier: string): Promise<{
    success: boolean;
    licenseKey?: string;
    error?: string;
}> {
    try {
        const keygenApiKey = process.env.KEYGEN_API_KEY || KEYGEN_API_KEY.value();
        const keygenAccountId = process.env.KEYGEN_ACCOUNT_ID || KEYGEN_ACCOUNT_ID.value() || 'c86687d0-695b-474c-bd18-e37d96969dcb';
        const keygenProductId = process.env.KEYGEN_PRODUCT_ID || KEYGEN_PRODUCT_ID.value();

        if (!keygenApiKey || !keygenAccountId || !keygenProductId) {
            throw new Error('Keygen.sh credentials not configured');
        }

        const response = await fetch(`https://api.keygen.sh/v1/accounts/${keygenAccountId}/licenses`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${keygenApiKey}`,
                'Content-Type': 'application/vnd.api+json',
                'Accept': 'application/vnd.api+json'
            },
            body: JSON.stringify({
                data: {
                    type: 'licenses',
                    attributes: {
                        name: `${tier} License for ${email}`,
                        metadata: {
                            email,
                            tier,
                            source: 'stripe_webhook',
                            created_via: 'codecontextpro_payment'
                        }
                    },
                    relationships: {
                        product: {
                            data: {
                                type: 'products',
                                id: keygenProductId
                            }
                        }
                    }
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Keygen license creation failed:', response.status, errorText);
            throw new Error(`Keygen API error: ${response.status}`);
        }

        const data = await response.json();
        const licenseKey = data.data?.attributes?.key;

        if (!licenseKey) {
            throw new Error('No license key returned from Keygen');
        }

        console.log('✅ Keygen license created:', licenseKey.substring(0, 12) + '***');
        return {
            success: true,
            licenseKey
        };

    } catch (error) {
        console.error('❌ Failed to create Keygen license:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * CORS Handler with Security Restrictions
 */
const corsHandler = cors.default({
    origin: [
        'https://codecontextpro.com',
        'https://www.codecontextpro.com',
        'https://codecontextpro-mes.web.app',
        'https://codecontextpro-mes.firebaseapp.com',
        /\.codecontext\.pro$/,
        'http://localhost:3000',
        'http://localhost:5000',
        'http://localhost:5173',
        'https://localhost:5000'
    ],
    credentials: true,
    optionsSuccessStatus: 200
});

/**
 * Security Headers Middleware
 */
function addSecurityHeaders(res: Response): void {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Content-Security-Policy': "default-src 'self' 'unsafe-inline' https://js.stripe.com; script-src 'self' 'unsafe-inline' https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.stripe.com; frame-src https://js.stripe.com;",
        'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
}

/**
 * Email Validation Function
 */
function validateEmail(email: string): boolean {
    if (!email || typeof email !== 'string') {
        return false;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 255;
}

/**
 * Security: Detect potential secrets in input data
 */
function validateNoSecrets(data: any): void {
    const content = JSON.stringify(data);
    const secretPatterns = [
        /sk_[a-zA-Z0-9_]{20,}/,
        /AIza[0-9A-Za-z\-_]{35}/,
        /pk_live_[a-zA-Z0-9]{24,}/,
        /password\s*[:=]\s*[^\s]+/i,
        /secret\s*[:=]\s*[^\s]+/i,
        /api[_\s]*key\s*[:=]\s*[^\s]+/i
    ];

    for (const pattern of secretPatterns) {
        if (pattern.test(content)) {
            throw new HttpsError(
                'invalid-argument',
                'SECURITY: Potential secret detected in request data'
            );
        }
    }
}



/**
 * Get Pricing HTTP Function (v2)
 */
export const getPricingHttp = onRequest(
    { secrets: [MEMORY_PRICE_ID] },
    async (req: Request, res: Response) => {
        try {
            addSecurityHeaders(res);
            
            corsHandler(req, res, async () => {
                if (req.method !== 'GET') {
                    res.status(405).json({ error: 'Method not allowed' });
                    return;
                }

                // Access secrets - fallback to env for local development
                const memoryPrice = process.env.LOCAL_MEMORY_PRICE_ID || process.env.MEMORY_PRICE_ID || MEMORY_PRICE_ID.value();

                if (!memoryPrice) {
                    console.error('❌ Critical configuration missing: Stripe price ID not configured');
                    res.status(500).json({ 
                        error: 'Pricing system configuration incomplete',
                        message: 'Pricing temporarily unavailable - contact administrator' 
                    });
                    return;
                }

                res.json({
                    pricing: {
                        memory: {
                            name: 'Memory Pro',
                            price: 19,
                            currency: 'USD',
                            period: 'month',
                            description: 'Building the Future Together - Support our API platform development',
                            limits: {
                                memory: 'unlimited',
                                projects: 'unlimited',
                                executions: 'coming-soon'
                            },
                            features: [
                                '5,000 Memory Recalls/month',
                                'Unlimited Projects',
                                'Persistent AI Memory',
                                'Support API Platform Development'
                            ],
                            stripePriceId: memoryPrice
                        }
                    },
                    mission: {
                        title: 'Building the Future Together',
                        description: 'Every CLI subscription funds development of our open API platform, democratizing persistent AI memory for the entire industry.'
                    }
                });
            });
            
        } catch (error) {
            console.error('❌ Error in getPricingHttp:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

/**
 * Create Checkout Session (v2)
 */
export const createCheckout = onRequest(
    { secrets: [STRIPE_SECRET_KEY, MEMORY_PRICE_ID] },
    async (req: Request, res: Response) => {
        try {
            addSecurityHeaders(res);
            
            corsHandler(req, res, async () => {
                if (req.method !== 'POST') {
                    res.status(405).json({ error: 'Method not allowed' });
                    return;
                }

                const { email, tier } = req.body;

                if (!email || typeof email !== 'string') {
                    res.status(400).json({ error: 'Email is required' });
                    return;
                }

                if (!tier || typeof tier !== 'string') {
                    res.status(400).json({ error: 'Tier is required' });
                    return;
                }

                if (!validateEmail(email)) {
                    res.status(400).json({ error: 'Invalid email format' });
                    return;
                }

                validateNoSecrets(req.body);

                // Validate tier (only 'memory' tier available now)
                if (tier !== 'memory') {
                    res.status(400).json({ 
                        error: 'Invalid tier. Only "memory" tier is available.',
                        availableTiers: ['memory']
                    });
                    return;
                }

                // Access secrets with fallback for local development
                const memoryPrice = process.env.LOCAL_MEMORY_PRICE_ID || process.env.MEMORY_PRICE_ID || MEMORY_PRICE_ID.value();

                if (!memoryPrice) {
                    console.error('❌ Critical configuration missing: Stripe price ID not configured');
                    res.status(500).json({ 
                        error: 'Payment system configuration incomplete',
                        message: 'Contact administrator - pricing not configured' 
                    });
                    return;
                }

                const priceIds: Record<string, string> = {
                    memory: memoryPrice
                };

                const priceId = priceIds[tier];
                if (!priceId) {
                    console.error('❌ Invalid tier requested:', tier);
                    res.status(400).json({ error: 'Missing price ID' });
                    return;
                }

                // Initialize Stripe with the secret key
                const stripeInstance = new Stripe(
                    process.env.LOCAL_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.value(),
                    { apiVersion: '2023-10-16' }
                );

                const session = await stripeInstance.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [{
                        price: priceId,
                        quantity: 1
                    }],
                    mode: 'subscription',
                    customer_email: email,
                    success_url: `${req.headers.origin || 'http://localhost:5000'}/success.html?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${req.headers.origin || 'http://localhost:5000'}/`,
                    metadata: {
                        tier,
                        email,
                        source: 'codecontextpro'
                    }
                });

                console.log('✅ Checkout session created', {
                    sessionId: session.id,
                    email: email.substring(0, 3) + '***',
                    tier,
                    timestamp: new Date().toISOString(),
                    ip: req.ip,
                    userAgent: req.get('User-Agent')
                });

                res.json({
                    sessionId: session.id,
                    url: session.url
                });
            });
            
        } catch (error) {
            console.error('❌ Error in createCheckout:', error);
            
            if (error instanceof HttpsError) {
                res.status(400).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Please contact support' });
            }
        }
    }
);

/**
 * Stripe Webhook Handler (v2) - Updated for Keygen.sh
 */
export const stripeWebhook = onRequest(
    { secrets: [STRIPE_WEBHOOK_SECRET, KEYGEN_API_KEY, KEYGEN_ACCOUNT_ID, KEYGEN_PRODUCT_ID, STRIPE_SECRET_KEY] },
    async (req: Request, res: Response) => {
        try {
            addSecurityHeaders(res);

            if (req.method !== 'POST') {
                res.status(405).json({ error: 'Method not allowed' });
                return;
            }

            const sig = req.get('stripe-signature');
            const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET.value()).trim();

            if (!sig || !webhookSecret) {
                console.error('❌ Missing Stripe signature or webhook secret');
                res.status(400).json({ error: 'Missing signature or webhook secret' });
                return;
            }

            let event: Stripe.Event;

            try {
                const stripeInstance = new Stripe(
                    process.env.STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.value(),
                    { apiVersion: '2023-10-16' }
                );
                event = stripeInstance.webhooks.constructEvent((req as any).rawBody, sig, webhookSecret);
            } catch (err) {
                console.error('❌ Webhook signature verification failed:', err);
                res.status(400).json({ error: 'Invalid signature' });
                return;
            }

            if (event.type === 'checkout.session.completed') {
                const session = event.data.object as Stripe.Checkout.Session;
                
                console.log('✅ Payment successful for session:', session.id);
                
                const { tier, email } = session.metadata || {};
                
                if (!tier || !email) {
                    console.error('❌ Missing metadata in session:', session.id);
                    res.status(400).json({ error: 'Missing session metadata' });
                    return;
                }

                // Create license in Keygen.sh instead of custom system
                const keygenResult = await createKeygenLicense(email, tier);
                
                if (!keygenResult.success || !keygenResult.licenseKey) {
                    console.error('❌ Failed to create Keygen license:', keygenResult.error);
                    res.status(500).json({ error: 'License creation failed' });
                    return;
                }

                // Store payment record in Firestore for tracking
                const paymentRecord = {
                    email,
                    tier,
                    stripeSessionId: session.id,
                    stripeCustomerId: session.customer,
                    keygenLicenseKey: keygenResult.licenseKey.substring(0, 12) + '***', // Masked for security
                    amount: session.amount_total,
                    currency: session.currency,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'completed'
                };

                await admin.firestore()
                    .collection('payments')
                    .doc(session.id)
                    .set(paymentRecord);

                // Update stats - earlyAdoptersSold as per Phase 2.1 spec
                if (tier === 'memory') {
                    await admin.firestore()
                        .collection('public')
                        .doc('stats')
                        .set({
                            earlyAdoptersSold: admin.firestore.FieldValue.increment(1),
                            memoryTierUsers: admin.firestore.FieldValue.increment(1),
                            totalRevenue: admin.firestore.FieldValue.increment(19),
                            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                            keygenLicensesCreated: admin.firestore.FieldValue.increment(1)
                        }, { merge: true });
                }

                console.log('✅ Keygen license created and payment recorded:', keygenResult.licenseKey.substring(0, 12) + '***');
            }

            res.status(200).json({ received: true });

        } catch (error) {
            console.error('❌ Error in stripeWebhook:', error);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    }
);

// Legacy validateLicense function removed - replaced by Keygen.sh client-side validation

// Legacy getAuthToken function removed - Keygen.sh handles authentication directly

/**
 * Report Usage Function (v2)
 */
export const reportUsage = onCall(async (data, context) => {
    try {
        if (!data || typeof data !== 'object') {
            throw new HttpsError(
                'invalid-argument',
                'Invalid request data'
            );
        }

        validateNoSecrets(data);

        const { operation, metadata, projectId, timestamp, version } = (data as unknown) as {
            operation: string;
            metadata: any;
            projectId: string;
            timestamp: string;
            version: string;
        };

        if (!operation || typeof operation !== 'string') {
            throw new HttpsError(
                'invalid-argument',
                'Operation is required and must be a string'
            );
        }

        if (!timestamp || typeof timestamp !== 'string') {
            throw new HttpsError(
                'invalid-argument',
                'Timestamp is required and must be a string'
            );
        }

        const usageRecord = {
            operation: operation.trim(),
            metadata: metadata || {},
            projectId: projectId || 'unknown',
            timestamp: admin.firestore.Timestamp.fromDate(new Date(timestamp)),
            version: version || '1.0.0',
            reportedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await admin.firestore()
            .collection('usage')
            .add(usageRecord);

        console.log('✅ Usage reported successfully', {
            operation: operation.trim(),
            projectId: projectId || 'unknown',
            timestamp: timestamp
        });

        return {
            success: true,
            message: 'Usage reported successfully'
        };

    } catch (error) {
        console.error('❌ Error in reportUsage:', error);
        
        if (error instanceof HttpsError) {
            throw error;
        }
        
        throw new HttpsError(
            'internal',
            'Usage reporting failed'
        );
    }
});

// Legacy validateUsage function removed - usage limits now handled by Keygen.sh license validation

/**
 * Get License by Session Function (v2) - Updated for Keygen.sh
 * Retrieves license key for success page display
 */
export const getLicenseBySession = onRequest(
    { secrets: [] },
    async (req: Request, res: Response) => {
        try {
            addSecurityHeaders(res);
            
            corsHandler(req, res, async () => {
                if (req.method !== 'GET') {
                    res.status(405).json({ error: 'Method not allowed' });
                    return;
                }

                const sessionId = req.query.session_id as string;

                if (!sessionId || typeof sessionId !== 'string') {
                    res.status(400).json({ error: 'Session ID is required' });
                    return;
                }

                // Query payments by Stripe session ID (updated for Keygen.sh)
                const paymentSnapshot = await admin.firestore()
                    .collection('payments')
                    .doc(sessionId)
                    .get();

                if (!paymentSnapshot.exists) {
                    res.status(404).json({ error: 'Payment record not found for session' });
                    return;
                }

                const paymentData = paymentSnapshot.data();
                if (!paymentData) {
                    res.status(404).json({ error: 'Payment data not found' });
                    return;
                }

                // Note: We don't store the full license key for security
                // The customer will receive it via email or other secure channel
                res.status(200).json({
                    tier: paymentData.tier,
                    email: paymentData.email.substring(0, 3) + '***', // Partially masked
                    amount: paymentData.amount,
                    currency: paymentData.currency,
                    status: 'completed',
                    message: 'License created successfully! Check your email for the license key.',
                    instructions: 'Use "codecontextpro activate <LICENSE_KEY>" to activate your license.'
                });
            });
        } catch (error) {
            console.error('❌ Error in getLicenseBySession:', error);
            res.status(500).json({ error: 'Failed to retrieve payment information' });
        }
    }
);

/**
 * Get Firebase Configuration for Customer CLI Distribution
 * CRITICAL: Solves the Firebase config distribution issue for customer environments
 *
 * This is a PUBLIC endpoint that serves Firebase client configuration.
 * Firebase client config is meant to be public (it's in every web app's source).
 * The API key restrictions in Google Cloud Console provide the actual security.
 */
export const getFirebaseConfig = onRequest(
    {
        cors: true, // Allow all origins for this public config endpoint
        memory: '128MiB',
        timeoutSeconds: 30,
        invoker: 'public', // CRITICAL: Allow public access without authentication
        secrets: [FIREBASE_WEB_API_KEY], // SECURITY: Load API key from Secret Manager
    },
    async (req: Request, res: Response) => {
        try {
            console.log('🔧 Firebase config requested by customer CLI');

            // Add security headers
            res.set('Access-Control-Allow-Origin', '*');
            res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.set('Access-Control-Allow-Headers', 'Content-Type');
            res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

            // Handle preflight OPTIONS request
            if (req.method === 'OPTIONS') {
                res.status(204).send('');
                return;
            }

            // Only allow GET requests
            if (req.method !== 'GET') {
                res.status(405).json({ error: 'Method not allowed' });
                return;
            }

            // Firebase client configuration (using Secret Manager for API key)
            // SECURITY: API key from Secret Manager, other config from environment/defaults
            const firebaseConfig = {
                apiKey: FIREBASE_WEB_API_KEY.value(), // SECURE: Read from Secret Manager
                authDomain: process.env.FIREBASE_AUTH_DOMAIN || "codecontextpro-mes.firebaseapp.com",
                projectId: process.env.FIREBASE_PROJECT_ID || "codecontextpro-mes",
                storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "codecontextpro-mes.firebasestorage.app",
                messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "168225201154",
                appId: process.env.FIREBASE_APP_ID || "1:168225201154:web:e035d44d4a093ddcf7db1b",
                databaseURL: process.env.FIREBASE_DATABASE_URL || "https://codecontextpro-mes-default-rtdb.firebaseio.com"
            };

            // Validate that we have the required configuration
            if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
                console.error('❌ Firebase configuration incomplete - missing API key or project ID');
                res.status(500).json({
                    error: 'Firebase configuration not properly set up on server',
                    message: 'Please contact support - server configuration issue'
                });
                return;
            }

            console.log('✅ Firebase config served to customer CLI');

            // Return the configuration
            res.status(200).json({
                ...firebaseConfig,
                version: "1.0.0",
                distributedAt: new Date().toISOString(),
                note: "This configuration enables your CLI to connect to CodeContextPro-MES services"
            });

        } catch (error) {
            console.error('❌ Error serving Firebase config:', error);
            res.status(500).json({
                error: 'Failed to retrieve Firebase configuration',
                message: 'Please try again or contact support'
            });
        }
    }
);
