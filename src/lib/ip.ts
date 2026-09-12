import { Elysia } from 'elysia'

export const ip = new Elysia({ name: 'libs/ip' })
	.macro({
		ip: {
			derive({ headers, server, request }) {
				const forwardedIp = Bun.env.VERCEL === '1'
					? headers['x-forwarded-for']?.split(',')[0]?.trim()
					: undefined

				return {
					ip: forwardedIp || server?.requestIP(request)?.address || 'unidentified',
				}
			}
		}
	})
