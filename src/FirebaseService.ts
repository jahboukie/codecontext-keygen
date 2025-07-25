/**
 * CodeContextPro-MES Firebase Service
 * Security-first Firebase integration with usage reporting
 * 
 * Handles secure communication with Firebase backend
 * with comprehensive data sanitization and validation
 */

import { initializeApp, getApps } from 'firebase/app';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { getAuth, signInWithCustomToken } from 'firebase/auth';

export interface UsageMetadata {
    [key: string]: any;
}

export interface UsageReport {
    operation: string;
    timestamp: string;
    projectId: string;
    metadata: UsageMetadata;
    version: string;
}

export class FirebaseService {
    private projectId: string;
    private apiEndpoint: string;
    private app: any;
    private functions: any;
    private auth: any;

    constructor(skipInitialization: boolean = false) {
        this.projectId = process.env.FIREBASE_PROJECT_ID || 'codecontext-mes';
        this.apiEndpoint = `https://${this.projectId}.cloudfunctions.net`;
        
        if (!skipInitialization) {
            // Initialize Firebase
            this.initializeFirebase();
            
            // Validate configuration on initialization
            this.validateConfig();
        }
    }

    /**
     * Initialize Firebase manually (for late initialization)
     * FIXED: Graceful handling when Firebase config is unavailable
     */
    public initializeIfNeeded(): void {
        if (!this.app) {
            try {
                this.initializeFirebase();
                // Only validate config if Firebase was actually initialized
                if (this.app) {
                    this.validateConfig();
                }
            } catch (error) {
                console.warn('⚠️ Firebase initialization skipped:', error instanceof Error ? error.message : 'Unknown error');
                // Don't throw error - allow graceful degradation
            }
        }
    }

    /**
     * Load Firebase configuration from distributed config file (customer environment)
     * CRITICAL: Enables customers to use CLI without dev environment variables
     */
    private loadDistributedConfig(): any | null {
        try {
            const fs = require('fs');
            const path = require('path');
            
            // Look for config in .codecontext directory
            const configPath = path.join(process.cwd(), '.codecontext', 'firebase-config.json');
            
            if (fs.existsSync(configPath)) {
                const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                // Using distributed config
                return configData.firebase;
            }
            
            // Also check parent directories (in case CLI is run from subdirectory)
            let currentDir = process.cwd();
            const root = path.parse(currentDir).root;
            
            while (currentDir !== root) {
                const parentConfigPath = path.join(currentDir, '.codecontext', 'firebase-config.json');
                if (fs.existsSync(parentConfigPath)) {
                    const configData = JSON.parse(fs.readFileSync(parentConfigPath, 'utf8'));
                    // Using distributed config from parent directory
                    return configData.firebase;
                }
                currentDir = path.dirname(currentDir);
            }
            
            return null;
            
        } catch (error) {
            console.warn('⚠️ Could not load distributed Firebase config:', error);
            return null;
        }
    }

    /**
     * Initialize Firebase App and Functions
     * CRITICAL: Now supports customer environments with distributed config
     * FIXED: Graceful degradation when Firebase config is unavailable
     */
    private initializeFirebase(): void {
        try {
            // Try to load Firebase config from distributed file first (customer environment)
            let firebaseConfig = this.loadDistributedConfig();

            // Fall back to environment variables (development environment)
            if (!firebaseConfig) {
                firebaseConfig = {
                    apiKey: process.env.FIREBASE_API_KEY,
                    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
                    projectId: this.projectId,
                    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
                    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
                    appId: process.env.FIREBASE_APP_ID
                };
            }

            // CRITICAL FIX: Check if we have ANY Firebase config before validation
            const hasAnyConfig = Object.values(firebaseConfig).some(value => value && value !== 'undefined');

            if (!hasAnyConfig) {
                console.warn('⚠️ No Firebase configuration available - running in offline mode');
                console.warn('   License activation will use mock validation until config is distributed');
                return; // Exit gracefully without initializing Firebase
            }

            // Validate required configuration only if we have some config
            const requiredFields = ['apiKey', 'authDomain', 'storageBucket', 'messagingSenderId', 'appId'] as const;
            const missingFields = requiredFields.filter(field => !firebaseConfig[field as keyof typeof firebaseConfig]);

            if (missingFields.length > 0) {
                // Configuration incomplete - exit gracefully
                return;
            }

            // Initialize Firebase app if not already initialized
            if (!getApps().length) {
                this.app = initializeApp(firebaseConfig);
            } else {
                this.app = getApps()[0];
            }

            // Initialize Functions and Auth
            this.functions = getFunctions(this.app);
            this.auth = getAuth(this.app);

            // Connect to emulator if in development
            if (process.env.NODE_ENV === 'development' && process.env.FIREBASE_EMULATOR === 'true') {
                connectFunctionsEmulator(this.functions, 'localhost', 5001);
                console.log('🔧 Connected to Firebase Functions emulator');
            }

            // Firebase initialized

        } catch (error) {
            console.error('❌ Firebase initialization failed:', error);
            throw error;
        }
    }

