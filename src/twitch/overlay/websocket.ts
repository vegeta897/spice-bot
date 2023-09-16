import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { DEV_MODE } from '../../util.js'
import { spiceLog, timestampLog } from '../../logger.js'
import { TrainEvents, getCurrentTrain } from '../chat/trains.js'
import { getData, modifyData } from '../../db.js'
import randomstring from 'randomstring'
import { getOverlayPosition } from '../chat/grace.js'
import { TrainWSMessage } from 'grace-train-lib/trains'

const version = 4

export function initWebsocket(server: http.Server) {
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
			ws.send('invalid-key', (err) => {
				if (err) spiceLog(err)
				ws.terminate()
			})
			return
		}
		wsMap.set(ws, { isAlive: true })
		timestampLog(
			`Received websocket connection from ${req.headers.host} (${wsMap.size})`
		)

		ws.send(
			stringifyMessage({
				type: 'init',
				data: {
					version,
					train: getCurrentTrain(),
					position: getOverlayPosition(),
				},
			}),
			(err) => {
				if (err) timestampLog('Error sending websocket init message', err)
			}
		)

		ws.on('error', (err) => timestampLog('Websocket error:', err))

		ws.on('message', function (data) {
			let message: IncomingMessage
			try {
				message = JSON.parse(data as unknown as string)
			} catch (e) {
				timestampLog('Websocket received non-JSON message:', data)
				return
			}
			switch (message.type) {
				case 'train-query':
					sendTrainIfExists(ws)
					break
				default:
					timestampLog('Websocket received unrecognized message:', message)
					break
			}
		})

		ws.on('pong', function onPong() {
			const wsData = wsMap.get(this)
			if (wsData) wsData.isAlive = true
		})

		ws.on('close', function () {
			wsMap.delete(ws)
			timestampLog(`Websocket connection closed (${wsMap.size})`)
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

	TrainEvents.on('start', (event) => {
		if (DEV_MODE) console.log('sending train start event to ws clients')
		sendMessage(wss, { type: 'train-start', data: event })
	})
	TrainEvents.on('add', (event) => {
		if (DEV_MODE) console.log('sending train add event to ws clients')
		sendMessage(wss, { type: 'train-add', data: event })
	})
	TrainEvents.on('end', (event) => {
		if (DEV_MODE) console.log('sending train end event to ws clients')
		sendMessage(wss, { type: 'train-end', data: event })
	})
	TrainEvents.on('overlay', (event) => {
		if (DEV_MODE) console.log('sending overlay event to ws clients')
		sendMessage(wss, { type: 'overlay', data: event })
	})
}

type IncomingMessage = { type: 'train-query'; data: { id: string } }

// For type safety on message object
const stringifyMessage = (message: TrainWSMessage) => JSON.stringify(message)

function sendMessage(wss: WebSocketServer, message: TrainWSMessage) {
	wss.clients.forEach((client) => {
		if (client.readyState !== WebSocket.OPEN) return
		client.send(stringifyMessage(message), (err) => {
			if (err) timestampLog('Error sending websocket message:', err)
		})
	})
}

function sendTrainIfExists(ws: WebSocket) {
	const trainInProgress = getCurrentTrain()
	if (!trainInProgress) return
	timestampLog('Sending grace train in progress')
	ws.send(stringifyMessage({ type: 'train-start', data: trainInProgress }))
}
