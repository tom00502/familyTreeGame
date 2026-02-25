import { gameState } from '../../../utils/gameState'

export default defineEventHandler((event) => {
  const roomId = getRouterParam(event, 'id')

  if (!roomId) {
    throw createError({ statusCode: 400, message: '缺少 roomId' })
  }

  const room = gameState.rooms.get(roomId)

  if (!room) {
    throw createError({ statusCode: 404, message: '房間不存在' })
  }

  return {
    roomId: room.roomId,
    roomName: room.roomName,
    status: room.status,
    isLocked: room.isLocked,
    playerCount: room.players.size,
  }
})
