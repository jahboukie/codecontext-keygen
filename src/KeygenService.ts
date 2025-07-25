/**
 * CodeContextPro-MES Keygen.sh Integration
 * Professional license validation using Keygen.sh API
 * 
 * Replaces the flawed Firebase-based license system with
 * a robust, professional licensing platform.
 */

export interface KeygenLicense {
    id: string;
    key: string;
    name?: string;
    status: 'active' | 'expired' | 'suspended' | 'banned';
    expiry?: string;
    maxActivations?: number;
    activations: number;
    metadata: Record<string, any>;
    created: string;
    updated: string;
}

export interface KeygenActivation {
    id: string;
    fingerprint: string;
    platform: string;
    hostname: string;
    created: string;
}

export interface KeygenValidationResponse {
    valid: boolean;
    license?: KeygenLicense;
    activations?: KeygenActivation[];
    message?: string;
    code?: string;
}

export interface KeygenActivationResponse {
    success: boolean;
    activation?: KeygenActivation;
    message?: string;
    code?: string;
}

export class KeygenService {
    private readonly apiUrl = 'https://api.keygen.sh/v1';
    private readonly accountId: string;
    private readonly apiKey: string;
    private readonly productId: string;

    constructor(accountId?: string, apiKey?: string, productId?: string) {
        this.accountId = accountId || process.env.KEYGEN_ACCOUNT_ID || 'c86687d0-695b-474c-bd18-e37d96969dcb';
        this.apiKey = apiKey || process.env.KEYGEN_API_KEY || '';
        this.productId = productId || process.env.KEYGEN_PRODUCT_ID || '';

        if (!this.accountId || !this.apiKey || !this.productId) {
            console.warn('⚠️ Keygen.sh credentials not found - license validation will fail');
            console.warn('   Set KEYGEN_ACCOUNT_ID, KEYGEN_API_KEY, and KEYGEN_PRODUCT_ID environment variables');
        }
    }

