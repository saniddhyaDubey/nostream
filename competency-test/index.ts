import { nip19 } from "nostr-tools";
import WebSocket from "ws";
import { exportGraphToHtml } from "./graphBuilder.js";

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
//--------------------------------------------------------------------------------------

// Validate config
if (MAX_HOPS < 1) {
  throw new Error(`MAX_HOPS must be >= 1, got ${MAX_HOPS}`);
}

export function buildWoT () : void {
    const buildStartTime = Date.now();
    let connectStartTime = Date.now();
    let hopStartTime = 0;

    console.log(`Connecting to ${RELAY_URL}...`);

    const ws = new WebSocket(RELAY_URL);

    ws.on("open", () => {
        const connectTime = Date.now() - connectStartTime;
        console.log(`Connected in ${connectTime}ms. Sending Kind-3 request for seed pubkey.`);

        const pubkey_hex = npubToHex(SEED_PUBKEY)
        visited.add(pubkey_hex)
        const REQ_EVENT = createKind3Req([pubkey_hex], "hop-1");
        hopStartTime = Date.now();
        ws.send(REQ_EVENT);
    });

    ws.on("message", (data: WebSocket.RawData) => {
        const msg = JSON.parse(data.toString());

        if (msg[0] === "EVENT") {
            
            const event: NostrEvent = msg[2];
            const follows = parseFollowList(event);
            followGraph.set(event.pubkey, follows);
            eventsThisHop++;
            totalEdges += follows.length;
        } else if (msg[0] === "EOSE") {
            
            const subId = msg[1];
            ws.send(JSON.stringify(["CLOSE", subId]));

            const currentHop = parseInt(subId.split("-")[1], 10);
            const nextHop = currentHop + 1;
            const hopDuration = Date.now() - hopStartTime;
            console.log(
                `Hop ${currentHop} done in ${hopDuration}ms: ${eventsThisHop} contact list(s) · ${totalEdges} total edges · ${visited.size} unique pubkeys so far`
            );
            eventsThisHop = 0;

            if (nextHop > MAX_HOPS) {

                const totalTime = Date.now() - buildStartTime;
                console.log(`\n─── Final summary ───`);
                console.log(`Hops traversed: ${MAX_HOPS}`);
                console.log(`Unique pubkeys: ${visited.size}`);
                console.log(`Total edges: ${totalEdges}`);
                console.log(`Total time: ${totalTime}ms`);
                exportGraphToHtml(followGraph, npubToHex(SEED_PUBKEY));
                ws.close();
                return;
            }

            const nextTargets = new Set<string>();
            for (const follows of followGraph.values()) {
                for (const f of follows) {
                    if (!visited.has(f)){
                        visited.add(f);
                        nextTargets.add(f);
                    }
                }
            }

            if (nextTargets.size === 0) {
                
                const totalTime = Date.now() - buildStartTime;
                console.log(`\n─── Final summary ───`);
                console.log(`Hops traversed: ${MAX_HOPS}`);
                console.log(`Unique pubkeys: ${visited.size}`);
                console.log(`Total edges: ${totalEdges}`);
                console.log(`Total time: ${totalTime}ms`);
                exportGraphToHtml(followGraph, npubToHex(SEED_PUBKEY));
                ws.close();
                return;
            }

            console.log(`Hop ${nextHop}: fetching follows for ${nextTargets.size} users.`);
            hopStartTime = Date.now();
            ws.send(createKind3Req(Array.from(nextTargets), `hop-${nextHop}`));
        }
    });

    ws.on("error", (err: Error) => {
        console.error("WebSocket error:", err.message);
    });

    ws.on("close", (code: number, reason: Buffer) => {
        console.log(`Connection closed. Code: ${code}, Reason: ${reason.toString() || "none"}`);
    });
}

function npubToHex(npub: string): string {
  const decoded = nip19.decode(npub);

  if (decoded.type !== "npub") {
    throw new Error(`Expected npub, got ${decoded.type}`);
  }

  return decoded.data;
}

function createKind3Req(pubkey: string[], subscriptionId?: string): string {
    const subId = subscriptionId ?? `sub-${Math.random().toString(36).slice(2, 10)}`;

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

function parseFollowList(event: NostrEvent): string[] {
  return event.tags
    .filter((tag) => tag[0] === "p")
    .map((tag) => tag[1])
}

function countLeadingZeroBits(hexId: string): number {
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

export function verifyEventPow(event: NostrEvent): {
  actualDifficulty: number;
  committedTarget: number | null;
  valid: boolean;
  message: string;
} {
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

  const rawTarget = nonceTag[2];
  if (rawTarget === undefined) {
    return {
      actualDifficulty,
      committedTarget: null,
      valid: false,
      message: `Nonce tag present but no target committed. Event ID has ${actualDifficulty} leading zero bits.`,
    };
  }

  const committedTarget = parseInt(rawTarget, 10);
  if (isNaN(committedTarget)) {
    return {
      actualDifficulty,
      committedTarget: null,
      valid: false,
      message: `Nonce tag has invalid target value: "${rawTarget}".`,
    };
  }

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
