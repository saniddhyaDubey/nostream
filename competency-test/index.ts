import { nip19 } from "nostr-tools";
import WebSocket from "ws";
import { exportGraphToHtml } from "./graphBuilder.js";

// Define the structure of a Nostr event for TypeScript type checking
export interface NostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
  sig: string;
}

//configuration:
const RELAY_URL = "wss://relay.damus.io";

//relay options:
// const RELAY_URL = "wss://nos.lol";
// const RELAY_URL = "wss://relay.primal.net";

// const SEED_PUBKEY = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";  //~16.5 nodes (including leaf nodes) | ~59k edges
const SEED_PUBKEY = "npub19pxkqvlna77masux62kjq56m7s065769mx7jjxltglqy2rcxk6jqrqe7gq";  //~2295 nodes (including leaf nodes) | ~2935 edges
const followGraph = new Map<string, string[]>();
const visited = new Set<string>();
const MAX_HOPS = 2;     //SEED_PUBKEY follow-list = Hop-1, MAX_HOPS = Depth wanted
const MAX_AUTHORS_PER_REQ = 500;
let eventsThisHop = 0;
let totalEdges = 0;
const followTimestamps = new Map<string, number>();
let hopTimer: ReturnType<typeof setTimeout>;
//--------------------------------------------------------------------------------------

// Validate config
if (MAX_HOPS < 1) {
  throw new Error(`MAX_HOPS must be >= 1, got ${MAX_HOPS}`);
}

// Helper function to print final summary stats
function printSummary(startTime: number, seedHex: string): void {
    const totalTime = Date.now() - startTime;
    console.log(`\n─── Final summary ───`);
    console.log(`Seed Pubkey: ${seedHex}`);
    console.log(`Seed Relay: ${RELAY_URL}`);
    console.log(`Hops traversed: ${MAX_HOPS}`);
    console.log(`Unique pubkeys: ${visited.size}`);
    console.log(`Total edges: ${totalEdges}`);
    console.log(`Total time: ${totalTime}ms`);
}


// Helper function to reset the hop timer whenever we receive a new event for the current hop. If we don't receive any new events for 30 seconds, we assume we've reached the end of this hop and move on to the next one to avoid getting stuck waiting indefinitely.
function resetHopTimer(ws: WebSocket, currentHopId: string) {
    clearTimeout(hopTimer);
    hopTimer = setTimeout(() => {
        console.warn(`Hop timed out after 30s, proceeding with ${eventsThisHop} events`);
        ws.send(JSON.stringify(["CLOSE", currentHopId]));
        // simulate EOSE by re-emitting the message
        ws.emit("message", Buffer.from(JSON.stringify(["EOSE", currentHopId])));
    }, 30000);
}

// Main function to build the WoT graph
export function buildWoT () : void {
    // Track total time from start to finish
    const buildStartTime = Date.now();
    let connectStartTime = Date.now();
    let hopStartTime = 0;

    console.log(`Connecting to ${RELAY_URL}...`);

    const ws = new WebSocket(RELAY_URL);

    ws.on("open", () => {
        const connectTime = Date.now() - connectStartTime;
        console.log(`Connected in ${connectTime}ms. Sending Kind-3 request for seed pubkey.`);

        // Mark seed pubkey as visited and start with its follow list
        const pubkey_hex = npubToHex(SEED_PUBKEY)
        visited.add(pubkey_hex)
        const REQ_EVENT = createKind3Req([pubkey_hex], "hop-1");
        resetHopTimer(ws, "hop-1")
        hopStartTime = Date.now();
        ws.send(REQ_EVENT);
    });

    ws.on("message", (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());

        // We expect messages in the format: ["EVENT", subId, event] or ["EOSE", subId]
        if (msg[0] === "EVENT") {
            
            const event: NostrEvent = msg[2];
            const existingTs = followTimestamps.get(event.pubkey);
            if (existingTs === undefined || event.created_at > existingTs) {
                const follows = parseFollowList(event);
                followGraph.set(event.pubkey, follows);
                followTimestamps.set(event.pubkey, event.created_at);
                eventsThisHop++;
                totalEdges += follows.length;
            }
        } else if (msg[0] === "EOSE") {
            clearTimeout(hopTimer)
            // End of current subscription's events, time to process and move to next hop
            // Transition to next hop happens using BFS (breadth-first search) logic: we gather all unique follows from the current hop's events, then request their follow lists in the next hop            
            const subId = msg[1];
            ws.send(JSON.stringify(["CLOSE", subId]));

            const currentHop = parseInt(subId.split("-")[1], 10);
            const nextHop = currentHop + 1;
            const hopDuration = Date.now() - hopStartTime;
            
            // Gather unique next targets for the following hop
            const nextTargets = new Set<string>();
            for (const follows of followGraph.values()) {
              for (const f of follows) {
                if (!visited.has(f)){
                  visited.add(f);
                  nextTargets.add(f);
                }
              }
            }

            console.log(
                `Hop ${currentHop} done in ${hopDuration}ms: ${eventsThisHop} contact list(s) · ${totalEdges} total edges · ${visited.size} unique pubkeys so far`
            );

            eventsThisHop = 0;

            if (nextHop > MAX_HOPS) {
                printSummary(buildStartTime, npubToHex(SEED_PUBKEY));
                exportGraphToHtml(followGraph, npubToHex(SEED_PUBKEY));
                ws.close();
                return;
            }

            

            if (nextTargets.size === 0) {
                printSummary(buildStartTime, npubToHex(SEED_PUBKEY));
                exportGraphToHtml(followGraph, npubToHex(SEED_PUBKEY));
                ws.close();
                return;
            }

            console.log(`Hop ${nextHop}: fetching follows for ${nextTargets.size} users.`);
            // Send new request for the next hop with all unique targets collected from the current hop's events. We can batch them up to MAX_AUTHORS_PER_REQ per request if needed.
            hopStartTime = Date.now();
            ws.send(createKind3Req(Array.from(nextTargets), `hop-${nextHop}`));
            resetHopTimer(ws, `hop-${nextHop}`)
        }
    });

    ws.on("error", (err: Error) => {
        console.error("WebSocket error:", err.message);
    });

    ws.on("close", (code: number, reason: Buffer) => {
        console.log(`Connection closed. Code: ${code}, Reason: ${reason.toString() || "none"}`);
    });
}

