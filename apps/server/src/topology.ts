/**
 * Server topology helper — thin re-export of shared pure helpers.
 * Keeps server code decoupled from direct shared import paths in tests.
 */
export { getAllRoomIds, getHallBounds, getRoomAt, getRoomRect, isInsideRoom, getElevatorX, lobbyBounds } from "@grandhotel/shared";
export type { HallBounds, RoomRect } from "@grandhotel/shared";
