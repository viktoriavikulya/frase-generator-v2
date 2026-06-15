const { renderPhrase } = require("../libs/render-lib");

async function main() {
  const text = process.argv[2] || "Creen que me voy a quedar callada pero toda la vida me han regañado por contestona";
  const mode = process.argv[3] || "retro3d";
  const bg = process.argv[4] || "#0a1628";

  const result = await renderPhrase({ text, mode, bg });
  console.log("Imagen guardada en:", result.outputPath);
}

main().catch((err) => {
  console.error("Error renderizando:", err);
  process.exit(1);
});