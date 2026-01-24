export const RECOMMENDATIONS: (string | string[])[] = [
	// UI frameworks
	'lit-html',
	'preact',
	'react',
	'solid-js',
	'svelte',
	'vue',

	// routing
	'@solidjs/router',
	['@tanstack/react-router', '@tanstack/solid-router'],
	'navaid',
	'path-to-regexp',
	'react-router',
	'regexparam',
	'trouter',
	'vue-router',
	'wouter',

	// state management
	'effector',
	'immer',
	'jotai',
	['mobx', 'mobx-react'],
	'nanostores',
	'pinia',
	['redux', 'react-redux'],
	'valtio',
	['@xstate/react', '@xstate/solid', '@xstate/svelte', '@xstate/vue'],
	'zustand',

	// standalone reactivity
	'@preact/signals-core',
	'@vue/reactivity',
	'alien-signals',

	// data fetching
	'@apollo/client',
	'graphql-request',
	[
		'@tanstack/angular-query',
		'@tanstack/react-query',
		'@tanstack/solid-query',
		'@tanstack/svelte-query',
		'@tanstack/vue-query',
	],
	['@trpc/client', '@trpc/react-query'],
	'swr',
	'urql',

	// HTTP clients
	'axios',
	'ky',
	'ofetch',
	'redaxios',
	'wretch',

	// validation/schema
	'ajv',
	'arktype',
	'@badrap/valita',
	'@sinclair/typebox',
	'superstruct',
	'valibot',
	'yup',
	'zod',

	// date/time
	['date-fns', '@date-fns/tz', '@date-fns/utc'],
	'dayjs',
	'@formkit/tempo',
	'luxon',

	// class names/styling
	'classnames',
	'clsx',
	'tailwind-merge',

	// ID generation
	'cuid2',
	'human-id',
	'nanoid',
	'ulid',
	'uuid',

	// deep clone/equality
	'dequal',
	'fast-deep-equal',
	'klona',
	'rfdc',

	// object utilities
	'deepmerge',
	'defu',
	'destr',
	'dot-prop',

	// string utilities
	'change-case',
	'slugify',

	// memoization / caching
	'fast-memoize',
	'memoize',
	'p-memoize',
	'tinylru',

	// throttle / debounce
	'throttle-debounce',

	// query strings
	'qs',
	'query-string',

	// i18n
	['@formatjs/intl', 'react-intl'],
	['@fluent/bundle', '@fluent/react'],
	['i18next', 'react-i18next', 'vue-i18n'],
	['@lingui/core', '@lingui/react'],
	'@inlang/paraglide-js',

	// markdown
	'markdown-it',
	'marked',
	'turndown',

	// syntax highlighting
	'highlight.js',
	'prismjs',
	'shiki',

	// rich text editors
	['lexical', '@lexical/react'],
	'quill',
	'slate',
	['@tiptap/core', '@tiptap/react', '@tiptap/vue-3', '@tiptap/starter-kit'],

	// template literals
	'htm',

	// search
	'fuse.js',
	'minisearch',

	// animation
	'animejs',
	'@formkit/auto-animate',
	['framer-motion', 'motion-v', 'motion'],
	'gsap',
	'popmotion',

	// forms
	['final-form', 'react-final-form'],
	'react-hook-form',
	[
		'@formisch/preact',
		'@formisch/qwik',
		'@formisch/react',
		'@formisch/solid',
		'@formisch/svelte',
		'@formisch/vue',
	],
	[
		'@tanstack/angular-form',
		'@tanstack/lit-form',
		'@tanstack/react-form',
		'@tanstack/solid-form',
		'@tanstack/svelte-form',
		'@tanstack/vue-form',
	],

	// tables
	[
		'@tanstack/angular-table',
		'@tanstack/lit-table',
		'@tanstack/qwik-table',
		'@tanstack/react-table',
		'@tanstack/solid-table',
		'@tanstack/svelte-table',
		'@tanstack/vue-table',
	],

	// virtualization
	'rc-virtual-list',
	'virtua',
	[
		'@tanstack/angular-virtual',
		'@tanstack/lit-virtual',
		'@tanstack/react-virtual',
		'@tanstack/solid-virtual',
		'@tanstack/svelte-virtual',
		'@tanstack/vue-virtual',
	],

	// drag and drop
	['@dnd-kit/core', '@dnd-kit/sortable'],
	'@atlaskit/pragmatic-drag-and-drop',
	'sortablejs',

	// charts / visualization
	'chart.js',
	'd3',
	'echarts',
	'recharts',

	// icons
	'@iconify/iconify',
	['lucide', 'lucide-react'],

	// toast / notifications
	'react-hot-toast',
	'sonner',

	// storage
	'idb',
	'idb-keyval',
	'localforage',

	// CSV
	'papaparse',

	// PDF
	'pdf-lib',
	'pdfjs-dist',

	// sanitization
	'dompurify',

	// compression
	'fflate',
	'pako',

	// encoding / binary
	'multiformats',
	'uint8arrays',

	// cryptography
	'@noble/curves',
	'@noble/hashes',

	// color
	'colord',
	'culori',

	// math / precision
	'big.js',
	'bignumber.js',
	'decimal.js',

	// formatting
	'ms',
	'pretty-bytes',

	// serialization
	'devalue',
	'ohash',
	'superjson',

	// events
	'eventemitter3',
	'mitt',

	// functional / result types
	'effect',
	'neverthrow',
	'true-myth',
	'ts-pattern',

	// promise utilities
	'p-all',
	'p-limit',
	'p-map',
	'p-queue',
	'p-series',

	// utilities
	'es-toolkit',
	'lodash-es',
	'ramda',

	// head management
	'react-helmet',
	'react-helmet-async',

	// React utilities
	'react-freeze',

	// web workers
	'comlink',

	// benchmarking
	'tinybench',

	// AI / LLM
	'ai',
	['@tanstack/ai', '@tanstack/ai-react', '@tanstack/ai-solid'],

	// UI component libraries
	'antd',
	'@base-ui/react',
	'@chakra-ui/react',
	'corvu',
	'@fluentui/react-components',
	['@mui/material', '@mui/joy'],
	['radix-ui', '@radix-ui/themes'],
	['radix-vue', 'reka-ui'],
	['react-aria', 'react-stately'],
	'tamagui',

	// CSS-in-JS / styling
	['@emotion/react', '@emotion/styled'],
	'styled-components',
	'styled-jsx',

	// positioning/floating
	'nanopop',
	['@floating-ui/dom', '@floating-ui/react', '@floating-ui/react-dom', '@floating-ui/vue'],
];
