export interface TelemetryRecord {
  type: string;
  timestamp: number;
  actorSessionId?: string;
  targetSessionId?: string;
  roomId?: string;
  shaft?: string;
  floor?: number;
  fromFloor?: number;
  destFloor?: number;
  valid?: boolean;
  wasTargetSaboteur?: boolean;
  crimeOccurred?: boolean;
  winner?: "staff" | "saboteur" | null;
  saboteurSessionId?: string;
  traitorSessionId?: string;
  traitorName?: string;
  coverage?: number;
  coveragePercent?: number;
  preppedCount?: number;
  trashedCount?: number;
  cleanCount?: number;
  timeSinceCrimeMs?: number;
  crimeTimestamp?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export interface DecoyCallStats {
  totalCalls: number;
  decoyCalls: number;
  decoyRate: number;
}

export interface RoundKpis {
  roundDurationMs: number;
  roundDurationSeconds: number;
  winner: "staff" | "saboteur" | null;
  saboteurWon: boolean;
  totalAccusations: number;
  correctAccusations: number;
  correctAccusationRate: number;
  totalCatches: number;
  catchesPerHour: number;
  timeToFirstCrimeDiscoveryMs: number | null;
  timeToFirstCrimeDiscoverySeconds: number | null;
  totalCalls: number;
  decoyCalls: number;
  decoyCallRate: number;
  coverageSamplesCount: number;
  finalCoverage: number;
}

export interface AggregateKpis {
  totalRounds: number;
  saboteurWins: number;
  staffWins: number;
  saboteurWinRate: number;
  totalAccusations: number;
  correctAccusations: number;
  correctAccusationRate: number;
  totalCatches: number;
  totalDurationMs: number;
  totalDurationHours: number;
  catchesPerHour: number;
  averageTimeToFirstCrimeDiscoveryMs: number | null;
  averageTimeToFirstCrimeDiscoverySeconds: number | null;
  totalCalls: number;
  totalDecoyCalls: number;
  decoyCallRate: number;
}

/**
 * Parse JSONL string into an array of typed telemetry records.
 */
export function parseTelemetryJsonl(jsonl: string): TelemetryRecord[] {
  if (!jsonl || typeof jsonl !== "string") return [];
  return jsonl
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TelemetryRecord);
}

function normalizeEvents(recordsOrJsonl: TelemetryRecord[] | string): TelemetryRecord[] {
  if (typeof recordsOrJsonl === "string") {
    return parseTelemetryJsonl(recordsOrJsonl);
  }
  return recordsOrJsonl;
}

/**
 * Computes saboteur win rate across one or more rounds.
 */
export function computeSaboteurWinRate(
  rounds: Array<TelemetryRecord[] | string> | (TelemetryRecord[] | string),
): number {
  const roundList: TelemetryRecord[][] = Array.isArray(rounds) && rounds.length > 0 && (typeof rounds[0] === "string" || Array.isArray(rounds[0]))
    ? (rounds as Array<TelemetryRecord[] | string>).map(normalizeEvents)
    : [normalizeEvents(rounds as TelemetryRecord[] | string)];

  let saboteurWins = 0;
  let completedRounds = 0;

  for (const events of roundList) {
    const end = events.find((e) => e.type === "round_end") as
      | { type: "round_end"; winner: string | null }
      | undefined;
    if (end && end.winner) {
      completedRounds++;
      if (end.winner === "saboteur") {
        saboteurWins++;
      }
    }
  }

  return completedRounds > 0 ? saboteurWins / completedRounds : 0;
}

/**
 * Computes correct accusation rate: correct accusations / total accusations.
 */
export function computeCorrectAccusationRate(recordsOrJsonl: TelemetryRecord[] | string): number {
  const events = normalizeEvents(recordsOrJsonl);
  const accusations = events.filter((e) => e.type === "accusation") as Array<{
    type: "accusation";
    valid: boolean;
  }>;

  if (accusations.length === 0) return 0;
  const correct = accusations.filter((a) => a.valid).length;
  return correct / accusations.length;
}

/**
 * Computes catches per hour normalized by round duration.
 */
