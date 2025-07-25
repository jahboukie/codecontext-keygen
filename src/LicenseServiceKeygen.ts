/**
 * CodeContextPro-MES License Service - Keygen.sh Integration
 * Simplified license management using professional Keygen.sh platform
 * 
 * Replaces the complex Firebase-based license system with a clean,
 * professional licensing solution.
 */

import { KeygenService, KeygenLicense, KeygenValidationResponse } from './KeygenService';
import * as fs from 'fs';
import * as path from 'path';

export interface License {
    key: string;
    tier: string;
    active: boolean;
    features: string[];
    activatedAt: string;
    expiresAt?: string;
    email?: string;
    maxActivations?: number;
    currentActivations: number;
}

export interface LicenseStatus {
    tier: string;
    active: boolean;
    features: string[];
    daysRemaining?: number;
    activationsUsed: number;
    maxActivations?: number;
    mock?: boolean;
}

export interface PurchaseResult {
    success: boolean;
    tier: string;
    message: string;
    nextStep?: string;
    checkoutUrl?: string;
}

export class LicenseServiceKeygen {
    private keygenService: KeygenService;
    private licenseFile: string;
    private currentLicense: License | null = null;

    constructor(projectPath: string = process.cwd()) {
        this.keygenService = new KeygenService();
        this.licenseFile = path.join(projectPath, '.codecontext', 'license.json');
        
        // Load cached license if exists
        this.loadCachedLicense();
    }

    /**
     * Activate license using Keygen.sh
     */
    async activateLicense(licenseKey: string): Promise<License> {
        try {
            console.log('🔑 Activating license with Keygen.sh...');

            if (!licenseKey || typeof licenseKey !== 'string') {
                throw new Error('License key is required and must be a string');
            }

            const trimmedKey = licenseKey.trim();
            if (trimmedKey.length === 0) {
                throw new Error('License key cannot be empty');
            }

            // First validate the license
            const validation = await this.keygenService.validateLicense(trimmedKey);
            if (!validation.valid || !validation.license) {
                throw new Error(validation.message || 'License validation failed');
            }

            // Then activate it on this machine
            const activation = await this.keygenService.activateLicense(trimmedKey);
            if (!activation.success) {
                // If activation fails but license is valid, it might already be activated
                console.log('⚠️ Activation failed, but license is valid - may already be activated');
            }

            // Create our license object from Keygen data
            const license: License = {
                key: trimmedKey,
                tier: this.determineTier(validation.license),
                active: validation.license.status === 'active',
                features: this.determineFeatures(validation.license),
                activatedAt: new Date().toISOString(),
                expiresAt: validation.license.expiry || undefined,
                email: validation.license.metadata?.email || undefined,
                maxActivations: validation.license.maxActivations || undefined,
                currentActivations: validation.license.activations
            };

            // Cache the license locally
            await this.cacheLicense(license);
            this.currentLicense = license;

            console.log('✅ License activated successfully');
            console.log(`   Tier: ${license.tier}`);
            console.log(`   Features: ${license.features.join(', ')}`);
            
            return license;

        } catch (error) {
            console.error('❌ License activation failed:', error);
            throw new Error(error instanceof Error ? error.message : 'License activation failed');
        }
    }

    /**
     * Validate current license (online check)
     */
    async validateLicense(): Promise<boolean> {
        try {
            if (!this.currentLicense) {
                return false;
            }

            const validation = await this.keygenService.validateLicense(this.currentLicense.key);
            
            if (validation.valid && validation.license) {
                // Update cached license with fresh data
                this.currentLicense.active = validation.license.status === 'active';
                this.currentLicense.currentActivations = validation.license.activations;
                await this.cacheLicense(this.currentLicense);
                
                return this.currentLicense.active;
            }

            return false;

        } catch (error) {
            console.warn('⚠️ Online license validation failed, using cached license');
            return this.currentLicense?.active || false;
        }
    }

    /**
     * Get current license (from cache)
     */
    getCurrentLicense(): License {
        if (!this.currentLicense) {
            throw new Error('No active license found. Please run: codecontextpro activate <LICENSE_KEY>');
        }

        return this.currentLicense;
    }

    /**
     * Check if license has specific feature
     */
    hasFeature(feature: string): boolean {
        if (!feature || typeof feature !== 'string') {
            return false;
        }

        try {
            const license = this.getCurrentLicense();
            return license.active && license.features.includes(feature);
        } catch {
            return false;
        }
    }

    /**
     * Check if license allows specific operation
     */
    canPerformOperation(operation: string): boolean {
        if (!operation || typeof operation !== 'string') {
            return false;
        }

        try {
            const license = this.getCurrentLicense();
            
            if (!license.active) {
                console.log(`❌ License inactive, operation blocked: ${operation}`);
                return false;
            }

            // Feature-based operation checking
            const operationFeatureMap: { [key: string]: string } = {
                'remember': 'unlimited_memory',
                'recall': 'unlimited_memory',
                'scan': 'project_scanning',
                'export': 'memory_export',
                'sync': 'cloud_sync'
            };

            const requiredFeature = operationFeatureMap[operation];
            if (requiredFeature) {
                return this.hasFeature(requiredFeature);
            }

            // Default: allow basic operations
            console.log(`✅ Operation allowed: ${operation}`);
            return true;

        } catch {
            return false;
        }
    }

