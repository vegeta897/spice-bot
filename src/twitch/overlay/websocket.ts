import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { DEV_MODE, timestampLog } from '../../util.js'
import { GraceTrainEvents } from '../chat/graceEvents.js'
import qs from 'node:querystring'

export function initWebsocket(server: http.Server) {
	if (!DEV_MODE) return
	const wsMap: Map<WebSocket, { isAlive: boolean }> = new Map()

	const wss = new WebSocketServer({ server })
	wss.on('connection', function (ws, req) {
		ws.on('error', console.error)

		wsMap.set(ws, { isAlive: true })

		// TODO: Verify host matches env var?
		const query = qs.parse(req.url || '')
		console.log('new ws connection', query.key, 'host:', req.headers.host)

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

	GraceTrainEvents.on('start', (event) => {
		// console.log('sending train start to ws clients')
		sendMessage(wss, 'start train!')
	})
	GraceTrainEvents.on('grace', (event) => {
		// console.log('sending grace to ws clients')
		sendMessage(wss, 'grace!')
	})
	GraceTrainEvents.on('end', (event) => {
		// console.log('sending train end to ws clients')
		sendMessage(wss, 'train ended!')
	})
}

function sendMessage(wss: WebSocketServer, message: string) {
	wss.clients.forEach((client) => {
		if (client.readyState !== WebSocket.OPEN) return
		client.send(message)
	})
}