export function computeCatchesPerHour(
  recordsOrJsonl: TelemetryRecord[] | string,
  durationSecondsOverride?: number,
): number {
  const events = normalizeEvents(recordsOrJsonl);
  const catches = events.filter((e) => e.type === "catch").length;

  let durationSec = durationSecondsOverride;
  if (durationSec === undefined || durationSec <= 0) {
    const end = events.find((e) => e.type === "round_end") as
      | { type: "round_end"; durationMs: number }
      | undefined;
    if (end && typeof end.durationMs === "number" && end.durationMs > 0) {
      durationSec = end.durationMs / 1000;
    } else if (events.length > 1) {
      const first = events[0].timestamp;
      const last = events[events.length - 1].timestamp;
      if (typeof first === "number" && typeof last === "number" && last > first) {
        durationSec = (last - first) / 1000;
      }
    }
  }

  if (!durationSec || durationSec <= 0) return 0;
  const hours = durationSec / 3600;
  return catches / hours;
}

/**
 * Computes time from first sabotage crime until first staff discovery / catch.
 * Returns elapsed milliseconds or null if no crime occurred or was never discovered.
 */
export function computeTimeToFirstCrimeDiscovery(
  recordsOrJsonl: TelemetryRecord[] | string,
): number | null {
  const events = normalizeEvents(recordsOrJsonl);
  const crimes = events.filter((e) => e.type === "sabotage");
  if (crimes.length === 0) return null;

  const firstCrime = crimes[0];
  const crimeTime = firstCrime.timestamp;

  // Potential discovery events occurring at or after the crime
  const discoveries = events.filter((e) => {
    if (e.timestamp < crimeTime) return false;
    if (e.type === "discovery") return true;
    if (e.type === "catch") return true;
    if (e.type === "accusation" && (e as { valid?: boolean }).valid === true) return true;
    return false;
  });

  if (discoveries.length === 0) return null;

  const firstDiscovery = discoveries[0];
  return Math.max(0, firstDiscovery.timestamp - crimeTime);
}

/**
 * Computes decoy call usage: elevator calls when caller never enters / boards.
 */
export function computeDecoyCallUsage(
  recordsOrJsonl: TelemetryRecord[] | string,
): DecoyCallStats {
  const events = normalizeEvents(recordsOrJsonl);
  const calls = events.filter((e) => e.type === "call") as Array<{
    type: "call";
    timestamp: number;
    actorSessionId: string;
    shaft: string;
  }>;
  const rides = events.filter((e) => e.type === "ride") as Array<{
    type: "ride";
    timestamp: number;
    actorSessionId: string;
    shaft: string;
  }>;

  if (calls.length === 0) {
    return { totalCalls: 0, decoyCalls: 0, decoyRate: 0 };
  }

  let decoyCalls = 0;
  for (const call of calls) {
    // Check if the caller rode the elevator shaft after calling
    const matchingRide = rides.find(
      (r) =>
        r.shaft === call.shaft &&
        r.actorSessionId === call.actorSessionId &&
        r.timestamp >= call.timestamp,
    );
    if (!matchingRide) {
      decoyCalls++;
    }
  }

  return {
    totalCalls: calls.length,
    decoyCalls,
    decoyRate: decoyCalls / calls.length,
  };
}

/**
 * Computes all deduplication & KPI metrics for a single round's telemetry.
 */