    /**
     * Get license status summary
     */
    getLicenseStatus(): LicenseStatus {
        try {
            const license = this.getCurrentLicense();
            
            let daysRemaining: number | undefined;
            if (license.expiresAt) {
                const expiry = new Date(license.expiresAt);
                const now = new Date();
                daysRemaining = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            }

            return {
                tier: license.tier,
                active: license.active,
                features: license.features,
                daysRemaining,
                activationsUsed: license.currentActivations,
                maxActivations: license.maxActivations,
                mock: false
            };

        } catch {
            return {
                tier: 'none',
                active: false,
                features: [],
                activationsUsed: 0,
                mock: false
            };
        }
    }

    /**
     * Determine tier from Keygen license data
     */
    private determineTier(keygenLicense: KeygenLicense): string {
        // Check metadata or license name for tier information
        const metadata = keygenLicense.metadata || {};
        
        if (metadata.tier) {
            return metadata.tier;
        }

        if (keygenLicense.name?.toLowerCase().includes('memory')) {
            return 'memory';
        }

        // Default tier
        return 'memory';
    }

    /**
     * Determine features from Keygen license data
     */
    private determineFeatures(keygenLicense: KeygenLicense): string[] {
        const tier = this.determineTier(keygenLicense);
        const metadata = keygenLicense.metadata || {};

        // Features based on tier
        if (tier === 'memory') {
            return [
                'unlimited_memory',
                'unlimited_projects',
                'project_scanning',
                'memory_export',
                'persistent_memory',
                'aes_encryption',
                'priority_support'
            ];
        }

        // Custom features from metadata
        if (metadata.features && Array.isArray(metadata.features)) {
            return metadata.features;
        }

        // Default features
        return ['basic_memory', 'limited_projects'];
    }

    /**
     * Cache license to local file
     */
    private async cacheLicense(license: License): Promise<void> {
        try {
            const licenseDir = path.dirname(this.licenseFile);
            if (!fs.existsSync(licenseDir)) {
                fs.mkdirSync(licenseDir, { recursive: true });
            }

            const cacheData = {
                ...license,
                cachedAt: new Date().toISOString(),
                version: '2.0.0-keygen'
            };

            fs.writeFileSync(this.licenseFile, JSON.stringify(cacheData, null, 2));
            console.log('💾 License cached locally');

        } catch (error) {
            console.warn('⚠️ Failed to cache license:', error);
            // Don't throw - caching is not critical
        }
    }

    /**
     * Load cached license from local file
     */
    private loadCachedLicense(): void {
        try {
            if (!fs.existsSync(this.licenseFile)) {
                return;
            }

            const cacheData = JSON.parse(fs.readFileSync(this.licenseFile, 'utf8'));
            
            // Validate cache format
            if (cacheData.version === '2.0.0-keygen' && cacheData.key) {
                this.currentLicense = {
                    key: cacheData.key,
                    tier: cacheData.tier,
                    active: cacheData.active,
                    features: cacheData.features || [],
                    activatedAt: cacheData.activatedAt,
                    expiresAt: cacheData.expiresAt,
                    email: cacheData.email,
                    maxActivations: cacheData.maxActivations,
                    currentActivations: cacheData.currentActivations || 0
                };

                console.log('📋 Cached license loaded');
            }

        } catch (error) {
            console.warn('⚠️ Failed to load cached license:', error);
            // Clear invalid cache
            try {
                fs.unlinkSync(this.licenseFile);
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Purchase license (redirects to external purchase flow)
     * Since Keygen.sh handles the purchase externally, this method
     * provides guidance on how to purchase
     */
    async purchaseLicense(tier: string = 'memory'): Promise<PurchaseResult> {
        try {
            // Validate tier
            const validTiers = ['memory'];
            if (!tier || typeof tier !== 'string' || !validTiers.includes(tier.toLowerCase())) {
                return {
                    success: false,
                    tier: tier || 'unknown',
                    message: `Invalid tier: ${tier}. Valid options: ${validTiers.join(', ')}`,
                    nextStep: 'Please specify a valid tier'
                };
            }

            const normalizedTier = tier.toLowerCase();

            // In the Keygen.sh model, purchases happen externally
            // This method provides guidance on how to purchase
            return {
                success: false,
                tier: normalizedTier,
                message: 'License purchase must be completed externally through CodeContext Pro website',
                nextStep: 'Visit https://codecontextpro.com to purchase a license, then activate it using: codecontextpro activate <LICENSE_KEY>'
            };

        } catch (error) {
            return {
                success: false,
                tier: tier || 'unknown',
                message: error instanceof Error ? error.message : 'Purchase failed',
                nextStep: 'Please try again or contact support'
            };
        }
    }

    /**
     * Check if Keygen service is configured
     */
    isConfigured(): boolean {
        return this.keygenService.isConfigured();
    }

    /**
     * Get configuration status
     */
    getConfigStatus() {
        return this.keygenService.getConfigStatus();
    }
}