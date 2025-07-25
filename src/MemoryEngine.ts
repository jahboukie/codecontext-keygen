/**
 * CodeContextPro-MES Memory Engine
 * Security-first persistent memory implementation with SQLite database
 * 
 * Copyright (c) 2025 CodeContext Team. All rights reserved.
 * 
 * PROPRIETARY SOFTWARE - NOT LICENSED UNDER MIT
 * This file contains proprietary intellectual property of CodeContext Team
 * and is not licensed under the MIT License applicable to the CLI tool.
 * 
 * The memory management algorithms, search optimization, and AI-context
 * integration techniques contained herein are trade secrets and proprietary
 * technology that power the CodeContextPro-MES service.
 * 
 * Unauthorized copying, redistribution, reverse engineering, or modification 
 * of this file, via any medium, is strictly prohibited without express 
 * written permission from CodeContext Team.
 * 
 * Handles secure storage and retrieval of development context
 * with comprehensive input validation and secret detection
 * 
 * Phase 1 Sprint 1.3: Real SQLite Database Integration
 */

import * as fs from 'fs';
import * as path from 'path';
import { MemoryDatabase, SearchOptions } from './database/MemoryDatabase';

export interface Memory {
    id: number;
    content: string;
    context: string;
    type: string;
    timestamp: string;
}

export interface SearchResult {
    id: number;
    content: string;
    relevance: number;
    timestamp: string;
}

export class MemoryEngine {
    private projectPath: string;
    private dbPath: string;
    private database: MemoryDatabase;
    private initialized: boolean = false;

    constructor(projectPath: string) {
        this.projectPath = projectPath;
        this.dbPath = path.join(projectPath, '.codecontext', 'memory.db');
        this.database = new MemoryDatabase(this.dbPath);
        // Don't validate project path in constructor - let init command create the directory
    }

    /**
     * Initialize database connection
     * Phase 1 Sprint 1.3: Real database initialization
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        
        try {
            await this.database.initialize();
            this.initialized = true;
            console.log('✅ Memory engine initialized with SQLite database');
        } catch (error) {
            console.error('❌ Failed to initialize memory engine:', error);
            throw error;
        }
    }

    /**
     * Store memory with security validation and real database persistence
     * Phase 1 Sprint 1.3: Real SQLite implementation
     */
    async storeMemory(content: string, context: string = 'cli-command', type: string = 'general'): Promise<number> {
        // Validate project is initialized (for non-init operations)
        this.validateProjectPath();

        // Ensure database is initialized
        await this.initialize();

        // Input validation (security requirement)
        if (!content || typeof content !== 'string') {
            throw new Error('Invalid content: must be non-empty string');
        }

        if (content.trim().length === 0) {
            throw new Error('Content cannot be empty or whitespace only');
        }

        if (content.length > 10000) {
            throw new Error('Content too large: max 10,000 characters');
        }

        // Security check: detect potential secrets
        this.validateNoSecrets(content);

        // Validate context and type
        if (context && typeof context !== 'string') {
            throw new Error('Context must be a string');
        }

        if (type && typeof type !== 'string') {
            throw new Error('Type must be a string');
        }

        try {
            // Store in SQLite database
            const memoryId = await this.database.storeMemory(
                content.trim(),
                context || 'unknown',
                type || 'general',
                [], // tags - can be extended later
                {} // metadata - can be extended later
            );

            console.log(`✅ Memory stored: [${type}] ${content.substring(0, 50)}...`);
            return memoryId;

        } catch (error) {
            console.error('❌ Failed to store memory:', error);
            throw error;
        }
    }

