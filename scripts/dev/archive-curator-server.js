const { main } = require("../archive-x/curator-server");

if (require.main === module) {
  main().catch(err => {
    console.error("No se pudo iniciar el curador de archivo_x:");
    console.error(err);
    process.exit(1);
  });
}

module.exports = require("../archive-x/curator-server");
