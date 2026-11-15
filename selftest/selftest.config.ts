import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', timeout: 10000, use: { channel: 'chrome' } });