export function computeRoundKpis(recordsOrJsonl: TelemetryRecord[] | string): RoundKpis {
  const events = normalizeEvents(recordsOrJsonl);

  const endRecord = events.find((e) => e.type === "round_end") as
    | {
        type: "round_end";
        winner: "staff" | "saboteur" | null;
        durationMs: number;
        coverage: number;
      }
    | undefined;

  let durationMs = endRecord?.durationMs ?? 0;
  if (durationMs <= 0 && events.length > 1) {
    const first = events[0].timestamp;
    const last = events[events.length - 1].timestamp;
    if (typeof first === "number" && typeof last === "number") {
      durationMs = Math.max(0, last - first);
    }
  }
  const durationSeconds = durationMs / 1000;

  const winner = endRecord?.winner ?? null;
  const saboteurWon = winner === "saboteur";

  const accusations = events.filter((e) => e.type === "accusation") as Array<{
    type: "accusation";
    valid: boolean;
  }>;
  const totalAccusations = accusations.length;
  const correctAccusations = accusations.filter((a) => a.valid).length;
  const correctAccusationRate =
    totalAccusations > 0 ? correctAccusations / totalAccusations : 0;

  const totalCatches = events.filter((e) => e.type === "catch").length;
  const catchesPerHour = computeCatchesPerHour(events, durationSeconds);

  const timeToFirstCrimeDiscoveryMs = computeTimeToFirstCrimeDiscovery(events);
  const timeToFirstCrimeDiscoverySeconds =
    timeToFirstCrimeDiscoveryMs !== null ? timeToFirstCrimeDiscoveryMs / 1000 : null;

  const decoyStats = computeDecoyCallUsage(events);

  const coverageSamples = events.filter((e) => e.type === "coverage_sample");
  const lastSample = coverageSamples[coverageSamples.length - 1] as
    | { coverage?: number }
    | undefined;
  const finalCoverage = endRecord?.coverage ?? lastSample?.coverage ?? 0;

  return {
    roundDurationMs: durationMs,
    roundDurationSeconds: durationSeconds,
    winner,
    saboteurWon,
    totalAccusations,
    correctAccusations,
    correctAccusationRate,
    totalCatches,
    catchesPerHour,
    timeToFirstCrimeDiscoveryMs,
    timeToFirstCrimeDiscoverySeconds,
    totalCalls: decoyStats.totalCalls,
    decoyCalls: decoyStats.decoyCalls,
    decoyCallRate: decoyStats.decoyRate,
    coverageSamplesCount: coverageSamples.length,
    finalCoverage,
  };
}

/**
 * Computes aggregated KPIs across multiple rounds.
 */
export function computeAggregateKpis(
  rounds: Array<TelemetryRecord[] | string>,
): AggregateKpis {
  const roundKpisList = rounds.map(computeRoundKpis);

  const totalRounds = roundKpisList.length;
  let saboteurWins = 0;
  let staffWins = 0;
  let totalAccusations = 0;
  let correctAccusations = 0;
  let totalCatches = 0;
  let totalDurationMs = 0;
  let totalCalls = 0;
  let totalDecoyCalls = 0;

  const discoveryTimesMs: number[] = [];

  for (const kpi of roundKpisList) {
    if (kpi.winner === "saboteur") saboteurWins++;
    if (kpi.winner === "staff") staffWins++;
    totalAccusations += kpi.totalAccusations;
    correctAccusations += kpi.correctAccusations;
    totalCatches += kpi.totalCatches;
    totalDurationMs += kpi.roundDurationMs;
    totalCalls += kpi.totalCalls;
    totalDecoyCalls += kpi.decoyCalls;
    if (kpi.timeToFirstCrimeDiscoveryMs !== null) {
      discoveryTimesMs.push(kpi.timeToFirstCrimeDiscoveryMs);
    }
  }

  const completedRounds = saboteurWins + staffWins;
  const saboteurWinRate = completedRounds > 0 ? saboteurWins / completedRounds : 0;
  const correctAccusationRate =
    totalAccusations > 0 ? correctAccusations / totalAccusations : 0;
  const totalDurationHours = totalDurationMs / (1000 * 3600);
  const catchesPerHour =
    totalDurationHours > 0 ? totalCatches / totalDurationHours : 0;
  const decoyCallRate = totalCalls > 0 ? totalDecoyCalls / totalCalls : 0;

  const averageTimeToFirstCrimeDiscoveryMs =
    discoveryTimesMs.length > 0
      ? discoveryTimesMs.reduce((a, b) => a + b, 0) / discoveryTimesMs.length
      : null;
  const averageTimeToFirstCrimeDiscoverySeconds =
    averageTimeToFirstCrimeDiscoveryMs !== null
      ? averageTimeToFirstCrimeDiscoveryMs / 1000
      : null;

  return {
    totalRounds,
    saboteurWins,
    staffWins,
    saboteurWinRate,
    totalAccusations,
    correctAccusations,
    correctAccusationRate,
    totalCatches,
    totalDurationMs,
    totalDurationHours,
    catchesPerHour,
    averageTimeToFirstCrimeDiscoveryMs,
    averageTimeToFirstCrimeDiscoverySeconds,
    totalCalls,
    totalDecoyCalls,
    decoyCallRate,
  };
}
