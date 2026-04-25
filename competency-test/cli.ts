import * as readline from "readline/promises";
import { buildWoT, NostrEvent, verifyEventPow } from "./index.js";
import { Command } from "commander";
import { stdin as input, stdout as output } from "process";

const program = new Command();

program
  .name("wot-cli")
  .description("CLI for WoT builder and NIP-13 PoW verifier")
  .version("1.0.0");

program
  .command("run")
  .description("Interactive menu")
  .action(async () => {
    const rl = readline.createInterface({ input, output });

    console.log("\n=== Moderation & Discovery Engine ===");
    console.log("1) Build Web of Trust");
    console.log("2) Verify NIP-13 PoW of an event");
    const choice = (await rl.question("\nSelect an option (1/2): ")).trim();

    if (choice === "1") {
        rl.close();
        console.log("\nRunning WoT builder with default values from source.");
        console.log("To change seed / relay / max hops, edit the constants in index.ts.\n");
        buildWoT();
    } else if (choice === "2") {
        const eventJson = (await rl.question("Paste the Nostr event JSON (single line):\n")).trim();
        rl.close();

        let event: NostrEvent;
        try {
            event = JSON.parse(eventJson);
        } catch (err) {
            console.error("Invalid JSON:", (err as Error).message);
            return;
        }

        if (!event.id) {
            console.error("Event is missing 'id' field.");
            return;
        }

        const result = verifyEventPow(event);
        console.log(`\n${result.message}`);
        console.log(`Actual difficulty: ${result.actualDifficulty} bits`);
        console.log(`Committed target:  ${result.committedTarget ?? "none"}`);
        console.log(`Verdict:           ${result.valid ? "✅ valid" : "❌ invalid"}`);
    }
})

program.parse(process.argv);
