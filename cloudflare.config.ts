import { defineConfig } from 'cf/config';

export default defineConfig({
	worker: {
		name: 'teardown',
		compatibilityDate: '2026-01-20',
		workersDev: false,
		assets: {
			notFoundHandling: 'single-page-application',
		},
	},
});
