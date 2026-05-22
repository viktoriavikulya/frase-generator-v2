const fs = require("fs/promises");
const path = require("path");
const { renderPhrase } = require("../libs/render-lib");
const { RETRO_PALETTES } = require("../libs/retro-palettes");

async function main() {
  const text =
    process.argv[2] ||
    "me enamoré del potencial y el potencial renunció sin carta";

  const mode = process.argv[3] || "retro3d";

  const colors = RETRO_PALETTES.filter(p => p.inCycle);

  console.log(`Renderizando ${colors.length} posts en modo "${mode}"...`);
  console.log(`Frase: "${text}"`);
  console.log("");

  for (let i = 0; i < colors.length; i++) {
    const color = colors[i];

    console.log(
      `[${i + 1}/${colors.length}] Renderizando ${color.id} (${color.bg})...`
    );

    const result = await renderPhrase({
      text,
      mode,
      bg: color.bg
    });

    const originalPath = result.outputPath;
    const dir = path.dirname(originalPath);

    const safeName = `${String(i + 1).padStart(2, "0")}_${color.id}_${color.bg.replace("#", "")}.png`;
    const finalPath = path.join(dir, safeName);

    await fs.rename(originalPath, finalPath);

    console.log(`✅ Guardado en: ${finalPath}`);
    console.log("");
  }

  console.log("Listo. Se generó un post por cada color.");
}

main().catch((err) => {
  console.error("Error renderizando:", err);
  process.exit(1);
});