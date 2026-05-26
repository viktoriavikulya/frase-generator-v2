const { main } = require("../../archive-x/build-carousel-plan");

if (require.main === module) {
  main().catch(err => {
    console.error("Error construyendo plan de carruseles:");
    console.error(err);
    process.exit(1);
  });
}

module.exports = require("../../archive-x/build-carousel-plan");