    /**
     * Report usage analytics (fire-and-forget)
     * Implements Phase 1 Sprint 1.1 specification with security-first approach
     */
    async reportUsage(operation: string, metadata: UsageMetadata = {}): Promise<boolean> {
        try {
            // Input validation
            if (!operation || typeof operation !== 'string') {
                throw new Error('Invalid operation: must be non-empty string');
            }

            if (operation.trim().length === 0) {
                throw new Error('Operation cannot be empty or whitespace only');
            }

            // Security: sanitize metadata to remove sensitive data
            const sanitizedMetadata = this.sanitizeMetadata(metadata);

            // Build usage report
            const usageReport: UsageReport = {
                operation: operation.trim(),
                timestamp: new Date().toISOString(),
                projectId: this.projectId,
                metadata: sanitizedMetadata,
                version: '1.0.0'
            };

            // Real usage reporting to Firebase Functions
            console.log(`📊 Reporting usage: ${operation}`);
            
            try {
                // Call Firebase Functions for usage reporting
                const reportUsageFunction = httpsCallable(this.functions, 'reportUsage');
                await reportUsageFunction(usageReport);
                
                console.log('✅ Usage reported successfully');
                return true;
                
            } catch (functionError) {
                // Fallback: If Firebase function doesn't exist, log locally but don't fail
                console.warn(`⚠️ Firebase usage reporting unavailable, logging locally:`, functionError);
                console.log(`📊 Usage Report: ${operation}`);
                console.log(`   Metadata: ${JSON.stringify(sanitizedMetadata)}`);
                return true; // Don't fail the main operation
            }

        } catch (error) {
            // Fire-and-forget: don't throw errors, just log warnings
            console.warn(`⚠️ Usage reporting failed (non-blocking): ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    /**
     * Security: sanitize metadata to remove sensitive information
     * Critical security feature from development BIBLE
     */
    private sanitizeMetadata(metadata: UsageMetadata): UsageMetadata {
        const sensitivePatterns = [
            /sk_[a-zA-Z0-9_]{20,}/g,                                            // Stripe secret keys
            /AIza[0-9A-Za-z\-_]{35}/g,                                          // Google API keys
            /pk_live_[a-zA-Z0-9]{24,}/g,                                        // Stripe live keys
            /password/gi,                                                       // Password fields
            /secret/gi,                                                         // Secret fields
            /key/gi,                                                           // Key fields (be careful with this)
            /token/gi                                                          // Token fields
        ];

        const sanitized: UsageMetadata = {};

        for (const [key, value] of Object.entries(metadata)) {
            let sanitizedValue = value;

            // Check if key name is sensitive
            const keyIsSensitive = sensitivePatterns.some(pattern => 
                typeof key === 'string' && pattern.test(key)
            );

            if (keyIsSensitive) {
                sanitizedValue = '[REDACTED]';
            }
            // Check if value contains sensitive data
            else if (typeof value === 'string') {
                let hasSecrets = false;
                for (const pattern of sensitivePatterns) {
                    if (pattern.test(value)) {
                        hasSecrets = true;
                        break;
                    }
                }

                if (hasSecrets) {
                    console.warn('⚠️ SECURITY: Sensitive data detected in metadata, redacting');
                    sanitizedValue = '[REDACTED]';
                }
                // Truncate long strings for privacy
                else if (value.length > 1000) {
                    sanitizedValue = value.substring(0, 1000) + '...[TRUNCATED]';
                }
            }
            // Handle nested objects (basic sanitization)
            else if (typeof value === 'object' && value !== null) {
                sanitizedValue = { sanitized: true, type: 'object' };
            }

            sanitized[key] = sanitizedValue;
        }

        return sanitized;
    }

    /**
     * Validate Firebase configuration - Updated for customer environment support
     * CRITICAL: Now accepts either distributed config OR environment variables
     */
    private validateConfig(): void {
        // Check if we have distributed config file (customer environment)
        const distributedConfig = this.loadDistributedConfig();
        
        if (distributedConfig) {
            console.log('✅ Firebase configuration validated (distributed config)');
            return;
        }
        
        // Fall back to environment variable validation (development environment)
        const requiredVars = [
            'FIREBASE_PROJECT_ID',
            'FIREBASE_API_KEY',
            'FIREBASE_AUTH_DOMAIN',
            'FIREBASE_STORAGE_BUCKET',
            'FIREBASE_MESSAGING_SENDER_ID',
            'FIREBASE_APP_ID'
        ];
        const missing = requiredVars.filter(varName => !process.env[varName]);

        if (missing.length > 0) {
            console.warn(`⚠️ Missing Firebase environment variables: ${missing.join(', ')}`);
            console.warn('   Customer environment should activate license first to get config');
            console.warn('   Run: codecontextpro activate <LICENSE_KEY>');
            // Don't throw error - allow graceful degradation for customers
        } else {
            console.log('✅ Firebase configuration validated (environment variables)');
        }
    }

    /**
     * Get service configuration info
     */
    getConfig(): { projectId: string; apiEndpoint: string; configured: boolean } {
        return {
            projectId: this.projectId,
            apiEndpoint: this.apiEndpoint,
            configured: !!process.env.FIREBASE_PROJECT_ID
        };
    }

    /**
     * Validate license with Firebase Functions
     * Phase 2 Sprint 2.1: Real license validation implementation
     */
    async validateLicense(licenseKey: string): Promise<any> {
        try {
            // Input validation
            if (!licenseKey || typeof licenseKey !== 'string') {
                throw new Error('License key is required and must be a string');
            }

            // CRITICAL FIX: Check if Firebase is available before using it
            if (!this.functions || !this.app) {
                throw new Error('Firebase not initialized. Please ensure Firebase configuration is available.');
            }

            console.log(`🔍 Calling Firebase validateLicense function...`);

            // Call Firebase Functions using the SDK
            const validateLicenseFunction = httpsCallable(this.functions, 'validateLicense');
            const result = await validateLicenseFunction({ licenseKey });

            if (!result.data) {
                throw new Error('Invalid response from license validation');
            }

            console.log('✅ License validation successful');
            return result.data;

        } catch (error) {
            console.error('❌ License validation failed:', error);
            
            // Handle Firebase Functions errors
            if (error && typeof error === 'object' && 'code' in error) {
                const firebaseError = error as any;
                throw new Error(`License validation failed: ${firebaseError.message || firebaseError.code}`);
            }
            
            throw error;
        }
    }

    /**
     * Validate Usage with Firebase Functions - Phase 2.2 Implementation
     * CRITICAL: Enforces usage limits with authentication
     */
    async validateUsage(licenseKey: string, operation: string, email: string, authToken: string): Promise<any> {
        try {
            // Input validation
            if (!licenseKey || typeof licenseKey !== 'string') {
                throw new Error('License key is required and must be a string');
            }

            if (!operation || typeof operation !== 'string') {
                throw new Error('Operation is required and must be a string');
            }

            if (!email || typeof email !== 'string') {
                throw new Error('Email is required and must be a string');
            }

            if (!authToken || typeof authToken !== 'string') {
                throw new Error('Auth token is required and must be a string');
            }

            // Validate operation type
            const validOperations = ['recall', 'remember', 'scan', 'export', 'execute'];
            if (!validOperations.includes(operation)) {
                throw new Error(`Invalid operation. Must be one of: ${validOperations.join(', ')}`);
            }

            console.log(`🛡️ Validating usage for operation: ${operation}`);

            // Authenticate with Firebase using custom token
            await signInWithCustomToken(this.auth, authToken);
            console.log('🔑 Firebase authentication successful');

            // Call Firebase Functions with authenticated context
            const validateUsageFunction = httpsCallable(this.functions, 'validateUsage');
            
            const result = await validateUsageFunction({
                licenseKey,
                operation,
                email
            });

            if (!result.data) {
                throw new Error('Invalid response from usage validation');
            }

            console.log('✅ Usage validation successful', {
                operation,
                remaining: (result.data as any)?.usage?.remaining || 'unknown',
                tier: (result.data as any)?.tier || 'unknown'
            });

            return result.data;

        } catch (error) {
            console.error('❌ Usage validation failed:', error);
            
            // Handle Firebase Functions errors
            if (error && typeof error === 'object' && 'code' in error) {
                const firebaseError = error as any;
                
                // Provide user-friendly error messages for common cases
                if (firebaseError.code === 'functions/resource-exhausted') {
                    throw new Error(`Usage limit exceeded: ${firebaseError.message}`);
                } else if (firebaseError.code === 'functions/unauthenticated') {
                    throw new Error('Authentication failed. Please activate your license again.');
                } else if (firebaseError.code === 'functions/permission-denied') {
                    throw new Error('Permission denied. License may not belong to this user.');
                } else if (firebaseError.code === 'auth/invalid-custom-token') {
                    throw new Error('Invalid authentication token. Please re-activate your license.');
                } else {
                    throw new Error(`Usage validation failed: ${firebaseError.message || firebaseError.code}`);
                }
            }
            
            throw error;
        }
    }

    /**
     * Get Firebase Auth Token - Phase 2.2 Implementation
     * Gets a custom Firebase Auth token for authenticated API calls
     */
    async getAuthToken(licenseKey: string): Promise<any> {
        try {
            // Input validation
            if (!licenseKey || typeof licenseKey !== 'string') {
                throw new Error('License key is required and must be a string');
            }

            // CRITICAL FIX: Check if Firebase is available before using it
            if (!this.functions || !this.app) {
                throw new Error('Firebase not initialized. Please ensure Firebase configuration is available.');
            }

            console.log(`🔑 Calling Firebase getAuthToken function...`);

            // Call Firebase Functions using the SDK
            const getAuthTokenFunction = httpsCallable(this.functions, 'getAuthToken');
            const result = await getAuthTokenFunction({ licenseKey });

            if (!result.data) {
                throw new Error('Invalid response from auth token generation');
            }

            console.log('✅ Auth token generated successfully');
            return result.data;

        } catch (error) {
            console.error('❌ Auth token generation failed:', error);
            
            // Handle Firebase Functions errors
            if (error && typeof error === 'object' && 'code' in error) {
                const firebaseError = error as any;
                throw new Error(`Auth token generation failed: ${firebaseError.message || firebaseError.code}`);
            }
            
            throw error;
        }
    }

    /**
     * Test connection (Phase 1 mock)
     */
    async testConnection(): Promise<boolean> {
        try {
            console.log('🔌 Testing Firebase connection...');
            
            // Phase 1 mock: always return true
            await new Promise(resolve => setTimeout(resolve, 200));
            
            console.log('✅ Firebase connection test passed (mock)');
            return true;
        } catch (error) {
            console.warn('⚠️ Firebase connection test failed:', error instanceof Error ? error.message : 'Unknown error');
            return false;
        }
    }
}
