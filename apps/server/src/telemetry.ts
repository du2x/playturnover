export type TelemetryEventType =
  | "round_start"
  | "coverage_sample"
  | "prep"
  | "sabotage"
  | "call"
  | "ride"
  | "catch"
  | "accusation"
  | "discovery"
  | "round_end";

export interface TelemetryRoundStart {
  type: "round_start";
  timestamp: number;
  saboteurSessionId: string;
  playerCount: number;
  players: string[];
  shiftEndsAt: number;
}

export interface TelemetryCoverageSample {
  type: "coverage_sample";
  timestamp: number;
  coverage: number;
  coveragePercent: number;
  preppedCount: number;
  trashedCount: number;
  cleanCount: number;
}

export interface TelemetryPrepEvent {
  type: "prep";
  timestamp: number;
  actorSessionId: string;
  roomId: string;
  valid: boolean;
  wasTargetSaboteur: boolean;
  crimeOccurred: boolean;
  shaft?: string;
  targetSessionId?: string;
}

export interface TelemetrySabotageEvent {
  type: "sabotage";
  timestamp: number;
  actorSessionId: string;
  roomId: string;
  valid: boolean;
  wasTargetSaboteur: boolean;
  crimeOccurred: boolean;
  shaft?: string;
  targetSessionId?: string;
}

export interface TelemetryCallEvent {
  type: "call";
  timestamp: number;
  actorSessionId: string;
  shaft: string;
  floor: number;
  valid: boolean;
  wasTargetSaboteur: boolean;
  crimeOccurred: boolean;
  roomId?: string;
  targetSessionId?: string;
}

export interface TelemetryRideEvent {
  type: "ride";
  timestamp: number;
  actorSessionId: string;
  shaft: string;
  fromFloor?: number;
  destFloor?: number;
  valid: boolean;
  wasTargetSaboteur: boolean;
  crimeOccurred: boolean;
  roomId?: string;
  targetSessionId?: string;
}

export interface TelemetryCatchEvent {
  type: "catch";
  timestamp: number;
  actorSessionId: string;
  targetSessionId: string;
  roomId: string;
  valid: boolean;
  wasTargetSaboteur: boolean;
  crimeOccurred: boolean;
  shaft?: string;
}

export interface TelemetryAccusationEvent {
  type: "accusation";
  timestamp: number;
  actorSessionId: string;
  targetSessionId: string;
  valid: boolean;
  wasTargetSaboteur: boolean;
  crimeOccurred: boolean;
  roomId?: string;
  shaft?: string;
}

export interface TelemetryDiscoveryEvent {
  type: "discovery";
  timestamp: number;
  actorSessionId: string;
  roomId: string;
  timeSinceCrimeMs: number;
  crimeTimestamp: number;
}

export interface TelemetryRoundEnd {
  type: "round_end";
  timestamp: number;
  winner: "staff" | "saboteur" | null;
  traitorSessionId: string;
  traitorName: string;
  coverage: number;
  coveragePercent: number;
  durationMs: number;
}

export type TelemetryRecord =
  | TelemetryRoundStart
  | TelemetryCoverageSample
  | TelemetryPrepEvent
  | TelemetrySabotageEvent
  | TelemetryCallEvent
  | TelemetryRideEvent
  | TelemetryCatchEvent
  | TelemetryAccusationEvent
  | TelemetryDiscoveryEvent
  | TelemetryRoundEnd;

export class TelemetryLogger {
  private records: TelemetryRecord[] = [];

  public log(record: TelemetryRecord): void {
    this.records.push(record);
  }

  public getRecords(): TelemetryRecord[] {
    return [...this.records];
  }

  public toJsonl(): string {
    return this.records.map((r) => JSON.stringify(r)).join("\n");
  }

  public clear(): void {
    this.records = [];
  }
}
