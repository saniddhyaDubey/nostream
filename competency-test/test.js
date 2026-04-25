#!/usr/bin/env node

/**
 * Nostr Relay Monitor
 *
 * Connects to a Nostr relay via WebSocket and measures:
 *  - Events per second (overall and per-kind)
 *  - Kind distribution
 *  - Unique pubkeys observed
 *  - Event size distribution
 *  - Latency (EOSE response time)
 *
 * Usage:
 *   node nostr-relay-monitor.js [relay-url] [duration-seconds]
 *
 * Examples:
 *   node nostr-relay-monitor.js wss://relay.damus.io 60
 *   node nostr-relay-monitor.js wss://nos.lol 300
 *
 * Note: This gives you the events-per-second THIS relay is
 * sending to you as a subscriber. That's a reasonable proxy for
 * "new events the relay is accepting," since relays fan out
 * accepted events to subscribers in real time.
 */

import WebSocket from 'ws';

// ---- Config ----
const RELAY_URL = process.argv[2] || 'wss://relay.damus.io';
const DURATION_SECONDS = parseInt(process.argv[3] || '60', 10);
const PRINT_INTERVAL_SECONDS = 5;

// ---- State ----
const stats = {
  startTime: null,
  endTime: null,
  totalEvents: 0,
  eventsByKind: new Map(),       // kind -> count
  uniquePubkeys: new Set(),
  eventSizes: [],                 // bytes
  secondBuckets: new Map(),       // unix second -> count
  notices: [],
  errors: [],
  connectTime: null,
  firstEventTime: null,
  eoseReceived: false,
  eoseTime: null,
};

// ---- Kind labels (human readable) ----
const KIND_LABELS = {
  0: 'profile metadata',
  1: 'text note',
  3: 'contacts (follow list)',
  4: 'encrypted DM',
  5: 'event deletion',
  6: 'repost',
  7: 'reaction',
  40: 'channel create',
  41: 'channel metadata',
  42: 'channel message',
  1984: 'report',
  9734: 'zap request',
  9735: 'zap receipt',
  10002: 'relay list',
  30023: 'long-form article',
};

function labelForKind(kind) {
  return KIND_LABELS[kind] || `kind ${kind}`;
}

// ---- Connection ----
console.log(`\n🔌 Connecting to ${RELAY_URL}...`);
console.log(`⏱️  Will monitor for ${DURATION_SECONDS} seconds\n`);

const connectStart = Date.now();
const ws = new WebSocket(RELAY_URL);

ws.on('open', () => {
  stats.connectTime = Date.now() - connectStart;
  stats.startTime = Date.now();

  console.log(`✅ Connected in ${stats.connectTime}ms`);
  console.log(`📡 Subscribing to all events (no filter)...\n`);

  // Subscribe to ALL recent events with no historical limit.
  // limit: 0 means "don't send me historical events, only new ones"
  // Some relays ignore limit:0 and send a small history anyway — that's fine.
  const subscription = [
    'REQ',
    'monitor',
    {
      // No filters = everything. Some relays reject this; if so, try:
      // kinds: [0, 1, 3, 4, 6, 7]  (common kinds)
      limit: 0,
    },
  ];

  ws.send(JSON.stringify(subscription));

  // Start periodic reporting
  startPeriodicReport();

  // Schedule termination
  setTimeout(() => {
    console.log('\n⏹️  Duration reached, closing connection...');
    ws.close();
  }, DURATION_SECONDS * 1000);
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());
    const msgType = msg[0];

    if (msgType === 'EVENT') {
      handleEvent(msg[2], data.length);
    } else if (msgType === 'EOSE') {
      stats.eoseReceived = true;
      stats.eoseTime = Date.now() - stats.startTime;
      console.log(`📍 EOSE received after ${stats.eoseTime}ms (historical events done, now streaming new)\n`);
    } else if (msgType === 'NOTICE') {
      stats.notices.push(msg[1]);
      console.log(`📬 NOTICE: ${msg[1]}`);
    } else if (msgType === 'OK') {
      // Not relevant for a read-only monitor
    } else {
      console.log(`❓ Unknown message type: ${msgType}`);
    }
  } catch (err) {
    stats.errors.push(err.message);
  }
});

ws.on('error', (err) => {
  console.error(`❌ WebSocket error: ${err.message}`);
  stats.errors.push(err.message);
});

ws.on('close', () => {
  stats.endTime = Date.now();
  printFinalReport();
  process.exit(0);
});

// ---- Event handler ----
function handleEvent(event, rawBytes) {
  stats.totalEvents += 1;

  if (!stats.firstEventTime) {
    stats.firstEventTime = Date.now() - stats.startTime;
  }

  // Track kind
  const kind = event.kind;
  stats.eventsByKind.set(kind, (stats.eventsByKind.get(kind) || 0) + 1);

  // Track unique pubkeys
  if (event.pubkey) {
    stats.uniquePubkeys.add(event.pubkey);
  }

  // Track event size
  stats.eventSizes.push(rawBytes);

  // Bucket by second for rate calculation
  const second = Math.floor(Date.now() / 1000);
  stats.secondBuckets.set(second, (stats.secondBuckets.get(second) || 0) + 1);
}

// ---- Periodic reporting ----
function startPeriodicReport() {
  setInterval(() => {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const rate = stats.totalEvents / elapsed;
    const uniqueCount = stats.uniquePubkeys.size;

    console.log(
      `[${elapsed.toFixed(0).padStart(4)}s] ` +
      `📊 events: ${stats.totalEvents.toLocaleString().padStart(6)} | ` +
      `rate: ${rate.toFixed(1).padStart(5)}/s | ` +
      `unique pubkeys: ${uniqueCount.toLocaleString().padStart(5)} | ` +
      `kinds seen: ${stats.eventsByKind.size}`
    );
  }, PRINT_INTERVAL_SECONDS * 1000);
}

