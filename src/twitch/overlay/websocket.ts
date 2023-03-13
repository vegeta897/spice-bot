import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { DEV_MODE, timestampLog } from '../../util.js'
import { GraceEvents } from '../chat/grace.js'
import qs from 'node:querystring'

export function initWebsocket(server: http.Server) {
	if (!DEV_MODE) return
	const wsMap: Map<WebSocket, { isAlive: boolean }> = new Map()

	const wss = new WebSocketServer({ server })
	wss.on('connection', function (ws, req) {
		ws.on('error', console.error)

		wsMap.set(ws, { isAlive: true })

		console.log('host:', req.headers.host) // TODO: Verify host matches env var?
		const query = qs.parse(req.url || '')
		console.log('new ws connection', query.key)

		ws.on('message', function (message) {
			//
			// Here we can now use session parameters.
			//
			console.log(`Received message "${message}"`)
		})

		ws.on('pong', function onPong() {
			const wsData = wsMap.get(this)
			if (wsData) {
				wsData.isAlive = true
			} else {
				console.log('wsData NOT found!')
			}
		})

		ws.on('close', function () {
			wsMap.delete(ws)
		})
	})

	const pingInterval = setInterval(() => {
		wss.clients.forEach((ws) => {
			const wsData = wsMap.get(ws)
			if (!wsData) {
				console.log('ws client not found in map!')
				return
			}
			if (wsData.isAlive === false) return ws.terminate()
			wsData.isAlive = false
			ws.ping()
		})
	}, 10 * 1000)

	wss.on('close', () => {
		clearInterval(pingInterval)
	})

	GraceEvents.on('grace', (event) => {
		console.log('sending grace to ws clients')
		wss.clients.forEach((client) => {
			if (client.readyState !== WebSocket.OPEN) return
			client.send('grace!')
		})
	})
}
