import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { DEV_MODE, timestampLog } from '../../util.js'
import {
	GraceTrainEvents,
	TrainAddData,
	TrainEndData,
	TrainStartData,
} from '../chat/graceEvents.js'
import { getData, modifyData } from '../../db.js'
import randomstring from 'randomstring'

export function initWebsocket(server: http.Server) {
	if (!DEV_MODE) return
	const authKeys = [...getData().streamOverlayAuthKeys]
	if (authKeys.length === 0) {
		authKeys.push(
			randomstring.generate({
				length: 10,
				readable: true,
				capitalization: 'lowercase',
			})
		)
		modifyData({ streamOverlayAuthKeys: authKeys })
	}
	const wsMap: Map<WebSocket, { isAlive: boolean }> = new Map()

	const wss = new WebSocketServer({ server })
	wss.on('connection', function (ws, req) {
		const params = new URLSearchParams((req.url || '').replace(/^\//g, ''))
		const authKey = params.get('key')
		if (!authKey || !authKeys.includes(authKey)) {
			timestampLog(
				`Received websocket connection from ${req.headers.host} with invalid auth key (${authKey})`
			)
			ws.terminate()
			return
		}
		timestampLog(`Received websocket connection from ${req.headers.host}`)

		wsMap.set(ws, { isAlive: true })

		ws.on('error', (err) => timestampLog('WebSocket error:', err))

		ws.on('message', function (message) {
			timestampLog(`Websocket received message "${message}"`)
		})

		ws.on('pong', function onPong() {
			const wsData = wsMap.get(this)
			if (wsData) wsData.isAlive = true
		})

		ws.on('close', function () {
			timestampLog('Websocket connection closed')
			wsMap.delete(ws)
		})
	})

	const pingInterval = setInterval(() => {
		wss.clients.forEach((ws) => {
			const wsData = wsMap.get(ws)
			if (!wsData) return
			if (wsData.isAlive === false) return ws.terminate()
			wsData.isAlive = false
			ws.ping()
		})
	}, 10 * 1000)

	wss.on('close', () => {
		clearInterval(pingInterval)
	})

	GraceTrainEvents.on('start', (event) => {
		console.log('sending train start event to ws clients')
		sendMessage(wss, { type: 'start', data: event })
	})
	GraceTrainEvents.on('add', (event) => {
		console.log('sending train add event to ws clients')
		sendMessage(wss, { type: 'add', data: event })
	})
	GraceTrainEvents.on('end', (event) => {
		console.log('sending train end event to ws clients')
		sendMessage(wss, { type: 'end', data: event })
	})
}

type Message =
	| { type: 'start'; data: TrainStartData }
	| { type: 'add'; data: TrainAddData }
	| { type: 'end'; data: TrainEndData }

function sendMessage(wss: WebSocketServer, message: Message) {
	wss.clients.forEach((client) => {
		if (client.readyState !== WebSocket.OPEN) return
		client.send(JSON.stringify(message))
	})
}