// ---- Final report ----
function printFinalReport() {
  const durationMs = stats.endTime - stats.startTime;
  const durationSec = durationMs / 1000;

  console.log('\n' + '='.repeat(70));
  console.log(`📈 FINAL REPORT: ${RELAY_URL}`);
  console.log('='.repeat(70));

  console.log(`\n⏱️  Duration: ${durationSec.toFixed(1)}s`);
  console.log(`🔌 Connection established: ${stats.connectTime}ms`);
  if (stats.firstEventTime) {
    console.log(`📬 Time to first event: ${stats.firstEventTime}ms`);
  }
  if (stats.eoseTime) {
    console.log(`📍 EOSE latency: ${stats.eoseTime}ms`);
  }

  // Overall rate
  const avgRate = stats.totalEvents / durationSec;
  console.log(`\n📊 EVENTS`);
  console.log(`   Total events received: ${stats.totalEvents.toLocaleString()}`);
  console.log(`   Average rate: ${avgRate.toFixed(2)} events/sec`);

  // Peak rate (best second)
  if (stats.secondBuckets.size > 0) {
    const peakRate = Math.max(...stats.secondBuckets.values());
    console.log(`   Peak rate: ${peakRate} events/sec`);

    // Also compute p50 / p95 per-second rates
    const rates = [...stats.secondBuckets.values()].sort((a, b) => a - b);
    const p50 = rates[Math.floor(rates.length * 0.5)];
    const p95 = rates[Math.floor(rates.length * 0.95)];
    console.log(`   Per-second p50: ${p50} events/sec`);
    console.log(`   Per-second p95: ${p95} events/sec`);
  }

  // Unique pubkeys
  console.log(`\n👥 AUTHORS`);
  console.log(`   Unique pubkeys seen: ${stats.uniquePubkeys.size.toLocaleString()}`);
  if (stats.totalEvents > 0) {
    const avgEventsPerPubkey = stats.totalEvents / stats.uniquePubkeys.size;
    console.log(`   Avg events per pubkey: ${avgEventsPerPubkey.toFixed(2)}`);
  }

  // Kind distribution
  console.log(`\n🏷️  KIND DISTRIBUTION`);
  const sortedKinds = [...stats.eventsByKind.entries()].sort((a, b) => b[1] - a[1]);
  const topKinds = sortedKinds.slice(0, 10);
  for (const [kind, count] of topKinds) {
    const pct = ((count / stats.totalEvents) * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(pct / 2));
    console.log(
      `   kind ${String(kind).padStart(5)} (${labelForKind(kind).padEnd(25)}): ` +
      `${count.toLocaleString().padStart(6)} (${pct.padStart(5)}%) ${bar}`
    );
  }
  if (sortedKinds.length > 10) {
    const otherCount = sortedKinds.slice(10).reduce((sum, [, c]) => sum + c, 0);
    console.log(`   ...${sortedKinds.length - 10} other kinds: ${otherCount.toLocaleString()}`);
  }

  // Event size
  if (stats.eventSizes.length > 0) {
    const sortedSizes = [...stats.eventSizes].sort((a, b) => a - b);
    const avgSize = sortedSizes.reduce((a, b) => a + b, 0) / sortedSizes.length;
    const p50Size = sortedSizes[Math.floor(sortedSizes.length * 0.5)];
    const p95Size = sortedSizes[Math.floor(sortedSizes.length * 0.95)];
    const maxSize = sortedSizes[sortedSizes.length - 1];

    console.log(`\n📦 EVENT SIZE (raw WebSocket frame bytes)`);
    console.log(`   Average: ${Math.round(avgSize)} bytes`);
    console.log(`   p50: ${p50Size} bytes`);
    console.log(`   p95: ${p95Size} bytes`);
    console.log(`   Max: ${maxSize} bytes`);
  }

  // Health checks
  console.log(`\n⚠️  ISSUES`);
  if (stats.notices.length === 0 && stats.errors.length === 0) {
    console.log(`   None — clean run ✅`);
  } else {
    if (stats.notices.length > 0) {
      console.log(`   Notices from relay (${stats.notices.length}):`);
      stats.notices.slice(0, 5).forEach(n => console.log(`     - ${n}`));
    }
    if (stats.errors.length > 0) {
      console.log(`   Errors (${stats.errors.length}):`);
      stats.errors.slice(0, 5).forEach(e => console.log(`     - ${e}`));
    }
  }

  // Interpretation helper
  console.log(`\n💡 INTERPRETATION`);
  if (avgRate < 1) {
    console.log(`   This is a low-traffic relay or quiet period.`);
    console.log(`   For WoT design: latency matters less, but recompute can be lazy.`);
  } else if (avgRate < 20) {
    console.log(`   This is a medium-traffic relay — typical for most public relays.`);
    console.log(`   For WoT design: lookup must be <1ms; millisecond-level checks are fine.`);
  } else {
    console.log(`   This is a high-traffic relay.`);
    console.log(`   For WoT design: lookup must be microseconds; in-memory set is mandatory.`);
    console.log(`   Any network hop on the hot path will hurt.`);
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

// ---- Graceful shutdown on Ctrl+C ----
process.on('SIGINT', () => {
  console.log('\n\n⏹️  Interrupted by user, finalizing...');
  ws.close();
});
