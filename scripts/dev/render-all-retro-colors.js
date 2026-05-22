const fs = require("fs/promises");
const path = require("path");
const { renderPhrase } = require("../libs/render-lib");

async function main() {
  const text =
    process.argv[2] ||
    "me enamoré del potencial y el potencial renunció sin carta";

  const mode = process.argv[3] || "retro3d";

  const colors = [
    // Ciclo original
    { name: "retroWhite", hex: "#f6f1e8" },
    { name: "retroBlack", hex: "#0d0f14" },
    { name: "retroYellow", hex: "#f4c400" },
    { name: "retroBlue", hex: "#3d5afe" },
    { name: "retroRed", hex: "#e53935" },

    // Ciclo oscuro / melancólico
    { name: "retroWine", hex: "#0d0208" },
    { name: "retroPurple", hex: "#1a0033" },
    { name: "retroNavy", hex: "#0a1628" },
    { name: "retroCoffee", hex: "#1c0a00" },

    // Ciclo cálido / irónico
    { name: "retroOrange", hex: "#ff4d00" },
    { name: "retroPink", hex: "#d4006a" },
    { name: "retroMustard", hex: "#8d6e00" },
    { name: "retroGreen", hex: "#2e7d32" }
  ];

  console.log(`Renderizando ${colors.length} posts en modo "${mode}"...`);
  console.log(`Frase: "${text}"`);
  console.log("");

  for (let i = 0; i < colors.length; i++) {
    const color = colors[i];

    console.log(
      `[${i + 1}/${colors.length}] Renderizando ${color.name} (${color.hex})...`
    );

    const result = await renderPhrase({
      text,
      mode,
      bg: color.hex
    });

    const originalPath = result.outputPath;
    const dir = path.dirname(originalPath);

    const safeName = `${String(i + 1).padStart(2, "0")}_${color.name}_${color.hex.replace("#", "")}.png`;
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