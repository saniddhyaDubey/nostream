# Nostream Competency Test

This directory contains a TypeScript-based implementation of a Web of Trust (WoT) builder and NIP-13 Proof of Work verifier for the Nostr protocol. It demonstrates proficiency with the Nostream relay infrastructure, Nostr protocol NIPs, and TypeScript development.

## Overview

The competency test fulfills three core requirements:

1. **Local Nostream Development Environment Setup** — Setting up and running Nostream locally
2. **Web of Trust Graph Builder** — A TypeScript script that connects to a public Nostr relay, fetches Kind 3 (contact list) events, recursively traverses social graphs up to a configurable depth, and measures performance
3. **NIP-13 Proof of Work Validator** — A function that validates whether a Nostr event ID meets a specific Proof of Work difficulty target

## Project Structure

```
competency-test/
├── index.ts          # Core WoT builder and PoW verifier logic
├── cli.ts            # Interactive CLI interface
├── graphBuilder.ts   # HTML graph visualization export
└── README.md         # This file
```

## Implementation Details

### 1. Web of Trust Builder (`index.ts`)

The `buildWoT()` function implements a multi-hop social graph traversal:

**Flow:**
1. Connects to a public Nostr relay via WebSocket
2. Sends a NIP-01 REQ message to fetch Kind 3 events for the seed pubkey
3. Parses "p" tags from the contact list to extract follows
4. For each hop, collects all unique pubkeys and batches Kind 3 requests
5. Tracks metrics: unique pubkeys, total edges, per-hop timing
6. Exports the graph as an interactive HTML visualization

**Key Features:**
- **Configurable depth**: Control traversal depth via `MAX_HOPS` constant
- **Rate limiting**: Batches requests in groups of up to 500 authors per REQ
- **Visited tracking**: Prevents duplicate requests and cycle detection
- **Performance metrics**: Per-hop and total execution time
- **Multiple relay support**: Choose between Damus, Nos.lol, or Primal relays

**Configuration (edit in `index.ts`):**
```typescript
const RELAY_URL = "wss://relay.damus.io";
const SEED_PUBKEY = "npub19pxkqvlna77masux62kjq56m7s065769mx7jjxltglqy2rcxk6jqrqe7gq";
const MAX_HOPS = 2;
```

**Output:**
```
Connecting to wss://relay.damus.io...
Connected in 245ms. Sending Kind-3 request for seed pubkey.
Hop 1 done in 3021ms: 523 contact list(s) · 2935 total edges · 524 unique pubkeys so far
Hop 2 done in 8456ms: 1771 contact lists · [cumulative stats]

─── Final summary ───
Hops traversed: 2
Unique pubkeys: 2295
Total edges: 2935
Total time: 11722ms

📊 Graph written to: /absolute/path/wot-graph.html
   Open it in a browser to explore the Web of Trust.
```

### 2. NIP-13 Proof of Work Verifier (`index.ts`)

The `verifyEventPow()` function validates event Proof of Work according to NIP-13:

**Algorithm:**
1. Counts leading zero bits in the event ID (SHA-256 hash)
2. Extracts the committed PoW target from the event's nonce tag
3. Compares actual difficulty against committed target

**Return object:**
```typescript
{
  actualDifficulty: number;        // Leading zero bits in event ID
  committedTarget: number | null;  // Target from nonce tag, if present
  valid: boolean;                  // Whether event meets or exceeds target
  message: string;                 // Human-readable verdict
}
```

**Validation cases:**
- ✅ **Valid**: Event ID has ≥ committed target difficulty
- ✅ **Valid (uncommitted)**: Event has no nonce tag (always passes)
- ❌ **Invalid**: Event ID has < committed target difficulty
- ❌ **Invalid**: Nonce tag has non-numeric or missing target

### 3. CLI Interface (`cli.ts`)

Interactive menu with two options:

```
=== Moderation & Discovery Engine ===
1) Build Web of Trust
2) Verify NIP-13 PoW of an event
```

**Option 1**: Runs `buildWoT()` with pre-configured constants (edit source to change)

**Option 2**: 
- Accepts a Nostr event as single-line JSON
- Validates the event structure and PoW
- Displays detailed verdict

**Example event validation:**
```json
{
  "id": "000000001cf53c0fb19e54d62ba27ec5e38e55f9dff6a63a4b8a0f0fa6d22b17",
  "pubkey": "...",
  "kind": 1,
  "tags": [["nonce", "1000000", "20"]],
  "content": "...",
  "created_at": 1234567890,
  "sig": "..."
}
```

### 4. Graph Visualization (`graphBuilder.ts`)

Exports the follow graph as an interactive HTML page using **vis-network**:

**Features:**
- **Node styling**: Seed pubkey highlighted in red, follows in blue
- **Interactive**: Click nodes to display full pubkey, drag to rearrange, zoom/pan
- **Physics engine**: forceAtlas2Based layout for organic network visualization
- **Statistics**: Header displays node count, edge count, seed pubkey

## Setup & Installation

### Prerequisites
- Node.js 18+
- npm or yarn
- Git

### Installation

1. **Clone and navigate to the project:**
   ```bash
   cd /path/to/nostream
   ```

2. **Install competency-test dependencies:**
   ```bash
   cd competency-test
   npm install
   ```

4. **Build the TypeScript:**
   ```bash
   npm run build
   ```

## Usage

### Run the CLI
```bash
npm run cli
```

### Build Web of Trust
```bash
npm run cli
# Select option 1
```

This will:
- Connect to the configured relay
- Traverse the social graph up to MAX_HOPS
- Generate `wot-graph.html` in the current directory
- Print performance metrics to console

### Verify Event PoW
```bash
npm run cli
# Select option 2
# Paste a Nostr event JSON in one line without breaks
```

Example event (kind 1 with PoW):
```json
{"id":"0000000000000000000000000000000000000000000000000000000000000000","pubkey":"3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d","kind":1,"tags":[["nonce","1000000","20"]],"content":"Hello, Nostr!","created_at":1672531200,"sig":"6b3144707a52dc5fbc6e0f0f6c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c8c"}
```

## Technical Details

### Technologies
- **TypeScript** — Type-safe implementation
- **Nostr Protocol** — NIP-01 (basic), NIP-13 (PoW), NIP-19 (bech32)
- **WebSocket** — Real-time relay communication
- **vis-network** — Graph visualization library
- **Commander.js** — CLI argument parsing
- **nostr-tools** — Nostr encoding/decoding utilities

### Key Algorithms

**Graph Traversal:**
- BFS-like approach with hop-based batching
- Maintains visited set to prevent cycles
- Collects all new pubkeys before each hop
- Adapts batch sizes for relay efficiency

### Performance Characteristics

**Typical results with seed pubkey ~2295 nodes:**
- Hop 1: ~3 seconds (523 users fetched)
- Hop 2: ~8 seconds (1771 users fetched)
- Total: ~12 seconds end-to-end
- Memory: < 50MB for 2k+ node graphs

## Author

Saniddhya Dubey — Nostream Competency Test
