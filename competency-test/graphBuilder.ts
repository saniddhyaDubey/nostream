import { resolve } from "path";
import { writeFileSync } from "fs";

export function exportGraphToHtml(
  followGraph: Map<string, string[]>,
  seedHex: string,
  outPath: string = "wot-graph.html"
): void {

    const nodes: { id: string; label: string; color: string; size: number }[] = [];
    const edges: { from: string; to: string }[] = [];
    const seen = new Set<string>();

    function addNode(pk: string): void {
    if (seen.has(pk)) return;
    seen.add(pk);
    nodes.push({
        id: pk,
        label: pk.slice(0, 8),
        color: pk === seedHex ? "#ff6b6b" : "#4dabf7",
        size: pk === seedHex ? 30 : 10,
    });
    }

    for (const [author, follows] of followGraph) {
        addNode(author);
        for (const f of follows) {
            addNode(f);
            edges.push({ from: author, to: f });
        }
    }

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Web of Trust — ${seedHex.slice(0, 12)}...</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #1a1a1a; color: #eee; }
    #header { padding: 12px 20px; background: #222; border-bottom: 1px solid #333; }
    #header h1 { margin: 0; font-size: 18px; }
    #header p { margin: 4px 0 0; font-size: 13px; color: #aaa; }
    #network { width: 100vw; height: calc(100vh - 70px); }
    #info { position: absolute; bottom: 20px; left: 20px; background: rgba(0,0,0,0.7);
            padding: 10px 14px; border-radius: 6px; font-size: 13px; max-width: 500px;
            word-break: break-all; display: none; }
  </style>
</head>
<body>
  <div id="header">
    <h1>Web of Trust</h1>
    <p>Seed: ${seedHex} · ${nodes.length} nodes · ${edges.length} edges · Click a node for details</p>
  </div>
  <div id="network"></div>
  <div id="info"></div>
  <script>
    const nodes = new vis.DataSet(${JSON.stringify(nodes)});
    const edges = new vis.DataSet(${JSON.stringify(edges)});
    const container = document.getElementById("network");
    const info = document.getElementById("info");
    const options = {
      nodes: { shape: "dot", font: { color: "#eee", size: 11 } },
      edges: { arrows: "to", color: { color: "#555", opacity: 0.4 }, smooth: false },
      physics: { solver: "forceAtlas2Based", stabilization: { iterations: 200 } },
      interaction: { hover: true, dragNodes: true, zoomView: true }
    };
    const network = new vis.Network(container, { nodes, edges }, options);
    network.on("click", (params) => {
      if (params.nodes.length > 0) {
        info.textContent = "Pubkey: " + params.nodes[0];
        info.style.display = "block";
      } else {
        info.style.display = "none";
      }
    });
  </script>
</body>
</html>`;

  writeFileSync(outPath, html);
  console.log(`\n📊 Graph written to: ${resolve(outPath)}`);
  console.log(`   Open it in a browser to explore the Web of Trust.\n`);
}