    /**
     * Validate a license key with Keygen.sh
     */
    async validateLicense(licenseKey: string): Promise<KeygenValidationResponse> {
        try {
            if (!licenseKey || typeof licenseKey !== 'string') {
                return {
                    valid: false,
                    message: 'License key is required and must be a string',
                    code: 'INVALID_INPUT'
                };
            }

            const trimmedKey = licenseKey.trim();
            if (trimmedKey.length === 0) {
                return {
                    valid: false,
                    message: 'License key cannot be empty',
                    code: 'EMPTY_KEY'
                };
            }

            console.log('🔍 Validating license with Keygen.sh...');

            const response = await fetch(`${this.apiUrl}/accounts/${this.accountId}/licenses/actions/validate-key`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/vnd.api+json',
                    'Accept': 'application/vnd.api+json'
                },
                body: JSON.stringify({
                    meta: {
                        key: trimmedKey,
                        scope: {
                            product: this.productId
                        }
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Keygen API error:', response.status, errorText);
                
                if (response.status === 401) {
                    return {
                        valid: false,
                        message: 'Invalid API credentials',
                        code: 'UNAUTHORIZED'
                    };
                } else if (response.status === 404) {
                    return {
                        valid: false,
                        message: 'License key not found',
                        code: 'LICENSE_NOT_FOUND'
                    };
                } else {
                    return {
                        valid: false,
                        message: 'License validation service unavailable',
                        code: 'SERVICE_ERROR'
                    };
                }
            }

            const data = await response.json();
            console.log('✅ Keygen validation response received');

            // Parse Keygen response format
            const keygenResponse = data as any; // Type assertion for Keygen API response
            const isValid = keygenResponse.meta?.valid === true;
            const license = keygenResponse.data ? this.parseLicenseData(keygenResponse.data) : undefined;
            const activations = keygenResponse.included?.filter((item: any) => item.type === 'activations')
                .map((item: any) => this.parseActivationData(item)) || [];

            return {
                valid: isValid,
                license,
                activations,
                message: isValid ? 'License is valid' : 'License is invalid',
                code: isValid ? 'VALID' : 'INVALID'
            };

        } catch (error) {
            console.error('❌ License validation error:', error);
            return {
                valid: false,
                message: error instanceof Error ? error.message : 'Unknown validation error',
                code: 'NETWORK_ERROR'
            };
        }
    }

    /**
     * Activate a license on the current machine
     */
    async activateLicense(licenseKey: string): Promise<KeygenActivationResponse> {
        try {
            if (!licenseKey || typeof licenseKey !== 'string') {
                return {
                    success: false,
                    message: 'License key is required and must be a string',
                    code: 'INVALID_INPUT'
                };
            }

            const fingerprint = this.generateMachineFingerprint();
            console.log('🔑 Activating license on machine...');

            const response = await fetch(`${this.apiUrl}/accounts/${this.accountId}/licenses/actions/activate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/vnd.api+json',
                    'Accept': 'application/vnd.api+json'
                },
                body: JSON.stringify({
                    meta: {
                        key: licenseKey.trim(),
                        scope: {
                            product: this.productId,
                            fingerprint
                        }
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Keygen activation error:', response.status, errorText);
                
                if (response.status === 422) {
                    return {
                        success: false,
                        message: 'License activation limit exceeded or already activated',
                        code: 'ACTIVATION_LIMIT_EXCEEDED'
                    };
                } else if (response.status === 404) {
                    return {
                        success: false,
                        message: 'License key not found',
                        code: 'LICENSE_NOT_FOUND'
                    };
                } else {
                    return {
                        success: false,
                        message: 'License activation failed',
                        code: 'ACTIVATION_FAILED'
                    };
                }
            }

            const data = await response.json();
            const keygenResponse = data as any; // Type assertion for Keygen API response
            const activation = keygenResponse.data ? this.parseActivationData(keygenResponse.data) : undefined;

            console.log('✅ License activated successfully');
            return {
                success: true,
                activation,
                message: 'License activated successfully',
                code: 'ACTIVATED'
            };

        } catch (error) {
            console.error('❌ License activation error:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown activation error',
                code: 'NETWORK_ERROR'
            };
        }
    }

    /**
     * Generate a machine fingerprint for license activation
     */
    private generateMachineFingerprint(): string {
        const os = require('os');
        const crypto = require('crypto');

        // Create a stable machine identifier
        const machineData = [
            os.hostname(),
            os.platform(),
            os.arch(),
            os.cpus()[0]?.model || 'unknown-cpu',
            os.networkInterfaces()
        ].join(':');

        return crypto.createHash('sha256').update(machineData).digest('hex').substring(0, 32);
    }

    /**
     * Parse Keygen license data from API response
     */
    private parseLicenseData(data: any): KeygenLicense {
        const attributes = data.attributes || {};
        
        return {
            id: data.id,
            key: attributes.key,
            name: attributes.name,
            status: attributes.status,
            expiry: attributes.expiry,
            maxActivations: attributes.maxActivations,
            activations: attributes.activations || 0,
            metadata: attributes.metadata || {},
            created: attributes.created,
            updated: attributes.updated
        };
    }

    /**
     * Parse Keygen activation data from API response
     */
    private parseActivationData(data: any): KeygenActivation {
        const attributes = data.attributes || {};
        
        return {
            id: data.id,
            fingerprint: attributes.fingerprint,
            platform: attributes.platform,
            hostname: attributes.hostname,
            created: attributes.created
        };
    }

    /**
     * Check if service is properly configured
     */
    isConfigured(): boolean {
        return !!(this.accountId && this.apiKey && this.productId);
    }

    /**
     * Get service configuration status
     */
    getConfigStatus(): {
        configured: boolean;
        hasAccountId: boolean;
        hasApiKey: boolean;
        hasProductId: boolean;
    } {
        return {
            configured: this.isConfigured(),
            hasAccountId: !!this.accountId,
            hasApiKey: !!this.apiKey,
            hasProductId: !!this.productId
        };
    }
}