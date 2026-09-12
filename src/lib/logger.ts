import { AsyncLocalStorage } from 'node:async_hooks'
import { configure, getConsoleSink, getJsonLinesFormatter, getLogger } from '@logtape/logtape'
import { elysiaLogger } from '@logtape/elysia'
import { isDev } from './env'

const level = isDev ? 'debug' : 'info'

await configure({
	sinks: {
		console: getConsoleSink({
			formatter: isDev ? undefined : getJsonLinesFormatter(),
		}),
	},
	contextLocalStorage: new AsyncLocalStorage(),
	loggers: [
		{
			category: ['maya'],
			sinks: ['console'],
			lowestLevel: level
		},
		{ category: ['logtape', 'meta'], sinks: ['console'], lowestLevel: 'warning' },
	]
})

export const logger = getLogger(['maya'])

export const httpLogger = elysiaLogger({
	category: ['maya', 'http'],
	format: isDev ? 'dev' : 'structured-combined',
	level,
	skip: ({ path }) => path === '/',
	context: true,
})