    /**
     * Search memories with real database full-text search
     * Phase 1 Sprint 1.3: Real SQLite FTS implementation
     */
    async searchMemories(query: string, limit: number = 10): Promise<SearchResult[]> {
        // Ensure database is initialized
        await this.initialize();

        // Input validation
        if (!query || typeof query !== 'string') {
            throw new Error('Invalid query: must be non-empty string');
        }

        if (query.trim().length === 0) {
            throw new Error('Query cannot be empty or whitespace only');
        }

        if (limit < 1 || limit > 100) {
            throw new Error('Limit must be between 1 and 100');
        }

        // Security: ensure query doesn't contain secrets
        this.validateNoSecrets(query);

        try {
            // Use real database search with FTS5
            const results = await this.database.searchMemories(query, {
                limit,
                minRelevance: 0.1
            });

            console.log(`✅ Search completed: "${query}" - Found ${results.length} results`);
            return results;

        } catch (error) {
            console.error('❌ Search failed:', error);
            throw error;
        }
    }

    /**
     * Security validation: detect potential secrets in content
     * Critical security feature from development BIBLE
     */
    private validateNoSecrets(content: string): void {
        const secretPatterns = [
            /sk_[a-zA-Z0-9_]{20,}/,                                         // Stripe secret keys
            /AIza[0-9A-Za-z\-_]{35}/,                                       // Google API keys  
            /pk_live_[a-zA-Z0-9]{24,}/,                                     // Stripe live keys
            /rk_live_[a-zA-Z0-9]{24,}/,                                     // Stripe restricted keys
            /password\s*[:=]\s*[^\s]+/i,                                    // Password assignments
            /secret\s*[:=]\s*[^\s]+/i,                                      // Secret assignments
            /api[_\s]*key\s*[:=]\s*[^\s]+/i                                 // API key assignments
        ];

        for (const pattern of secretPatterns) {
            if (pattern.test(content)) {
                throw new Error('SECURITY: Potential secret detected in content');
            }
        }
    }

    /**
     * Validate project path exists and has CodeContext Pro structure
     * Only called for operations that require an initialized project (not during init)
     */
    private validateProjectPath(): void {
        if (!fs.existsSync(this.projectPath)) {
            throw new Error(`Project path does not exist: ${this.projectPath}`);
        }

        const codecontextDir = path.join(this.projectPath, '.codecontext');
        if (!fs.existsSync(codecontextDir)) {
            throw new Error('CodeContext Pro not initialized. Run "codecontextpro init" first.');
        }
    }

    /**
     * Create project structure during initialization
     */
    private createProjectStructure(): void {
        const codecontextDir = path.join(this.projectPath, '.codecontext');
        if (!fs.existsSync(codecontextDir)) {
            fs.mkdirSync(codecontextDir, { recursive: true });
            console.log('📁 Created .codecontext directory');
        }
    }

    /**
     * Get database statistics
     * Phase 1 Sprint 1.3: Real database statistics
     */
    async getStats(): Promise<{ totalMemories: number; totalSizeBytes: number; lastUpdated: string }> {
        await this.initialize();
        return await this.database.getStats();
    }

    /**
     * Get memory by ID
     * Phase 1 Sprint 1.3: Database retrieval
     */
    async getMemoryById(id: number): Promise<any | null> {
        await this.initialize();
        return await this.database.getMemoryById(id);
    }

    /**
     * Delete memory by ID
     * Phase 1 Sprint 1.3: Database deletion
     */
    async deleteMemory(id: number): Promise<boolean> {
        await this.initialize();
        return await this.database.deleteMemory(id);
    }

    /**
     * Close database connection
     * Phase 1 Sprint 1.3: Proper cleanup
     */
    async close(): Promise<void> {
        if (this.initialized) {
            await this.database.close();
            this.initialized = false;
        }
    }

    /**
     * Get project information
     */
    getProjectInfo(): { path: string; dbPath: string; initialized: boolean } {
        return {
            path: this.projectPath,
            dbPath: this.dbPath,
            initialized: this.initialized
        };
    }

    /**
     * Initialize project and return project information
     * Used by codecontextpro init command
     */
    async initProject(): Promise<{ path: string; dbPath: string; initialized: boolean }> {
        // Create project structure first (this is what init does)
        this.createProjectStructure();

        // Now initialize the database
        await this.initialize();

        return this.getProjectInfo();
    }
}