// Helper functions
function npubToHex(npub: string): string {
  const decoded = nip19.decode(npub);

  if (decoded.type !== "npub") {
    throw new Error(`Expected npub, got ${decoded.type}`);
  }

  return decoded.data;
}

// Build a Nostr subscription request for kind 3 (contact lists) with a list of pubkeys
function createKind3Req(pubkey: string[], subscriptionId?: string): string {
    const subId = subscriptionId ?? `sub-${Math.random().toString(36).slice(2, 10)}`;
    // We can only request a limited number of authors per subscription, so we may need to batch requests if the list is too long. For simplicity, this function assumes the caller will handle batching if needed.
    const req = [
        "REQ",
        subId,
        {
        kinds: [3],
        authors: pubkey,
        limit: MAX_AUTHORS_PER_REQ,
        },
    ];
    return JSON.stringify(req);
}

// Extract the list of followed pubkeys from a kind 3 event's tags
export function parseFollowList(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === "p" && typeof tag[1] === "string" && /^[0-9a-f]{64}$/i.test(tag[1]))
    .map((tag) => tag[1].toLowerCase())
}

// Count the number of leading zero bits in a hex string (event ID)
export function countLeadingZeroBits(hexId: string): number {
  let count = 0;

  for (const char of hexId) {
    const nibble = parseInt(char, 16);
    if (isNaN(nibble)) {
      throw new Error(`Invalid hex character in event ID: ${char}`);
    }
    if (nibble === 0) {
      count += 4;
      continue;
    }
    count += Math.clz32(nibble) - 28;
    break;
  }

  return count;
}

// Verify if a given event meets its claimed PoW target (if any)
export function verifyEventPow(event: NostrEvent): {
  actualDifficulty: number;
  committedTarget: number | null;
  valid: boolean;
  message: string;
} {
  // The event ID is a SHA-256 hash of the event content, so its leading zero bits indicate the actual PoW difficulty. We look for a "nonce" tag to find the claimed target difficulty. If no nonce tag is present, we consider it valid but uncommitted.
  const actualDifficulty = countLeadingZeroBits(event.id);
  const nonceTag = event.tags.find((t) => t[0] === "nonce");

  if (!nonceTag) {
    return {
      actualDifficulty,
      committedTarget: null,
      valid: true,
      message: `No nonce tag present. Event ID has ${actualDifficulty} leading zero bits (uncommitted).`,
    };
  }

  // If a nonce tag is present, we expect it to have a target value indicating the required difficulty. We compare the actual difficulty against this target to determine validity.
  const rawTarget = nonceTag[2];
  if (rawTarget === undefined) {
    return {
      actualDifficulty,
      committedTarget: null,
      valid: false,
      message: `Nonce tag present but no target committed. Event ID has ${actualDifficulty} leading zero bits.`,
    };
  }

  // The target should be an integer representing the required number of leading zero bits. We parse it and compare against the actual difficulty.
  const committedTarget = parseInt(rawTarget, 10);
  if (isNaN(committedTarget)) {
    return {
      actualDifficulty,
      committedTarget: null,
      valid: false,
      message: `Nonce tag has invalid target value: "${rawTarget}".`,
    };
  }

  // An event is valid if its actual difficulty meets or exceeds the committed target. We return a detailed message indicating the result.
  const valid = actualDifficulty >= committedTarget;
  return {
    actualDifficulty,
    committedTarget,
    valid,
    message: valid
      ? `Valid: event meets committed target of ${committedTarget} (actual: ${actualDifficulty} bits).`
      : `Invalid: event claims ${committedTarget} bits but only has ${actualDifficulty}.`,
  };
}
