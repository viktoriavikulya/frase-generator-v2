const { main } = require("../../archive-x/import-saved-tweets-to-sheet");

if (require.main === module) {
  main().catch(err => {
    console.error("Error importando archivo X:");
    console.error(err);
    process.exit(1);
  });
}

module.exports = require("../../archive-x/import-saved-tweets-to-sheet");
