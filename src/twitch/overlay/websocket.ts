import http from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { timestampLog } from '../../util.js'
import {
	createTrainStartEvent,
	GraceTrainEvents,
	type OverlayData,
	type TrainAddData,
	type TrainEndData,
	type TrainStartData,
} from '../chat/graceEvents.js'
import { getData, modifyData } from '../../db.js'
import randomstring from 'randomstring'
import { getCurrentTrain } from '../chat/graceStats.js'
import { getOverlayPosition } from '../chat/grace.js'

const version = 1

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
				if (err) console.log(err)
				ws.terminate()
			})
			return
		}
		wsMap.set(ws, { isAlive: true })
		timestampLog(
			`Received websocket connection from ${req.headers.host} (${wsMap.size})`
		)

		ws.send(
			JSON.stringify({
				type: 'init',
				data: {
					version,
					noTrains: !getCurrentTrain(),
					position: getOverlayPosition(),
				},
			}),
			(err) => {
				if (err) console.log('Error sending websocket init message', err)
				sendStartedTrain(ws)
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
					sendStartedTrain(ws)
					break
				default:
					console.log('Websocket received unrecognized message:', message)
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

	GraceTrainEvents.on('start', (event) => {
		console.log('sending train start event to ws clients')
		sendMessage(wss, { type: 'train-start', data: event })
	})
	GraceTrainEvents.on('add', (event) => {
		console.log('sending train add event to ws clients')
		sendMessage(wss, { type: 'train-add', data: event })
	})
	GraceTrainEvents.on('end', (event) => {
		console.log('sending train end event to ws clients')
		sendMessage(wss, { type: 'train-end', data: event })
	})
	GraceTrainEvents.on('overlay', (event) => {
		console.log('sending overlay event to ws clients')
		sendMessage(wss, { type: 'overlay', data: event })
	})
}

type Message =
	| { type: 'init'; data: { version: number; noTrains: boolean } & OverlayData }
	| { type: 'train-start'; data: TrainStartData }
	| { type: 'train-add'; data: TrainAddData }
	| { type: 'train-end'; data: TrainEndData }
	| { type: 'overlay'; data: OverlayData }

type IncomingMessage = { type: 'train-query'; data: { id: string } }

function sendMessage(wss: WebSocketServer, message: Message) {
	wss.clients.forEach((client) => {
		if (client.readyState !== WebSocket.OPEN) return
		client.send(JSON.stringify(message), (err) => {
			if (err) timestampLog('Error sending websocket message:', err)
		})
	})
}

function sendStartedTrain(ws: WebSocket) {
	const trainInProgress = getCurrentTrain()
	if (!trainInProgress || trainInProgress.endUsername) return
	console.log('Sending grace train in progress')
	ws.send(
		JSON.stringify({
			type: 'train-start',
			data: createTrainStartEvent(trainInProgress),
		})
	)
}
